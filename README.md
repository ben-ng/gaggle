# Gaggle

[![Build Status](https://img.shields.io/circleci/project/ben-ng/gaggle.svg)](https://circleci.com/gh/ben-ng/gaggle/tree/master) ![Code Coverage](https://img.shields.io/badge/Coverage-100%25-brightgreen.svg)

Gaggle helps you perform asynchronous business logic over a network. Specifically, it implements mutual exclusion with keyed locks.

## Examples

### Atomic Increment

Without Gaggle, a situation like this might arise if multiple processes tried to update a value in a database that only supported "GET" and "SET" commands.

```
Process A:
1. GET x => 0
2. SET x 1

Process B:
1. GET x => 0
2. SET x 1

Result: x = 1
```

Solving this problem with Gaggle looks like this:

```js

var RedisGaggle = require('gaggle').Redis
  , g = new RedisGaggle()
  , db = require('your-hypothetical-database')

g.lock('myMutex', {
  duration: 1000      // Hold the lock for no longer than 1 second
, maxWait: 5000       // Wait for no longer than 5s to acquire the lock
})
.then(lock => {
  return db.get('x')
  .then(value => {
    return db.set('x', value + 1)
  })
  .then(() => {
    return g.unlock(lock)         // Unlocking with the same opaque object
  })
})
.catch(err => {
  // Handle any errors. No need to release the lock as it will
  // automatically expire if the db.get or db.set commands failed.
})

```

## License

Copyright (c) 2015 Ben Ng <me@benng.me>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
