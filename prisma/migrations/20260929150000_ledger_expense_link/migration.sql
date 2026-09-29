-- Link expense ledger debits for atomic reversal on expense delete.
ALTER TABLE "ledger_transactions" ADD COLUMN "expenseId" INTEGER;

CREATE UNIQUE INDEX "ledger_transactions_expenseId_key" ON "ledger_transactions"("expenseId");

ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
