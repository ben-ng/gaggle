var ChannelInterface = require('./channel-interface')
  , Joi = require('joi')
  , prettifyJoiError = require('../helpers/prettify-joi-error')
  , SocketIOClient = require('socket.io-client')
  , util = require('util')
  , _ = require('lodash')

function SocketIOChannel (opts) {
  var validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
        channelOptions: Joi.object().keys({
          host: Joi.string()
        , channel: Joi.string()
        , clusterSize: Joi.number()
        })
      , logFunction: Joi.func()
      , id: Joi.string()
      }).requiredKeys(
        'channelOptions'
      , 'channelOptions.host'
      , 'channelOptions.channel'
      , 'channelOptions.clusterSize'
      ), {
        convert: false
      })

  ChannelInterface.apply(this, Array.prototype.slice.call(arguments))

  if (validatedOptions.error != null) {
    throw new Error(prettifyJoiError(validatedOptions.error))
  }

  this._host = _.get(validatedOptions, 'value.channelOptions.host')
  this._channel = _.get(validatedOptions, 'value.channelOptions.channel')
  this._clusterSize = _.get(validatedOptions, 'value.channelOptions.clusterSize')
  this._handleMsg = _.bind(this._handleMsg, this)
}

util.inherits(SocketIOChannel, ChannelInterface)

SocketIOChannel.prototype._connect = function _connect () {
  var self = this
    , client = SocketIOClient(this._host)
    , onPossibilityOfServerLosingChannelInformation

  /* istanbul ignore if: only happens in browsers, which we don't test in */
  if (typeof window != 'undefined') {
    // A shim, because we're not using browserify
    require('socket.io-p2p/socketiop2p.min.js')

    // Webpack doesn't find "foo" when we do new require('foo')()
    var SocketIOP2P = require('socket.io-p2p')
    client = new SocketIOP2P(client, {
        autoUpgrade: true
      , peerOpts: {
          numClients: this._clusterSize
        }
      })
  }

  onPossibilityOfServerLosingChannelInformation = function declareChannel () {
    client.emit('declareChannel', self._channel)

    if (!self.state.connected) {
      self._connected()
    }
  }

  client.on('msg', this._handleMsg)

  client.on('reconnect', onPossibilityOfServerLosingChannelInformation)
  client.on('unknownChannel', onPossibilityOfServerLosingChannelInformation)
  client.once('connect', onPossibilityOfServerLosingChannelInformation)

  /* istanbul ignore if: only happens in browsers with WebRTC support */
  client.on('upgrade', function () {
    client.usePeerConnection = true
  })

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
  var msg = {
    from: this.id
  , data: data
  }
  this._client.emit('msg', msg)
  this._handleMsg(msg)
}

SocketIOChannel.prototype._send = function _send (nodeId, data) {
  var msg = {
    from: this.id
  , to: nodeId
  , data: data
  }
  this._client.emit('msg', msg)

  // Needed to handle an inconsistency where the WebRTC emit
  // does not send the message to ourselves, but the regular
  // socket.io emit does
  this._handleMsg(msg)
}

SocketIOChannel.prototype._handleMsg = function _handleMsg (msg) {
  if ((msg.to == null || msg.to === this.id) && this.state.connected) {
    this._recieved(msg.from, msg.data)
  }
}

module.exports = SocketIOChannel
