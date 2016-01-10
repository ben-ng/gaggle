var StrategyInterface = require('./strategy-interface')
  , util = require('util')

/**
* Intentionally empty strategy for testing strategy implementation error detection
*/

function UnimplementedStrategy () {
  StrategyInterface.apply(this, Array.prototype.slice.call(arguments))
}

util.inherits(UnimplementedStrategy, StrategyInterface)

module.exports = UnimplementedStrategy
