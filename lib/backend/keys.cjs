"use strict";

// Plain CommonJS so that scripts/ can require it inside the runner image, which
// has no TypeScript runtime. lib/ imports this same file.
//
// Every runner implementation carries its own copy of these two functions and
// must produce byte-identical output; keys.test.ts pins the expected values.

const { createHmac } = require("node:crypto");

/**
 * The signing key of one backend queue, derived from `FOI_BACKEND_SECRET`.
 * HMAC is one-way: holding one queue's key reveals neither the master nor any
 * other queue's key.
 *
 * @param {string} master
 * @param {string} backendId
 * @returns {string}
 */
function deriveBackendSecret(master, backendId) {
  return createHmac("sha256", master)
    .update(`foi-backend:${backendId}`)
    .digest("hex");
}

/**
 * The signing key behind one runner token. The backend id is part of the input,
 * so a token only ever verifies against the queue it was issued for.
 *
 * @param {string} master
 * @param {string} backendId
 * @param {string} keyId
 * @returns {string}
 */
function deriveTokenSecret(master, backendId, keyId) {
  return createHmac("sha256", master)
    .update(`foi-runner-token:${backendId}:${keyId}`)
    .digest("hex");
}

module.exports = { deriveBackendSecret, deriveTokenSecret };
