/* eslint-disable @typescript-eslint/unbound-method */

import type { OrderRepository } from "../src/repositories/order.repository";
import type { OrderProcessor } from "../src/services/order-processor.service";
import { createOrderService } from "../src/services/order.service";
import { createOrderRequestHash } from "../src/utils/order-request-hash";
import {
  createOrderRecord,
  defaultOrderRequest
} from "./helpers/order-fixture";

describe("order service", () => {
  let orderRepository: jest.Mocked<OrderRepository>;
  let orderProcessor: jest.Mocked<OrderProcessor>;

  beforeEach(() => {
    orderRepository = {
      createAttempt: jest.fn(),
      failAndReleaseStock: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findProcessable: jest.fn(),
      markConfirmed: jest.fn(),
      markTemporaryFailure: jest.fn(),
      startProcessingAttempt: jest.fn()
    };
    orderProcessor = {
      processOrder: jest.fn(),
      waitForIdle: jest.fn()
    };
    orderRepository.findByIdempotencyKey.mockResolvedValue(null);
  });

  function createService(
    timeoutWait: (delayMs: number) => Promise<void> =
      () => new Promise(() => undefined)
  ) {
    return createOrderService({
      orderProcessor,
      orderRepository,
      syncTimeoutMs: 100,
      timeoutWait
    });
  }

  it("gera o mesmo SHA-256 independentemente da ordem dos itens", () => {
    const firstHash = createOrderRequestHash({
      items: [
        { productId: "product-2", quantity: 2 },
        { productId: "product-1", quantity: 1 }
      ]
    });
    const secondHash = createOrderRequestHash({
      items: [
        { quantity: 1, productId: "product-1" },
        { quantity: 2, productId: "product-2" }
      ]
    });

    expect(firstHash).toBe(secondHash);
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("retorna ACCEPTED quando excede a janela síncrona", async () => {
    const pendingOrder = createOrderRecord();
    orderRepository.createAttempt.mockResolvedValue({
      kind: "CREATED",
      order: pendingOrder
    });
    orderProcessor.processOrder.mockReturnValue(
      new Promise(() => undefined)
    );

    const result = await createService(() => Promise.resolve()).create({
      idempotencyKey: "order-key-123",
      request: defaultOrderRequest
    });

    expect(result).toEqual({
      kind: "ACCEPTED",
      body: {
        orderId: "order-1",
        status: "PROCESSING",
        statusUrl: "/api/orders/order-1"
      }
    });
  });

  it("reproduz pedido existente sem iniciar processamento", async () => {
    const existingOrder = createOrderRecord({ status: "CONFIRMED" });
    orderRepository.findByIdempotencyKey.mockResolvedValue(existingOrder);

    const result = await createService().create({
      idempotencyKey: "order-key-123",
      request: defaultOrderRequest
    });

    expect(result.kind).toBe("REPLAYED");
    expect(orderRepository.createAttempt).not.toHaveBeenCalled();
    expect(orderProcessor.processOrder).not.toHaveBeenCalled();
  });

  it("trata o pedido recuperado após corrida como replay", async () => {
    orderRepository.createAttempt.mockResolvedValue({
      kind: "EXISTING",
      order: createOrderRecord({ status: "CONFIRMED" })
    });

    const result = await createService().create({
      idempotencyKey: "order-key-123",
      request: defaultOrderRequest
    });

    expect(result.kind).toBe("REPLAYED");
    expect(orderProcessor.processOrder).not.toHaveBeenCalled();
  });

});
