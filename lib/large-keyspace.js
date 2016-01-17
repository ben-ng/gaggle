var Promise = require('bluebird')
  , async = require('async')
  , redis = require('redis')
  , once = require('once')
  , _ = require('lodash')
  , uuid = require('uuid')

Promise.promisifyAll(redis.RedisClient.prototype)

module.exports = function largeKeyspace (createStrategy, clusterSize, operationCount, _cb) {
  // Test state
  var r = redis.createClient()
    , i = 0
    , finishedGaggles = 0
    , gaggleFinished
    , cluster = []
    , cb = once(_cb)
    , expectedFinalValue = operationCount * clusterSize
    , randomPrefix = uuid.v4()
    , uniqueCounter = 0
    , globalValue = 0

  gaggleFinished = function gaggleFinished () {
    finishedGaggles = finishedGaggles + 1

    if (finishedGaggles === clusterSize) {
        r.quit()

        _.each(cluster, function (node) {
          node.close()
        })

      if (globalValue !== expectedFinalValue) {
        var errMsg = 'Increments were not all applied: expected ' + expectedFinalValue + ', got ' + globalValue

        cb(new Error(errMsg))
      }
      else {
        cb()
      }
    }
  }

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
          return new Promise(function (resolve, reject) {
            setTimeout(function () {
              var temp = globalValue
              setTimeout(function () {
                resolve(temp)
              }, 15)
            }, 15)
          })
          .then(function () {
            return new Promise(function (resolve, reject) {
              setTimeout(function () {
                globalValue = globalValue + 1

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
}
