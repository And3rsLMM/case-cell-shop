type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

type FetchStep =
  | { kind: "response"; value: Response | Promise<Response> }
  | { kind: "failure"; error: unknown }
  | { kind: "handler"; handle: FetchHandler };

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => normalizedHeaders.get(name.toLowerCase()) ?? null,
    },
    json: async () => body,
  } as Response;
}

export function respond(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): FetchStep {
  return { kind: "response", value: jsonResponse(body, status, headers) };
}

export function respondLater(promise: Promise<Response>): FetchStep {
  return { kind: "response", value: promise };
}

export function rejectWith(error: unknown): FetchStep {
  return { kind: "failure", error };
}

export function handleWith(handle: FetchHandler): FetchStep {
  return { kind: "handler", handle };
}

export function apiError(
  code: string,
  message: string,
  status: number,
  retryable: boolean,
  details: Record<string, unknown> = {},
): FetchStep {
  return respond(
    {
      error: {
        code,
        message,
        details,
        retryable,
        requestId: "request-test-1",
      },
    },
    status,
  );
}

export function installFetchMock(
  ...steps: FetchStep[]
): jest.MockedFunction<typeof fetch> {
  const queue = [...steps];

  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const step = queue.shift();

    if (!step) {
      throw new Error(`Fetch inesperado para ${String(input)}.`);
    }

    if (step.kind === "failure") {
      throw step.error;
    }

    if (step.kind === "handler") {
      return step.handle(input, init);
    }

    return step.value;
  }) as jest.MockedFunction<typeof fetch>;

  globalThis.fetch = fetchMock;
  return fetchMock;
}

export function installRepeatingFetchMock(
  handle: FetchHandler,
): jest.MockedFunction<typeof fetch> {
  const fetchMock = jest.fn(handle) as jest.MockedFunction<typeof fetch>;
  globalThis.fetch = fetchMock;
  return fetchMock;
}

export function getRequestHeader(
  fetchMock: jest.MockedFunction<typeof fetch>,
  callIndex: number,
  headerName: string,
): string | null {
  const headers = fetchMock.mock.calls[callIndex]?.[1]?.headers;

  if (!headers) {
    return null;
  }

  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(headerName);
  }

  if (Array.isArray(headers)) {
    const entry = headers.find(
      ([name]) => name.toLowerCase() === headerName.toLowerCase(),
    );
    return entry?.[1] ?? null;
  }

  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === headerName.toLowerCase(),
  );
  return entry?.[1] === undefined ? null : String(entry[1]);
}

export function getRequestBody<T>(
  fetchMock: jest.MockedFunction<typeof fetch>,
  callIndex: number,
): T {
  const body = fetchMock.mock.calls[callIndex]?.[1]?.body;

  if (typeof body !== "string") {
    throw new Error(`A chamada ${callIndex} não possui body JSON em string.`);
  }

  return JSON.parse(body) as T;
}
