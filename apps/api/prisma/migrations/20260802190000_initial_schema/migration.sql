-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceInCents" INTEGER NOT NULL CHECK ("priceInCents" >= 0),
    "stock" INTEGER NOT NULL CHECK ("stock" >= 0),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
    "unitPriceInCents" INTEGER NOT NULL CHECK ("unitPriceInCents" >= 0),
    "totalPriceInCents" INTEGER NOT NULL CHECK ("totalPriceInCents" >= 0),
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        "status" IN ('PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED', 'STOCK_REJECTED')
    ),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "processingAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("processingAttempts" >= 0),
    "stockReleasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "Product" ("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Product_active_id_idx" ON "Product"("active", "id");

-- CreateIndex
CREATE INDEX "Product_active_name_idx" ON "Product"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_productId_createdAt_idx" ON "Order"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_updatedAt_idx" ON "Order"("status", "updatedAt");
