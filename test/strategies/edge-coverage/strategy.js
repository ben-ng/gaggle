/**
* Coverage for edge cases in the redis strategy
*/

var Strategy = require('../../../strategies/leader-strategy')
  , test = require('tape')
  , _ = require('lodash')

test('leader strategy - missing options', function (t) {
  t.throws(function () {
    /*eslint-disable: no-unused-vars*/
    var a = new Strategy()
    /*eslint-enable: no-unused-vars*/
  }, 'Should throw if missing options')

  t.end()
})
