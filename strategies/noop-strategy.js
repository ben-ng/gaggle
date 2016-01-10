var StrategyInterface = require('./strategy-interface')
  , Promise = require('bluebird')
  , util = require('util')
  , uuid = require('uuid')

/**
* A strategy that does nothing for testing strategy state and the test suite
*/

function NoopStrategy () {
  StrategyInterface.apply(this, Array.prototype.slice.call(arguments))
}

util.inherits(NoopStrategy, StrategyInterface)

NoopStrategy.prototype._lock = function _lock (key) {
  return Promise.resolve({
    key: key
  , nonce: uuid.v4()
  })
}

NoopStrategy.prototype._unlock = function _unlock () {
  return Promise.resolve()
}

NoopStrategy.prototype._close = function _close () {
  return Promise.resolve()
}

module.exports = NoopStrategy
