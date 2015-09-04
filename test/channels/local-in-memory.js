var test = require('tape')
  , uuid = require('uuid')
  , Channel = require('../../lib/channels/local-in-memory')

function openChannels (t, requestedChannelCount, cb) {
  var channels = []
    , i
    , tempChannel
    , connectedCounter = 0
    , connectedMap = {}
    , onConnect
    , cleanup
    , cleanedUp = false
    , executionsCounter = 0

  cleanup = function () {
    if (cleanedUp) {
      throw new Error('Cannot clean up the same test twice')
    }
    else {
      cleanedUp = true
    }

    var onDisconnect = function (whichChannel) {
      connectedCounter -= 1

      if (connectedCounter === 0) {
        t.end()
      }
    }

    for (var channelId in connectedMap) {
      if (connectedMap.hasOwnProperty(channelId) && connectedMap[channelId] != null) {
        connectedMap[channelId].once('disconnected', onDisconnect.bind(this, tempChannel))
        connectedMap[channelId].disconnect()
        connectedMap[channelId] = null
      }
    }
  }

  cleanup.after = function (executionsNeeded) {
    executionsCounter++

    if (executionsCounter === executionsNeeded) {
      cleanup()
    }
  }

  onConnect = function (whichChannel) {
    if (connectedMap[whichChannel.id] == null) {
      connectedCounter += 1

      connectedMap[whichChannel.id] = whichChannel

      if (connectedCounter === requestedChannelCount) {
        cb.apply(this, channels.concat(cleanup))
      }
    }
  }

  for (i=0; i<requestedChannelCount; ++i) {
    tempChannel = new Channel({id: uuid.v4()})

    tempChannel.once('connected', onConnect.bind(this, tempChannel))
    tempChannel.connect()

    channels.push(tempChannel)
  }
}

test('throws when options are invalid', function (t) {

  t.throws(function () {
    /* eslint-disable no-new */
    new Channel()
    /* eslint-enable no-new */
  }, 'throws when options are missing')

  t.throws(function () {
    /* eslint-disable no-new */
    new Channel({id: 'not-a-guid'})
    /* eslint-enable no-new */
  }, 'throws when options are invalid')

  t.end()

})

test('should connect after instantiation and disconnect when requested', function (t) {

  var c = new Channel({id: uuid.v4()})

  c.once('disconnected', function () {
    t.pass('disconnected')
    t.end()
  })

  c.once('connected', function () {
    t.pass('connected')
    c.disconnect()
  })

  c.connect()
})

test('should send a message to a specified node', function (t) {
  openChannels(t, 2, function (a, b, cleanup) {

    b.once('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')
      t.strictEquals(data, 'foo', 'message contents should be "foo"')

      cleanup()
    })

    a.send(b.id, 'foo')
  })
})

test('test helper works', function (t) {
  openChannels(t, 1, function (a, cleanup) {
    cleanup()
  })
})

test('test helper throws if you try to clean up the test twice', function (t) {
  var fakeTest = {end: function noop () {}}

  openChannels(fakeTest, 1, function (a, cleanup) {
    cleanup()

    t.throws(function () {
      cleanup()
    }, 'throws if you try to clean up twice')

    t.end()
  })
})

test('should broadcast a message to all nodes', function (t) {
  openChannels(t, 3, function (a, b, c, cleanup) {

    b.once('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')
      t.strictEquals(data, 'foo', 'message contents should be "foo"')
      cleanup.after(2)
    })

    c.once('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')
      t.strictEquals(data, 'foo', 'message contents should be "foo"')
      cleanup.after(2)
    })

    a.broadcast('foo')
  })
})
