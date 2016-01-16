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
  , createCluster
  , createClusterWithLeader

createClusterWithLeader = function (CLUSTER_SIZE, cb) {
  var POLLING_INTERVAL = 100
    , CONSENSUS_TIMEOUT = 10000
    , testStart = Date.now()
    , cluster = createCluster(CLUSTER_SIZE)
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

  async.whilst(function () {
    return !hasReachedLeaderConsensus() && Date.now() - testStart < CONSENSUS_TIMEOUT
  }, function (next) {
    setTimeout(next, POLLING_INTERVAL)
  }, function () {
    var leaderId = hasReachedLeaderConsensus()
      , leader = _.find(cluster, function (node) {
        return node.id === leaderId
      })

    if (leader != null) {
      cb(null, cluster, leader, function cleanup () {
        return Promise.map(cluster, function (node) {
          return node.close()
        })
      })
    }
    else {
      cb(new Error('the cluster did not elect a leader in time'))
    }
  })
}

createCluster = function createCluster (CLUSTER_SIZE) {
  var tempId
    , tempChannel
    , cluster = []

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

  return cluster
}

test('raft strategy - the leader can lock and unlock', function (t) {
  var LOCK_TIMEOUT = 10000

  t.plan(5)

  createClusterWithLeader(5, function (err, cluster, leader, cleanup) {
    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    leader.lock('foobar', {
      duration: 2000
    , maxWait: LOCK_TIMEOUT
    })
    .then(function (lock) {
      t.pass('should acquire the lock')

      return leader.unlock(lock)
      .then(function () {
        t.pass('should release the lock')
      })
    })
    .finally(function () {

      cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

test('raft strategy - a follower can lock and unlock', function (t) {
  var LOCK_TIMEOUT = 10000

  t.plan(5)

  createClusterWithLeader(5, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    notTheLeader.lock('foobar', {
      duration: 2000
    , maxWait: LOCK_TIMEOUT
    })
    .then(function (lock) {
      t.pass('should acquire the lock')

      return notTheLeader.unlock(lock)
      .then(function () {
        t.pass('should release the lock')
      })
    })
    .finally(function () {

      cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

test('raft strategy - locks are queued until a leader is elected', function (t) {
  var LOCK_TIMEOUT = 5000
    , CLUSTER_SIZE = 2
    , cluster = createCluster(CLUSTER_SIZE)
    , randomNode

  t.plan(3)

  randomNode = cluster[_.random(0, CLUSTER_SIZE - 1)]

  randomNode.lock('foobar', {
    duration: 2000
  , maxWait: LOCK_TIMEOUT
  })
  .then(function (lock) {
    t.pass('should acquire the lock')

    return randomNode.unlock(lock)
    .then(function () {
      t.pass('should release the lock')
    })
  })
  .finally(function () {
    Promise.map(cluster, function (node) {
      return node.close()
    })
    .then(function () {
      t.pass('cleanly closed the strategy')
    })
  })
})

/**
* "When sending an AppendEntries RPC, the leader includes the index and term of the entry in its
* log that immediately precedes the new entries. If the follower does not find an entry in its log
* with the same index and term, then it refuses the new entries. The consistency check acts as an
* induction step: the initial empty state of the logs satisfies the Log Matching Property, and the
* consistency check preserves the Log Matching Property whenever logs are extended. As a result,
* whenever AppendEntries returns successfully, the leader knows that the follower’s log is identical
* to its own log up through the new entries."
*
* p19
*
* In order to test this, we need to do some hacky manipulation of the nodes to get them into
* a situation where the conflict detection code can run. We'll start by creating a cluster of two
* nodes, wait for them to elect a leader, manipulate their logs, let the heartbeat happen,
* and then check the logs to see if the conflict was removed.
*/
test('raft strategy - log replication induction step', function (t) {
  t.plan(7)

  createClusterWithLeader(2, function (err, cluster, leader, cleanup) {
    t.ifError(err, 'should not error')

    leader.lock('lock_a')
    .then(function (lock) {
      t.pass('lock a was acquired')

      return leader.unlock(lock)
      .then(function () {
        t.pass('lock a was released')
      })
    })
    .then(function () {
      /**
      * At this point we know that there is at least one entry in the logs of both nodes
      * in the cluster. This is important because the conflict detection depends on there
      * being a previous entry in the log.
      */
      var follower = _.find(cluster, function (node) { return node.id !== leader.id })
        , leaderTerm = leader._currentTerm
        , rubbishEntry = {term: leaderTerm - 1, data: {foo: 'bar'}}

      // Now, we add a rubbish entry to the follower's log:
      follower._log.push(rubbishEntry)

      // Acquire a lock on the leader again, which should cause new entries to
      // be sent to the follower, and flush out the bad ones we added
      leader.lock('lock_b')
      .then(function (lock) {
        t.pass('lock b was acquired')

        return leader.unlock(lock)
        .then(function () {
          t.pass('lock b was released')
        })
      })
      .then(function () {
        t.ok(_.find(follower._log, rubbishEntry) == null, 'the rubbish entry should have been removed')

        cleanup()
        .then(function () {
          t.pass('cleanly closed the strategy')
        })
      })
    })
  })
})

test('raft strategy - votes no for candidates in earlier terms', function (t) {
  t.plan(3)

  createClusterWithLeader(2, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'should not error')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    leader._channel.on('recieved', function (originNodeId, msg) {
      if (msg.type === Strategy._RPC_TYPE.REQUEST_VOTE_REPLY) {
        t.strictEquals(msg.voteGranted, false, 'should not grant votes to nodes in earlier terms')

        cleanup()
        .then(function () {
          t.pass('cleanly closed the strategy')
        })
      }
    })

    leader._channel.send(notTheLeader.id, {
      type: Strategy._RPC_TYPE.REQUEST_VOTE
    , term: notTheLeader._currentTerm - 1
    , candidateId: leader.id
    , lastLogIndex: -1
    , lastLogTerm: -1
    })
  })
})

test('raft strategy - fails when append entries is recieved from earlier terms', function (t) {
  t.plan(3)

  createClusterWithLeader(2, function (err, cluster, leader, cleanup) {
    var notTheLeader
      , laterTerm

    t.ifError(err, 'should not error')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    laterTerm = notTheLeader._currentTerm + 1

    notTheLeader._currentTerm = laterTerm

    leader._channel.on('recieved', function (originNodeId, msg) {
      if (msg.type === Strategy._RPC_TYPE.APPEND_ENTRIES_REPLY &&
          msg.term === laterTerm) {
        t.strictEquals(msg.success, false, 'should respond with failure')

        cleanup()
        .then(function () {
          t.pass('cleanly closed the strategy')
        })
      }
    })
  })
})

test('raft strategy - catches lagging followers up', function (t) {
  var POLLING_INTERVAL = 100
    , TEST_TIMEOUT = 10000

  t.plan(7)

  createClusterWithLeader(2, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'should not error')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    leader.lock('lock_a')
    .then(function (lock) {
      t.pass('acquires lock a')

      return leader.unlock(lock)
      .then(function () {
        t.pass('releases lock a')
      })
    })
    .then(function () {
      return leader.lock('lock_b')
    })
    .then(function (lock) {
      t.pass('acquires lock b')

      return leader.unlock(lock)
      .then(function () {
        t.pass('releases lock b')
      })
    })
    .then(function () {
      var testStart = Date.now()
        , originalLogLength = notTheLeader._log.length

      // Remove entries from the follower, and wait until the leader catches it up
      notTheLeader._log = []
      notTheLeader._commitIndex = -1
      notTheLeader._lastApplied = -1

      async.whilst(function () {
        return notTheLeader._log.length !== originalLogLength && Date.now() - testStart < TEST_TIMEOUT
      }, function (next) {
        setTimeout(next, POLLING_INTERVAL)
      }, function () {
        t.ok(notTheLeader._log.length, originalLogLength, 'The follower was caught up')

        cleanup()
        .then(function () {
          t.pass('cleanly closed the strategy')
        })
      })
    })
  })
})
