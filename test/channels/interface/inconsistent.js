var t = require('tap')
  , uuid = require('uuid')
  , Channel = require('../../../channels/unimplemented-channel')

t.test('channels throw when inconsistent', function (t) {
  t.throws(function () {
    var c = new Channel({id: uuid.v4()})
    c._recieved('bogus', 'data')
  }, 'throws when _recieved is called when channel is disconnected')

  t.throws(function () {
    var c = new Channel({id: uuid.v4()})
    c._connected()
    c._connected()
  }, 'throws when _connected is called when channel is already connected')

  t.throws(function () {
    var c = new Channel({id: uuid.v4()})
    c._disconnected()
  }, 'throws when _disconnected is called when channel is already disconnected')

  t.end()
})
