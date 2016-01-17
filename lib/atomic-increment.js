var Promise = require('bluebird')
  , async = require('async')
  , redis = require('redis')
  , once = require('once')
  , _ = require('lodash')

Promise.promisifyAll(redis.RedisClient.prototype)

module.exports = function atomicIncrement (createStrategy, clusterSize, incrementCount, _cb) {
  // Test parameters
  var lockKey = 'gaggleAtomicIncrementTestLock'
  // Test state
    , r = redis.createClient()
    , expectedFinalValue = incrementCount * clusterSize
    , i = 0
    , finishedGaggles = 0
    , gaggleFinished
    , globalValue = 0
    , cluster = []
    , cb = once(_cb)

  gaggleFinished = function gaggleFinished () {
    finishedGaggles = finishedGaggles + 1

    if (finishedGaggles === clusterSize) {
        r.quit()

        _.each(cluster, function (node) {
          node.close()
        })

      if (globalValue !== expectedFinalValue) {
        var errMsg = 'Increments were not atomic: expected ' + expectedFinalValue + ', got ' + globalValue

        cb(new Error(errMsg))
      }
      else {
        cb()
      }
    }
  }

  r.delAsync(lockKey, 0)
  .then(function () {
    for (i=0; i<clusterSize; ++i) {
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

          g.lock(lockKey, {maxWait: 5000, duration: 2000})
          // CRITICAL SECTION BEGIN
          .then(function (lock) {
            return new Promise(function (resolve, reject) {
              setTimeout(function () {
                var temp = globalValue
                setTimeout(function () {
                  resolve(temp)
                }, 15)
              }, 15)
            })
            .then(function (val) {
              return new Promise(function (resolve, reject) {
                setTimeout(function () {
                  globalValue = val + 1

                  setTimeout(function () {
                    resolve()
                  }, 15)
                }, 15)
              })
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
