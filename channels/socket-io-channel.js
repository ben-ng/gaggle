var ChannelInterface = require('./channel-interface')
  , Joi = require('joi')
  , prettifyJoiError = require('../helpers/prettify-joi-error')
  , SocketIOClient = require('socket.io-client')
  , util = require('util')
  , _ = require('lodash')

/**
* A simple channel that uses Redis's pub/sub
*/

function SocketIOChannel (opts) {
  var validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
        channelOptions: Joi.object().keys({
          host: Joi.string()
        , channel: Joi.string()
        })
      , logFunction: Joi.func()
      , id: Joi.string()
      }).requiredKeys('channelOptions', 'channelOptions.host', 'channelOptions.channel'), {
        convert: false
      })

  ChannelInterface.apply(this, Array.prototype.slice.call(arguments))

  if (validatedOptions.error != null) {
    throw new Error(prettifyJoiError(validatedOptions.error))
  }

  this._host = _.get(validatedOptions, 'value.channelOptions.host')
  this._channel = _.get(validatedOptions, 'value.channelOptions.channel')
}

util.inherits(SocketIOChannel, ChannelInterface)

SocketIOChannel.prototype._connect = function _connect () {
  var self = this
    , client = SocketIOClient(this._host)
    , onPossibilityOfServerLosingChannelInformation

  onPossibilityOfServerLosingChannelInformation = function declareChannel () {
    client.emit('declareChannel', self._channel)

    if (!self.state.connected) {
      self._connected()
    }
  }

  client.on('msg', function (msg) {
    if ((msg.to == null || msg.to === self.id) && self.state.connected) {

      self._recieved(msg.from, msg.data)
    }
  })

  client.on('reconnect', onPossibilityOfServerLosingChannelInformation)
  client.on('unknownChannel', onPossibilityOfServerLosingChannelInformation)
  client.once('connect', onPossibilityOfServerLosingChannelInformation)

  this._client = client
}

SocketIOChannel.prototype._disconnect = function _disconnect () {
  var self = this

  this._client.removeAllListeners()

  this._client.once('disconnect', function () {
    self._disconnected()
  })

  this._client.disconnect()
}

SocketIOChannel.prototype._broadcast = function _broadcast (data) {
  this._client.emit('msg', {
    from: this.id
  , data: data
  })
}

SocketIOChannel.prototype._send = function _send (nodeId, data) {
  this._client.emit('msg', {
    from: this.id
  , to: nodeId
  , data: data
  })
}

module.exports = SocketIOChannel
