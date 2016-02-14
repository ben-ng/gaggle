var Joi = require('joi')
  , util = require('util')
  , Promise = require('bluebird')
  , _ = require('lodash')
  , EventEmitter = require('events').EventEmitter
  , uuid = require('uuid')
  , once = require('once')
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
    , APPEND_ENTRY: 'APPEND_ENTRY'
    , DISPATCH: 'DISPATCH'
    , DISPATCH_REPLY: 'DISPATCH_REPLY'
    }

Promise.config({
  warnings: {wForgottenReturn: false}
})

function Gaggle (opts) {
  var self = this
    , validatedOptions = Joi.validate(opts, Joi.object().keys({
        clusterSize: Joi.number().min(1)
      , channel: Joi.object()
      , id: Joi.string()
      , electionTimeout: Joi.object().keys({
          min: Joi.number().min(0)
        , max: Joi.number().min(Joi.ref('min'))
        }).default({min: 300, max: 500})
      , heartbeatInterval: Joi.number().min(0).default(50)
      , accelerateHeartbeats: Joi.boolean().default(false)
      , rpc: Joi.object().default()
      }).requiredKeys('id', 'channel', 'clusterSize'), {
        convert: false
      })
    , electMin
    , electMax
    , heartbeatInterval

  if (validatedOptions.error != null) {
    throw new Error(prettifyJoiError(validatedOptions.error))
  }

  // For convenience
  electMin = validatedOptions.value.electionTimeout.min
  electMax = validatedOptions.value.electionTimeout.max
  this._clusterSize = validatedOptions.value.clusterSize
  this._unlockTimeout = validatedOptions.value.unlockTimeout
  this._rpc = validatedOptions.value.rpc
  heartbeatInterval = validatedOptions.value.heartbeatInterval

  this.id = validatedOptions.value.id
  this._closed = false

  opts.channel.connect()
  this._channel = opts.channel

  // Used for internal communication, such as when an entry is committed
  this._emitter = new EventEmitter()
  this._emitter.setMaxListeners(100)

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

  // Proxy these internal events to the outside world
  this._emitter.on('appended', function () {
    self.emit.apply(self, ['appended'].concat(Array.prototype.slice.call(arguments)))
  })

  this._emitter.on('committed', function () {
    self.emit.apply(self, ['committed'].concat(Array.prototype.slice.call(arguments)))
  })

  this._emitter.on('leaderElected', function () {
    self.emit.apply(self, ['leaderElected'].concat(Array.prototype.slice.call(arguments)))
  })

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

  this._beginHeartbeat = function _beginHeartbeat () {
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

    if (validatedOptions.value.accelerateHeartbeats) {
      self._forceHeartbeat = function _forceHeartbeat () {
        clearInterval(self._leaderHeartbeatInterval)
        sendHeartbeat()
        self._leaderHeartbeatInterval = setInterval(sendHeartbeat, heartbeatInterval)
      }
    }
  }

  this._onMessageRecieved = _.bind(this._onMessageRecieved, this)
  this._channel.on('recieved', this._onMessageRecieved)

  this._emitter.on('dirty', function () {
    if (typeof self._forceHeartbeat === 'function') {
      self._forceHeartbeat()
    }
  })

  this._resetElectionTimeout()
}

util.inherits(Gaggle, EventEmitter)

Gaggle.prototype._onMessageRecieved = function _onMessageRecieved (originNodeId, data) {
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

    if (highestPossibleCommitIndex > self._commitIndex) {
      self._commitIndex = highestPossibleCommitIndex

      self._emitter.emit('dirty')
    }
  }

  // All nodes should commit entries between lastApplied and commitIndex
  for (i=self._lastApplied + 1, ii=self._commitIndex; i<=ii; ++i) {
    self._emitter.emit('committed', JSON.parse(JSON.stringify(self._log[i])), i)
    self._lastApplied = i
  }
}

Gaggle.prototype.dispatchOnLeader = function dispatchOnLeader () {
  var args = Array.prototype.slice.call(arguments)
  return this._dispatchOnLeader.apply(this, [uuid.v4()].concat(args))
}

Gaggle.prototype._dispatchOnLeader = function _dispatchOnLeader (rpcId, methodName, args, timeout, cb) {
  var self = this
    , performRequest
    , p

  if (typeof timeout === 'function') {
    cb = timeout
    timeout = -1
  }

  timeout = typeof timeout === 'number' ? timeout : -1

  /**
  * This odd pattern is because there is a possibility that
  * we were elected the leader after the leaderElected event
  * fires. So we wait until its time to perform the request
  * to decide if we need to delegate to the leader, or perform
  * the logic ourselves
  */
  performRequest = once(function performRequest () {
    if (self._state === STATES.LEADER) {

      if (self._rpc[methodName] == null) {
        self._channel.broadcast({
          type: RPC_TYPE.DISPATCH_REPLY
        , term: self._currentTerm
        , id: rpcId
        , returnValues: [{
            message: 'The RPC method ' + methodName + ' does not exist'
          , stack: 'Gaggle.prototype._dispatchOnLeader'
          , isSerializedError: true
          }]
        })
      }
      else {
        self._rpc[methodName].apply(self, args.concat(function _rpc_cb () {
          var args = Array.prototype.slice.call(arguments)

          if (args[0] != null && args[0] instanceof Error) {
            args[0] = {
              message: args[0].message
            , stack: args[0].stack
            , isSerializedError: true
            }
          }

          self._channel.broadcast({
            type: RPC_TYPE.DISPATCH_REPLY
          , term: self._currentTerm
          , id: rpcId
          , returnValues: args
          })
        }))
      }
    }
    else {
      self._channel.send(self._leader, {
        type: RPC_TYPE.DISPATCH
      , term: self._currentTerm
      , id: rpcId
      , methodName: methodName
      , args: args
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

  p = new Promise(function (resolve, reject) {
    var resolveOnAck = function _resolveOnAck (id, ret) {
          if (id === rpcId) {
            if (ret[0] != null) {
              reject(ret[0])
            }
            else {
              resolve(ret.slice(1))
            }
            cleanup()
          }
        }
      , cleanup = function _cleanup () {
          self._emitter.removeListener('leaderElected', performRequest)
          self._emitter.removeListener('rpcAck', resolveOnAck)
          clearTimeout(timeoutHandle)
        }
      , timeoutHandle

    // And wait for acknowledgement...
    self._emitter.on('rpcAck', resolveOnAck)

    // Or if we time out before the message is committed...
    if (timeout > -1) {
      timeoutHandle = setTimeout(function _failOnTimeout () {
        reject(new Error('Timed out before the rpc method returned'))
        cleanup()
      }, timeout)
    }
  })

  if (cb != null) {
    p.then(function (args) {
      cb.apply(null, [null].concat(args))
    }).catch(cb)
  }
  else {
    return p
  }
}

Gaggle.prototype.getLog = function () {
  return this._log
}

Gaggle.prototype.getCommitIndex = function () {
  return this._commitIndex
}

Gaggle.prototype.append = function append (data, timeout, cb) {
  var self = this
    , msgId = self.id + '_' + uuid.v4()
    , performRequest
    , p

  if (typeof timeout === 'function') {
    cb = timeout
    timeout = -1
  }

  timeout = typeof timeout === 'number' ? timeout : -1

  /**
  * This odd pattern is because there is a possibility that
  * we were elected the leader after the leaderElected event
  * fires. So we wait until its time to perform the request
  * to decide if we need to delegate to the leader, or perform
  * the logic ourselves
  */
  performRequest = once(function performRequest () {
    var entry

    if (self._state === STATES.LEADER) {
      entry = {
        term: self._currentTerm
      , data: data
      , id: msgId
      }

      self._log.push(entry)
      self._emitter.emit('appended', entry, self._log.length - 1)
    }
    else {
      self._channel.send(self._leader, {
        type: RPC_TYPE.APPEND_ENTRY
      , data: data
      , id: msgId
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

  p = new Promise(function (resolve, reject) {
    var resolveOnCommitted = function _resolveOnCommitted (entry) {
          if (entry.id === msgId) {
            resolve()
            cleanup()
          }
        }
      , cleanup = function _cleanup () {
          self._emitter.removeListener('leaderElected', performRequest)
          self._emitter.removeListener('committed', resolveOnCommitted)
          clearTimeout(timeoutHandle)
        }
      , timeoutHandle

    // And wait for acknowledgement...
    self._emitter.on('committed', resolveOnCommitted)

    // Or if we time out before the message is committed...
    if (timeout > -1) {
      timeoutHandle = setTimeout(function _failOnTimeout () {
        reject(new Error('Timed out before the entry was committed'))
        cleanup()
      }, timeout)
    }
  })

  if (cb != null) {
    p.then(_.bind(cb, null, null)).catch(cb)
  }
  else {
    return p
  }
}

Gaggle.prototype.isLeader = function isLeader () {
  return this._state === STATES.LEADER
}

Gaggle.prototype.hasUncommittedEntriesInPreviousTerms = function hasUncommittedEntriesInPreviousTerms () {
  var self = this

  return _.find(self._log, function (entry, idx) {
    return entry.term < self._currentTerm && idx > self._commitIndex
  }) != null
}

Gaggle.prototype._handleMessage = function _handleMessage (originNodeId, data) {

  var self = this
    , conflictedAt = -1
    , entry

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
    // Do not combine these conditions, its intentionally written this way so that the
    // code coverage tool can do a thorough analysis
    if (data.term >= self._currentTerm) {
      var lastLogEntry = _.last(self._log)
        , lastLogTerm = lastLogEntry != null ? lastLogEntry.term : -1
        , candidateIsAtLeastAsUpToDate = data.lastLogTerm > lastLogTerm || // Its either in a later term...
                                        // or same term, and at least at the same index
                                        data.lastLogTerm === lastLogTerm && data.lastLogIndex >= self._log.length - 1

      if ((self._votedFor == null || self._votedFor === data.candidateId) && candidateIsAtLeastAsUpToDate) {
        self._votedFor = data.candidateId
        self._channel.send(data.candidateId, {
          type: RPC_TYPE.REQUEST_VOTE_REPLY
        , term: self._currentTerm
        , voteGranted: true
        })
        return
      }
    }

    self._channel.send(originNodeId, {
      type: RPC_TYPE.REQUEST_VOTE_REPLY
    , term: self._currentTerm
    , voteGranted: false
    })
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
        self._beginHeartbeat()
        self._emitter.emit('leaderElected')
      }
    }
    break

    case RPC_TYPE.APPEND_ENTRY:
      if (self._state === STATES.LEADER) {
        entry = {
          term: self._currentTerm
        , id: data.id
        , data: data.data
        }

        self._log.push(entry)
        self._emitter.emit('appended', entry, self._log.length - 1)

        self._emitter.emit('dirty')
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
        , id: entry.id
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

    case RPC_TYPE.DISPATCH:
    if (self._state === STATES.LEADER && self._currentTerm === data.term) {
      self._dispatchOnLeader(data.id, data.methodName, data.args).catch(_.noop)
    }
    break

    case RPC_TYPE.DISPATCH_REPLY:
    if (data.returnValues[0] != null &&
      typeof data.returnValues[0] === 'object' &&
      data.returnValues[0].isSerializedError === true) {
      var t = data.returnValues[0]
      data.returnValues[0] = new Error(t.message)
      data.returnValues[0].stack = t.stack
    }

    self._emitter.emit.apply(self._emitter, ['rpcAck', data.id, data.returnValues])
    break
  }
}

Gaggle.prototype._resetElectionTimeout = function _resetElectionTimeout () {
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

Gaggle.prototype._beginElection = function _beginElection () {
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
  , lastLogTerm: lastLogIndex > -1 ? this._log[lastLogIndex].term : -1
  })
}

Gaggle.prototype.close = function close (cb) {
  var self = this
    , p

  this._channel.removeListener('recieved', this._onMessageRecieved)
  clearTimeout(this._electionTimeout)
  clearInterval(this._leaderHeartbeatInterval)

  this._emitter.removeAllListeners()

  p = new Promise(function (resolve, reject) {
    self._channel.once('disconnected', function () {
      resolve()
    })
    self._channel.disconnect()
  })

  if (cb != null) {
    p.then(_.bind(cb, null, null)).catch(cb)
  }
  else {
    return p
  }
}

module.exports = Gaggle
module.exports._STATES = _.cloneDeep(STATES)
module.exports._RPC_TYPE = _.cloneDeep(RPC_TYPE)

