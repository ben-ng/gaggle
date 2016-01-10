var test = require('tape')
  , Strategy = require('../../strategies/unimplemented-strategy')
  , LOCK_MODES = require('../../lock-modes')

test('Rejects when invalid lock modes are used', function (t) {
  var c = new Strategy()

  t.plan(2)

  c.lock('dummy', {
    mode: LOCK_MODES.NONE
  }).catch(function (e) {
    t.equals(e.toString()
    , 'Invalid options: "mode" must be one of [EXCLUSIVE, SHARED]'
    , 'Locking with NONE fails with the right error')
  })

  c.unlock('dummy', {
    mode: LOCK_MODES.EXCLUSIVE
  }).catch(function (e) {
    t.equals(e.toString()
    , 'Invalid options: "mode" must be one of [NONE, SHARED]'
    , 'Unlocking with EXCLUSIVE fails with the right error')
  })
})
