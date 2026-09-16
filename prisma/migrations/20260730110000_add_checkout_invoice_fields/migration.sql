ALTER TABLE "Sale"
ADD COLUMN "invoiceNumber" TEXT,
ADD COLUMN "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "discountType" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
ADD COLUMN "customerName" TEXT,
ADD COLUMN "customerMobile" TEXT;

UPDATE "Sale"
SET
  "invoiceNumber" = 'ALM-' || LPAD("id"::TEXT, 6, '0'),
  "subtotal" = "totalAmount";

ALTER TABLE "Sale"
ALTER COLUMN "invoiceNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Sale_invoiceNumber_key" ON "Sale"("invoiceNumber");
