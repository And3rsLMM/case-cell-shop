import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { Express } from "express";

export interface HttpTestServer {
  baseUrl: string;
  close(): Promise<void>;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    server.closeAllConnections();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });

    server.closeIdleConnections();
    server.closeAllConnections();
  });
}

export async function startHttpTestServer(
  app: Express
): Promise<HttpTestServer> {
  const server = createServer(app);

  try {
    await new Promise<void>((resolve, reject) => {
      const handleStartupError = (error: Error): void => {
        server.off("listening", handleListening);
        reject(error);
      };
      const handleListening = (): void => {
        server.off("error", handleStartupError);
        resolve();
      };

      server.once("error", handleStartupError);
      server.once("listening", handleListening);
      server.listen(0, "127.0.0.1");
    });

    const address = server.address();

    if (address === null || typeof address === "string") {
      throw new Error("Não foi possível obter a porta do servidor de teste.");
    }

    const { port } = address satisfies AddressInfo;
    let closePromise: Promise<void> | null = null;

    return {
      baseUrl: `http://127.0.0.1:${port}`,
      close: () => {
        closePromise ??= closeServer(server);
        return closePromise;
      }
    };
  } catch (startupError: unknown) {
    try {
      await closeServer(server);
    } catch (closeError: unknown) {
      throw new AggregateError(
        [startupError, closeError],
        "Falha ao iniciar e encerrar o servidor HTTP de teste."
      );
    }

    throw startupError;
  }
}
