const PREFIX = "[foi]";

function line(message: string): string {
  return `${PREFIX} ${message}`;
}

export const log = {
  info(message: string): void {
    console.log(line(message));
  },
  warn(message: string): void {
    console.warn(line(message));
  },
  error(message: string, cause?: unknown): void {
    if (cause !== undefined) console.error(line(message), cause);
    else console.error(line(message));
  },
};

export function refuse(header: string, items: string[]): never {
  throw new Error(
    `${line(header)}\n` + items.map((item) => `  - ${item}`).join("\n"),
  );
}
