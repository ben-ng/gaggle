/**
* Test if we can lock and unlock with the raft strategy
*/

var test = require('tape')
  , async = require('async')
  , uuid = require('uuid')
  , _ = require('lodash')
  , Promise = require('bluebird')
  , Strategy = require('../../../strategies/raft-strategy')
  , Channel = require('../../../channels/in-memory-channel')

test('raft strategy - the leader can lock and unlock', function (t) {
  var CLUSTER_SIZE = 5
    , POLLING_INTERVAL = 100
    , CONSENSUS_TIMEOUT = 10000
    , LOCK_TIMEOUT = 3000
    , testStart = Date.now()
    , cluster = []
    , tempId
    , tempChannel
    , hasReachedLeaderConsensus

  t.plan(4)

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
    })
    .finally(function () {

      /*
      _.each(cluster, function (node) {
        console.error(node.id + (node._state === 'LEADER' ? ' (leader)' : '') +
          ' commitIndex: ' + node._commitIndex +
          ' lastApplied: ' + node._lastApplied +
          ' log:\n' + node._log.map(e => '\t' + JSON.stringify(e)).join('\n') + '\n')
      })
      */

      Promise.map(cluster, function (node) {
        return node.close()
      })
      .then(function () {
        t.pass('Cleanly closed the strategy')
      })
    })
  })
})

test('raft strategy - a follower can lock and unlock', function (t) {
  var CLUSTER_SIZE = 5
    , POLLING_INTERVAL = 100
    , CONSENSUS_TIMEOUT = 10000
    , LOCK_TIMEOUT = 3000
    , testStart = Date.now()
    , cluster = []
    , tempId
    , tempChannel
    , hasReachedLeaderConsensus

  t.plan(4)

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
      , notTheLeader = _.find(cluster, function (node) {
        return node.id !== leaderId
      })

    t.ok(leaderId, 'A leader was elected, and all nodes are in consensus')

    notTheLeader.lock('foobar', {
      duration: 2000
    , maxWait: LOCK_TIMEOUT
    })
    .then(function (lock) {
      t.pass('Should acquire the lock')

      return notTheLeader.unlock(lock)
      .then(function () {
        t.pass('Should release the lock')
      })
    })
    .finally(function () {

      Promise.map(cluster, function (node) {
        return node.close()
      })
      .then(function () {
        t.pass('Cleanly closed the strategy')
      })
    })
  })
})

test('raft strategy - locks are queued until a leader is elected', function (t) {
  var CLUSTER_SIZE = 5
    , LOCK_TIMEOUT = 3000
    , cluster = []
    , tempId
    , tempChannel
    , randomNode

  t.plan(3)

  for (var i=0; i<CLUSTER_SIZE; ++i) {
    tempId = uuid.v4()
    tempChannel = new Channel({
      id: tempId
    })

    cluster.push(new Strategy({
      id: tempId
    , channel: tempChannel
    , strategyOptions: {
        clusterSize: CLUSTER_SIZE
      }
    }))
  }

  randomNode = cluster[_.random(0, CLUSTER_SIZE - 1)]

  randomNode.lock('foobar', {
    duration: 2000
  , maxWait: LOCK_TIMEOUT
  })
  .then(function (lock) {
    t.pass('Should acquire the lock')

    return randomNode.unlock(lock)
    .then(function () {
      t.pass('Should release the lock')
    })
  })
  .finally(function () {

    Promise.map(cluster, function (node) {
      return node.close()
    })
    .then(function () {
      t.pass('Cleanly closed the strategy')
    })
  })

})
