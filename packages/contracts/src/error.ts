export interface ValidationFieldError {
  field: string;
  message: string;
}

export interface ValidationErrorDetails extends Record<string, unknown> {
  fields: ValidationFieldError[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryable: boolean;
    requestId: string;
  };
}
