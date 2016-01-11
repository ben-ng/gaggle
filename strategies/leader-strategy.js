var StrategyInterface = require('./strategy-interface')
  , Joi = require('joi')
  , util = require('util')
  , Promise = require('bluebird')
  , async = require('async')
  , _ = require('lodash')
  , uuid = require('uuid')
  , prettifyJoiError = require('../helpers/prettify-joi-error')
  , STATES = {
      CANDIDATE: 'CANDIDATE'
    , LEADER: 'LEADER'
    , FOLLOWER: 'FOLLOWER'
    }
  , schemasToConstructors = function (schemas) {
      var constructors = {}

      // Convert schemas into factory functions
      _.each(schemas, function (schema, key) {
        constructors[key] = function _constructMessage (opts) {
          var result = Joi.validate(opts, schema)

          if (result.error != null) {
            throw new Error('Could not construct malformed ' + key + ' message: ' +
              prettifyJoiError(result.error))
          }

          return {
            type: key
          , payload: _.cloneDeep(result.value)
          }
        }
      })
    }
  , RPC = schemasToConstructors({
      requestVote: Joi.object().keys({
        term: Joi.number()
      , candidateId: Joi.string()
      }).requiredKeys('term', 'candidateId')
    , requestVoteReply: Joi.object().keys({
        term: Joi.number()
      , voteGranted: Joi.boolean()
      }).requiredKeys('term', 'voteGranted')
    , heartbeat: Joi.object().keys({
        term: Joi.number()
      }).requiredKeys('term')
    , heartbeatReply: Joi.object().keys({
        term: Joi.number()
      }).requiredKeys('term')
    })

/**
* A naive solution to distributed mutual exclusion. Performs leader election
* and then routes all lock requests through the leader. Supports membership
* changes. Somewhat fault tolerant -- crashes trigger a new round of leader
* election. The intent of this strategy is to handle membership changes so
* that other strategies can inherit from it and focus on different strategies
* for mutual exclusion. The leader election is inspired by Raft's.
*/

function LeaderStrategy (opts) {
  var validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
        strategyOptions: Joi.object().keys({
          electionTimeout: Joi.object().keys({
            min: Joi.number().min(0)
          , max: Joi.number().min(Joi.ref('strategyOptions.electionTimeout.min'))
          })
        })
      , channel: Joi.object()
      }), {
        convert: false
      })

  StrategyInterface.apply(this, Array.prototype.slice.call(arguments))

  if (validatedOptions.error != null) {
    throw new Error(prettifyJoiError(validatedOptions.error))
  }

  this._channel = opts.channel

  this._currentTerm = 0
  this._votedFor = null

  this._beginElection()
}

util.inherits(LeaderStrategy, StrategyInterface)

LeaderStrategy.prototype._beginElection = function _beginElection () {
  this._state = STATES.CANDIDATE
  this._currentTerm = this._currentTerm + 1
  this._votedFor = this.id

  this._channel.broadcast(RPC.requestVote({
    term: this._currentTerm
  , candidateId: this.id
  }))
}

LeaderStrategy.prototype._lock = function _lock (key, opts) {
  var acquired = false
    , started = Date.now()
    , MAX_WAIT = opts.maxWait
    , LOCK_DURATION = opts.duration
    , r = this._redis
    , newNonce = this.id + '_' + uuid.v4()

  if (this._state === STATES.CANDIDATE) {
    return Promise.reject(new Error('An election is currently in progress'))
  }
  else {

  }
}

LeaderStrategy.prototype._unlock = function _unlock (lock) {
  var r = this._redis

  return r.getAsync(lock.key)
  .then(function (res) {
    if (res === lock.nonce) {
      return r.delAsync(lock.key)
    }
    else {
      return Promise.resolve()
    }
  })
}

LeaderStrategy.prototype._close = function _close () {
  this._redis.quit()

  return Promise.resolve()
}

module.exports = LeaderStrategy
