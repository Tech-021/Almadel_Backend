const { requestJson } = require("../lib/http");
const { summarizeSamples } = require("../lib/metrics");
const { runCountedStages } = require("../lib/stages");

async function ensureWorkingAccount(config, anchor, runSalt) {
  const name = `Loadtest Cash ${runSalt}`;
  const created = await requestJson(config, {
    method: "POST",
    path: "/finance/accounts",
    token: anchor.token,
    businessId: anchor.businessId,
    body: { name, type: "cash", openingBalance: 10000 },
  });
  if (created.ok && created.json?.account?.id) return created.json.account;

  const listed = await requestJson(config, {
    method: "GET",
    path: "/finance/accounts",
    token: anchor.token,
    businessId: anchor.businessId,
  });
  const accounts = listed.json?.accounts || listed.json || [];
  const match = Array.isArray(accounts) ? accounts.find((row) => row.name === name) || accounts[0] : null;
  if (!match?.id) throw new Error("Could not create or find a finance account for the cash/accounts suite.");
  return match;
}

async function runFinanceSuite(config, anchor, runSalt) {
  const account = await ensureWorkingAccount(config, anchor, runSalt);
  const stages = [];
  let aborted = null;
  let created = 0;

  const expenseRun = await runCountedStages({
    config,
    test: "expense-create",
    scenario: "API load via POST /finance/expenses (Cash / Accounts).",
    counts: config.profile.expenseCounts,
    makeItem: (sequence) => sequence,
    worker: (sequence) =>
      requestJson(config, {
        method: "POST",
        path: "/finance/expenses",
        token: anchor.token,
        businessId: anchor.businessId,
        body: {
          accountId: account.id,
          amount: 10 + (sequence % 40),
          category: `Loadtest expense ${(sequence % 10) + 1}`,
          description: `Loadtest expense ${runSalt}-${sequence}`,
        },
      }),
  });
  stages.push(...expenseRun.stages);
  created += expenseRun.created;
  if (expenseRun.aborted) aborted = expenseRun.aborted;

  if (!aborted) {
    const txRun = await runCountedStages({
      config,
      test: "ledger-create",
      scenario: "API load via POST /finance/transactions (Cash / Accounts).",
      counts: config.profile.ledgerCounts,
      makeItem: (sequence) => sequence,
      worker: (sequence) =>
        requestJson(config, {
          method: "POST",
          path: "/finance/transactions",
          token: anchor.token,
          businessId: anchor.businessId,
          body: {
            accountId: account.id,
            amount: 5 + (sequence % 20),
            direction: sequence % 2 === 0 ? "credit" : "debit",
            type: "other",
            note: `Loadtest ledger ${runSalt}-${sequence}`,
          },
        }),
    });
    stages.push(...txRun.stages);
    created += txRun.created;
    if (txRun.aborted) aborted = txRun.aborted;
  }

  const from = "2020-01-01";
  const to = "2030-12-31";
  const probes = await probeFinanceReads(config, anchor, config.profile.readConcurrency, { from, to });
  stages.push(...probes);

  return { stages, aborted, created, accountId: account.id };
}

async function probeFinanceReads(config, anchor, concurrencyLevels, range) {
  const endpoints = [
    { test: "finance-accounts", path: "/finance/accounts" },
    { test: "finance-expenses", path: `/finance/expenses?from=${range.from}&to=${range.to}&page=1&limit=50` },
    { test: "finance-transactions", path: `/finance/transactions?from=${range.from}&to=${range.to}&page=1&limit=50` },
    { test: "finance-payments", path: `/finance/payments?from=${range.from}&to=${range.to}&page=1&limit=50` },
    { test: "finance-summary", path: `/finance/reports/summary?from=${range.from}&to=${range.to}` },
  ];

  const stages = [];
  for (const endpoint of endpoints) {
    for (const concurrency of concurrencyLevels) {
      const started = performance.now();
      const samples = await Promise.all(
        Array.from({ length: concurrency }, () =>
          requestJson(config, {
            method: "GET",
            path: endpoint.path,
            token: anchor.token,
            businessId: anchor.businessId,
          }),
        ),
      );
      const body = samples[0]?.json;
      const rows = Array.isArray(body?.accounts)
        ? body.accounts.length
        : Array.isArray(body?.expenses)
          ? body.expenses.length
          : Array.isArray(body?.transactions)
            ? body.transactions.length
            : Array.isArray(body?.payments)
              ? body.payments.length
              : body
                ? 1
                : 0;
      stages.push(
        summarizeSamples(samples, {
          test: endpoint.test,
          endpoint: `GET ${endpoint.path.split("?")[0]}`,
          concurrency,
          elapsedMs: performance.now() - started,
          rowsReturned: rows,
          paginated: /page=/.test(endpoint.path),
        }),
      );
    }
  }
  return stages;
}

module.exports = { probeFinanceReads, runFinanceSuite };
