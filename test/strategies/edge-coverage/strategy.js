/**
* Coverage for edge cases in the raft strategy
*/

var Strategy = require('../../../strategies/raft-strategy')
  , test = require('tape')

test('raft strategy - missing options', function (t) {
  t.throws(function () {
    /*eslint-disable no-unused-vars*/
    var a = new Strategy()
    /*eslint-enable no-unused-vars*/
  }, 'Should throw if missing options')

  t.end()
})
