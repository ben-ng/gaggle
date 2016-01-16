var ChannelInterface = require('./channel-interface')
  , util = require('util')
  , instanceMap = {}

/**
* Intended for use in testing, this channel only works
* within the same process, and uses timeouts to simulate
* network delay
*/

function InMemoryChannel () {
  ChannelInterface.apply(this, Array.prototype.slice.call(arguments))

  instanceMap[this.id] = {
    connected: false
  , instance: this
  }
}

util.inherits(InMemoryChannel, ChannelInterface)

InMemoryChannel.prototype._connect = function _connect () {
  var self = this

  setImmediate(function () {
    instanceMap[self.id].connected = true
    self._connected()
  })
}

InMemoryChannel.prototype._disconnect = function _disconnect () {
  var self = this

  setImmediate(function () {
    instanceMap[self.id].connected = false
    self._disconnected()
  })
}

InMemoryChannel.prototype._broadcast = function _broadcast (data) {
  for (var instanceKey in instanceMap) {
    if (instanceMap.hasOwnProperty(instanceKey)) {
      this._send(instanceKey, data)
    }
  }
}

InMemoryChannel.prototype._send = function _send (nodeId, data) {
  var self = this

  setImmediate(function () {
    if (instanceMap[nodeId] != null && instanceMap[nodeId].connected === true) {
      instanceMap[nodeId].instance._recieved(self.id, data)
    }
  })
}

module.exports = InMemoryChannel
