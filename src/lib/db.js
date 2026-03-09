'use strict';

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGODB_URI_STANDARD || '';
const DISCOVER_PRIMARY = process.env.MONGODB_DISCOVER_PRIMARY === 'true';

let cached = global.__mongooseConnection;

if (!cached) {
  cached = global.__mongooseConnection = { conn: null, promise: null };
}

async function connect() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI or MONGODB_URI_STANDARD must be set');
  }
  if (cached.conn) {
    return cached.conn;
  }
  if (!cached.promise) {
    const opts = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
    };
    if (DISCOVER_PRIMARY) {
      opts.directConnection = false;
    }
    cached.promise = mongoose.connect(MONGODB_URI, opts).then((m) => m);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = { connect };
