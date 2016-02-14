var t = require('tap')
  , uuid = require('uuid')
  , _ = require('lodash')
  , http = require('http')
  , serverEnhancer = require('../../../lib/socket-io-server-enhancer')
  , RANDOM_HIGH_PORT = _.random(9000, 65535)
  , InMemoryChannel = require('../../../channels/in-memory-channel')
  , RedisChannel = require('../../../channels/redis-channel')
  , SocketIOChannel = require('../../../channels/socket-io-channel')
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
              channelName: 'channelIntegrationTestChannel'
            }
          })
        }
      , cls: RedisChannel
      }
    , SocketIO: {
        setup: function setupSocketIOServer (cb) {
          var noop = function noop (req, resp) {
                resp.writeHead(200)
                resp.end()
              }
            , server = http.createServer(noop)
            , closeServer

          closeServer = serverEnhancer(server)

          server.listen(RANDOM_HIGH_PORT, function () {
            cb(function exposedTeardownCb (teardownCb) {
              server.once('close', teardownCb)
              closeServer()
            })
          })
        }
      , create: function createSocketIOChannel () {
          return new SocketIOChannel({
            id: uuid.v4()
          , channelOptions: {
              host: 'http://127.0.0.1:' + RANDOM_HIGH_PORT
            , channel: 'gaggle'
            }
          })
        }
      , cls: RedisChannel
      }
    }

// Start outer EACH
// Define these t.tests once for each channel
_.each(channelsToTest, function (channelDetails, channelName) {

var createChannel = channelDetails.create
  , customTestSetup = channelDetails.setup
  , Channel = channelDetails.cls

if (customTestSetup == null) {
  customTestSetup = function noopSetup (cb) {
    cb(function noopCleanup (_cb) {_cb()})
  }
}

function setupTest (t, requestedChannelCount, cb) {
  var channels = []
    , i
    , tempChannel
    , connectedCounter = 0
    , connectedMap = {}
    , onConnect
    , cleanup
    , cleanedUp = false
    , executionsCounter = 0
    , customTestCleanup

  cleanup = function () {
    var onDisconnect

    if (cleanedUp) {
      throw new Error('Cannot clean up the same t.test twice')
    }
    else {
      cleanedUp = true
    }

    if (requestedChannelCount === 0) {
      customTestCleanup(t.end)
      return
    }

    onDisconnect = function (whichChannel) {
      connectedCounter -= 1

      if (connectedCounter === 0) {
        customTestCleanup(t.end)
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

  customTestSetup(function (teardownFunc) {
    customTestCleanup = teardownFunc

    if (requestedChannelCount === 0) {
      cb(cleanup)
      return
    }

    for (i=0; i<requestedChannelCount; ++i) {
      tempChannel = createChannel()

      tempChannel.once('connected', onConnect.bind(this, tempChannel))
      tempChannel.connect()

      channels.push(tempChannel)
    }
  })
}

t.test(channelName + ' channel integration - throws when options are invalid', function (t) {

  t.throws(function () {
    /* eslint-disable no-new */
    new Channel()
    /* eslint-enable no-new */
  }, 'throws when options are missing')

  t.throws(function () {
    /* eslint-disable no-new */
    new Channel({id: ''}) // needs to be a nonempty string
    /* eslint-enable no-new */
  }, 'throws when options are invalid')

  t.end()

})

t.test(channelName + ' channel integration - should connect after instantiation and disconnect when requested', function (t) {

  setupTest(t, 0, function (cleanup) {
    var c = createChannel()

    c.once('disconnected', function () {
      t.pass('disconnected')

      cleanup(t.end)
    })

    c.once('connected', function () {
      t.pass('connected')
      c.disconnect()
    })

    c.connect()
  })
})

t.test(channelName + ' channel integration - should send a message to a specified node', function (t) {
  setupTest(t, 2, function (a, b, cleanup) {

    b.once('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')
      t.strictEquals(data, 'foo', 'message contents should be "foo"')

      cleanup()
    })

    a.send(b.id, 'foo')
  })
})

t.test(channelName + ' channel integration - should send a message to itself', function (t) {
  setupTest(t, 1, function (a, cleanup) {

    a.once('recieved', function (originNodeId, data) {
      t.strictEquals(originNodeId, a.id, 'message origin should be node A')
      t.strictEquals(data, 'foo', 'message contents should be "foo"')

      cleanup()
    })

    a.send(a.id, 'foo')
  })
})

t.test(channelName + ' channel integration - should be FIFO', function (t) {
  setupTest(t, 2, function (a, b, cleanup) {

    var previous = -1
      , sequenceLength = 50
      , finish = _.after(sequenceLength, function () {
          b.removeAllListeners()
          cleanup()
        })

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

t.test(channelName + ' channel integration - t.test helper works', function (t) {
  setupTest(t, 1, function (a, cleanup) {
    t.pass('the helper opens the channels')
    cleanup()
  })
})

t.test(channelName + ' channel integration - t.test helper throws if you try to clean up the t.test twice', function (t) {
  var fakeTest = {end: function noop () {}}

  setupTest(fakeTest, 1, function (a, cleanup) {
    cleanup()

    t.throws(function () {
      cleanup()
    }, 'throws if you try to clean up twice')

    t.end()
  })
})

t.test(channelName + ' channel integration - should broadcast a message to all nodes', function (t) {
  setupTest(t, 3, function (a, b, c, cleanup) {

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
