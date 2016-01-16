var test = require('tape')
  , uuid = require('uuid')
  , Strategy = require('../../../strategies/noop-strategy')

test('Rejects when called after closed', function (t) {
  var s = new Strategy({id: uuid.v4()})
    , expectation = 'Error: This instance has been closed'

  t.plan(2)

  // This should cause locks and unlocks to fail
  s.close()

  s.lock('dummy').catch(function (e) {
    t.equals(e.toString(), expectation, 'Lock fails with the right error')
  })

  s.unlock('dummy').catch(function (e) {
    t.equals(e.toString(), expectation, 'Unlock fails with the right error')
  })
})
