# Gaggle [![Build Status](https://img.shields.io/circleci/project/ben-ng/gaggle.svg)](https://circleci.com/gh/ben-ng/gaggle/tree/master) [![Coverage Status](https://img.shields.io/coveralls/ben-ng/gaggle/master.svg)](https://coveralls.io/github/ben-ng/gaggle?branch=master) [![npm version](https://img.shields.io/npm/v/gaggle.svg)](https://www.npmjs.com/package/gaggle)

Gaggle is a keyed mutex. It abstracts over different [Strategies](#strategies) for mutual exclusion, so you can choose your own tradeoffs.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Performance](#performance)
  - [Worst Case: Frequently Blocking Operations](#worst-case-frequently-blocking-operations)
  - [Best Case: Rarely Blocking Operations](#best-case-rarely-blocking-operations)
- [Usage](#usage)
  - [Strategies](#strategies)
  - [Channels](#channels)
- [Examples](#examples)
  - [Atomic Increments](#atomic-increments)
    - [Sample Code: Performing Atomic Increments (Callbacks)](#sample-code-performing-atomic-increments-callbacks)
    - [Sample Code: Performing Atomic Increments (Promises)](#sample-code-performing-atomic-increments-promises)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Performance

### Worst Case: Frequently Blocking Operations

This simulates a worst-case scenario where 10 processes are competing for the same lock.

```
Redis x 1.58 ops/sec ±7.73% (13 runs sampled)
Raft (Accelerated) x 0.45 ops/sec ±1.77% (12 runs sampled)
Raft (Vanilla) x 0.06 ops/sec ±14.22% (5 runs sampled)

      Raft (Vanilla) | ######################################## | 159.22 ms/operation
  Raft (Accelerated) | ######                                   | 22.19 ms/operation
               Redis | ##                                       | 6.33 ms/operation
```

### Best Case: Rarely Blocking Operations

This simulates a best-case scenario where 10 processes never block each other.

```
Redis x 7.71 ops/sec ±5.93% (41 runs sampled)
Raft (Accelerated) x 1.06 ops/sec ±2.91% (15 runs sampled)
Raft (Vanilla) x 0.21 ops/sec ±0.71% (6 runs sampled)

      Raft (Vanilla) | ######################################## | 48.08 ms/operation
  Raft (Accelerated) | ########                                 | 9.42 ms/operation
               Redis | #                                        | 1.3 ms/operation
```

## Usage

### Strategies

Distributed strategies require the use of a [Channel](#channels)

Strategy  | Distributed? | Failure Tolerance                                                                                       | Notes
--------- | ------------ | ------------------------------------------------------------------------------------------------------- | ----------------
Redis     | No           | Redis can't fail, but any number of processes can fail as locks automatically expire                    | Uses `SET EX NX`
Raft      | Yes          | Less than half of all processes can fail, or be out of contact because of network partitions.           | Uses [Raft](http://raft.github.io)

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

## License

Copyright (c) 2015 Ben Ng <me@benng.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
