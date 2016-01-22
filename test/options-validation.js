/**
* Test if leader election is working
*/

var t = require('tap')
  , gaggle = require('../')

t.test('fails when required Gaggle options are missing', function (t) {
  t.throws(function () {
    gaggle({
      id: 'i am required'
    , channel: {
        'name': 'memory'
      }
    })
  }, /Invalid options: "clusterSize" is required/, 'throws the expected error')

  t.end()
})

t.test('fails when required factory options are missing', function (t) {
  t.throws(function () {
    gaggle({
      id: 'i am required'
    })
  }, /Invalid options: "channel" is required/, 'throws the expected error')

  t.end()
})

t.test('fails properly when no options are given', function (t) {
  t.throws(function () {
    gaggle()
  }, /Invalid options: "id" is required/, 'throws the expected error')

  t.end()
})
