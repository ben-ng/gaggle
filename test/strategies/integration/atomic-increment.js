/**
* Test if multiple gaggles can atomically increment a value
*
* Each process starts up, creates a gaggle, and then tries to increment
* a value 1000 times.
*/

var test = require('tape')
  , uuid = require('uuid')
  , _ = require('lodash')
  , atomicIncrement = require('../../../lib/atomic-increment')
  , CLUSTER_SIZE = 10

test('atomic increment test fails when mutual exclusion is faulty', function (t) {
  var Strategy = require('../../../strategies/noop-strategy')

  atomicIncrement(function () {
    return new Strategy({id: uuid.v4()})
  }, CLUSTER_SIZE, 100, function (err) {
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
    , testStart = Date.now()
    , INCREMENTS_PER_PROCESS = 50

  atomicIncrement(function () {
    counter = counter + 1

    // Gives us coverage for both default and explicit init
    return new Strategy(counter % 2 === 0 ? explicitOptions : {id: uuid.v4()})
  }
  , CLUSTER_SIZE, INCREMENTS_PER_PROCESS, function (err) {
    t.ifError(err, 'There should be no error')

    t.pass('Average lock time: ' + _.round((Date.now() - testStart) / (CLUSTER_SIZE * INCREMENTS_PER_PROCESS), 2) + 'ms')

    t.end()
  })
})

test('atomic increment - Gaggle', function (t) {
  var Strategy = require('../../../strategies/gaggle-strategy')
    , Channel = require('../../../channels/in-memory-channel')
    , testStart = Date.now()
    , INCREMENTS_PER_PROCESS = 20

  atomicIncrement(function () {
    var id = uuid.v4()
      , chan = new Channel({
          id: id
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
    t.ifError(err, 'There should be no error')

    t.pass('Average lock time: ' + _.round((Date.now() - testStart) / (CLUSTER_SIZE * INCREMENTS_PER_PROCESS), 2) + 'ms')

    t.end()
  })
})

test('atomic increment - Raft', function (t) {
  var Strategy = require('../../../strategies/raft-strategy')
    , Channel = require('../../../channels/in-memory-channel')
    , testStart = Date.now()
    , INCREMENTS_PER_PROCESS = 20

  atomicIncrement(function () {
    var id = uuid.v4()
      , chan = new Channel({
          id: id
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
    t.ifError(err, 'There should be no error')

    t.pass('Average lock time: ' + _.round((Date.now() - testStart) / (CLUSTER_SIZE * INCREMENTS_PER_PROCESS), 2) + 'ms')

    t.end()
  })
})
