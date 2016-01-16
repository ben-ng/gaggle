var Promise = require('bluebird')
  , Joi = require('joi')
  , prettifyJoiError = require('../helpers/prettify-joi-error')

/*
* Gaggle is an interface for mutual exclusion Strategies
*
* Strategy implementors should extend this class with the methods:
*   _setLockState
*   _close
*
* Implementors should use the following protected methods:
*   _createPromise
*   _logFunction
*
* Strategy consumers should use the public interface:
*   lock
*   unlock
*   close
*/

function StrategyInterface (opts) {
  var validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
    logFunction: Joi.func().default(function noop () {})
  , strategyOptions: Joi.object()
  , channel: Joi.object()
  , id: Joi.string()
  }).requiredKeys('id'))

  if (validatedOptions.error != null) {
    throw new Error(prettifyJoiError(validatedOptions.error))
  }

  this.id = validatedOptions.value.id
  this._logFunction = validatedOptions.value.logFunction
  this._closed = false
}

StrategyInterface.prototype.lock = function lock (key, opts) {
  var validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
    duration: Joi.number().min(0).default(10000)
  , maxWait: Joi.number().min(0).default(5000)
  }), {
    convert: false
  })

  if (this._closed !== false) {
    return Promise.reject(new Error('This instance has been closed'))
  }
  else if (validatedOptions.error != null) {
    return Promise.reject(prettifyJoiError(validatedOptions.error))
  }
  else if (typeof this._lock === 'function') {
    return this._lock(key, validatedOptions.value)
  }
  else {
    return Promise.reject(new Error('unimplemented method _lock is required by the Strategy interface'))
  }
}

StrategyInterface.prototype.unlock = function unlock (lock) {
  var validatedLock = Joi.validate(lock, Joi.object().keys({
        key: Joi.string()
      , nonce: Joi.string()
      }).requiredKeys('key', 'nonce'), {
        convert: false
      })

  if (this._closed !== false) {
    return Promise.reject(new Error('This instance has been closed'))
  }
  else if (validatedLock.error != null) {
    return Promise.reject(prettifyJoiError(validatedLock.error))
  }
  else if (typeof this._unlock === 'function') {
    return this._unlock(validatedLock.value)
  }
  else {
    return Promise.reject(new Error('unimplemented method _unlock is required by the Strategy interface'))
  }
}

StrategyInterface.prototype.close = function close () {
  this._closed = true

  if (typeof this._close === 'function') {
    return this._close()
  }
  else {
    return Promise.reject(new Error('unimplemented method _close is required by the Strategy interface'))
  }
}

module.exports = StrategyInterface
