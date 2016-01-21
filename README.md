# Gaggle [![Build Status](https://img.shields.io/circleci/project/ben-ng/gaggle.svg)](https://circleci.com/gh/ben-ng/gaggle/tree/master) [![Coverage Status](https://img.shields.io/coveralls/ben-ng/gaggle/master.svg)](https://coveralls.io/github/ben-ng/gaggle?branch=master) [![npm version](https://img.shields.io/npm/v/gaggle.svg)](https://www.npmjs.com/package/gaggle)

Gaggle is a [Raft](http://raft.github.io) implementation that focuses on ease of use.

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

## Usage

```js
var Gaggle = require('gaggle')
var opts = {
      channel: {
        name: 'redis'
      , redisChannel: 'foo'
      }
    , clusterSize: 3
    }

var nodeA = new Gaggle(opts)
var nodeB = new Gaggle(opts)
var nodeC = new Gaggle(opts)

// Nodes will emit "committed" events whenever the cluster
// comes to consensus about an entry
nodeC.on('committed', function (data) {
  console.log(data)
})

// Entry data can also be numbers, arrays, or objects
nodeA.append('mary')
nodeB.append('had')
nodeA.append('a')
nodeC.append('little')

// You can also get a reference to a message like this
var entry = nodeB.append('lamb')

// So that you can tell when it commits
entry.on('committed', function () {
  console.log('!')
})

// This example prints the sentence "mary had a little lamb" in some order
// Note that Raft only guarantees that all nodes commit entries in the same
// order, but nodes sent from different nodes at different times may not be
// committed in the order that they were sent.
```

###

### Channels

Channel | Options                                                                                                                     | Description
------- | --------------------------------------------------------------------------------------------------------------------------- | -----------
Memory  | *None*                                                                                                                      | Useful for tests
Redis   | <ul><li>**String** redisChannel *required*</li><li>**String** redisConnectionString `redis://user:pass@host:port`</li></ul> | Fast, works across different machines, but Redis can't fail


## License

Copyright (c) 2015 Ben Ng <me@benng.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
