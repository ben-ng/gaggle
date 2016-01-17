/**
* Coverage for edge cases in the raft strategy
*/

var Strategy = require('../../../strategies/raft-strategy')
  , RedisChannel = require('../../../channels/redis-channel')
  , InMemoryChannel = require('../../../channels/in-memory-channel')
  , test = require('tape')
  , uuid = require('uuid')
  , async = require('async')

test('raft strategy - fails when no options are given', function (t) {
  t.throws(function () {
    /*eslint-disable no-unused-vars*/
    var c = new Strategy()
    /*eslint-enable no-unused-vars*/
  }, /Invalid options/, 'Should throw if missing options')

  t.end()
})

test('raft strategy - fails when invalid options are given', function (t) {
  t.throws(function () {
    /*eslint-disable no-unused-vars*/
    var c = new Strategy({
      id: uuid.v4()
    , strategyOptions: {
        heartbeatInterval: 'well this should be a number'
      }
    })
    /*eslint-enable no-unused-vars*/
  }, /Invalid options/, 'Should throw if invalid options')

  t.end()
})

test('raft strategy - acquisition fails early', function (t) {
  var a_id = uuid.v4()
    , a = new Strategy({
        id: a_id
      , strategyOptions: {
          clusterSize: 2
        }
      , channel: new InMemoryChannel({
          id: a_id
        })
      })
    , b_id = uuid.v4()
    , b = new Strategy({
        id: b_id
      , strategyOptions: {
          clusterSize: 2
        }
      , channel: new InMemoryChannel({
          id: b_id
        })
      })
    , sameKey = 'timeOutLock'
    , sawExpectedErr = false

  a.lock(sameKey, {
    duration: 10000
  })
  .then(function (lock) {
    return b.lock(sameKey, {
      maxWait: 50000
    })
    .catch(function (err) {
      sawExpectedErr = true
      t.equals(err.toString(), 'Error: Another process is holding on to the lock right now'
        , 'Should fail early')
    })
    .then(function () {
      return a.unlock(lock)
    })
    .finally(function () {
      t.ok(sawExpectedErr, 'Second acquisition should fail')

      b.close()
      a.close()

      t.end()
    })
  })
})

test('raft strategy - acquiring a lock times out', function (t) {
  var a_id = uuid.v4()
    , a = new Strategy({
        id: a_id
      , strategyOptions: {
          clusterSize: 2
        }
      , channel: new RedisChannel({
          id: a_id
        , channelOptions: {
            redisChannel: 'acqtimeoutpubsub'
          }
        })
      })
    , b_id = uuid.v4()
    , b = new Strategy({
        id: b_id
      , strategyOptions: {
          clusterSize: 2
        }
      , channel: new RedisChannel({
          id: b_id
        , channelOptions: {
            redisChannel: 'acqtimeoutpubsub'
          }
        })
      })
    , sameKey = 'timeOutLock'
    , sawExpectedErr = false

  a.lock(sameKey, {
    duration: 10000
  , maxWait: 0
  })
  .catch(function (err) {
    sawExpectedErr = true
    t.equals(err.toString(), 'Error: Timed out before acquiring the lock'
      , 'Should time out')
  })
  .finally(function () {
    t.ok(sawExpectedErr, 'Acquisition should fail')

    // This test happens so quickly that the channels usually haven't even connected yet
    async.whilst(function () {
      return !a._channel.state.connected || !b._channel.state.connected
    }, function (next) {
      setTimeout(next, 100)
    }, function () {
      b.close()
      a.close()

      t.end()
    })
  })
})

test('raft strategy - releasing a lock times out', function (t) {
  var a_id = uuid.v4()
    , a = new Strategy({
        id: a_id
      , strategyOptions: {
          clusterSize: 2
        , unlockTimeout: 0
        }
      , channel: new RedisChannel({
          id: a_id
        , channelOptions: {
            redisChannel: 'releasetimeoutpubsub'
          }
        })
      })
    , b_id = uuid.v4()
    , b = new Strategy({
        id: b_id
      , strategyOptions: {
          clusterSize: 2
        , unlockTimeout: 0
        }
      , channel: new RedisChannel({
          id: b_id
        , channelOptions: {
            redisChannel: 'releasetimeoutpubsub'
          }
        })
      })
    , sameKey = 'timeOutLock'
    , sawExpectedErr = false

  t.plan(3)

  a.lock(sameKey, {
    duration: 10000
  , maxWait: 10000
  })
  .then(function (lock) {
    t.pass('should acquire the lock')

    return a.unlock(lock)
    .catch(function (err) {
      sawExpectedErr = true
      t.equals(err.toString(), 'Error: Timed out before unlocking'
        , 'Should time out')
    })
  })
  .finally(function () {
    t.ok(sawExpectedErr, 'Acquisition should fail')

    // This test happens so quickly that the channels usually haven't even connected yet
    async.whilst(function () {
      return !a._channel.state.connected || !b._channel.state.connected
    }, function (next) {
      setTimeout(next, 100)
    }, function () {
      b.close()
      a.close()

      t.end()
    })
  })
})
