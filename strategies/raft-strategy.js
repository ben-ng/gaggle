var StrategyInterface = require('./strategy-interface')
  , Joi = require('joi')
  , util = require('util')
  , Promise = require('bluebird')
  , _ = require('lodash')
  , uuid = require('uuid')
  , EventEmitter = require('events').EventEmitter
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
    , REQUEST_LOCK: 'REQUEST_LOCK'
    , REQUEST_LOCK_REPLY: 'REQUEST_LOCK_REPLY'
    , REQUEST_UNLOCK: 'REQUEST_UNLOCK'
    , REQUEST_UNLOCK_REPLY: 'REQUEST_UNLOCK_REPLY'
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
  this._commitIndex = -1
  this._lastApplied = -1

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
    // Send initial blank entry. Don't broadcast this, as we
    // do NOT want to recieve our own append entry message...
    _.each(self._votes, function (v, nodeId) {
      self._channel.send(nodeId, {
        type: RPC_TYPE.APPEND_ENTRIES
      , term: self._currentTerm
      , leaderId: self.id
      , prevLogIndex: -1
      , prevLogTerm: -1
      , entries: []
      , leaderCommit: self._commitIndex
      })
    })

    clearInterval(self._leaderHeartbeatInterval)

    self._leaderHeartbeatInterval = setInterval(function () {

      _.each(self._votes, function (v, nodeId) {
        var entriesToSend = []
          , prevLogIndex = -1
          , prevLogTerm = -1

        // Initialize to leader last log index + 1 if empty
        // (Reset after each election)
        if (self._nextIndex[nodeId] == null) {
          self._nextIndex[nodeId] = self._log.length
        }

        for (var i=self._nextIndex[nodeId], ii=self._log.length; i<ii; ++i) {
          entriesToSend.push(_.extend({index: i}, self._log[i]))
        }

        if (entriesToSend.length > 0) {
          prevLogIndex = entriesToSend[0].index - 1

          if (prevLogIndex > -1) {
            prevLogTerm = self._log[prevLogIndex].term
          }
        }

        self._channel.send(nodeId, {
          type: RPC_TYPE.APPEND_ENTRIES
        , term: self._currentTerm
        , leaderId: self.id
        , prevLogIndex: prevLogIndex
        , prevLogTerm: prevLogTerm
        , entries: entriesToSend
        , leaderCommit: self._commitIndex
        })
      })
    }, heartbeatInterval)
  }

  this._onMessageRecieved = _.bind(this._onMessageRecieved, this)
  this._channel.on('recieved', this._onMessageRecieved)

  this._resetElectionTimeout()

  // Used for internal communication, such as when an entry is committed
  this._emitter = new EventEmitter()
}

util.inherits(LeaderStrategy, StrategyInterface)

LeaderStrategy.prototype._onMessageRecieved = function _onMessageRecieved (originNodeId, data) {
  var self = this
    , i
    , ii

  self._handleMessage(originNodeId, data)

  // If we are the leader, must try to increase our commitIndex here, so that
  // followers will find out about it and increment their own commitIndex
  if (self._state === STATES.LEADER) {
    // After handling any message, check to see if we can increment our commitIndex
    var highestPossibleCommitIndex = -1

    for (i=self._commitIndex + 1, ii=self._log.length; i<ii; ++i) {
      // Log entries must be from the current term
      if (self._log[i].term !== self._currentTerm) {
        continue
      }

      // There must be a majority of matchIndexes >= i
      if (_.filter(self._matchIndex, function (matchIndex) {
          return matchIndex >= i
        }).length > Math.ceil(self._clusterSize/2)) {
        highestPossibleCommitIndex = i
      }
    }

    if (highestPossibleCommitIndex > -1) {
      self._commitIndex = highestPossibleCommitIndex
    }
  }

  // All nodes should commit entries between lastApplied and commitIndex
  for (i=Math.max(0, self._lastApplied), ii=self._commitIndex; i<=ii; ++i) {
    self._emitter.emit('committed', self._log[i])
  }

  self._lastApplied = self._commitIndex
}

LeaderStrategy.prototype._handleMessage = function _handleMessage (originNodeId, data) {

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
    case RPC_TYPE.REQUEST_LOCK:
    case RPC_TYPE.REQUEST_UNLOCK:
    if (data.term === self._currentTerm && self._state === STATES.LEADER) {
      self._log.push({
        term: self._currentTerm
      , data: {
          key: data.key
        , nonce: data.nonce
        , ttl: data.type === RPC_TYPE.REQUEST_UNLOCK ? -1 : data.ttl
        }
      })
    }

    break

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

      // Keep collecting votes because that's how we discover what process ids are
      // in the system
      self._votes[originNodeId] = true

      if (_.values(self._votes).length > Math.ceil(this._clusterSize/2) && // Wait for a majority
        self._state !== STATES.LEADER) { // Stops this from happening when additional votes come in
        self._state = STATES.LEADER
        self._nextIndex = {}
        self._matchIndex = {}
        self._beginLeaderHeartbeat()
        self._emitter.emit('leaderElected')
      }
    }
    break

    case RPC_TYPE.APPEND_ENTRIES:
    // This is how you lose an election
    if (data.term >= self._currentTerm && self._state !== STATES.LEADER) {
      self._state = STATES.FOLLOWER
      self._leader = originNodeId
      self._emitter.emit('leaderElected')
    }

    // Reciever Implementation 1 & 2
    // p13

    /*eslint-disable no-extra-parens*/
    if (data.term < self._currentTerm ||                        // 1. reply false if term < currentTerm (section 3.3)
      (
        data.prevLogIndex > -1 &&                               // Don't do this if log is empty; it'll fail for the wrong reasons
        (self._log[data.prevLogIndex] == null  ||               // 2. reply false if log doesn't contain an entry at prevLogIndex
        self._log[data.prevLogIndex].term !== data.prevLogTerm) //    whose term matches prevLogTerm (section 3.5)
      )
      ) {
    /*eslint-enable no-extra-parens*/
      self._channel.send(originNodeId, {
        type: RPC_TYPE.APPEND_ENTRIES_REPLY
      , term: self._currentTerm
      , success: false
      })
      return
    }


    // 3. If an existing entry conflicts with a new one (same index but different terms),
    // delete the existing entry and all that follow it. (section 3.5)
    // p13
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

    // 4. Append any new entries not already in the log
    _.each(data.entries, function (entry) {
      var idx = entry.index

      if (self._log[idx] == null) {
        self._log[idx] = {
          term: entry.term
        , data: entry.data
        }
      }
    })

    // 5. If leaderCommit > commitIndex, set commitIndex = min(leaderCommit, index of last new entry)
    if (data.leaderCommit > self._commitIndex) {
      self._commitIndex = Math.min(data.leaderCommit, Math.max.apply(null, _.pluck(data.entries, 'index')))
    }

    self._channel.send(originNodeId, {
      type: RPC_TYPE.APPEND_ENTRIES_REPLY
    , term: self._currentTerm
    , success: true
    , lastLogIndex: self._log.length - 1
    })

    break

    case RPC_TYPE.APPEND_ENTRIES_REPLY:
    if (self._state === STATES.LEADER && self._currentTerm === data.term) {
      if (data.success === true && data.lastLogIndex > -1) {
        self._nextIndex[originNodeId] = data.lastLogIndex + 1
        self._matchIndex[originNodeId] = data.lastLogIndex

        // Find out what the highest commited entry is
      }
      else {
        if (self._nextIndex[originNodeId] == null) {
          self._nextIndex[originNodeId] = self._log.length
        }

        self._nextIndex[originNodeId] = Math.max(self._nextIndex[originNodeId] - 1, 0)
      }
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
  var self = this
    , sameNonce = self.id + '_' + uuid.v4()

  if (self._state === STATES.LEADER) {
    // Append to the log...
    self._log.push({
      term: self._currentTerm
    , data: {
        key: key
      , ttl: Date.now() + opts.duration
      , nonce: sameNonce
      }
    })
  }
  else if (self._state === STATES.FOLLOWER && self._leader != null) {
    self._channel.send(self.leader, {
      type: RPC_TYPE.REQUEST_LOCK
    , term: self._currentTerm
    , key: key
    , ttl: Date.now() + opts.duration
    , nonce: sameNonce
    })
  }

  return new Promise(function (resolve, reject) {
    var grantOnCommitted = function _grantOnCommitted (entry) {
          // A ttl < 0 is an unlock request and should be ignored
          if (entry.data.nonce !== sameNonce || entry.data.ttl < 0) {
            return
          }

          self._emitter.removeListener('committed', grantOnCommitted)
          clearTimeout(timeoutHandle)

          resolve({
            key: entry.data.key
          , nonce: entry.data.nonce
          })
        }
      , timeoutHandle

    // And wait for acknowledgement. Once we commit the entry,
    // we can grant the lock.
    self._emitter.on('committed', grantOnCommitted)

    // If we time out before the lock is granted
    // remove the event handler and reject
    timeoutHandle = setTimeout(function onGrantTimeout () {
      self._emitter.removeListener('committed', grantOnCommitted)

      reject(new Error('Timed out before acquiring the lock'))
    }, opts.maxWait)
  })
}

LeaderStrategy.prototype._unlock = function _unlock (lock) {
  var self = this
    , sameNonce = lock.nonce

  if (self._state === STATES.LEADER) {
    // Append to the log...
    self._log.push({
      term: self._currentTerm
    , data: {
        key: lock.key
      , nonce: lock.nonce
      , ttl: -1
      }
    })
  }
  else if (self._state === STATES.FOLLOWER && self._leader != null) {
    self._channel.send(self.leader, {
      type: RPC_TYPE.REQUEST_UNLOCK
    , term: self._currentTerm
    , key: lock.key
    , nonce: sameNonce
    })
  }

  return new Promise(function (resolve, reject) {
    var UNLOCK_TIMEOUT = 5000
      , ackOnCommitted = function _ackOnCommitted (entry) {
          // A ttl > 0 is a lock acquisition and should be ignored
          if (entry.data.nonce !== sameNonce || entry.data.ttl > 0) {
            return
          }

          self._emitter.removeListener('committed', ackOnCommitted)
          clearTimeout(timeoutHandle)

          resolve()
        }
      , timeoutHandle

    // And wait for acknowledgement. Once we commit the entry,
    // we can confirm the unlock.
    self._emitter.on('committed', ackOnCommitted)

    // If we time out before the lock is granted
    // remove the event handler and reject
    timeoutHandle = setTimeout(function onUnlockTimeout () {
      self._emitter.removeListener('committed', ackOnCommitted)

      reject(new Error('Timed out before unlocking'))
    }, UNLOCK_TIMEOUT)
  })
}

LeaderStrategy.prototype._close = function _close () {
  var self = this

  this._channel.removeListener('recieved', this._onMessageRecieved)
  clearTimeout(this._electionTimeout)
  clearInterval(this._leaderHeartbeatInterval)

  this._emitter.removeAllListeners()

  return new Promise(function (resolve, reject) {
    self._channel.once('disconnected', function () {
      resolve()
    })
    self._channel.disconnect()
  })
}

module.exports = LeaderStrategy

module.exports._STATES = _.cloneDeep(STATES)

