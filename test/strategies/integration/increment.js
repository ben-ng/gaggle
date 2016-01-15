/**
* Test if multiple gaggles can atomically increment a value
*
* Each process starts up, creates a gaggle, and then tries to increment
* a value 1000 times.
*/

var Promise = require('bluebird')
  , test = require('tape')
  , async = require('async')
  , redis = require('redis')
  , once = require('once')
  , uuid = require('uuid')
  , _ = require('lodash')
  , CLUSTER_SIZE = 10

Promise.promisifyAll(redis.RedisClient.prototype)

function testStrategy (createStrategy, incrementCount, _cb) {
  // Test parameters
  var valueKey = 'gaggleAtomicIncrementTestValue'
    , lockKey = 'gaggleAtomicIncrementTestLock'
  // Test state
    , r = redis.createClient()
    , expectedFinalValue = incrementCount * CLUSTER_SIZE
    , i = 0
    , finishedGaggles = 0
    , gaggleFinished
    , cluster = []
    , cb = once(_cb)

  gaggleFinished = function gaggleFinished () {
    finishedGaggles = finishedGaggles + 1

    if (finishedGaggles === CLUSTER_SIZE) {
      r.getAsync(valueKey)
      .then(function (val) {
        var actual = parseInt(val, 10)

        if (actual !== expectedFinalValue) {
          var errMsg = 'Increments were not atomic: expected ' + expectedFinalValue + ', got ' + actual

          return Promise.reject(new Error(errMsg))
        }
        else {
          return Promise.resolve()
        }
      })
      .catch(function (err) {
        cb(err)
      })
      .finally(function () {
        r.quit()

        _.each(cluster, function (node) {
          node.close()
        })

        cb()
      })
    }
  }

  r.setAsync(valueKey, 0)
  r.delAsync(lockKey, 0)
  .then(function () {
    for (i=0; i<CLUSTER_SIZE; ++i) {
    (function (ii) {
      var incrementCounter = 0
        , g = createStrategy()

      cluster.push(g)

      async.whilst(
        function () { return incrementCounter < incrementCount }
      , function (next) {
          // Correctness doesn't change when locks fail to be acquired
          // we only care about behavior when locks are acquired
          var ignoreResultAndKeepGoing = function () { return Promise.resolve() }

          g.lock(lockKey, {maxWait: 5000, duration: 1000})
          // CRITICAL SECTION BEGIN
          .then(function (lock) {
            return r.getAsync(valueKey)
            .then(function (val) {
              return r.setAsync(valueKey, parseInt(val, 10) + 1)
            })
            // CRITICAL SECTION END
            .then(function () {
              incrementCounter = incrementCounter + 1
              return g.unlock(lock)
              .then(function () {
                return Promise.resolve()
              })
            })
            .then(ignoreResultAndKeepGoing)
            .catch(ignoreResultAndKeepGoing)
          })
          .then(ignoreResultAndKeepGoing)
          .catch(ignoreResultAndKeepGoing)
          .finally(next)
        }
      , function () {
          gaggleFinished()
        }
      )
    })(i)
    }
  })
}

test('atomic increment test fails when mutual exclusion is faulty', function (t) {
  var Strategy = require('../../../strategies/noop-strategy')

  testStrategy(function () {
    return new Strategy({id: uuid.v4()})
  }, 100, function (err) {
    t.ok(err, 'There should be an error')

    if (err != null) {
      t.ok(err.toString().indexOf('Error: Increments were not atomic') === 0
      , 'The error should be that "Increments were not atomic"')
    }

    t.end()
  })
})

test('atomic increment - Redis', function (t) {
  var Strategy = require('../../../strategies/redis-strategy')
    , counter = 0
    , explicitOptions = {
        strategyOptions: {
          redisConnectionString: 'redis://127.0.0.1'
        }
      , id: uuid.v4()
      }

  testStrategy(function () {
    counter = counter + 1

    // Gives us coverage for both default and explicit init
    return new Strategy(counter % 2 === 0 ? explicitOptions : {id: uuid.v4()})
  }
  , 100, function (err) {
    t.equal(err, undefined, 'There should be no error (got ' + err + ')')

    t.end()
  })
})

test('atomic increment - Raft', function (t) {
  var Strategy = require('../../../strategies/raft-strategy')
    , Channel = require('../../../channels/redis-channel')

  testStrategy(function () {
    var id = uuid.v4()
      , chan = new Channel({
          id: id
        , channelOptions: {
            redisChannel: 'raftAtomicIncrement'
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
  , 20, function (err) {
    t.equal(err, undefined, 'There should be no error (got ' + err + ')')

    t.end()
  })
})
