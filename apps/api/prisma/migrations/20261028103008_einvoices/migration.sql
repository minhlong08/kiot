-- CreateTable
CREATE TABLE "EInvoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "branchId" INTEGER NOT NULL,
    "series" TEXT NOT NULL,
    "number" TEXT,
    "lookupCode" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "buyerName" TEXT NOT NULL DEFAULT '',
    "buyerTaxCode" TEXT NOT NULL DEFAULT '',
    "buyerAddress" TEXT NOT NULL DEFAULT '',
    "buyerEmail" TEXT NOT NULL DEFAULT '',
    "totalBeforeVat" INTEGER NOT NULL DEFAULT 0,
    "vatAmount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "ratesJson" TEXT NOT NULL DEFAULT '[]',
    "provider" TEXT NOT NULL DEFAULT 'stub',
    "issuedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EInvoice_invoiceId_idx" ON "EInvoice"("invoiceId");

-- CreateIndex
CREATE INDEX "EInvoice_status_issuedAt_idx" ON "EInvoice"("status", "issuedAt");
