/**
* Test if leader election is working
*/

var test = require('tape')
  , async = require('async')
  , uuid = require('uuid')
  , _ = require('lodash')
  , Promise = require('bluebird')

test('elects exactly one leader when no process fails', function (t) {
  var Strategy = require('../../../strategies/raft-strategy')
    , Channel = require('../../../channels/redis-channel')
    , CHAN = 'leaderElectionTestChannel'
    , CLUSTER_SIZE = 5
    , POLLING_INTERVAL = 10
    , cluster = []
    , tempId
    , tempChannel
    , hasReachedLeaderConsensus

  hasReachedLeaderConsensus = function hasReachedLeaderConsensus () {
    var maxTerm = Math.max.apply(null, _.pluck(cluster, '_currentTerm'))
      , leaders = _(cluster).filter(function (node) {
          return node._currentTerm === maxTerm
        }).pluck('_leader').compact().valueOf()
      , followerCount = _.filter(cluster, function (node) {
          return node._currentTerm === maxTerm && node._state === Strategy._STATES.FOLLOWER
        }).length

    return leaders.length === CLUSTER_SIZE && _.uniq(leaders).length === 1 && followerCount === CLUSTER_SIZE
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
    return !hasReachedLeaderConsensus()
  }, function (next) {
    setTimeout(next, POLLING_INTERVAL)
  }, function () {
    t.pass('Exactly one leader was elected, and all nodes agree on who that is')

    Promise.map(cluster, function (node) {
      return node.close()
    })
    .then(function () {
      t.pass('Cleanly closed the strategy')
      t.end()
    })
  })
})
