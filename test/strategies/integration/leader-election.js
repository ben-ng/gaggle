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
    , TIMEOUT = 5000
    , testStart = Date.now()
    , cluster = []
    , tempId
    , tempChannel
    , hasReachedLeaderConsensus

  hasReachedLeaderConsensus = function hasReachedLeaderConsensus () {
    var maxTerm = Math.max.apply(null, _.map(cluster, '_currentTerm'))
      , leaders = _(cluster).filter(function (node) {
          return node._currentTerm === maxTerm
        }).map('_leader').compact().valueOf()
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
    return !hasReachedLeaderConsensus() && Date.now() - testStart < TIMEOUT
  }, function (next) {
    setTimeout(next, POLLING_INTERVAL)
  }, function () {
    t.ok(hasReachedLeaderConsensus(), 'A leader was elected, and all nodes are in consensus')

    /*
    _.each(cluster, function (node) {
      console.error(node.id + ' term: ' + node._currentTerm + ' state: ' + node._state + ' leader: ' + node._leader)
    })
    */

    Promise.map(cluster, function (node) {
      return node.close()
    })
    .then(function () {
      t.pass('Cleanly closed the strategy')
      t.end()
    })
  })
})

test('re-elects a leader when a leader fails', function (t) {
  var Strategy = require('../../../strategies/raft-strategy')
    , Channel = require('../../../channels/redis-channel')
    , CHAN = 'leaderReelectionTestChannel'
    , CLUSTER_SIZE = 5
    , POLLING_INTERVAL = 10
    , TIMEOUT = 5000
    , testStart = Date.now()
    , cluster = []
    , tempId
    , tempChannel
    , hasReachedLeaderConsensus

  t.plan(9)

  hasReachedLeaderConsensus = function hasReachedLeaderConsensus () {
    var maxTerm = Math.max.apply(null, _.map(cluster, '_currentTerm'))
      , leaders = _(cluster).filter(function (node) {
          return node._currentTerm === maxTerm
        }).map('_leader').compact().valueOf()
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
    return !hasReachedLeaderConsensus() && Date.now() - testStart < TIMEOUT
  }, function (next) {
    setTimeout(next, POLLING_INTERVAL)
  }, function () {
    var leaderId = hasReachedLeaderConsensus()
      , leader = _.find(cluster, function (node) {
          return node.id === leaderId
        })

    t.ok(leaderId, 'A leader was elected, and all nodes are in consensus')
    t.ok(leader, 'The leader was found in the cluster')

    // We want to perform the check that sees if a candidate is at least as up to date as a
    // follower before it grants a vote, so this creates some log entries for that to happen
    leader.lock('lock_a')
    .then(function (lock) {
      t.pass('acquired lock a')

      return leader.unlock(lock)
      .then(function () {
        t.pass('released lock a')
      })
    })
    .then(function () {
      _.remove(cluster, function (node) {
        return node.id === leaderId
      })

      t.ok(cluster.length < CLUSTER_SIZE, 'The elected leader was removed from the cluster')

      leader.close()
      .then(function () {
        t.pass('The elected leader has disconnected')
        t.ok(!hasReachedLeaderConsensus(), 'Consensus has not been reached')

        testStart = Date.now()
        async.whilst(function () {
          return !hasReachedLeaderConsensus() && Date.now() - testStart < TIMEOUT
        }, function (next) {
          setTimeout(next, POLLING_INTERVAL)
        }, function () {
          t.ok(hasReachedLeaderConsensus(), 'A new leader was elected, and all nodes are in consensus')

          Promise.map(cluster, function (node) {
            return node.close()
          })
          .then(function () {
            t.pass('Cleanly closed the strategy')
          })
        })
      })
    })
  })
})
