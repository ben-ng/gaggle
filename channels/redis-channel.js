var ChannelInterface = require('./channel-interface')
  , Joi = require('joi')
  , prettifyJoiError = require('../helpers/prettify-joi-error')
  , redis = require('redis')
  , util = require('util')
  , _ = require('lodash')

/**
* A simple channel that uses Redis's pub/sub
*/

function RedisChannel (opts) {
  var validatedOptions = Joi.validate(opts || {}, Joi.object().keys({
        channelOptions: Joi.object().keys({
          connectionString: Joi.string()
        , channelName: Joi.string()
        })
      , logFunction: Joi.func()
      , id: Joi.string()
      }).requiredKeys('channelOptions', 'channelOptions.channelName'), {
        convert: false
      })

  ChannelInterface.apply(this, Array.prototype.slice.call(arguments))

  if (validatedOptions.error != null) {
    throw new Error(prettifyJoiError(validatedOptions.error))
  }

  this._connString = _.get(validatedOptions, 'value.channelOptions.connectionString')
  this._redisChannel = _.get(validatedOptions, 'value.channelOptions.channelName')
}

util.inherits(RedisChannel, ChannelInterface)

RedisChannel.prototype._connect = function _connect () {
  var self = this
    , redisChannel = this._redisChannel
    , connString = this._connString
    , subClient = connString != null ? redis.createClient(connString) : redis.createClient()
    , pubClient = connString != null ? redis.createClient(connString) : redis.createClient()
    , connectedAfterTwoCalls = _.after(2, function () {
        self._connected()
      })

  subClient.on('error', this._logFunction)
  pubClient.on('error', this._logFunction)

  subClient.on('message', function (channel, message) {
    var parsed

    try {
      parsed = JSON.parse(message)
    }
    catch (e) {}

    if (channel === redisChannel && (parsed.to == null || parsed.to === self.id) && self.state.connected) {
      self._recieved(parsed.from, parsed.data)
    }
  })

  subClient.on('subscribe', function (channel) {
    if (channel === redisChannel) {
      connectedAfterTwoCalls()
    }
  })

  subClient.subscribe(redisChannel)

  pubClient.on('ready', function () {
    connectedAfterTwoCalls()
  })

  this._sub = subClient
  this._pub = pubClient
}

RedisChannel.prototype._disconnect = function _disconnect () {
  var self = this
    , disconnectedAfterTwoCalls = _.after(2, function () {
        self._disconnected()
      })

  this._sub.unsubscribe(this._redisChannel)
  this._sub.removeAllListeners()
  this._sub.once('end', function () {
    disconnectedAfterTwoCalls()
  })
  this._sub.quit()

  this._pub.removeAllListeners()
  this._pub.once('end', function () {
    disconnectedAfterTwoCalls()
  })
  this._pub.quit()
}

RedisChannel.prototype._broadcast = function _broadcast (data) {
  this._pub.publish(this._redisChannel, JSON.stringify({
    from: this.id
  , data: data
  }))
}

RedisChannel.prototype._send = function _send (nodeId, data) {
  this._pub.publish(this._redisChannel, JSON.stringify({
    from: this.id
  , to: nodeId
  , data: data
  }))
}

module.exports = RedisChannel
