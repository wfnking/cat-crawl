export type LoggerSink = Pick<Console, "log" | "info" | "warn" | "error">;

export type Logger = {
  log: (message: unknown, ...rest: unknown[]) => void;
  info: (message: unknown, ...rest: unknown[]) => void;
  warn: (message: unknown, ...rest: unknown[]) => void;
  error: (message: unknown, ...rest: unknown[]) => void;
};

function withScope(scope: string | undefined, message: unknown, rest: unknown[]): unknown[] {
  if (!scope) {
    return [message, ...rest];
  }
  const token = `[${scope}]`;
  if (typeof message === "string") {
    return [`${token} ${message}`, ...rest];
  }
  return [token, message, ...rest];
}

export function createLogger(scope?: string, sink: LoggerSink = console): Logger {
  return {
    log(message, ...rest) {
      sink.log(...withScope(scope, message, rest));
    },
    info(message, ...rest) {
      sink.info(...withScope(scope, message, rest));
    },
    warn(message, ...rest) {
      sink.warn(...withScope(scope, message, rest));
    },
    error(message, ...rest) {
      sink.error(...withScope(scope, message, rest));
    },
  };
}
