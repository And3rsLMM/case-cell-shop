import type { Server } from "node:http";

import type { Express } from "express";

interface HttpServerHandlers {
  onError(error: Error): void;
  onListening(): void;
}

export function listenHttpServer(
  app: Express,
  port: number,
  handlers: HttpServerHandlers
): Server {
  const server = app.listen(port);

  server.once("error", (error) => {
    handlers.onError(error);
  });
  server.once("listening", () => {
    handlers.onListening();
  });

  return server;
}
