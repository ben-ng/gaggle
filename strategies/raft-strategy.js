var StrategyInterface = require('./strategy-interface')
  , Joi = require('joi')
  , util = require('util')
  , Promise = require('bluebird')
  , _ = require('lodash')
  , uuid = require('uuid')
  , once = require('once')
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
          }).default({min: 500, max: 1000})
        , heartbeatInterval: Joi.number().min(0).default(50)
        , clusterSize: Joi.number().min(1)
        })
      , channel: Joi.object()
      , id: Joi.string()
      }).requiredKeys('channel', 'strategyOptions', 'strategyOptions.clusterSize'), {
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

  // Used for internal communication, such as when an entry is committed
  this._emitter = new EventEmitter()

  // Volatile state on all servers

  // "When servers start up, they begin as followers"
  // p16
  this._state = STATES.FOLLOWER
  this._leader = null

  this._currentTerm = 0
  this._votedFor = null
  this._log = [] // [{term: 1, data: {}}, ...]
  this._commitIndex = -1
  this._lastApplied = -1

  // This is the "state machine" that log entries will be applied to
  // It's just a map in this format:
  // {
  //   key_a: {nonce: 'foo', ttl: 1234},
  //   key_b: {nonce: 'foo', ttl: 1234},
  //   ...
  // }
  this._lockMap = {}

  this._emitter.on('committed', _.bind(this._onEntryCommitted, this))

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
    var sendHeartbeat

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

    sendHeartbeat = function sendHeartbeat () {
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
    }

    self._leaderHeartbeatInterval = setInterval(sendHeartbeat, heartbeatInterval)

    /**
    * Allows lock requests to be handled faster IN THEORY
    * but it seems to actually take twice as long under load, probably
    * because of lots more message passing... making the heartbeat interval
    * a small one turns out to be better.
    */
    /*
    self._forceLeaderHeartbeat = function _forceLeaderHeartbeat () {
      clearInterval(self._leaderHeartbeatInterval)
      sendHeartbeat()
      self._leaderHeartbeatInterval = setInterval(sendHeartbeat, heartbeatInterval)
    }
    */
  }

  this._onMessageRecieved = _.bind(this._onMessageRecieved, this)
  this._channel.on('recieved', this._onMessageRecieved)

  this._resetElectionTimeout()
}

util.inherits(LeaderStrategy, StrategyInterface)

LeaderStrategy.prototype._onMessageRecieved = function _onMessageRecieved (originNodeId, data) {
  var self = this
    , i
    , ii

  self._resetElectionTimeout()

  self._handleMessage(originNodeId, data)

  // If we are the leader, must try to increase our commitIndex here, so that
  // followers will find out about it and increment their own commitIndex
  if (self._state === STATES.LEADER) {
    // After handling any message, check to see if we can increment our commitIndex
    var highestPossibleCommitIndex = -1

    for (i=self._commitIndex + 1, ii=self._log.length; i<ii; ++i) {
      // Log entries must be from the current term
      if (self._log[i].term === self._currentTerm &&
          // And there must be a majority of matchIndexes >= i
          _.filter(self._matchIndex, function (matchIndex) {
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
  for (i=self._lastApplied + 1, ii=self._commitIndex; i<=ii; ++i) {
    self._emitter.emit('committed', self._log[i])
    self._lastApplied = i
  }
}

LeaderStrategy.prototype._lockIfPossible = function _lockIfPossible (entry) {
  var self = this
    , key = entry.key
    , duration = entry.duration
    , nonce = entry.nonce

  if (self._state === STATES.LEADER) {
    // Locks are requested with a duration, but when the leader decides its time to
    // grant a lock, that duration is turned into a ttl
    var ttl
      , lockMapEntry = self._lockMap[key]

    // If the state machine doesn't contain the key, or the lock has expired...
    if (lockMapEntry == null || lockMapEntry.ttl < Date.now()) {
      ttl = Date.now() + duration

      self._log.push({
        term: self._currentTerm
        // Replace duration and maxWait with ttl; that information is useless
        // now, and the ttl is all that matters to the cluster
      , data: _.extend({ttl: ttl}, _.omit(entry, 'duration', 'maxWait'))
      })

      self._lockMap[key] = {
        ttl: ttl
      , nonce: nonce
      }

      // Accelerates lock acquisition by achieving consensus earlier
      // self._forceLeaderHeartbeat()
    }
    else {
      // Say no so that the follower doesn't waste time waiting
      self._channel.send(entry.requester, {
        type: RPC_TYPE.REQUEST_LOCK_REPLY
      , term: self._currentTerm
      , nonce: nonce
      })
    }
  }
}

LeaderStrategy.prototype._unlockIfPossible = function _unlockIfPossible (entry) {
  var self = this

  if (self._state === STATES.LEADER) {
    var key = entry.key
      , nonce = entry.nonce

    if (self._lockMap[key] != null && self._lockMap[key].nonce === nonce) {
      self._log.push({
        term: self._currentTerm
        // Replace duration and maxWait with ttl; that information is useless
        // now, and the ttl is all that matters to the cluster
      , data: {
          key: key
        , nonce: nonce
        , ttl: -1
        }
      })

      // Accelerates unlocking by achieving consensus earlier
      // self._forceLeaderHeartbeat()
    }
  }
}

LeaderStrategy.prototype._handleMessage = function _handleMessage (originNodeId, data) {

  var self = this
    , conflictedAt = -1

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
    if (data.term === self._currentTerm && self._state === STATES.LEADER) {
      self._lockIfPossible({
        key: data.key
      , nonce: data.nonce
      , duration: data.duration
      , maxWait: data.maxWait
      , requester: originNodeId
      })
    }
    break

    // A reply is a quick failure message
    case RPC_TYPE.REQUEST_LOCK_REPLY:
      self._emitter.emit('lockRejected', data.nonce)
    break


    case RPC_TYPE.REQUEST_UNLOCK:
    if (data.term === self._currentTerm && self._state === STATES.LEADER) {
      self._unlockIfPossible({
        key: data.key
      , nonce: data.nonce
      })
    }
    break

    case RPC_TYPE.REQUEST_VOTE:
    if (data.term < self._currentTerm) {
      self._channel.send(originNodeId, {
        type: RPC_TYPE.REQUEST_VOTE_REPLY
      , term: self._currentTerm
      , voteGranted: false
      })
      return
    }

    if ((self._votedFor == null || self._votedFor === data.candidateId) &&
      (data.lastLogIndex < 0 || data.lastLogIndex >= self._log.length)) {
      self._votedFor = data.candidateId
      self._channel.send(data.candidateId, {
        type: RPC_TYPE.REQUEST_VOTE_REPLY
      , term: self._currentTerm
      , voteGranted: true
      })
      return
    }
    break

    case RPC_TYPE.REQUEST_VOTE_REPLY:
    // broadcasts reach ourselves, so we'll actually vote for ourselves here
    if (data.term === self._currentTerm &&
        data.voteGranted === true) {

      // Keep collecting votes because that's how we discover what process ids are
      // in the system
      self._votes[originNodeId] = true

      // Stops this from happening when extra votes come in
      if (self._state === STATES.CANDIDATE &&
      _.values(self._votes).length > Math.ceil(this._clusterSize/2) // Wait for a majority
      ) {
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

    if (data.term < self._currentTerm) {                        // 1. reply false if term < currentTerm (section 3.3)
      self._channel.send(originNodeId, {
        type: RPC_TYPE.APPEND_ENTRIES_REPLY
      , term: self._currentTerm
      , success: false
      })
      return
    }

    // This could be merged into the previous if statement, but then istanbul can't detect if tests have covered this branch
    if (data.prevLogIndex > -1 &&                                  // Don't do this if log is empty; it'll fail for the wrong reasons
        (self._log[data.prevLogIndex] == null  ||                  // 2. reply false if log doesn't contain an entry at prevLogIndex
        self._log[data.prevLogIndex].term !== data.prevLogTerm)) { //    whose term matches prevLogTerm (section 3.5)

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
      self._commitIndex = Math.min(data.leaderCommit, self._log.length - 1)
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
    , timeout = self._generateRandomElectionTimeout()

  if (self._electionTimeout != null) {
    clearTimeout(self._electionTimeout)
  }

  self._electionTimeout = setTimeout(function () {
    self._resetElectionTimeout()
    self._beginElection()
  }, timeout)
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
  , lastLogTerm: lastLogIndex > 0 ? this._log[lastLogIndex].term : -1
  })
}

LeaderStrategy.prototype._lock = function _lock (key, opts) {
  var self = this
    , sameNonce = self.id + '_' + uuid.v4()
    , performRequest

  /**
  * This odd pattern is because there is a possibility that
  * we were elected the leader after the leaderElected event
  * fires. So we wait until its time to perform the request
  * to decide if we need to delegate to the leader, or perform
  * the logic ourselves
  */
  performRequest = once(function performRequest () {
    if (self._state === STATES.LEADER) {
      // Append to the log...
      self._lockIfPossible({
        key: key
      , nonce: sameNonce
      , duration: opts.duration
      , maxWait: opts.maxWait
      , requester: self.id
      })
    }
    else {
      self._channel.send(self._leader, {
        type: RPC_TYPE.REQUEST_LOCK
      , term: self._currentTerm
      , key: key
      , duration: opts.duration
      , maxWait: opts.maxWait
      , nonce: sameNonce
      })
    }
  })

  if (self._state === STATES.LEADER) {
    performRequest()
  }
  else if (self._state === STATES.FOLLOWER && self._leader != null) {
    performRequest()
  }
  else {
    self._emitter.once('leaderElected', performRequest)
  }

  return new Promise(function (resolve, reject) {
    var grantOnCommitted = function _grantOnCommitted (entry) {
          // A ttl < 0 is an unlock request and should be ignored
          if (entry.data.nonce !== sameNonce || entry.data.ttl < 0) {
            return
          }

          resolve({
            key: entry.data.key
          , nonce: entry.data.nonce
          })
          cleanup()
        }
      , failOnReject = function _failOnReject (nonce) {
          if (nonce !== sameNonce) {
            return
          }

          reject(new Error('Another process is holding on to the lock right now'))
          cleanup()
        }
      , failOnTimeout = function _failOnTimeout () {
          self._channel.send(self._leader, {
            type: RPC_TYPE.REQUEST_UNLOCK
          , term: self._currentTerm
          , key: key
          , nonce: sameNonce
          })

          reject(new Error('Timed out before acquiring the lock'))
          cleanup()
        }
      , cleanup = function _cleanup () {
          self._emitter.removeListener('leaderElected', performRequest)
          self._emitter.removeListener('committed', grantOnCommitted)
          self._emitter.removeListener('lockRejected', failOnReject)
          clearTimeout(timeoutHandle)
        }
      , timeoutHandle

    // And wait for acknowledgement. Once we commit the entry,
    // we can grant the lock.
    self._emitter.on('committed', grantOnCommitted)
    self._emitter.on('lockRejected', failOnReject)

    // If we time out before the lock is granted
    // remove the event handler and reject
    timeoutHandle = setTimeout(failOnTimeout, opts.maxWait)
  })
}

LeaderStrategy.prototype._unlock = function _unlock (lock) {
  var self = this
    , sameNonce = lock.nonce
    , UNLOCK_TIMEOUT = 5000

  if (self._state === STATES.LEADER) {
    // Append to the log...
    self._unlockIfPossible({
      key: lock.key
    , nonce: lock.nonce
    })
  }
  else if (self._state === STATES.FOLLOWER && self._leader != null) {
    self._channel.send(self._leader, {
      type: RPC_TYPE.REQUEST_UNLOCK
    , term: self._currentTerm
    , key: lock.key
    , nonce: sameNonce
    })
  }
  /**
  * We don't queue unlocks the same way that we queue locks because
  * its so unlikely that the leader goes down in between a lock
  * and unlock, and the unlock request happens precisely when
  * the follower becomes a candidate.
  */

  return new Promise(function (resolve, reject) {
    var ackOnCommitted = function _ackOnCommitted (entry) {
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

LeaderStrategy.prototype._onEntryCommitted = function _onEntryCommitted (entry) {
  if (entry.data.ttl < 0) {
    this._lockMap[entry.data.key] = null
  }
  else {
    this._lockMap[entry.data.key] = {
      nonce: entry.data.nonce
    , ttl: entry.data.ttl
    }
  }
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
module.exports._RPC_TYPE = _.cloneDeep(RPC_TYPE)

