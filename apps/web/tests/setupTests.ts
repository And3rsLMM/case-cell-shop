import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  Reflect.deleteProperty(globalThis, "fetch");
});
