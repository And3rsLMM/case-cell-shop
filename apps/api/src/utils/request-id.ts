const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isValidRequestId(value: string | undefined): value is string {
  return value !== undefined && REQUEST_ID_PATTERN.test(value);
}
