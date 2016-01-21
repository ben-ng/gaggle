var Joi = require('joi')
  , _ = require('lodash')
  , channels = require('./channels')
  , channelNames = _.keys(channels)
  , prettifyJoiError = require('./helpers/prettify-joi-error')
  , Gaggle = require('./gaggle')
  , schema

schema = Joi.object().keys({
  id: Joi.string()
, clusterSize: Joi.number().min(1)
, electionTimeout: Joi.object().keys({
    min: Joi.number().min(0)
  , max: Joi.number().min(Joi.ref('electionTimeout.min'))
  }).default({min: 300, max: 500})
, heartbeatInterval: Joi.number().min(0).default(50)
, channel: Joi.object().keys({
    name: Joi.string().valid(channelNames)
  })
}).requiredKeys([
  'id'
, 'clusterSize'
, 'channel'
, 'channel.name'
])


module.exports = function GaggleFactory (opts) {
  var validatedOptions = Joi.validate(opts || {}, schema, {allowUnknown: true, stripUnknown: false})
    , channelInst

  if (validatedOptions.error != null) {
    throw new Error(prettifyJoiError(validatedOptions.error))
  }

  opts = validatedOptions.value

  channelInst = new channels[opts.channel.name]({
                  id: opts.id
                , channelOptions: _.omit(opts.channel, 'name')
                })

  return new Gaggle({
    id: opts.id
  , clusterSize: opts.clusterSize
  , channel: channelInst
  })
}

module.exports._STATES = Gaggle._STATES
module.exports._RPC_TYPE = Gaggle._RPC_TYPE
