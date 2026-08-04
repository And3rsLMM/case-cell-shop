export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  info(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

type LogLevel = "error" | "info";

function writeLog(
  service: string,
  level: LogLevel,
  message: string,
  context: LogContext = {}
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service,
    message,
    ...context
  });

  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(`${entry}\n`);
}

export function createConsoleLogger(service: string): Logger {
  return {
    info: (message, context) => {
      writeLog(service, "info", message, context);
    },
    error: (message, context) => {
      writeLog(service, "error", message, context);
    }
  };
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown };

    return {
      name: error.name,
      ...(typeof errorWithCode.code === "string"
        ? { code: errorWithCode.code }
        : {})
    };
  }

  return {
    type: typeof error
  };
}
