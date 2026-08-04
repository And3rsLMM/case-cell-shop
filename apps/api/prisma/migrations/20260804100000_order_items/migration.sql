PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "totalPriceInCents" INTEGER NOT NULL CHECK ("totalPriceInCents" >= 0),
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        "status" IN ('PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED', 'STOCK_REJECTED')
    ),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "processingAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("processingAttempts" >= 0),
    "stockReleasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "new_Order" (
    "id",
    "idempotencyKey",
    "requestHash",
    "totalPriceInCents",
    "status",
    "errorCode",
    "errorMessage",
    "processingAttempts",
    "stockReleasedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "idempotencyKey",
    "requestHash",
    "totalPriceInCents",
    "status",
    "errorCode",
    "errorMessage",
    "processingAttempts",
    "stockReleasedAt",
    "createdAt",
    "updatedAt"
FROM "Order";

CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "unitPriceInCents" INTEGER NOT NULL CHECK ("unitPriceInCents" >= 0),
    "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
    "subtotalInCents" INTEGER NOT NULL CHECK ("subtotalInCents" >= 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItem_orderId_fkey"
        FOREIGN KEY ("orderId") REFERENCES "Order" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "Product" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "OrderItem" (
    "id",
    "orderId",
    "productId",
    "productNameSnapshot",
    "unitPriceInCents",
    "quantity",
    "subtotalInCents",
    "createdAt"
)
SELECT
    'legacy-' || o."id",
    o."id",
    o."productId",
    p."name",
    o."unitPriceInCents",
    o."quantity",
    o."totalPriceInCents",
    o."createdAt"
FROM "Order" o
INNER JOIN "Product" p ON p."id" = o."productId";

DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";

CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
CREATE INDEX "Order_status_updatedAt_idx" ON "Order"("status", "updatedAt");
CREATE UNIQUE INDEX "OrderItem_orderId_productId_key" ON "OrderItem"("orderId", "productId");
CREATE INDEX "OrderItem_productId_createdAt_idx" ON "OrderItem"("productId", "createdAt");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
