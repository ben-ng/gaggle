var test = require('tape')
  , Strategy = require('../../strategies/unimplemented-strategy')

test('Rejects when stub methods are called', function (t) {
  var s = new Strategy()

  t.plan(3)

  s.lock('dummy').catch(function (e) {
    t.equals(e.toString()
    , 'Error: unimplemented method _setLockState is required by the Strategy interface'
    , 'Lock fails with the right error')
  })

  s.unlock({key: 'dummy', nonce: 'dummy'}).catch(function (e) {
    t.equals(e.toString()
    , 'Error: unimplemented method _setLockState is required by the Strategy interface'
    , 'Unlock fails with the right error')
  })

  s.close().catch(function (e) {
    t.equals(e.toString()
    , 'Error: unimplemented method _close is required by the Strategy interface'
    , 'Close fails with the right error')
  })
})
