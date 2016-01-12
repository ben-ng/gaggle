var StrategyInterface = require('./strategy-interface')
  , Joi = require('joi')
  , util = require('util')
  , Promise = require('bluebird')
  , _ = require('lodash')
  , prettifyJoiError = require('../helpers/prettify-joi-error')
  , STATES = {
      CANDIDATE: 'CANDIDATE'
    , LEADER: 'LEADER'
    , FOLLOWER: 'FOLLOWER'
    }
  , RPC_TYPE = {
      REQUEST_VOTE: 'REQUEST_VOTE'
    , REQUEST_VOTE_REPLY: 'REQUEST_VOTE_REPLY'
    , APPEND_ENTRIES: 'APPEND_ENTRIES'
    , APPEND_ENTRIES_REPLY: 'APPEND_ENTRIES_REPLY'
    }

/**
* A naive solution to distributed mutual exclusion. Performs leader election
* and then routes all lock requests through the leader. Supports membership
* changes. Somewhat fault tolerant -- crashes trigger a new round of leader
* election. The intent of this strategy is to handle membership changes so
* that other strategies can inherit from it and focus on different strategies
* for mutual exclusion. The leader election is inspired by Raft's.
*/

function LeaderStrategy (opts) {
  var self = this
    , validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
        strategyOptions: Joi.object().keys({
          electionTimeout: Joi.object().keys({
            min: Joi.number().min(0)
          , max: Joi.number().min(Joi.ref('strategyOptions.electionTimeout.min'))
          }).default({min: 150, max: 300})
        , heartbeatInterval: Joi.number().min(0).default(50)
        , clusterSize: Joi.number().min(1)
        })
      , channel: Joi.object()
      , id: Joi.string()
      }).requiredKeys('strategyOptions', 'strategyOptions.clusterSize'), {
        convert: false
      })
    , electMin
    , electMax
    , heartbeatInterval

  StrategyInterface.apply(this, Array.prototype.slice.call(arguments))

  if (validatedOptions.error != null) {
    throw new Error(prettifyJoiError(validatedOptions.error))
  }
  // For convenience
  electMin = validatedOptions.value.strategyOptions.electionTimeout.min
  electMax = validatedOptions.value.strategyOptions.electionTimeout.max
  this._clusterSize = validatedOptions.value.strategyOptions.clusterSize
  heartbeatInterval = validatedOptions.value.strategyOptions.heartbeatInterval

  opts.channel.connect()
  this._channel = opts.channel

  // Volatile state on all servers

  // "When servers start up, they begin as followers"
  // p16
  this._state = STATES.FOLLOWER
  this._leader = null

  this._currentTerm = 0
  this._votedFor = null
  this._log = []
  this._commitIndex = 0
  this._lastApplied = 0

  // Volatile state on leaders
  this._nextIndex = {}
  this._matchIndex = {}

  // Volatile state on candidates
  this._votes = {}

  // "If a follower recieves no communication over a period of time called the election timeout
  // then it assumes there is no viable leader and begins an election to choose a new leader"
  // p16
  this._lastCommunicationTimestamp = Date.now()

  this._generateRandomElectionTimeout = function _generateRandomElectionTimeout () {
    return _.random(electMin, electMax, false) // no floating points
  }

  this._beginLeaderHeartbeat = function _beginLeaderHeartbeat () {
    // Send initial blank entry
    self._channel.broadcast({
      type: RPC_TYPE.APPEND_ENTRIES
    , term: self._currentTerm
    , leaderId: self.id
    , prevLogIndex: -1
    , prevLogTerm: -1
    , entries: []
    , leaderCommit: self._commitIndex
    })

    clearInterval(self._leaderHeartbeatInterval)

    self._leaderHeartbeatInterval = setInterval(function () {
      self._channel.broadcast({
        type: RPC_TYPE.APPEND_ENTRIES
      , term: self._currentTerm
      , leaderId: self.id
      , prevLogIndex: -1
      , prevLogTerm: -1
      , entries: []
      , leaderCommit: self._commitIndex
      })
    }, heartbeatInterval)
  }

  this._onMessageRecieved = _.bind(this._onMessageRecieved, this)
  this._channel.on('recieved', this._onMessageRecieved)

  this._resetElectionTimeout()
}

util.inherits(LeaderStrategy, StrategyInterface)

LeaderStrategy.prototype._onMessageRecieved = function _onMessageRecieved (originNodeId, data) {
  var self = this
    , conflictedAt = -1

  self._resetElectionTimeout()

  // data always has the following keys:
  // {
  //   type: the RPC method call or response
  //   term: some integer
  // }

  if (data.term > self._currentTerm) {
    self._currentTerm = data.term
    self._leader = null
    self._votedFor = null
    self._state = STATES.FOLLOWER
    clearInterval(self._leaderHeartbeatInterval)
  }

  switch (data.type) {
    case RPC_TYPE.REQUEST_VOTE:
    if (data.term < self._currentTerm) {
      self._channel.send(originNodeId, {
        type: RPC_TYPE.REQUEST_VOTE_REPLY
      , term: self._currentTerm
      , votedGranted: false
      })
      return
    }

    if ((self._votedFor == null || self._votedFor === data.candidateId) &&
      (data.lastLogIndex < 0 || data.lastLogIndex >= self._log.length)) {
      self._votedFor = data.candidateId
      self._channel.send(data.candidateId, {
        type: RPC_TYPE.REQUEST_VOTE_REPLY
      , term: self._currentTerm
      , votedGranted: true
      })
      return
    }
    break

    case RPC_TYPE.REQUEST_VOTE_REPLY:
    // broadcasts reach ourselves, so we'll actually vote for ourselves here
    if (self._state === STATES.CANDIDATE &&
        data.term === self._currentTerm &&
        data.votedGranted === true) {

      self._votes[originNodeId] = true

      if (_.values(self._votes).length > Math.ceil(this._clusterSize/2)) {
        self._state = STATES.LEADER
        self._beginLeaderHeartbeat()
      }
    }
    break

    case RPC_TYPE.APPEND_ENTRIES:
    // This is how you lose an election
    if (data.term >= self._currentTerm && self._state !== STATES.LEADER) {
      self._state = STATES.FOLLOWER
      self._leader = originNodeId
    }

    // Reciever Implementation 1 & 2
    // p13
    if (data.term < self._currentTerm ||
      self._log[data.prevLogIndex] == null  ||
      self._log[data.prevLogIndex].term !== data.prevLogTerm) {
      self._channel.send(originNodeId, {
        type: RPC_TYPE.APPEND_ENTRIES_REPLY
      , term: self._currentTerm
      , success: false
      })
      return
    }

    _.each(data.entries, function (entry) {
      // entry is:
      // {index: 0, term: 0, data: {foo: bar}}
      var idx = entry.index

      if (self._log[idx] != null && self._log[idx].term !== entry.term) {
        conflictedAt = idx
      }
    })

    if (conflictedAt > 0) {
      self._log = self._log.slice(0, conflictedAt)
    }

    _.each(data.entries, function (entry) {
      var idx = entry.index

      if (self._log[idx] == null) {
        self._log[idx] = {
          term: entry.term
        , data: entry.data
        }
      }
    })

    if (data.leaderCommit > self._commitIndex) {
      self._commitIndex = Math.min(data.leaderCommit, Math.max.apply(null, _.pluck(data.entries, 'index')))
    }

    break
  }
}

LeaderStrategy.prototype._resetElectionTimeout = function _resetElectionTimeout () {
  var self = this

  if (this._electionTimeout != null) {
    clearTimeout(this._electionTimeout)
  }

  this._electionTimeout = setTimeout(function () {
    self._resetElectionTimeout()
    self._beginElection()
  }, this._generateRandomElectionTimeout())
}

LeaderStrategy.prototype._beginElection = function _beginElection () {
  // To begin an election, a follower increments its current term and transitions to
  // candidate state. It then votes for itself and issues RequestVote RPCs in parallel
  // to each of the other servers in the cluster.
  // p16
  var lastLogIndex

  this._currentTerm = this._currentTerm + 1
  this._state = STATES.CANDIDATE
  this._leader = null
  this._votedFor = this.id
  this._votes = {}

  lastLogIndex = this._log.length - 1

  this._channel.broadcast({
    type: RPC_TYPE.REQUEST_VOTE
  , term: this._currentTerm
  , candidateId: this.id
  , lastLogIndex: lastLogIndex
  , lastLogTerm: lastLogIndex > 0 ? self._log[lastLogIndex].term : -1
  })
}

LeaderStrategy.prototype._lock = function _lock (key, opts) {
  return Promise.reject(new Error('Unimplemented'))
}

LeaderStrategy.prototype._unlock = function _unlock (lock) {
  return Promise.reject(new Error('Unimplemented'))
}

LeaderStrategy.prototype._close = function _close () {
  var self = this

  this._channel.removeListener('recieved', this._onMessageRecieved)
  clearTimeout(this._electionTimeout)
  clearInterval(this._leaderHeartbeatInterval)

  return new Promise(function (resolve, reject) {
    self._channel.once('disconnected', function () {
      resolve()
    })
    self._channel.disconnect()
  })
}

module.exports = LeaderStrategy

module.exports._STATES = _.cloneDeep(STATES)

