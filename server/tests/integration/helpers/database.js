'use strict';

// Connection helper for the disposable test replica set. Integration tests
// fail with an actionable message when it is not configured; they never skip
// themselves silently.

const mongoose = require('mongoose');

function testDatabaseUri() {
  const uri = process.env.MONGO_URI_TEST;
  if (!uri) {
    throw new Error(
      'MONGO_URI_TEST is not set. Start the local replica set (see README.md) and export ' +
      'MONGO_URI_TEST="mongodb://127.0.0.1:27017/text_to_learn_test?replicaSet=rs0&directConnection=true"'
    );
  }
  const name = new URL(uri).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    // Guards every cleanup below: this helper drops collections.
    throw new Error(`Refusing to use database "${name}": the integration database name must end in _test`);
  }
  return uri;
}

async function connectTestDatabase() {
  await mongoose.connect(testDatabaseUri(), { serverSelectionTimeoutMS: 5000 });
  return mongoose;
}

async function clearTestDatabase() {
  const { collections } = mongoose.connection;
  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
}

async function disconnectTestDatabase() {
  await mongoose.disconnect();
}

module.exports = { testDatabaseUri, connectTestDatabase, clearTestDatabase, disconnectTestDatabase };
