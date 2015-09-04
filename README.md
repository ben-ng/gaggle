# Gaggle

[![Build Status](https://circleci.com/gh/ben-ng/gaggle/tree/master.svg?style=svg)](https://circleci.com/gh/ben-ng/gaggle/tree/master)

Gaggle helps you perform asynchronous business logic over a network. Specifically, it implements distributed mutual exclusion with keyed locks.

## What Gaggle is Not

Gaggle is not a substitute for an [ACID](https://en.wikipedia.org/wiki/ACID) compliant database. It helps with isolation (the I in ACID), but Atomicity, Consistency, and Durability are out of its control, and left to your database.

# Usage

Gaggle has both callback and promise based APIs. The following example is presented in callback form because it is more universal. If you do not supply a function as the last argument to a method, Gaggle will return a `Promise`.

As asynchronous business logic tends to turn into a [Pyramid of doom](https://en.wikipedia.org/wiki/Pyramid_of_doom_(programming)), the author recommends using Gaggle's promise-based API together with a promise-based wrapper for your database.

```js

var Gaggle = require('gaggle')
  , g = new Gaggle({
      channel: 'redis'
    , channelConfig: {
        password: 'xxx'
      }
    })
  , db = require('your-hypothetical-database')

// Acquire read locks on john and sally's accounts
g.lock('read', ['accounts:john', 'accounts:sally'], function (err) {
  /*
  * After this, error handling is omitted for brevity.
  * If you get an error from gaggle, you should abort whatever you're
  * trying to do and try again from the start.
  */
  if (err)
    throw new Error('At least one of the read locks could not be acquired')

  /*
  * Now that we have read locks, we are assured that nobody else can
  * write to either account until we have released the locks. Other
  * processes may acquire read locks, but they may not acquire write
  * locks.
  */
  db.get(['accounts:john', 'accounts:sally'], function (err, old) {
    /*
    * This is a hypothetical method call, for simplicity
    * assume that `old` is this object:
    *
    * {
    *   john: {balance: 5}
    * , sally: {balance: 7}
    * }
    *
    * Now we'll upgrade our locks to write locks
    */
    g.lock('write', ['accounts:john', 'accounts:sally'], function (err) {
      /**
      * If we don't get an error here, we are now assured that we have
      * exclusive locks on both john and sally's accounts. Nobody can
      * acquire any sort of lock until we release this lock.
      */
      db.write({
        john: {balance: old.john.balance - 2}
      , sally: {balance: old.sally.balance + 2}
      }, function (err) {
        /*
        * Now that we're done, we need to release the locks to unblock
        * other processes
        */
        g.unlock(['accounts:john', 'accounts:sally'], function (err) {
          // We're done!
        })
      })
    })
  })
})

```

# License

Copyright (c) 2015 Ben Ng <me@benng.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
