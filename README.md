# Gaggle [![Build Status](https://img.shields.io/circleci/project/ben-ng/gaggle/master.svg)](https://circleci.com/gh/ben-ng/gaggle/tree/master) [![Coverage Status](https://img.shields.io/coveralls/ben-ng/gaggle/master.svg)](https://coveralls.io/github/ben-ng/gaggle?branch=master) [![npm version](https://img.shields.io/npm/v/gaggle.svg)](https://www.npmjs.com/package/gaggle)

Gaggle is a [Raft](http://raft.github.io) implementation that focuses on ease of use.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Contents**

- [Quick Example](#quick-example)
- [API](#api)
  - [Gaggle](#gaggle)
    - [Creating an instance](#creating-an-instance)
    - [Appending Messages](#appending-messages)
    - [Performing RPC calls on the leader](#performing-rpc-calls-on-the-leader)
    - [Checking for uncommitted entries in previous terms](#checking-for-uncommitted-entries-in-previous-terms)
    - [Deconstructing an instance](#deconstructing-an-instance)
    - [Getting the state of the node](#getting-the-state-of-the-node)
  - [Getting the log](#getting-the-log)
  - [Getting the commit index](#getting-the-commit-index)
    - [Event: appended](#event-appended)
    - [Event: committed](#event-committed)
    - [Event: leaderElected](#event-leaderelected)
  - [Channels](#channels)
    - [Socket.io](#socketio)
      - [Socket.io Channel Options](#socketio-channel-options)
    - [Redis](#redis)
      - [Redis Channel Options](#redis-channel-options)
    - [Redis Channel Example](#redis-channel-example)
    - [Memory](#memory)
      - [Memory Channel Options](#memory-channel-options)
    - [Memory Channel Example](#memory-channel-example)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Quick Example

```js
var gaggle = require('gaggle')
var uuid = require('uuid')
var defaults = require('lodash/defaults')
var opts = {
      channel: {
        name: 'redis'
      , redisChannel: 'foo'
      }
    , clusterSize: 3
    }

var nodeA = gaggle(defaults({id: uuid.v4()}, opts))
var nodeB = gaggle(defaults({id: uuid.v4()}, opts))
var nodeC = gaggle(defaults({id: uuid.v4()}, opts))

// Nodes will emit "committed" events whenever the cluster
// comes to consensus about an entry
nodeC.on('committed', function (data) {
  console.log(data)
})

// You can be notified when a specific message is committed
// by providing a callback
nodeC.append('mary', function () {
  console.log(',')
})

// Or, you can use promises
nodeA.append('had').then(function () {
  console.log('!')
})

// Or, you can just cross your fingers and hope that an error
// doesn't happen by neglecting the return result and callback
nodeA.append('a')

// Entry data can also be numbers, arrays, or objects
// we were just using strings here for simplicity
nodeB.append({foo: 'lamb'})

// You can specify a timeout as a second argument
nodeA.append('little', 1000)

// By default, gaggle will wait indefinitely for a message to commit
nodeC.append('a', function () {
  // I may never be called!
})

// This example prints the sentence:
//     "mary , had a little {foo: 'lamb'} !"
// in SOME order; Raft only guarantees that all nodes will commit entries in
// the same order, but nodes sent at different times may not be committed
// in the order that they were sent.
```

## API

### Gaggle

#### Creating an instance

```js
var gaggle = require('gaggle')
    // uuids are recommended, but you can use any string id
  , uuid = require('uuid')
  , g = gaggle({
      /**
      * Required settings
      */

      id: uuid.v4()
    , clusterSize: 5
    , channel: {
        name: 'redis' // or "memory", etc ...

        // ... additional keys are passed as options to the
        // "redis" channel. see channel docs for available
        // options.
      }

      /**
      * Optional settings
      */

      // Can be called through dispatchOnLeader()
    , rpc: {
        foo: function foo (a, b, c, d, cb) {
          // "this" inside here refers to the leader Gaggle instance
          // so you can do things like this...
          if (this.this.hasUncommittedEntriesFromPreviousTerms()) {
            this.append('noop')

            cb(new Error('I am not ready yet, try again in a few seconds'))
          }
          else {
            cb(null, ret_a, ret_b, ret_c)
          }
        }
      }

      // How long to wait before declaring the leader dead?
    , electionTimeout: {
        min: 300
      , max: 500
      }

      // How often should the leader send heartbeats?
    , heartbeatInterval: Joi.number().min(0).default(50)

      // Should the leader send a heartbeat if it would speed
      // up the commit of a message?
    , accelerateHeartbeats: Joi.boolean().default(false)
    })
```

#### Appending Messages

```txt
g.append(Mixed data, [Number timeout], [function(Error) callback])
```

Anything that can be serialized and deserialized as JSON is valid message data. If `callback` is not provided, a `Promise` will be returned.

```js
g.append(data, function (err) {})
g.append(data, timeout, function (err) {})

g.append(data).then()
g.append(data, timeout).then()
```


#### Performing RPC calls on the leader

```txt
g.dispatchOnLeader(String functionName, Array args, [Number timeout], [function(Error, [Mixed arg1, Mixed arg2, ...]) callback])
```

If you're building something on top of Gaggle, you'll probably have to use the leader as a coordinator. This is a helper function that simplifies that. While the `timeout` period is optional, omitting it means that the operation may never complete. You should *probably* always specify a timeout to handle lost messages and leader crashes.

```js
// Calls the function at key "foo" on the "rpc" object that was passed in as
// an option to the Gaggle constructor with the arguments "bar" and "baz".
g.dispatchOnLeader('foo', ['bar', 'baz'], 5000, function (err, ret_a, ret_b) {
})

g.dispatchOnLeader('foo', ['bar', 'baz'], 5000)
.spread(function (ret_a, ret_b) {

})
.catch(function (err) {

})
```

#### Checking for uncommitted entries in previous terms

```txt
g.hasUncommittedEntriesInPreviousTerms()
```

You'll need to use this in your RPC functions in order to safely handle leadership changes. Since leaders do not commit entries in earlier terms, you might need to "nudge" the cluster into a consistent state by appending a no-op message.

#### Deconstructing an instance

```txt
g.close([function(Error) callback])
```

When you're done, call `close` to remove event listeners and disconnect the channel.

```js
g.close(function (err) {})

g.close().then()
```

#### Getting the state of the node

```txt
g.isLeader()
```

Returns `true` if the current node is the leader state. Note that multiple nodes may return `true` at the same time because they can be leaders in different terms.

### Getting the log

```txt
g.getLog()
```

Returns the log, which is an array of entries.

### Getting the commit index

```txt
g.getCommitIndex()
```

Returns the commit index, which is the index of the last committed log entry.

#### Event: appended

Emitted by a leader whenever an entry is appended (but not committed) to its log.

```js
g.on('appended', function (entry, index) {
  // entry => {id: 'some-uuid', term: 1, data: {foo: bar}}
  // index => 1
})
```

#### Event: committed

Emitted whenever an entry is committed to the node's log.

```js
g.on('committed', function (entry, index) {
  // entry => {id: 'some-uuid', term: 1, data: {foo: bar}}
  // index => 1
})
```

#### Event: leaderElected

Emitted whenever a node discovers that a new leader has been elected.

```js
g.on('leaderElected', function () {
  console.log('four! more! years!')
})
```

### Channels

#### Socket.io

A pretty fast channel that works on either the server or the browser. You need to host your own Socket.io server. Gaggle exports a helper function to assist with this.

```js
var serverEnhancer = require('gaggle').enhanceServerForSocketIOChannel

var server = http.createServer(function (req, resp) {
      resp.writeHead(200)
      resp.end()
    })

var closeServer = serverEnhancer(server)

server.listen(8000)

// When you need to cleanly shut down `server`:
closeServer()
```

##### Socket.io Channel Options

* *required* String `name` Set to 'socket.io' to use this channel
* *required* String `host` Where your socket.io server is running, e.g. `http://localhost:9000`
* *required* String `channel` What channel to use

#### Redis

Fast, but relies heavily on your Redis server. Only works server-side.

##### Redis Channel Options

* *required* String `name` Set to 'redis' to use this channel
* *required* String `channelName` What channel to pub/sub to
* *optional* String `connectionString` The redis URL to connect to

#### Redis Channel Example

```js
gaggle({
  id: uuid.v4()
, clusterSize: 5
, channel: {
    name: 'redis'

    // required, the channel to pub/sub to
  , channelName: 'foobar'
    // optional, defaults to redis's defaults
  , connectionString: 'redis://user:password@127.0.0.1:1234'
  }
})
```

#### Memory

Useful for testing, only works in the same process.

##### Memory Channel Options

* *required* String `name` Set to 'memory' to use this channel

#### Memory Channel Example

```js
gaggle({
  id: uuid.v4()
, clusterSize: 5
, channel: {
    name: 'memory'
  }
})
```

## License

Copyright (c) 2015 Ben Ng <me@benng.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
