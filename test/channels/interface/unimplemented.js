var t = require('tap')
  , uuid = require('uuid')
  , Channel = require('../../../channels/unimplemented-channel')

t.test('throws when stub methods are called', function (t) {
  var c = new Channel({id: uuid.v4()})

  t.throws(function () {
    c.connect()
  }, 'throws when connect is called')

  t.throws(function () {
    c.broadcast()
  }, 'throws when broadcast is called')

  t.throws(function () {
    c.send()
  }, 'throws when send is called')

  t.throws(function () {
    c.disconnect()
  }, 'throws when disconnect is called')

  t.end()
})
