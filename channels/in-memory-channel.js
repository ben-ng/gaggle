var ChannelInterface = require('./channel-interface')
  , util = require('util')
  , _ = require('lodash')
  , instanceMap = {}

/**
* Intended for use in testing, this channel only works
* within the same process, and uses timeouts to simulate
* network delay
*/

function InMemoryChannel () {
  ChannelInterface.apply(this, Array.prototype.slice.call(arguments))

}

util.inherits(InMemoryChannel, ChannelInterface)

InMemoryChannel.prototype._connect = function _connect () {
  var self = this

  setImmediate(function () {
    instanceMap[self.id] = self
    self._connected()
  })
}

InMemoryChannel.prototype._disconnect = function _disconnect () {
  var self = this

  setImmediate(function () {
    instanceMap[self.id] = null
    self._disconnected()
  })
}

InMemoryChannel.prototype._broadcast = function _broadcast (data) {
  var self = this

  _.each(instanceMap, function (instance, key) {
    if (instance != null) {
      self._send(key, data)
    }
  })
}

InMemoryChannel.prototype._send = function _send (nodeId, data) {
  var self = this

  setImmediate(function () {
    if (instanceMap[nodeId] != null) {
      instanceMap[nodeId]._recieved(self.id, data)
    }
  })
}

module.exports = InMemoryChannel
