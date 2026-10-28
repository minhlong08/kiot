-- CreateTable
CREATE TABLE "Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "clientUuid" TEXT,
    "branchId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "sellerId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'store',
    "priceBookId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "promoDiscount" INTEGER NOT NULL DEFAULT 0,
    "invoiceDiscount" INTEGER NOT NULL DEFAULT 0,
    "voucherCode" TEXT,
    "voucherDiscount" INTEGER NOT NULL DEFAULT 0,
    "pointsUsed" INTEGER NOT NULL DEFAULT 0,
    "pointsValue" INTEGER NOT NULL DEFAULT 0,
    "otherIncome" INTEGER NOT NULL DEFAULT 0,
    "roundingAdjust" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL DEFAULT 0,
    "change" INTEGER NOT NULL DEFAULT 0,
    "debt" INTEGER NOT NULL DEFAULT 0,
    "costTotal" INTEGER NOT NULL DEFAULT 0,
    "pointsEarned" INTEGER NOT NULL DEFAULT 0,
    "returnedTotal" INTEGER NOT NULL DEFAULT 0,
    "promotions" TEXT NOT NULL DEFAULT '[]',
    "isDelivery" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "orderId" INTEGER,
    "shiftId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "unitId" INTEGER,
    "conversion" INTEGER NOT NULL DEFAULT 1,
    "qty" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "promoDiscount" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "isGift" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fundId" INTEGER,
    "cashVoucherId" INTEGER,
    CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceDelivery" (
    "invoiceId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receiverName" TEXT NOT NULL,
    "receiverPhone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "ward" TEXT NOT NULL DEFAULT '',
    "province" TEXT NOT NULL DEFAULT '',
    "partnerId" INTEGER,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "cod" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trackingCode" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SaleReturn" (
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
    "costTotal" INTEGER NOT NULL DEFAULT 0,
    "refundMethod" TEXT NOT NULL DEFAULT 'cash',
    "fundId" INTEGER,
    "exchangeInvoiceId" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SaleReturnLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "returnId" INTEGER NOT NULL,
    "invoiceLineId" INTEGER,
    "productId" INTEGER NOT NULL,
    "unitId" INTEGER,
    "conversion" INTEGER NOT NULL DEFAULT 1,
    "qty" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SaleReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "branchId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "createdById" INTEGER NOT NULL,
    "sellerId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "channel" TEXT NOT NULL DEFAULT 'store',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "deposit" INTEGER NOT NULL DEFAULT 0,
    "depositUsed" INTEGER NOT NULL DEFAULT 0,
    "depositFundId" INTEGER,
    "expectedAt" DATETIME,
    "note" TEXT NOT NULL DEFAULT '',
    "isDelivery" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CustomerOrderLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "unitId" INTEGER,
    "conversion" INTEGER NOT NULL DEFAULT 1,
    "qty" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "deliveredQty" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CustomerOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "branchId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingCash" INTEGER NOT NULL DEFAULT 0,
    "closedAt" DATETIME,
    "countedCash" INTEGER,
    "expectedCash" INTEGER,
    "note" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "SalesChannel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_code_key" ON "Invoice"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_clientUuid_key" ON "Invoice"("clientUuid");

-- CreateIndex
CREATE INDEX "Invoice_branchId_createdAt_idx" ON "Invoice"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_productId_idx" ON "InvoiceLine"("productId");

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "InvoicePayment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReturn_code_key" ON "SaleReturn"("code");

-- CreateIndex
CREATE INDEX "SaleReturn_invoiceId_idx" ON "SaleReturn"("invoiceId");

-- CreateIndex
CREATE INDEX "SaleReturn_branchId_createdAt_idx" ON "SaleReturn"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturnLine_returnId_idx" ON "SaleReturnLine"("returnId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_code_key" ON "CustomerOrder"("code");

-- CreateIndex
CREATE INDEX "CustomerOrder_branchId_createdAt_idx" ON "CustomerOrder"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerOrderLine_orderId_idx" ON "CustomerOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "Shift_userId_closedAt_idx" ON "Shift"("userId", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesChannel_code_key" ON "SalesChannel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SalesChannel_name_key" ON "SalesChannel"("name");
