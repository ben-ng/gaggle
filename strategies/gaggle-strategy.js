var RaftStrategy = require('./raft-strategy')
  , util = require('util')

function GaggleStrategy () {
  var self = this

  RaftStrategy.apply(this, Array.prototype.slice.call(arguments))

  this._emitter.on('dirty', function () {
    self._forceHeartbeat()
  })
}

util.inherits(GaggleStrategy, RaftStrategy)

module.exports = GaggleStrategy
