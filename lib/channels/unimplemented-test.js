var ChannelInterface = require('./channel-interface')
  , util = require('util')

/**
* Intentionally empty channel for testing channel implementation error detection
*/

function UnimplementedChannel () {
  ChannelInterface.apply(this, Array.prototype.slice.call(arguments))
}

util.inherits(UnimplementedChannel, ChannelInterface)

module.exports = UnimplementedChannel
