/**
* Test leader election and log replication
*/

var t = require('tap')
  , async = require('async')
  , uuid = require('uuid')
  , _ = require('lodash')
  , Promise = require('bluebird')
  , gaggle = require('../')
  , createCluster
  , createClusterWithLeader

createClusterWithLeader = function (opts, cb) {
  var POLLING_INTERVAL = 100
    , CONSENSUS_TIMEOUT = 10000
    , testStart = Date.now()
    , cluster
    , hasReachedLeaderConsensus

  opts = _.defaults(opts, {
    rpc: {}
  , accelerate: false
  })

  cluster = createCluster(opts)

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

createCluster = function createCluster (opts) {
  var cluster = []

  for (var i=0; i<opts.clusterSize; ++i) {
    cluster.push(gaggle({
      id: uuid.v4()
    , clusterSize: opts.clusterSize
    , channel: {name: 'memory'}
    , accelerateHeartbeats: opts.accelerate
    , rpc: opts.rpc
    }))
  }

  return cluster
}



t.test('leader election - elects exactly one leader when no process fails', function (t) {
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

    async.map(cluster, function (node, next) {
      // Tests the callback API
      node.close(next)
    }, function () {
      t.pass('Cleanly closed the strategy')
      t.end()
    })
  })
})

t.test('leader election - re-elects a leader when a leader fails', function (t) {
  var CLUSTER_SIZE = 5
    , POLLING_INTERVAL = 50
    , TIMEOUT = 5000
    , testStart = Date.now()
    , cluster = []
    , hasReachedLeaderConsensus

  t.plan(8)

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
    t.ok(leader.isLeader(), 'The leader returns true for isLeader')

    // We want to perform the check that sees if a candidate is at least as up to date as a
    // follower before it grants a vote, so this creates some log entries for that to happen
    leader.append('mary had', 1000)
    .then(function () {
      // No timeout on this one to cover the other case
      return leader.append('a little lamb')
    })
    .then(function () {

      _.remove(cluster, function (node) {
        return node.id === leaderId
      })

      t.ok(cluster.length < CLUSTER_SIZE, 'The elected leader was removed from the cluster')

      return leader.close()
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

t.test('leader election - votes no for candidates in earlier terms', function (t) {
  t.plan(3)

  createClusterWithLeader({clusterSize: 2}, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'should not error')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    leader._channel.on('recieved', function (originNodeId, msg) {
      if (msg.type === gaggle._RPC_TYPE.REQUEST_VOTE_REPLY) {
        t.strictEquals(msg.voteGranted, false, 'should not grant votes to nodes in earlier terms')

        cleanup()
        .then(function () {
          t.pass('cleanly closed the strategy')
        })
      }
    })

    leader._channel.send(notTheLeader.id, {
      type: gaggle._RPC_TYPE.REQUEST_VOTE
    , term: notTheLeader._currentTerm - 1
    , candidateId: leader.id
    , lastLogIndex: -1
    , lastLogTerm: -1
    })
  })
})

t.test('leader election - fails when append entries is recieved from earlier terms', function (t) {
  t.plan(3)

  createClusterWithLeader({clusterSize: 2}, function (err, cluster, leader, cleanup) {
    var notTheLeader
      , laterTerm

    t.ifError(err, 'should not error')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    laterTerm = notTheLeader._currentTerm + 1

    notTheLeader._currentTerm = laterTerm

    leader._channel.on('recieved', function (originNodeId, msg) {
      if (msg.type === gaggle._RPC_TYPE.APPEND_ENTRIES_REPLY &&
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

t.test('log replication - the leader can append entries', function (t) {
  t.plan(8)

  createClusterWithLeader({clusterSize: 5}, function (err, cluster, leader, cleanup) {
    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    leader.once('committed', function () {
      t.ok('the committed event fired on the leader')
    })

    leader.once('appended', function () {
      t.ok('the appended event fired on the leader')
    })

    leader.append('foobar')
    .then(function () {
      t.pass('should append the message')

      t.equals(leader.getLog().length, 1, 'there should be a log of length one')
      t.equals(leader.getCommitIndex(), 0, 'the commit index should be zero')

      return Promise.resolve()
    })
    .finally(function () {
      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

t.test('log replication - a follower can append entries', function (t) {
  t.plan(5)

  createClusterWithLeader({clusterSize: 5}, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    notTheLeader.once('committed', function () {
      t.ok('the committed event fired on the node')
    })

    // Use the callback API to cover those branches
    notTheLeader.append('foobar', function () {
      t.pass('should append the message')

      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

t.test('log replication - the leader can append entries when heartbeats are accelerated', function (t) {
  t.plan(4)

  createClusterWithLeader({clusterSize: 5, accelerate: true}, function (err, cluster, leader, cleanup) {
    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    leader.append('foobar')
    .then(function () {
      t.pass('should append the message')

      return Promise.resolve()
    })
    .finally(function () {
      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

t.test('log replication - a follower can append entries when heartbeats are accelerated', function (t) {
  t.plan(4)

  createClusterWithLeader({clusterSize: 5, accelerate: true}, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    notTheLeader.append('foobar')
    .then(function () {
      t.pass('should append the message')

      return Promise.resolve()
    })
    .finally(function () {
      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

t.test('log replication - appends are queued until a leader is elected', function (t) {
  var CLUSTER_SIZE = 2
    , cluster = createCluster({clusterSize: CLUSTER_SIZE})
    , randomNode

  t.plan(2)

  randomNode = cluster[_.random(0, CLUSTER_SIZE - 1)]

  randomNode.append('foobar')
  .then(function () {
    t.pass('should append the message')

    return Promise.resolve()
  })
  .finally(function () {
    return Promise.map(cluster, function (node) {
      return node.close()
    })
    .then(function () {
      t.pass('cleanly closed the strategy')
    })
  })
})

t.test('log replication - appends fail if not sent within the timeout', function (t) {
  var CLUSTER_SIZE = 2
    , cluster = createCluster({clusterSize: CLUSTER_SIZE})
    , randomNode

  t.plan(2)

  randomNode = cluster[_.random(0, CLUSTER_SIZE - 1)]

  randomNode.append('foobar', 0)
  .catch(function (e) {
    t.equals(e.toString(), 'Error: Timed out before the entry was committed', 'should fail with the expected error')

    return Promise.resolve()
  })
  .finally(function () {
    return Promise.map(cluster, function (node) {
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
t.test('log replication - safety via induction step', function (t) {
  t.plan(5)

  createClusterWithLeader({clusterSize: 2}, function (err, cluster, leader, cleanup) {
    t.ifError(err, 'should not error')

    leader.append('foo')
    .then(function () {
      t.pass('the message was appended')

      return Promise.resolve()
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
      return leader.append('bar')
      .then(function () {
        t.pass('the message was appended')
        return Promise.resolve()
      })
      .then(function () {
        t.ok(_.find(follower._log, rubbishEntry) == null, 'the rubbish entry should have been removed')

        return cleanup()
        .then(function () {
          t.pass('cleanly closed the strategy')
        })
      })
    })
  })
})

t.test('log replication - catches lagging followers up', function (t) {
  var POLLING_INTERVAL = 100
    , TEST_TIMEOUT = 10000

  t.plan(8)

  createClusterWithLeader({clusterSize: 2}, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'should not error')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    leader.append('foo')
    .then(function () {
      t.pass('appends message 1')

      return leader.append('bar')
    })
    .then(function () {
      t.pass('appends message 2')

      return leader.append('fez')
    })
    .then(function () {
      t.pass('appends message 3')

      return leader.append('doo')
    })
    .then(function () {
      t.pass('appends message 4')

      return Promise.resolve()
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
        t.equals(notTheLeader._log.length, originalLogLength, 'The follower was caught up')

        t.ok(!leader.hasUncommittedEntriesInPreviousTerms(), 'The leader should not have uncommitted entries in previous terms')

        cleanup()
        .then(function () {
          t.pass('cleanly closed the strategy')
        })
      })
    })
  })
})

t.test('dispatch - waits for leader election before dispatching', function (t) {
  var cluster = createCluster({
        clusterSize: 5
      , rpc: {
          ping: function ping (f, b, cb) {
            if (f === 'foo') {
              cb(null, 'pong')
            }
            else {
              cb(new Error('baz'))
            }
          }
        }
      })
    , node = cluster[0]

  t.plan(3)

  node.dispatchOnLeader('ping', ['foo', 'bar'])
  .then(function (res) {
    t.equals(res.length, 1, 'should respond with one return value')
    t.equals(res[0], 'pong', 'the return value should be "pong"')

    return Promise.resolve()
  })
  .finally(function () {
    return Promise.map(cluster, function (node) {
      return node.close()
    }).then(function () {
      t.pass('cleanly closed the strategy')
    })
  })
})

t.test('dispatch - the leader can dispatch rpc calls', function (t) {
  t.plan(5)

  createClusterWithLeader({
    clusterSize: 5
  , rpc: {
      ping: function ping (f, b, cb) {
        if (f === 'foo') {
          cb(null, 'pong')
        }
        else {
          cb(new Error('baz'))
        }
      }
    }
  }, function (err, cluster, leader, cleanup) {
    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    leader.dispatchOnLeader('ping', ['foo', 'bar'])
    .then(function (res) {
      t.equals(res.length, 1, 'should respond with one return value')
      t.equals(res[0], 'pong', 'the return value should be "pong"')

      return Promise.resolve()
    })
    .finally(function () {
      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

t.test('dispatch - a follower can dispatch rpc calls', function (t) {
  t.plan(6)

  createClusterWithLeader({
    clusterSize: 5
  , rpc: {
      ping: function ping (f, b, cb) {
        if (f === 'foo') {
          cb(null, 'pong')
        }
        else {
          cb(new Error('baz'))
        }
      }
    }
  }, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    // Use the callback API to cover those branches
    notTheLeader.dispatchOnLeader('ping', ['foo', 'bar'], function (err, ret) {
      t.ifError(err, 'there should be no error')
      t.equals(arguments.length, 2, 'should respond with one return value')
      t.equals(ret, 'pong', 'the return value should be "pong"')

      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

t.test('dispatch - errors from rpc calls are properly handled', function (t) {
  t.plan(6)

  createClusterWithLeader({
    clusterSize: 5
  , rpc: {
      ping: function ping (f, b, cb) {
        if (f === 'foo') {
          cb(null, 'pong')
        }
        else {
          cb(new Error('baz'))
        }
      }
    }
  }, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    // Use the callback API to cover those branches
    notTheLeader.dispatchOnLeader('ping', ['fee', 'fi'], function (err, ret) {
      t.ok(err, 'there should be an error')
      t.ok(err instanceof Error, 'err should be an Error')
      t.equals(err.toString(), 'Error: baz', 'the error message should be correct')

      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

t.test('dispatch - calling a nonexistent method from a leader fails', function (t) {
  t.plan(6)

  createClusterWithLeader({
    clusterSize: 5
  }, function (err, cluster, leader, cleanup) {
    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    // Use the callback API to cover those branches
    leader.dispatchOnLeader('ping', ['fee', 'fi'], function (err, ret) {
      t.ok(err, 'there should be an error')
      t.ok(err instanceof Error, 'err should be an Error')
      t.equals(err.toString(), 'Error: The RPC method ping does not exist', 'the error message should be correct')

      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

t.test('dispatch - calling a nonexistent method from a follower fails', function (t) {
  t.plan(6)

  createClusterWithLeader({
    clusterSize: 5
  }, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    // Use the callback API to cover those branches
    notTheLeader.dispatchOnLeader('ping', ['fee', 'fi'], function (err, ret) {
      t.ok(err, 'there should be an error')
      t.ok(err instanceof Error, 'err should be an Error')
      t.equals(err.toString(), 'Error: The RPC method ping does not exist', 'the error message should be correct')

      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})

t.test('dispatch - rpc calls can time out', function (t) {
  t.plan(5)

  createClusterWithLeader({
    clusterSize: 5
  , rpc: {
      ping: function ping (f, b, cb) {
        if (f === 'foo') {
          cb(null, 'pong')
        }
        else {
          cb(new Error('baz'))
        }
      }
    }
  }, function (err, cluster, leader, cleanup) {
    var notTheLeader

    t.ifError(err, 'there should be no error')

    t.ok(leader, 'a leader was elected, and all nodes are in consensus')

    notTheLeader = _.find(cluster, function (node) {
      return node.id !== leader.id
    })

    // Use the callback API to cover those branches
    notTheLeader.dispatchOnLeader('ping', ['foo', 'bar'], 0, function (err) {
      t.ok(err, 'there should be an error')
      t.equals(err.toString(), 'Error: Timed out before the rpc method returned', 'the error should be about timing out')

      return cleanup().then(function () {
        t.pass('cleanly closed the strategy')
      })
    })
  })
})
