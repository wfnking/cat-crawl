export type LoggerSink = Pick<Console, "log" | "info" | "warn" | "error">;

export type Logger = {
  log: (message: unknown, ...rest: unknown[]) => void;
  info: (message: unknown, ...rest: unknown[]) => void;
  warn: (message: unknown, ...rest: unknown[]) => void;
  error: (message: unknown, ...rest: unknown[]) => void;
};

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  const second = `${date.getSeconds()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function withScope(
  scope: string | undefined,
  message: unknown,
  rest: unknown[],
  now: () => Date,
): unknown[] {
  const prefix = `[${formatTimestamp(now())}]`;
  if (!scope) {
    if (typeof message === "string") {
      return [`${prefix} ${message}`, ...rest];
    }
    return [prefix, message, ...rest];
  }
  const token = `[${scope}]`;
  if (typeof message === "string") {
    return [`${prefix} ${token} ${message}`, ...rest];
  }
  return [prefix, token, message, ...rest];
}

export function createLogger(
  scope?: string,
  sink: LoggerSink = console,
  now: () => Date = () => new Date(),
): Logger {
  return {
    log(message, ...rest) {
      sink.log(...withScope(scope, message, rest, now));
    },
    info(message, ...rest) {
      sink.info(...withScope(scope, message, rest, now));
    },
    warn(message, ...rest) {
      sink.warn(...withScope(scope, message, rest, now));
    },
    error(message, ...rest) {
      sink.error(...withScope(scope, message, rest, now));
    },
  };
}
