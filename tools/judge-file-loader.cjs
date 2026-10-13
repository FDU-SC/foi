/**
 * Turbopack loader: emit one judge-source file as a base64 string module.
 *
 * Why this exists rather than `?raw`
 * ----------------------------------
 * Vite's `?raw` returns the file's text, and Turbopack's own docs advertise the
 * same thing via `import.meta.glob(..., { query: "?raw" })`. In the Turbopack
 * that ships with Next 16 it does not work: importing any file it has no
 * built-in rule for — `makefile`, `.txt`, `.bin` — fails the build with
 * "Unknown module type. This module doesn't have an associated type."
 *
 * The fix is one rule in `next.config.ts`, keyed on the *path* rather than on a
 * list of extensions. Once a rule matches, both `import x from "./f.cpp"` and the
 * `?raw` form resolve, and this loader decides what the module evaluates to.
 * Matching by path is what lets a problem keep any file at all in `code/`
 * without anyone maintaining an extension list.
 *
 * Why the file is re-read from disk
 * ---------------------------------
 * The `source` a loader receives has already been decoded as text, so a byte that
 * is not valid UTF-8 arrives as U+FFFD and is gone — measured, not assumed: a
 * file containing `00 FF FE 80` reached this loader as `00 EF BF BD EF BF BD EF
 * BF BD`, three replacement characters in place of the original bytes. Emitting
 * base64 from that would faithfully encode the damage.
 *
 * So the bytes are read from `resourcePath` instead, which is the one path that
 * never goes through a text decoder. `source` is kept only as a fallback for the
 * case where the path is unavailable.
 *
 * Why base64, even though most files are text
 * -------------------------------------------
 * A JS string is UTF-16, so text survives a round trip and binary does not.
 * Emitting bytes as base64 is the one form that never loses information, so the
 * loader does not have to guess. The decoding happens once, in
 * `content/_shared/judge-files.ts`, which recovers the bytes and decides per file
 * whether to send them as text (compact, and what a human reading the config
 * expects) or as base64 (the only lossless option). The sentinel prefix below is
 * how it recognises this output.
 *
 * Keep `JUDGE_FILE_PREFIX` in step with `JUDGE_FILE_BASE64_PREFIX` there; a test
 * asserts the two are equal.
 *
 * CommonJS on purpose: Turbopack loads loader files with `require`.
 */

const fs = require("node:fs");

const JUDGE_FILE_PREFIX = "foi-judge-file:base64:";

module.exports = function judgeFileLoader(source) {
  let bytes;
  try {
    bytes = fs.readFileSync(this.resourcePath);
  } catch {
    // No path to read: fall back to what we were handed. Correct for text, and
    // the only option — a failure here would be a build error with no better
    // explanation than this one.
    bytes = Buffer.isBuffer(source) ? source : Buffer.from(String(source), "utf8");
  }

  const encoded = JUDGE_FILE_PREFIX + bytes.toString("base64");

  // The stringify escapes the base64 text into a JS literal. Base64 contains no
  // character that needs escaping, but the value is still data from disk and
  // building source text by concatenation is how injection bugs start.
  return "export default " + JSON.stringify(encoded) + ";\n";
};
