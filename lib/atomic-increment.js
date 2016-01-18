var Promise = require('bluebird')
  , async = require('async')
  , redis = require('redis')
  , once = require('once')
  , _ = require('lodash')
  , microtime = require('microtime')
  , uuid = require('uuid')

Promise.promisifyAll(redis.RedisClient.prototype)

module.exports = function atomicIncrement (createStrategy, clusterSize, incrementCount, _cb) {
  // Test parameters
  var lockKey = 'gaggleAtomicIncrementTestLock-' + uuid.v4()
  // Test state
    , r = redis.createClient()
    , expectedFinalValue = incrementCount * clusterSize
    , i = 0
    , finishedGaggles = 0
    , gaggleFinished
    , globalValue = 0
    , cluster = []
    , oplog = []
    , errContext = []
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

        errMsg += '\n\nRelevant logs:\n' + errContext.join('\n')

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

                oplog.push('@' + microtime.now() + ' process ' + g.id.substring(0, 5) + ' read ' + temp)

                setTimeout(function () {
                  resolve(temp)
                }, 15)
              }, 15)
            })
            .then(function (val) {
              return new Promise(function (resolve, reject) {
                setTimeout(function () {

                  var oldGlobalValue = globalValue

                  globalValue = val + 1

                  oplog.push('@' + microtime.now() + ' process ' + g.id.substring(0, 5) + ' wrote ' + globalValue)

                  if (oldGlobalValue === globalValue) {
                    errContext = errContext.concat(_.takeRight(oplog, 10))
                    errContext.push('^ lost update detected')

                    // Detect a distributed strategy and make additional debugging info available
                    /*
                    if (g._state != null) {
                      errContext.push('v process states')

                      _.each(cluster, function (node) {
                        var logSummary = _(node._log).takeRight(10).map(function (entry, i) {
                              return '  ' + _.padEnd(i, 3) + ' t:' +  entry.term +
                              ' k:' + entry.data.key +
                              ' ttl:' + entry.data.ttl +
                              ' granter:' + entry.data.granter +
                              ' locks:' + JSON.stringify(entry.data.locks)
                            }).valueOf().join('\n')
                          , lockSummary = _(node._lockMap).map(function (v, k) {
                              if (v == null) {
                                return null
                              }
                              else {
                                return '  ' + k + ' ttl: ' + v.ttl
                              }
                            }).compact().value().join('\n')

                        errContext.push(node.id.substring(0, 5) + ' (' + node._state + ')' +
                          ' Term: ' + node._currentTerm +
                          ' Commit Index: ' + node._commitIndex +
                          ' Applied Index: ' + node._lastApplied +
                          ' \nLocks:\n' + lockSummary +
                          ' \n\nLogs:\n' + logSummary + '\n')
                      })
                    }
                    */

                    errContext.push('--------------')
                  }

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
