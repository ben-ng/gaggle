var SocketIOChannel = require('../../../channels/socket-io-channel')
  , uuid = require('uuid')
  , t = require('tap')

t.test('socket.io channel - fails options validation', function (t) {
  t.throws(function () {
    /*eslint-disable no-unused-vars*/
    var c = new SocketIOChannel({
      id: uuid.v4()
    })
    /*eslint-enable no-unused-vars*/
  }, /Invalid options: "channelOptions" is required/, 'Should throw if missing host')

  t.end()
})
