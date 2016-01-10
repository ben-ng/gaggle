/**
* This tests if two processes can atomically increment a value using only gaggle, get, and set.
*/

var Gaggle = require('gaggle')
  , g = new Gaggle({
      channel: 'redis'
    , channelConfig: {
        password: 'xxx'
      }
    , electionTimeoutRange: [150, 300]
    })
