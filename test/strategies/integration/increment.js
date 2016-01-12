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

Promise.promisifyAll(redis.RedisClient.prototype)

function testStrategy (createStrategy, _cb) {
  // Test parameters
  var incrementCount = 100
    , gaggleCount = 10
    , valueKey = 'gaggleAtomicIncrementTestValue'
    , lockKey = 'gaggleAtomicIncrementTestLock'
  // Test state
    , r = redis.createClient()
    , expectedFinalValue = incrementCount * gaggleCount
    , i = 0
    , finishedGaggles = 0
    , gaggleFinished
    , cb = once(_cb)

  gaggleFinished = function gaggleFinished () {
    finishedGaggles = finishedGaggles + 1

    if (finishedGaggles === gaggleCount) {
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

        cb()
      })
    }
  }

  r.setAsync(valueKey, 0)
  r.delAsync(lockKey, 0)
  .then(function () {
    for (i=0; i<gaggleCount; ++i) {
    (function () {
      var incrementCounter = 0
        , g = createStrategy()

      async.whilst(
        function () { return incrementCounter < incrementCount }
      , function (next) {
          g.lock(lockKey)
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
            })
          })
          .then(function () {
            next()
          })
        }
      , function () {
          g.close()
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
  }, function (err) {
    t.ok(err, 'There should be an error')

    if (err != null) {
      t.ok(err.toString().indexOf('Error: Increments were not atomic') === 0
      , 'The error should be that "Increments were not atomic"')
    }

    t.end()
  })
})

test('atomic increment - redis', function (t) {
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
    return new Strategy(counter % 2 === 0 ? explicitOptions : null)
  }
  , function (err) {
    t.equal(err, undefined, 'unexpected error: ' + err)

    t.end()
  })
})
