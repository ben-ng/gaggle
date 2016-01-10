var test = require('tape')
  , Strategy = require('../../strategies/unimplemented-strategy')

test('Throws when constructor options are invalid', function (t) {
  t.throws(function () {
      /*eslint-disable no-unused-vars*/
      var s = new Strategy({
        logFunction: 'should be a function'
      })
      /*eslint-enable no-unused-vars*/
    }
  , /^Error: Invalid options: "logFunction" must be a Function$/
  , 'Should throw if logFunction is not a function')

  t.end()
})
