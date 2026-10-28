-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SaleReturn" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "invoiceId" INTEGER,
    "branchId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "returnFee" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "refunded" INTEGER NOT NULL DEFAULT 0,
    "toDebt" INTEGER NOT NULL DEFAULT 0,
    "pointsReversed" INTEGER NOT NULL DEFAULT 0,
    "pointsRefunded" INTEGER NOT NULL DEFAULT 0,
    "costTotal" INTEGER NOT NULL DEFAULT 0,
    "refundMethod" TEXT NOT NULL DEFAULT 'cash',
    "fundId" INTEGER,
    "exchangeInvoiceId" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_SaleReturn" ("branchId", "code", "costTotal", "createdAt", "createdById", "customerId", "exchangeInvoiceId", "fundId", "id", "invoiceId", "note", "pointsReversed", "refundMethod", "refunded", "returnFee", "status", "subtotal", "toDebt", "total") SELECT "branchId", "code", "costTotal", "createdAt", "createdById", "customerId", "exchangeInvoiceId", "fundId", "id", "invoiceId", "note", "pointsReversed", "refundMethod", "refunded", "returnFee", "status", "subtotal", "toDebt", "total" FROM "SaleReturn";
DROP TABLE "SaleReturn";
ALTER TABLE "new_SaleReturn" RENAME TO "SaleReturn";
CREATE UNIQUE INDEX "SaleReturn_code_key" ON "SaleReturn"("code");
CREATE INDEX "SaleReturn_invoiceId_idx" ON "SaleReturn"("invoiceId");
CREATE INDEX "SaleReturn_branchId_createdAt_idx" ON "SaleReturn"("branchId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
