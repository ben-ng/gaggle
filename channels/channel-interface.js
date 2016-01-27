var EventEmitter = require('events').EventEmitter
  , util = require('util')
  , Joi = require('joi')
  , _ = require('lodash')
  , prettifyJoiError = require('../helpers/prettify-joi-error')

/**
* Channels are how nodes on the network communicate and must be initialized
* with the process ID.
*
* Events:
*   connected
*   disconnected
*   recieved(int originNodeId, data)
*
* Channel implementors should extend this class with the methods:
*   _connect
*   _disconnect
*   _broadcast
*   _send
*
* Implementors should use the following protected methods:
*   _connected
*   _disconnected
*   _recieved
*
* Channel consumers should use the public interface:
*   connect
*   disconnect
*   broadcast
*   send
*
*/

function ChannelInterface (opts) {
  EventEmitter.call(this)

  var validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
    id: Joi.string()
  , logFunction: Joi.func().default(function noop () {})
  , channelOptions: Joi.object()
  }).requiredKeys('id'))

  if (validatedOptions.error != null) {
    throw new Error(prettifyJoiError(validatedOptions.error))
  }

  this.id = validatedOptions.value.id

  this.state = {
    connected: false
  , isReconnecting: false
  }

  this._logFunction = validatedOptions.value.logFunction

  // Avoid duplicate messages
  this._lastRecievedMap = {}
  this._sequence = 0
}

util.inherits(ChannelInterface, EventEmitter)

/**
* For channel implementors:
* Call this when a message is recieved
*/
ChannelInterface.prototype._recieved = function _recieved (originNodeId, packet) {
  if (this.state.connected === false) {
    throw new Error('_recieved was called although the channel is in the disconnected state')
  }
  else {
    if (this._lastRecievedMap[originNodeId] == null || this._lastRecievedMap[originNodeId] < packet.sequence) {
      this._lastRecievedMap[originNodeId] = packet.sequence

      this._logFunction(this.id + ' recieved from ' + originNodeId + '\n' + JSON.stringify(packet.data, null, 2))
      this.emit('recieved', originNodeId, packet.data)
    }
    // else, this is a duplicate, and we should ignore it
  }
}

/**
* For channel implementors:
* Call this when the channel has connected
*/
ChannelInterface.prototype._connected = function _connected () {
  if (this.state.connected === true) {
    throw new Error('_connected was called although the channel is already in the connected state')
  }
  else {
    this.state.connected = true
    this.emit('connected')
  }
}

/**
* For channel implementors:
* Call this when the channel is disconnected
*/
ChannelInterface.prototype._disconnected = function _disconnected () {
  if (this.state.connected === false) {
    throw new Error('_disconnected was called although the channel is already in the disconnected state')
  }
  else {
    this.state.connected = false
    this.emit('disconnected')
  }
}

/**
* For channel consumers:
* Connect to the network
*
* Call _connected once the connection is established,
* and call _disconnected when the connection is lost.
* In the event of disconnection, channels should
* automatically attempt to reconnect.
*/
ChannelInterface.prototype.connect = function connect () {
  if (typeof this._connect === 'function') {
    return this._connect()
  }
  else {
    throw new Error('Not implemented')
  }
}

/**
* For channel consumers:
* Disconnect from the network
*
* Takes care to close all connections so that the process can
* quickly and cleanly exit.
*/
ChannelInterface.prototype.disconnect = function disconnect () {
  this._broadcast = _.noop
  this._send = _.noop
  this._recieved = _.noop

  if (typeof this._disconnect === 'function') {
    return this._disconnect()
  }
  else {
    throw new Error('Not implemented')
  }
}

/**
* For channel consumers:
* Send a message to all nodes on the network
*/
ChannelInterface.prototype.broadcast = function broadcast (data) {
  if (typeof this._broadcast === 'function') {
    this._logFunction(this.id + ' broadcasted\n' + JSON.stringify(data, null, 2))
    return this._broadcast(this._createPacket(data))
  }
  else {
    throw new Error('Not implemented')
  }
}

/**
* For channel consumers:
* Send a message to a node on the network
*/
ChannelInterface.prototype.send = function send (nodeId, data) {
  if (typeof this._send === 'function') {
    this._logFunction(this.id + ' sent to ' + nodeId + '\n' + JSON.stringify(data, null, 2))
    return this._send(nodeId, this._createPacket(data))
  }
  else {
    throw new Error('Not implemented')
  }
}

/**
* Private method that creates a data packet
*/
ChannelInterface.prototype._createPacket = function createPacket (data) {
  var seq = this._sequence

  this._sequence = this._sequence + 1

  return {
    data: data
  , sequence: seq
  }
}

module.exports = ChannelInterface
