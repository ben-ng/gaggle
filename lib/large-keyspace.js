var Promise = require('bluebird')
  , async = require('async')
  , redis = require('redis')
  , once = require('once')
  , _ = require('lodash')
  , uuid = require('uuid')

Promise.promisifyAll(redis.RedisClient.prototype)

module.exports = function largeKeyspace (createStrategy, clusterSize, operationCount, _cb) {
  // Test parameters
  var valueKey = 'gaggleLargeKeyspaceTestValue'
  // Test state
    , r = redis.createClient()
    , i = 0
    , finishedGaggles = 0
    , gaggleFinished
    , cluster = []
    , cb = once(_cb)
    , randomPrefix = uuid.v4()
    , uniqueCounter = 0

  gaggleFinished = function gaggleFinished () {
    finishedGaggles = finishedGaggles + 1

    if (finishedGaggles === clusterSize) {
      r.getAsync(valueKey)
      .then(function () {
        return Promise.resolve()
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
  .then(function () {
    for (i=0; i<clusterSize; ++i) {
    (function (ii) {
      var incrementCounter = 0
        , g = createStrategy()

      cluster.push(g)

      async.whilst(
        function () { return incrementCounter < operationCount }
      , function (next) {
          // Correctness doesn't change when locks fail to be acquired
          // we only care about behavior when locks are acquired
          var ignoreResultAndKeepGoing = function () { return Promise.resolve() }

          uniqueCounter = uniqueCounter + 1

          g.lock(randomPrefix + uniqueCounter, {maxWait: 5000, duration: 2000})
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
          // Breaks the promise chain to **significantly** reduce memory usage
          .finally(function () {
            setTimeout(next, 0)
          })
        }
      , function () {
          gaggleFinished()
        }
      )
    })(i)
    }
  })
}
