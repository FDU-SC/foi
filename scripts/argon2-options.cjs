/**
 * The Argon2id parameters, in one place because four call sites have to agree.
 *
 * A hash carries the parameters it was written with, so a mismatch verifies
 * fine and shows up as nothing at all: a script that drifted to a cheaper
 * setting would keep minting logins that work, and the only symptom would be
 * passwords protected less well than the deployment believes. Four copies each
 * captioned "must match lib/auth/credentials.ts" is a convention, and a
 * convention is what the rest of this repository spends its comments arguing
 * against.
 *
 * CommonJS rather than TypeScript because the far end of the dependency has no
 * choice: `set-password.cjs` and `create-account.cjs` run under plain `node`
 * inside the standalone image, where there is no loader to compile a `.ts` for
 * them. So the shared file has to be the one they can already read, and the
 * application imports it rather than the other way round.
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
