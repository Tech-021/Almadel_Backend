ALTER TABLE "Product"
ADD COLUMN "sku" TEXT,
ADD COLUMN "qrCode" TEXT,
ADD COLUMN "category" TEXT,
ADD COLUMN "costPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "sellingPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;

UPDATE "Product"
SET "sellingPrice" = "price"
WHERE "sellingPrice" = 0;

CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_qrCode_key" ON "Product"("qrCode");
CREATE INDEX "Product_category_idx" ON "Product"("category");
