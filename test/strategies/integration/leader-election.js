/**
* Test if multiple gaggles can atomically increment a value
*
* Each process starts up, creates a gaggle, and then tries to increment
* a value 1000 times.
*/

var test = require('tape')
  , async = require('async')
  , uuid = require('uuid')
  , _ = require('lodash')
  , Promise = require('bluebird')

test('elects exactly one leader when no process fails', function (t) {
  var Strategy = require('../../../strategies/leader-strategy')
    , Channel = require('../../../channels/redis-channel')
    , CHAN = 'leaderElectionTestChannel'
    , CLUSTER_SIZE = 5
    , POLLS = 200
    , POLLING_INTERVAL = 10
    , pollCounter = 0
    , cluster = []
    , tempId
    , tempChannel
    , countLeaders

  countLeaders = function countLeaders () {
    var maxTerm = Math.max.apply(null, _.pluck(cluster, '_currentTerm'))
      , leaders = _.filter(cluster, function (node) {
          return node._state === Strategy._STATES.LEADER && node._currentTerm === maxTerm
        }).length

    return leaders
  }

  for (var i=0; i<CLUSTER_SIZE; ++i) {
    tempId = uuid.v4()
    tempChannel = new Channel({
      id: tempId
    , channelOptions: {
        redisChannel: CHAN
      }
    // , logFunction: console.error
    })

    cluster.push(new Strategy({
      channel: tempChannel
    , strategyOptions: {
        clusterSize: CLUSTER_SIZE
      }
    }))
  }

  async.whilst(function () {
    return pollCounter < POLLS
  }, function (next) {
    var leaders = countLeaders()

    t.ok(leaders <= 1, 'There should never be more than one leader, found ' + leaders)

    pollCounter = pollCounter + 1

    setTimeout(next, POLLING_INTERVAL)
  }, function () {

    t.equals(countLeaders(), 1, 'Exactly one leader was elected')

    Promise.map(cluster, function (node) {
      return node.close()
    })
    .then(function () {
      t.pass('Cleanly closed the strategy')
      t.end()
    })
  })
})
