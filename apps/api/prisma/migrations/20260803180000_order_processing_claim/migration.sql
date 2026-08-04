CREATE TABLE "OrderProcessingClaim" (
    "orderId" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "leaseUntil" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderProcessingClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrderProcessingClaim_token_key" ON "OrderProcessingClaim"("token");

CREATE INDEX "OrderProcessingClaim_leaseUntil_idx" ON "OrderProcessingClaim"("leaseUntil");
