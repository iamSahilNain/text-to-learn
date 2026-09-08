'use strict';

// Structured operational logs.
//
// Deliberately narrow: an operation name, an outcome, a duration and counts.
// Never a topic, a title, a prompt, generated prose, a connection string or
// an SDK request URL.
function logOperation(fields) {
  console.log(JSON.stringify(fields));
}

function elapsedMsSince(startedAt) {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
}

function startTimer() {
  return process.hrtime.bigint();
}

module.exports = { logOperation, startTimer, elapsedMsSince };
