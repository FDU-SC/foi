import pino from "pino";

const options: pino.LoggerOptions = {
  name: "foi",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
};

// pino-pretty is a devDependency: only `next dev` may load it.
const logger =
  process.env.NODE_ENV === "development"
    ? pino({
        ...options,
        transport: {
          target: "pino-pretty",
          options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,name" },
        },
      })
    : pino(options, process.stdout);

export type LogFields = Record<string, unknown>;

export const log = {
  info(fields: LogFields | string, message?: string): void {
    if (typeof fields === "string") logger.info(fields);
    else logger.info(fields, message);
  },
  warn(fields: LogFields | string, message?: string): void {
    if (typeof fields === "string") logger.warn(fields);
    else logger.warn(fields, message);
  },
  error(fields: LogFields | string, message?: string): void {
    if (typeof fields === "string") logger.error(fields);
    else logger.error(fields, message);
  },
};

export function refuse(header: string, items: string[]): never {
  throw new Error(
    `[foi] ${header}\n` + items.map((item) => `  - ${item}`).join("\n"),
  );
}
