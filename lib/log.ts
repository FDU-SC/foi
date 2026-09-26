import pino from "pino";

const logger = pino(
  {
    name: "foi",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  process.stdout,
);

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
