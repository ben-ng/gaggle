var test = require('tape')
  , NoopStrategy = require('../../../strategies/noop-strategy')
  , RedisStrategy = require('../../../strategies/redis-strategy')
  , uuid = require('uuid')

test('Throws when constructor options are invalid', function (t) {
  t.throws(function () {
      /*eslint-disable no-unused-vars*/
      var s = new NoopStrategy({
        logFunction: 'should be a function'
      })
      /*eslint-enable no-unused-vars*/
    }
  , /^Error: Invalid options: "logFunction" must be a Function$/
  , 'Should throw if logFunction is not a function')

  t.end()
})

test('Throws when redis constructor options are invalid', function (t) {
  t.throws(function () {
      /*eslint-disable no-unused-vars*/
      var s = new RedisStrategy({
        strategyOptions: {
          redisConnectionString: false
        }
      , id: uuid.v4()
      })
      /*eslint-enable no-unused-vars*/
    }
  , /Invalid options: "redisConnectionString" must be a string/
  , 'Should throw if logFunction is not a function')

  t.end()
})

test('Throws when lock options are invalid', function (t) {
  var s = new NoopStrategy({id: uuid.v4()})

  s.lock('dummy', {maxWait: 'should be number'})
  .catch(function (err) {
    t.equals(err.toString()
    , 'Invalid options: "maxWait" must be a number'
    , 'Should reject if lock options are invalid')

    t.end()
  })
})

test('Throws when unlock argument is invalid', function (t) {
  var s = new NoopStrategy({id: uuid.v4()})

  s.unlock('should be a lock object')
  .catch(function (err) {
    t.equals(err.toString()
    , 'Invalid options: "value" must be an object'
    , 'Should reject if unlock argument is invalid')

    t.end()
  })
})
