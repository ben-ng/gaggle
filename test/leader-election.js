/**
* Test if leader election is working
*/

var t = require('tap')
  , async = require('async')
  , uuid = require('uuid')
  , _ = require('lodash')
  , Promise = require('bluebird')
  , gaggle = require('../')

t.test('elects exactly one leader when no process fails', function (t) {
  var CLUSTER_SIZE = 5
    , POLLING_INTERVAL = 10
    , TIMEOUT = 5000
    , testStart = Date.now()
    , cluster = []
    , hasReachedLeaderConsensus

  hasReachedLeaderConsensus = function hasReachedLeaderConsensus () {
    var maxTerm = Math.max.apply(null, _.map(cluster, '_currentTerm'))
      , leaders = _(cluster).filter(function (node) {
          return node._currentTerm === maxTerm
        }).map('_leader').compact().valueOf()
      , followerCount = _.filter(cluster, function (node) {
          return node._currentTerm === maxTerm && node._state === gaggle._STATES.FOLLOWER
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
    cluster.push(gaggle({
      id: uuid.v4()
    , clusterSize: CLUSTER_SIZE
    , channel: {
        name: 'redis'
      , channelName: 'leaderConsensusTest'
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

t.test('re-elects a leader when a leader fails', function (t) {
  var CLUSTER_SIZE = 5
    , POLLING_INTERVAL = 50
    , TIMEOUT = 5000
    , testStart = Date.now()
    , cluster = []
    , hasReachedLeaderConsensus

  t.plan(7)

  hasReachedLeaderConsensus = function hasReachedLeaderConsensus () {
    var maxTerm = Math.max.apply(null, _.map(cluster, '_currentTerm'))
      , leaders = _(cluster).filter(function (node) {
          return node._currentTerm === maxTerm
        }).map('_leader').compact().valueOf()
      , followerCount = _.filter(cluster, function (node) {
          return node._currentTerm === maxTerm && node._state === gaggle._STATES.FOLLOWER
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
    cluster.push(gaggle({
      id: uuid.v4()
    , clusterSize: CLUSTER_SIZE
    , channel: {
        name: 'redis'
      , channelName: 'leaderReelectionTest'
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
    leader.append('mary had a little lamb', 1000)
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
