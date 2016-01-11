var test = require('tape')
  , uuid = require('uuid')
  , _ = require('lodash')
  , InMemoryChannel = require('../../../channels/in-memory-channel')
  , RedisChannel = require('../../../channels/redis-channel')
  , channelsToTest = {
      InMemory: {
        create: function createInMemoryChannel () {
          return new InMemoryChannel({id: uuid.v4()})
        }
      , cls: InMemoryChannel
      }
    , Redis: {
        create: function createRedisChannel () {
          return new RedisChannel({
            id: uuid.v4()
          , channelOptions: {
              redisChannel: 'channelIntegrationTestChannel'
            }
          })
        }
      , cls: RedisChannel
      }
    }

// Start outer EACH
// Define these tests once for each channel
_.each(channelsToTest, function (channelDetails, channelName) {

var createChannel = channelDetails.create
  , Channel = channelDetails.cls

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
    tempChannel = createChannel()

    tempChannel.once('connected', onConnect.bind(this, tempChannel))
    tempChannel.connect()

    channels.push(tempChannel)
  }
}

test(channelName + ' channel integration - throws when options are invalid', function (t) {

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

test(channelName + ' channel integration - should connect after instantiation and disconnect when requested', function (t) {

  var c = createChannel()

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

test(channelName + ' channel integration - should send a message to a specified node', function (t) {
  openChannels(t, 2, function (a, b, cleanup) {

    b.once('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')
      t.strictEquals(data, 'foo', 'message contents should be "foo"')

      cleanup()
    })

    a.send(b.id, 'foo')
  })
})

test(channelName + ' channel integration - should be FIFO', function (t) {
  openChannels(t, 2, function (a, b, cleanup) {

    var previous = -1
      , sequenceLength = 1000
      , finish = _.after(function () {
          b.removeAllListeners()
          cleanup()
        }, sequenceLength)

    b.on('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')

      t.strictEquals(parseInt(data, 10), previous + 1, 'message should be in order')

      previous = previous + 1

      finish()
    })

    for (var i=0; i<sequenceLength; ++i) {
      a.send(b.id, i)
    }
  })
})

test(channelName + ' channel integration - test helper works', function (t) {
  openChannels(t, 1, function (a, cleanup) {
    cleanup()
  })
})

test(channelName + ' channel integration - test helper throws if you try to clean up the test twice', function (t) {
  var fakeTest = {end: function noop () {}}

  openChannels(fakeTest, 1, function (a, cleanup) {
    cleanup()

    t.throws(function () {
      cleanup()
    }, 'throws if you try to clean up twice')

    t.end()
  })
})

test(channelName + ' channel integration - should broadcast a message to all nodes', function (t) {
  openChannels(t, 3, function (a, b, c, cleanup) {

    a.once('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')
      t.strictEquals(data, 'foo', 'message contents should be "foo"')
      cleanup.after(3)
    })

    b.once('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')
      t.strictEquals(data, 'foo', 'message contents should be "foo"')
      cleanup.after(3)
    })

    c.once('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')
      t.strictEquals(data, 'foo', 'message contents should be "foo"')
      cleanup.after(3)
    })

    a.broadcast('foo')
  })
})

// End outer EACH
})
