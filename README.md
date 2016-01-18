# Gaggle [![Build Status](https://img.shields.io/circleci/project/ben-ng/gaggle.svg)](https://circleci.com/gh/ben-ng/gaggle/tree/master) [![Coverage Status](https://img.shields.io/coveralls/ben-ng/gaggle/master.svg)](https://coveralls.io/github/ben-ng/gaggle?branch=master) [![npm version](https://img.shields.io/npm/v/gaggle.svg)](https://www.npmjs.com/package/gaggle)

Gaggle is a keyed mutex. It abstracts over different [Strategies](#strategies) for mutual exclusion, so you can choose your own tradeoffs.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Performance](#performance)
- [Usage](#usage)
  - [Strategies](#strategies)
  - [Channels](#channels)
- [Examples](#examples)
  - [Atomic Increments](#atomic-increments)
    - [Sample Code: Performing Atomic Increments (Callbacks)](#sample-code-performing-atomic-increments-callbacks)
    - [Sample Code: Performing Atomic Increments (Promises)](#sample-code-performing-atomic-increments-promises)
- [The Gaggle Algorithm](#the-gaggle-algorithm)
  - [Log Entries](#log-entries)
  - [State Machine](#state-machine)
  - [Additional RPC Calls](#additional-rpc-calls)
  - [Methods](#methods)
    - [Lock(key, duration, maxWait)](#lockkey-duration-maxwait)
      - [Leader.lock](#leaderlock)
      - [Follower.lock](#followerlock)
      - [Candidate.lock](#candidatelock)
    - [Unlock(key, nonce, maxWait)](#unlockkey-nonce-maxwait)
      - [Leader.unlock](#leaderunlock)
      - [Follower.unlock](#followerunlock)
      - [Candidate.unlock](#candidateunlock)
  - [Correctness](#correctness)
    - [Test Suite](#test-suite)
    - [Fuzzer](#fuzzer)
    - [Formal Proof](#formal-proof)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Performance

Each test performs an asynchronous operation that takes approximately 70ms a hundred times. The "sequential" test is a single process performing all one hundred operations itself, in series. The "Worst Case" tests are ten processes trying to acquire the same lock before performing the task. The "Best Case" tests are ten processes acquiring different locks before performing the task.

```
Redis - Worst Case x 0.13 ops/sec ±1.20% (5 runs sampled)
Gaggle - Worst Case x 0.12 ops/sec ±1.41% (5 runs sampled)
Raft - Worst Case x 0.05 ops/sec ±0.92% (5 runs sampled)
Redis - Best Case x 0.63 ops/sec ±1.65% (6 runs sampled)
Gaggle - Best Case x 0.43 ops/sec ±7.17% (6 runs sampled)
Raft - Best Case x 0.17 ops/sec ±0.71% (5 runs sampled)

      Raft - Worst Case | ######################################## | 201.18 ms/operation
    Gaggle - Worst Case | ################                         | 82.16 ms/operation
     Redis - Worst Case | ###############                          | 77.02 ms/operation
  Sequential - Baseline | ##############                           | 68.32 ms/operation
       Raft - Best Case | ############                             | 59.71 ms/operation
     Gaggle - Best Case | #####                                    | 23.01 ms/operation
      Redis - Best Case | ###                                      | 15.78 ms/operation
```

Note that ms/operation can be much lower than the ~70ms each task takes because multiple processes are working on tasks at the same time.

You can run the benchmark suite with `npm run benchmark`, or run them ten times with `npm run benchmarks` (the results aren't very stable due to the randomness in Raft leader election).

## Usage

### Strategies

Distributed strategies require the use of a [Channel](#channels)

Strategy  | Distributed? | Failure Tolerance                                                                                       | Notes
--------- | ------------ | ------------------------------------------------------------------------------------------------------- | ----------------
Redis     | No           | Redis can't fail, but any number of processes can fail as locks automatically expire                    | Uses `SET EX NX`
Raft      | Yes          | Less than half of all processes can fail, or be out of contact because of network partitions.           | Uses [Raft](http://raft.github.io)
Gaggle    | Yes          | Less than half of all processes can fail, or be out of contact because of network partitions.           | Based on [Raft](http://raft.github.io)

### Channels

Channel | Options                                                                                                                     | Description
------- | --------------------------------------------------------------------------------------------------------------------------- | -----------
Memory  | *None*                                                                                                                      | Useful for tests
Redis   | <ul><li>**String** redisChannel *required*</li><li>**String** redisConnectionString `redis://user:pass@host:port`</li></ul> | Fast, works across different machines, but Redis can't fail

## Examples

### Atomic Increments

Multiple processes are simultaneously trying to increment the same value in a database that only supports "GET" and "SET" commands. A situation like this might arise:

```
Process A:
1. GET x => 0
2. SET x 1

Process B:
1. GET x => 0
2. SET x 1

Result: x = 1
Expected: x = 2
```

This is known as the "lost update" problem. You can solve this problem with Gaggle, which supports both callbacks and promises.

#### Sample Code: Performing Atomic Increments (Callbacks)

```js

var Gaggle = require('gaggle').Redis
  , g = new Gaggle()
  , db = require('your-hypothetical-database')

g.lock('myLock', {    // You can create multiple locks by naming them
  duration: 1000      // Hold the lock for no longer than 1 second
, maxWait: 5000       // Wait for no longer than 5s to acquire the lock
}, (err, lock) => {
  // Handle any errors. No need to release the lock as it will
  // automatically expire if the db.get or db.set commands failed.

  // Begin critical section
  db.get('x', (err, val) => {

    // Err handling omitted for brevity
    db.set('x', val + 1, function (err) {

      g.unlock('myLock', function (err) {
        // End critical section
      })
    })
  })
})

```

#### Sample Code: Performing Atomic Increments (Promises)

```js

var Gaggle = require('gaggle').Redis
  , g = new Gaggle()
  , db = require('your-hypothetical-database')

g.lock('myLock', {    // You can create multiple locks by naming them
  duration: 1000      // Hold the lock for no longer than 1 second
, maxWait: 5000       // Wait for no longer than 5s to acquire the lock
})
.then(lock => {
  // Begin critical section
  return db.get('x')
  .then(value => {
    return db.set('x', value + 1)
  })
  // End critical section
  .then(() => {
    return g.unlock(lock)
  })
})
.catch(err => {
  // Handle any errors. No need to release the lock as it will
  // automatically expire if the db.get or db.set commands failed.
})

```

By enclosing the `GET` and `SET` commands within the critical section, we guarantee that updates are not lost.

## The Gaggle Algorithm

Gaggle is based on [Raft](http://raft.github.io). It currently implements log replication and limited membership changes (the cluster size may not change, but process identifiers can).

### Log Entries

Gaggle uses three types of log entries: `LOCK`, `UNLOCK`, and `NOOP`.

```js
// A "lock" entry
{
  term: 1
, data: {
    key: 'foo'
  , nonce: 'abcd'
  , ttl: 1453090846002
  }
}

// An "unlock" entry
{
  term: 1
, data: {
    key: 'foo'
  , nonce: 'abcd'
  , ttl: -1
  }
}

// A "noop" entry
{
  term: 1
, data: 'noop'
}
```

### State Machine

Each node applies the log entries to a dictionary that maps string keys to lock metadata. This is referred to as the "state machine" in the Raft paper, but I'll refer to it as the "lock map" or `lockMap` here.

```js
lockMap = {
  'foo': {
    ttl: 1453090846002
  , nonce: 'abcd'
  }
, 'bar': null
}
```

### Additional RPC Calls

In addition to the `REQUEST_VOTE` and `APPEND_ENTRIES` RPC calls, Gaggle uses the `REQUEST_LOCK`, and `REQUEST_UNLOCK` RPC calls.

```js
// Sent when a follower wants a lock
{
  type: 'REQUEST_LOCK'
, term: 1
, key: 'foo'
, duration: 5000
, maxWait: 2000
, nonce: 'abcd'
}

// Only sent when a lock cannot be granted
{
  type: 'REQUEST_LOCK_REPLY'
, term: 1
, nonce: 'abcd'
}

// Sent when a follower gives up a lock
{
  type: 'REQUEST_UNLOCK'
, term: 1
, key: 'foo'
, nonce: 'abcd'
}
```

### Methods

#### Lock(key, duration, maxWait)

##### Leader.lock

1. If at least one entry from the current term has **not** been committed, append a `NOOP` entry to the log, send a heartbeat, and reject the request
2. If no entry for the `key` exists in `lockMap`, or the `ttl` of an existing entry is in the past, add a `LOCK` entry to the log, and send a heartbeat
3. If the `LOCK` entry from step 2 is committed before `maxWait` seconds, send a heartbeat, and resolve the request
4. Reject the request if `maxWait` seconds elapse before resolving

##### Follower.lock

1. Send `REQUEST_LOCK` with a unique `nonce` to the leader
2. Resolve the request when a `LOCK` log entry is committed with the same `nonce`
3. Reject the request if `maxWait` seconds elapse before resolving

##### Candidate.lock

1. Wait until a leader is elected, then apply the rules for Leader or Followers

#### Unlock(key, nonce, maxWait)

##### Leader.unlock

1. If no entry for the `key` exists in `lockMap`, or the entry's `nonce` does not match the `nonce` argument, reject the request
2. Otherwise, push an `UNLOCK` entry onto the log
3. When the entry from step 2 is committed, delete the `lockMap` entry for `key`, and resolve the request

##### Follower.unlock

1. Send `REQUEST_UNLOCK` with a previously used `nonce` to the leader
2. Resolve the request when an `UNLOCK` log entry is committed with the same `nonce`
3. Reject the request if `maxWait` seconds elapse before resolving

##### Candidate.unlock

1. Wait until a leader is elected, then apply the rules for Leader or Followers

### Correctness

#### Test Suite

Gaggle has a comprehensive test suite, and releases always have 100% statement coverage.

#### Fuzzer

Gaggle has a fuzzer that has detected problems in the past. You can run it with `npm run fuzz`. It will keep running until a consistency issue is detected.

#### Formal Proof

TODO

## License

Copyright (c) 2015 Ben Ng <me@benng.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
