/**
* Coverage for edge cases in the raft strategy
*/

var Strategy = require('../../../strategies/raft-strategy')
  , Channel = require('../../../channels/redis-channel')
  , test = require('tape')
  , uuid = require('uuid')

test('raft strategy - fails when no options are given', function (t) {
  t.throws(function () {
    /*eslint-disable no-unused-vars*/
    var c = new Strategy()
    /*eslint-enable no-unused-vars*/
  }, /Invalid options/, 'Should throw if missing options')

  t.end()
})

test('raft strategy - acquisition times out', function (t) {
  var a_id = uuid.v4()
    , a = new Strategy({
        id: a_id
      , strategyOptions: {
          clusterSize: 2
        }
      , channel: new Channel({
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
      , channel: new Channel({
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
  })
  .then(function (lock) {
    return b.lock(sameKey, {
      maxWait: 1
    })
    .catch(function (err) {
      sawExpectedErr = true
      t.equal(err.toString(), 'Error: Timed out before acquiring the lock', 'Should time out with expected error')
    })
    .then(function () {
      return a.unlock(lock)
    })
    .finally(function () {
      t.ok(sawExpectedErr, 'Second acquisition should time out')

      b.close()
      a.close()

      t.end()
    })
  })
})
