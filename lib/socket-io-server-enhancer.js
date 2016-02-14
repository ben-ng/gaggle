var SocketIO = require('socket.io')
  , _ = require('lodash')

function enhanceServerForGaggleSocketIOChannel (server) {
  var io = SocketIO(server)
    , sockets = []
    , cleanupAfterSocketDisconnect

  cleanupAfterSocketDisconnect = function cleanupAfterSocketDisconnect (socket) {
    _.remove(sockets, {handle: socket})
    socket.removeAllListeners()
    socket.disconnect()
  }

  io.sockets.on('connection', function (socket) {
    sockets.push({
      handle: socket
    , channel: 'unknown'
    })

    // broadcast everything to everyone in the same channel
    socket.on('msg', function (dat) {
      var sourceChannel = _.find(sockets, {handle: socket}).channel

      _.each(sockets, function (s) {
        if (s.channel === sourceChannel) {
          s.handle.emit('msg', dat)
        }
      })
    })

    socket.on('declareChannel', function (channel) {
      _.find(sockets, {handle: socket}).channel = channel
    })

    socket.on('disconnect', _.bind(cleanupAfterSocketDisconnect, null, socket))
  })

  return function teardown (cb) {
    io.close()

    _.each(sockets, cleanupAfterSocketDisconnect)
  }
}

module.exports = enhanceServerForGaggleSocketIOChannel
