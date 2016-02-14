module.exports = {
  memory: require('./in-memory-channel')
, 'socket.io': require('./socket-io-channel')
, redis: require('./redis-channel')
}
