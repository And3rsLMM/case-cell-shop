export interface AppError extends Error {
  code: string;
  details?: Record<string, unknown>;
  retryable: boolean;
  statusCode: number;
}

interface CreateAppErrorOptions {
  cause?: unknown;
  code: string;
  details?: Record<string, unknown>;
  message: string;
  retryable?: boolean;
  statusCode: number;
}

export function createAppError(options: CreateAppErrorOptions): AppError {
  const error = new Error(options.message) as AppError;

  error.name = "AppError";
  error.code = options.code;
  error.retryable = options.retryable ?? false;
  error.statusCode = options.statusCode;

  if (options.details !== undefined) {
    error.details = options.details;
  }

  if (options.cause !== undefined) {
    error.cause = options.cause;
  }

  return error;
}

export function isAppError(error: unknown): error is AppError {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Partial<AppError>;

  return (
    typeof candidate.code === "string" &&
    typeof candidate.retryable === "boolean" &&
    typeof candidate.statusCode === "number"
  );
}
