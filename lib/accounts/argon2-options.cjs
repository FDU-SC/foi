/**
 * The Argon2id parameters, in one place because every writer has to agree.
 *
 * A hash carries the parameters it was written with, so a mismatch verifies
 * fine and shows up as nothing at all: a caller that drifted to a cheaper
 * setting would keep minting logins that work, and the only symptom would be
 * passwords protected less well than the deployment believes.
 *
 * This module owns the decision. `scripts/create-account.cjs` is an operational
 * tool that has to mint hashes `verifyPassword` will accept, and it runs under
 * plain `node` inside the standalone image, where there is no loader to
 * compile a `.ts`. So the shared file is CommonJS — the application can
 * import it, and the tool can `require` it — living here rather than under
 * `scripts/`, which is a toolkit the rest of the repository does not import.
 *
 * The values are the OWASP baseline for Argon2id — 19 MiB, two passes, one
 * lane. Raising them is a decision about the whole deployment rather than
 * about one caller, which is the other reason none of this is an argument.
 */
module.exports = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
