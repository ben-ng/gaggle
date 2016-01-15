/**
* Test if we can lock and unlock with the raft strategy
*/

var test = require('tape')
  , async = require('async')
  , uuid = require('uuid')
  , _ = require('lodash')
  , Promise = require('bluebird')

test('the leader can lock and unlock with raft', function (t) {
  var Strategy = require('../../../strategies/raft-strategy')
    , Channel = require('../../../channels/redis-channel')
    , CHAN = 'leaderElectionTestChannel'
    , CLUSTER_SIZE = 5
    , POLLING_INTERVAL = 10
    , CONSENSUS_TIMEOUT = 5000
    , LOCK_TIMEOUT = 1000
    , testStart = Date.now()
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

    if (leaders.length === cluster.length - 1 &&
            _.uniq(leaders).length === 1 &&
            followerCount === cluster.length - 1) {
      return leaders[0]
    }
    else {
      return false
    }
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
      id: tempId
    , channel: tempChannel
    , strategyOptions: {
        clusterSize: CLUSTER_SIZE
      }
    }))
  }

  async.whilst(function () {
    return !hasReachedLeaderConsensus() && Date.now() - testStart < CONSENSUS_TIMEOUT
  }, function (next) {
    setTimeout(next, POLLING_INTERVAL)
  }, function () {
    var leaderId = hasReachedLeaderConsensus()
      , leader = _.find(cluster, function (node) {
        return node.id === leaderId
      })

    t.ok(leaderId, 'A leader was elected, and all nodes are in consensus')

    leader.lock('foobar', {
      duration: 2000
    , maxWait: LOCK_TIMEOUT
    })
    .then(function (lock) {
      t.pass('Should acquire the lock')

      return leader.unlock(lock)
      .then(function () {
        t.pass('Should release the lock')
      })
      .catch(function (err) {
        t.ifError(err, 'Should release the lock')
      })
    })
    .catch(function (err) {
      t.ifError(err, 'Should acquire the lock')

      _.each(cluster, function (node) {
        console.error(node.id + (node._state === 'LEADER' ? ' (leader)' : '') +
          ' commitIndex: ' + node._commitIndex +
          ' log:\n' + node._log.map(e => '\t' + JSON.stringify(e)).join('\n') + '\n')
      })
    })
    .finally(function () {
      Promise.map(cluster, function (node) {
        return node.close()
      })
      .then(function () {
        t.pass('Cleanly closed the strategy')
        t.end()
      })
    })
  })
})
