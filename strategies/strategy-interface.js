var uuid = require('uuid')
  , Promise = require('bluebird')
  , Joi = require('joi')
  , LOCK_MODES = require('../lock-modes')
  , prettifyJoiError

prettifyJoiError = function prettifyJoiError (err) {
  return 'Invalid options: ' + err.details.map(function (e) {
    return e.message
  }).join(', ')
}

/*
* Gaggle is an interface for mutual exclusion Strategies
*
* Strategy implementors should extend this class with the methods:
*   _setLockState
*
* Implementors should use the following protected methods:
*   _createPromise
*
* Strategy consumers should use the public interface:
*   lock
*   unlock
*/

function StrategyInterface () {
  this.id = uuid.v4()
}

StrategyInterface.prototype.lock = function lock (key, opts) {
  var validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
    mode: Joi.any().valid([LOCK_MODES.EXCLUSIVE, LOCK_MODES.SHARED])
                    .default(LOCK_MODES.EXCLUSIVE)
  , timeout: Joi.number().min(0)
  }), {
    convert: false
  })

  if (validatedOptions.error != null) {
    return Promise.reject(prettifyJoiError(validatedOptions.error))
  }
  else if (typeof this._setLockState === 'function') {
    return this._setLockState(key, validatedOptions.result)
  }
  else {
    return Promise.reject(new Error('unimplemented method _setLockState is required by the Strategy interface'))
  }
}

StrategyInterface.prototype.unlock = function unlock (key, opts) {
  var validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
    mode: Joi.any().valid([LOCK_MODES.NONE, LOCK_MODES.SHARED])
                    .default(LOCK_MODES.NONE)
  , timeout: Joi.number().min(0)
  }), {
    convert: false
  })

  if (validatedOptions.error != null) {
    return Promise.reject(prettifyJoiError(validatedOptions.error))
  }
  else if (typeof this._setLockState === 'function') {
    return this._setLockState(key, validatedOptions.result)
  }
  else {
    return Promise.reject(new Error('unimplemented method _setLockState is required by the Strategy interface'))
  }
}

module.exports = StrategyInterface
