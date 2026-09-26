"use strict";

// Shared plumbing for the account scripts.
//
// Plain CommonJS on purpose: the Dockerfile copies scripts/ into the runner
// image, which has no tsx and no TypeScript. That also rules out importing the
// validation rules from lib/, so the constants below are duplicated — each one
// names the file it must stay in sync with.

const crypto = require("node:crypto");
const util = require("node:util");
const { hash } = require("@node-rs/argon2");
const { Client } = require("pg");

const ARGON2_OPTIONS = require("../lib/accounts/argon2-options.cjs");

// Mirrors passwordMinLength in content/site.ts.
const PASSWORD_MIN_LENGTH = 8;
const GENERATED_PASSWORD_BYTES = 18;

/** An expected, user-facing failure — reported without a stack trace. */
class CliError extends Error {}

function bail(message) {
  throw new CliError(message);
}

function requireDevelopmentEnvironment(env = process.env) {
  if (env.FOI_ENV !== "dev") {
    bail("FOI_ENV 必须显式设为 dev，拒绝修改可能包含真实数据的数据库");
  }
}

/**
 * Parses `<positional...> --flag value` argv.
 *
 * Unknown flags, missing values, repeats and stray positionals are all errors.
 * This is rescue tooling: a typo that silently lands in the database is worse
 * than a refusal.
 */
function parseArgs(argv, valueOptions, usage) {
  const flags = new Map(
    Object.entries(valueOptions).map(([flag, key]) => [flag.slice(2), { flag, key }]),
  );

  // Non-strict so every refusal below keeps its own wording.
  const { tokens, positionals } = util.parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      ...Object.fromEntries([...flags.keys()].map((name) => [name, { type: "string" }])),
    },
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  if (tokens.some((token) => token.kind === "option" && token.name === "help")) {
    return { help: true, positional: positionals };
  }

  const parsed = {};
  for (const token of tokens) {
    if (token.kind !== "option") continue;

    const option = flags.get(token.name);
    if (!option) bail(`未知选项 ${token.rawName}\n\n${usage}`);

    // Rejecting a `-` prefix catches `--email --nick alice`, which would
    // otherwise swallow the next flag as this one's value.
    if (token.value === undefined || (!token.inlineValue && token.value.startsWith("-"))) {
      bail(`${option.flag} 后面要跟一个值`);
    }
    if (parsed[option.key] !== undefined) bail(`${option.flag} 给了不止一次`);
    parsed[option.key] = token.value;
  }

  return { ...parsed, positional: positionals };
}

function singlePositional(positional, label) {
  if (positional.length > 1) {
    bail(`只接受一个 ${label}，多出来的是: ${positional.slice(1).join(" ")}`);
  }
  return positional[0];
}

/**
 * Takes the password from stdin, reading to EOF, or generates one when stdin
 * is a TTY or empty.
 *
 * Deliberately without a timeout: a short read looks exactly like "no password
 * given", which would silently fall through to a generated password and leave
 * an account nobody can log into.
 */
async function resolvePassword() {
  let given = "";

  if (!process.stdin.isTTY) {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) given += chunk;
    given = given.trim();
  }

  if (given === "") {
    const password = crypto
      .randomBytes(GENERATED_PASSWORD_BYTES)
      .toString("base64url");
    return { password, generated: true };
  }

  if (given.length < PASSWORD_MIN_LENGTH) {
    bail(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
  }

  return { password: given, generated: false };
}

function hashPassword(password) {
  return hash(password, ARGON2_OPTIONS);
}

function reportPassword(generated, password) {
  if (!generated) return;
  console.log(`密码: ${password}`);
  console.log("这是唯一一次显示，请立即保存。");
}

async function withClient(fn) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) bail("缺少环境变量 DATABASE_URL");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function run(main) {
  main().catch((error) => {
    console.error(error instanceof CliError ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  CliError,
  PASSWORD_MIN_LENGTH,
  bail,
  hashPassword,
  parseArgs,
  reportPassword,
  requireDevelopmentEnvironment,
  resolvePassword,
  run,
  singlePositional,
  withClient,
};
