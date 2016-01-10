var test = require('tape')
  , Strategy = require('../../strategies/unimplemented-strategy')

test('Rejects when stub methods are called', function (t) {
  var c = new Strategy()
    , expectation = 'Error: unimplemented method _setLockState is required by the Strategy interface'

  t.plan(2)

  c.lock('dummy').catch(function (e) {
    t.equals(e.toString(), expectation, 'Lock fails with the right error')
  })

  c.unlock('dummy').catch(function (e) {
    t.equals(e.toString(), expectation, 'Unlock fails with the right error')
  })
})
