var Benchmark = require('benchmark')
  , bars = require('jstrace-bars')
  , atomicIncrement = require('../lib/atomic-increment')
  , largeKeyspace = require('../lib/large-keyspace')
  , uuid = require('uuid')
  , assert = require('assert')
  , _ = require('lodash')
  , async = require('async')
  , suite = new Benchmark.Suite()
  , CLUSTER_SIZE = 5
  , INCREMENTS_PER_PROCESS = 20

// add tests
suite
.add('Sequential - Baseline', {
  defer: true
, delay: 2
, fn: function (deferred) {
    var iterations = INCREMENTS_PER_PROCESS * CLUSTER_SIZE
      , globalCounter = 0

    async.timesSeries(iterations, function (i, next) {
      setTimeout(function () {
        var temp = globalCounter

        setTimeout(function () {
          globalCounter = temp + 1

          setTimeout(function () {

            setTimeout(function () {
              next()
            }, 15)
          }, 15)
        }, 15)
      }, 15)
    }, function () {
      deferred.resolve()
    })
  }
})
.add('Redis - Worst Case', {
  defer: true
, delay: 2
, fn: function (deferred) {
    var Strategy = require('../strategies/redis-strategy')

    atomicIncrement(function () {
      // Gives us coverage for both default and explicit init
      return new Strategy({
        strategyOptions: {
          redisConnectionString: 'redis://127.0.0.1'
        }
      , id: uuid.v4()
      })
    }
    , CLUSTER_SIZE, INCREMENTS_PER_PROCESS, function (err) {
      assert.ifError(err, 'There should be no error')

      deferred.resolve()
    })
  }
})
.add('Gaggle - Worst Case', {
  defer: true
, delay: 2
, fn: function (deferred) {
    var Strategy = require('../strategies/gaggle-strategy')
      , Channel = require('../channels/redis-channel')
      , testRedisChannel = uuid.v4()

    atomicIncrement(function () {
      var id = uuid.v4()
        , chan = new Channel({
            id: id
          , channelOptions: {
              redisChannel: testRedisChannel
            }
          })
        , strat = new Strategy({
            id: id
          , channel: chan
          , strategyOptions: {
              clusterSize: CLUSTER_SIZE
            }
          })

      return strat
    }
    , CLUSTER_SIZE, INCREMENTS_PER_PROCESS, function (err) {
      assert.ifError(err, 'There should be no error')
      deferred.resolve()
    })
  }
})
.add('Raft - Worst Case', {
  defer: true
, delay: 2
, fn: function (deferred) {
    var Strategy = require('../strategies/raft-strategy')
      , Channel = require('../channels/redis-channel')
      , testRedisChannel = uuid.v4()

    atomicIncrement(function () {
      var id = uuid.v4()
        , chan = new Channel({
            id: id
          , channelOptions: {
              redisChannel: testRedisChannel
            }
          })
        , strat = new Strategy({
            id: id
          , channel: chan
          , strategyOptions: {
              clusterSize: CLUSTER_SIZE
            }
          })

      return strat
    }
    , CLUSTER_SIZE, INCREMENTS_PER_PROCESS, function (err) {
      assert.ifError(err, 'There should be no error')
      deferred.resolve()
    })
  }
})
.add('Redis - Best Case', {
  defer: true
, delay: 2
, fn: function (deferred) {
    var Strategy = require('../strategies/redis-strategy')

    largeKeyspace(function () {
      // Gives us coverage for both default and explicit init
      return new Strategy({
        strategyOptions: {
          redisConnectionString: 'redis://127.0.0.1'
        }
      , id: uuid.v4()
      })
    }
    , CLUSTER_SIZE, INCREMENTS_PER_PROCESS, function (err) {
      assert.ifError(err, 'There should be no error')

      deferred.resolve()
    })
  }
})
.add('Gaggle - Best Case', {
  defer: true
, delay: 2
, fn: function (deferred) {
    var Strategy = require('../strategies/gaggle-strategy')
      , Channel = require('../channels/redis-channel')
      , testRedisChannel = uuid.v4()

    largeKeyspace(function () {
      var id = uuid.v4()
        , chan = new Channel({
            id: id
          , channelOptions: {
              redisChannel: testRedisChannel
            }
          })
        , strat = new Strategy({
            id: id
          , channel: chan
          , strategyOptions: {
              clusterSize: CLUSTER_SIZE
            }
          })

      return strat
    }
    , CLUSTER_SIZE, INCREMENTS_PER_PROCESS, function (err) {
      assert.ifError(err, 'There should be no error')
      deferred.resolve()
    })
  }
})
.add('Raft - Best Case', {
  defer: true
, delay: 2
, fn: function (deferred) {
    var Strategy = require('../strategies/raft-strategy')
      , Channel = require('../channels/redis-channel')
      , testRedisChannel = uuid.v4()

    largeKeyspace(function () {
      var id = uuid.v4()
        , chan = new Channel({
            id: id
          , channelOptions: {
              redisChannel: testRedisChannel
            }
          })
        , strat = new Strategy({
            id: id
          , channel: chan
          , strategyOptions: {
              clusterSize: CLUSTER_SIZE
            }
          })

      return strat
    }
    , CLUSTER_SIZE, INCREMENTS_PER_PROCESS, function (err) {
      assert.ifError(err, 'There should be no error')
      deferred.resolve()
    })
  }
})
.on('cycle', function (event) {
  console.log(String(event.target))
})
.on('complete', function () {
  var totalIncrements = CLUSTER_SIZE * INCREMENTS_PER_PROCESS
    , data = {}

  this.each(function (bench) {
    data[bench.name] = _.round(1000 / bench.hz / totalIncrements, 2)
  })

  console.log('')

  console.log(bars(data, {
    sort: true
  , width: 40
  }))
})
// run async
.run({ 'async': true })
