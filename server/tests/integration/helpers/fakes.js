'use strict';

// A chainable stand-in for a Mongoose query, so route tests can exercise the
// real handlers -- including their .populate/.maxTimeMS calls -- without a
// database.
function queryReturning(value) {
  const query = {
    populate: () => query,
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    maxTimeMS: () => query,
    then: (onFulfilled, onRejected) => Promise.resolve(value).then(onFulfilled, onRejected),
  };
  return query;
}

function queryRejecting(error) {
  const query = {
    populate: () => query,
    select: () => query,
    sort: () => query,
    skip: () => query,
    limit: () => query,
    maxTimeMS: () => query,
    then: (onFulfilled, onRejected) => Promise.reject(error).then(onFulfilled, onRejected),
  };
  return query;
}

module.exports = { queryReturning, queryRejecting };
