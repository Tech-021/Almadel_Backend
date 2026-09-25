const fs = require("fs");
const path = require("path");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function pct(value) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function stageTable(stages) {
  const header = "| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |";
  const rows = stages.map((stage) => {
    const label = stage.stage || stage.endpoint || stage.test;
    return `| ${label} | ${stage.concurrency ?? ""} | ${stage.requests} | ${stage.successful} | ${stage.failed} | ${stage.requestsPerSecond} | ${stage.latency.averageMs} | ${stage.latency.p95Ms} | ${stage.latency.p99Ms} | ${stage.grade || ""} |`;
  });
  return [header, ...rows].join("\n");
}

function htmlTable(stages) {
  const head = "<tr><th>Stage</th><th>Concurrency</th><th>Requests</th><th>Success</th><th>Errors</th><th>Req/s</th><th>Avg</th><th>P95</th><th>P99</th><th>Grade</th></tr>";
  const rows = stages
    .map((stage) => {
      const label = escapeHtml(stage.stage || stage.endpoint || stage.test);
      return `<tr><td>${label}</td><td>${stage.concurrency ?? ""}</td><td>${stage.requests}</td><td>${stage.successful}</td><td>${stage.failed}</td><td>${stage.requestsPerSecond}</td><td>${stage.latency.averageMs}</td><td>${stage.latency.p95Ms}</td><td>${stage.latency.p99Ms}</td><td>${escapeHtml(stage.grade || "")}</td></tr>`;
    })
    .join("");
  return `<table>${head}${rows}</table>`;
}

function collectStages(report) {
  return Object.values(report.suites).flatMap((suite) => suite.stages || []);
}

function executiveSummary(report) {
  const stages = collectStages(report);
  const failed = stages.filter((stage) => stage.grade === "FAIL");
  const warnings = stages.filter((stage) => stage.grade === "WARNING");
  const integrityFailures = (report.integrity || []).filter((row) => row.result !== "PASS");
  const maxConcurrency = stages.reduce((max, stage) => Math.max(max, stage.concurrency || 0), 0);
  const stable = stages.filter((stage) => stage.grade === "PASS").map((stage) => stage.concurrency || 0);
  const maxStable = stable.length ? Math.max(...stable) : 0;
  const lines = [];

  lines.push(
    failed.length === 0 && integrityFailures.length === 0
      ? "Overall for this API run: the completed stages stayed inside pass thresholds, and inventory checks that ran matched expected stock."
      : "Overall for this API run: one or more stages crossed fail thresholds, or an inventory check did not match. See the stop conditions and stage tables below.",
  );
  lines.push(
    `This is an **API request scalability** report. It measures real HTTP traffic against the stress API. It is not the database growth-curve report.`,
  );
  lines.push(`Profile used: **${report.profile}**. Base URL: ${report.baseUrl}.`);
  lines.push(`Highest concurrency exercised in a completed stage: **${maxConcurrency}**.`);
  lines.push(`Highest concurrency that still graded PASS: **${maxStable}**.`);
  if (warnings.length) {
    lines.push(`${warnings.length} stage(s) graded WARNING (slower or noisier, but not a hard fail).`);
  }
  if (report.stops?.length) {
    lines.push(
      `Ramp stopped ${report.stops.length} time(s). First stop: **${report.stops[0].test}** at concurrency **${report.stops[0].concurrency}** because ${report.stops[0].reason}. That stop point is useful evidence of where request scalability begins to degrade for that operation.`,
    );
  }
  if (integrityFailures.length) {
    lines.push(`${integrityFailures.length} inventory check(s) recorded DATA INTEGRITY FAILURE.`);
  } else if ((report.integrity || []).length) {
    lines.push("Inventory correctness checks matched expected stock under the concurrent update cases that ran.");
  }
  lines.push(
    "How to read the grades: PASS means error rate under 1% and p95 under 1s. WARNING means error rate 1–5% or p95 1–3s. FAIL means error rate above 5%, p95 above 3s, or a data-integrity failure. The ramp also stops early if error rate exceeds the configured max or p95 exceeds 5s.",
  );
  return lines;
}

function bottleneckNotes(report) {
  const notes = [];
  const team = report.suites.team;
  if (team?.localBcrypt && team.stages?.length) {
    const avg = team.stages[team.stages.length - 1].latency.averageMs;
    notes.push(
      `Observed: local bcrypt sample averaged ${team.localBcrypt.meanMs} ms at ${team.localBcrypt.rounds} rounds. The last team-create stage averaged ${avg} ms per request. ${team.localBcrypt.note}`,
    );
  }
  if (report.mail?.count) {
    notes.push(
      `Observed: the API process recorded ${report.mail.count} stress-sink credential emails with average ${report.mail.averageMs} ms spent building the message. Real SMTP was not used for those calls.`,
    );
  } else {
    notes.push(
      "Email timings were not recorded by the API process. Team-create latency includes whatever mail path that server used. Start the API with NODE_ENV=stress and STRESS_TEST=true so credential mail uses the in-process sink.",
    );
  }
  const lists = collectStages(report).filter((stage) =>
    ["product-list", "team-list", "customer-list", "finance-accounts", "finance-expenses", "reports-products", "reports-stock"].includes(stage.test),
  );
  for (const stage of lists) {
    if (stage.latency.p95Ms >= 1000) {
      notes.push(
        `Observed: ${stage.endpoint} p95 was ${stage.latency.p95Ms} ms at concurrency ${stage.concurrency}, rows returned ${stage.rowsReturned}. Possible cause: the handler loads the full collection for the business in one response. Suggested investigation: add pagination and review the staff aggregate queries.`,
      );
    }
  }
  if (!notes.length) {
    notes.push("No latency pattern in this run was large enough to call out beyond the stage tables.");
  }
  return notes;
}

function markdown(report) {
  const sections = [];
  sections.push(`# Almadel API stress report ${report.id}`);
  sections.push("## Executive Summary");
  sections.push(executiveSummary(report).map((line) => `- ${line}`).join("\n"));
  sections.push("## What this report tested");
  sections.push(
    [
      "This run sent real HTTP requests to the Almadel stress API.",
      "Business creation used owner sign-up plus `POST /business/setup`.",
      "Team creation used `POST /admin/staff` for staff and accountant roles on one business.",
      "Product and stock suites used the live product and inventory endpoints.",
      "Customers / Khata used `POST /customers` plus list and history reads.",
      "Cash / Accounts used `POST /finance/expenses` and `POST /finance/transactions`, plus accounts/expenses/payments/summary reads.",
      "Reports & Balance Sheet used read-only probes of `/reports/sales|products|stock` and `/finance/reports/summary`.",
      "Mixed traffic combined reads and writes to approximate normal usage.",
      "Concurrency was ramped in stages. If a stage became unhealthy, later stages for that suite were skipped.",
    ].map((line) => `- ${line}`).join("\n"),
  );
  sections.push("## Environment");
  sections.push(
    [
      `- Date: ${report.startedAt}`,
      `- Profile: ${report.profile}`,
      `- Base URL: ${report.baseUrl}`,
      `- Git: ${report.git}`,
      `- Node: ${report.app?.node}`,
      `- Host: ${report.app?.host} (${report.app?.platform})`,
      `- CPUs: ${report.app?.cpuCount}`,
      `- Memory free / total MB: ${report.app?.freeMemoryMb} / ${report.app?.totalMemoryMb}`,
      `- PostgreSQL: ${report.database?.version || "unavailable"}`,
      `- Database connections (active/idle/total): ${report.database?.activity?.active ?? "-"} / ${report.database?.activity?.idle ?? "-"} / ${report.database?.activity?.total ?? "-"}`,
      `- Cache hit ratio: ${report.database?.database?.cacheHitRatio ?? "-"}`,
      `- Deadlocks counter: ${report.database?.database?.deadlocks ?? "-"}`,
    ].join("\n"),
  );
  if (report.app?.pm2) {
    sections.push(`- PM2: ${report.app.pm2.map((item) => `${item.name} ${item.status} restarts ${item.restarts} cpu ${item.cpu} mem ${item.memoryMb}mb`).join("; ")}`);
  }
  sections.push("## Dataset");
  sections.push(Object.entries(report.dataset || {}).map(([key, value]) => `- ${key}: ${value}`).join("\n") || "- No dataset counts collected.");
  sections.push("## Business API Results");
  sections.push(report.suites.business?.stages?.length ? stageTable(report.suites.business.stages) : "Not run.");
  if (report.suites.business?.stages?.[0]?.parts) {
    sections.push("Average time inside the business flow is split below. Signup includes password hashing. Setup is the business transaction.");
    sections.push(report.suites.business.stages.map((stage) => `- Stage ${stage.stage}: signup ${stage.parts?.signupAvgMs} ms, setup ${stage.parts?.setupAvgMs} ms`).join("\n"));
  }
  sections.push("## Team-Member API Results");
  sections.push(report.suites.team?.stages?.length ? stageTable(report.suites.team.stages) : "Not run.");
  for (const stage of report.suites.team?.stages || []) {
    if (!stage.byRole) continue;
    sections.push(`### Stage ${stage.stage} by role`);
    sections.push(stageTable([
      { ...stage.byRole.staff, stage: "staff", concurrency: stage.concurrency, grade: "" },
      { ...stage.byRole.accountant, stage: "accountant", concurrency: stage.concurrency, grade: "" },
    ]));
  }
  sections.push("## Product API Results");
  const productStages = [
    ...(report.suites.products?.stages || []),
    ...(report.suites.reads?.stages || []).filter((stage) => String(stage.test).startsWith("product")),
  ];
  sections.push(productStages.length ? stageTable(productStages) : "Not run.");
  sections.push("## Stock API Results");
  sections.push(report.suites.stock?.stages?.length ? stageTable(report.suites.stock.stages) : "Not run.");
  sections.push("## Customers / Khata API Results");
  sections.push(report.suites.customers?.stages?.length ? stageTable(report.suites.customers.stages) : "Not run.");
  sections.push("## Cash / Accounts API Results");
  sections.push(report.suites.finance?.stages?.length ? stageTable(report.suites.finance.stages) : "Not run.");
  sections.push("## Reports & Balance Sheet API Results");
  sections.push(report.suites.reports?.stages?.length ? stageTable(report.suites.reports.stages) : "Not run.");
  sections.push("## Inventory Correctness");
  if (!report.integrity?.length) {
    sections.push("No inventory correctness checks were recorded in this run.");
  } else {
    sections.push("| Test | Initial | Successful | Failed | Expected | Actual | Result |");
    sections.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const row of report.integrity) {
      sections.push(`| ${row.test} | ${row.initial} | ${row.successful ?? ""} | ${row.failed ?? ""} | ${row.expected} | ${row.actual} | ${row.result} |`);
      if (row.result !== "PASS") {
        sections.push("");
        sections.push("DATA INTEGRITY FAILURE");
        sections.push(row.example ? `Example: ${JSON.stringify(row.example)}` : "Actual stock did not match the count of successful stock changes.");
      }
    }
  }
  sections.push("## Large Dataset Performance");
  const reads = report.suites.reads?.stages || [];
  sections.push(reads.length ? stageTable(reads) : "Not run. Seed a dataset, then run `npm run stress:reads` with STRESS_READ_TARGET=seed.");
  if (report.suites.reads?.notes) {
    sections.push(report.suites.reads.notes.map((note) => `- ${note}`).join("\n"));
  }
  sections.push("## Mixed Workload");
  sections.push(report.suites.mixed?.stages?.length ? stageTable(report.suites.mixed.stages) : "Not run.");
  sections.push("## Error Analysis");
  const groups = {};
  for (const stage of collectStages(report)) {
    for (const [key, value] of Object.entries(stage.errorGroups || {})) {
      if (!groups[key]) groups[key] = { count: 0, example: value.example };
      groups[key].count += value.count;
    }
  }
  if (!Object.keys(groups).length) sections.push("No failed requests were recorded.");
  else {
    sections.push("| Class | Count | Example |");
    sections.push("| --- | ---: | --- |");
    for (const [key, value] of Object.entries(groups)) {
      sections.push(`| ${key} | ${value.count} | ${String(value.example).replaceAll("|", "/")} |`);
    }
  }
  sections.push("## Bottlenecks");
  sections.push(bottleneckNotes(report).map((line) => `- ${line}`).join("\n"));
  sections.push("## Stop Conditions");
  if (!report.stops?.length) sections.push("No ramp was stopped early.");
  else sections.push(report.stops.map((stop) => `- ${stop.at} ${stop.test} stage ${stop.stage} concurrency ${stop.concurrency} error ${pct(stop.errorRate)} p95 ${stop.p95Ms} ms. ${stop.reason}`).join("\n"));
  sections.push("## Thresholds");
  sections.push("- PASS: error rate under 1% and p95 under 1 second, with no integrity failure.");
  sections.push("- WARNING: error rate from 1% to 5%, or p95 from 1 to 3 seconds.");
  sections.push("- FAIL: error rate above 5%, p95 above 3 seconds, or a data-integrity failure.");
  sections.push("## Recommendations");
  sections.push("These are follow-ups from the measurements above. They were not applied.");
  sections.push(bottleneckNotes(report).map((line) => `- ${line}`).join("\n"));
  return sections.join("\n\n") + "\n";
}

function dbMarkdown(report) {
  const db = report.suites?.database || {};
  const sections = [];
  sections.push(`# Almadel database stress report ${report.id}`);
  sections.push("## Executive Summary");
  sections.push(`- Scenario: ${db.scenario || "DATABASE VOLUME + ACID"}`);
  sections.push(`- ACID checks: ${db.summary?.acidPass ?? 0}/${db.summary?.acidTotal ?? 0} PASS`);
  if (db.summary?.acidFail) sections.push(`- ACID failures: ${db.summary.acidFail}`);
  sections.push(`- Query benchmark warnings/fails: ${db.summary?.queryWarnings ?? 0}`);
  sections.push("- This report uses direct database access against almadel_stress. It is not an API concurrency report.");

  sections.push("## Environment");
  sections.push(
    [
      `- Date: ${report.startedAt}`,
      `- Profile: ${report.profile}`,
      `- Git: ${report.git}`,
      `- Node: ${report.app?.node}`,
      `- Host: ${report.app?.host}`,
      `- PostgreSQL: ${report.database?.version || "unavailable"}`,
      `- Connections active/idle/total: ${report.database?.activity?.active ?? "-"} / ${report.database?.activity?.idle ?? "-"} / ${report.database?.activity?.total ?? "-"}`,
      `- Cache hit ratio: ${report.database?.database?.cacheHitRatio ?? "-"}`,
      `- Deadlocks: ${report.database?.database?.deadlocks ?? "-"}`,
    ].join("\n"),
  );

  sections.push("## Dataset");
  sections.push(Object.entries(report.dataset || {}).map(([key, value]) => `- ${key}: ${value}`).join("\n"));

  sections.push("## ACID Results");
  if (!db.acid?.length) sections.push("No ACID tests recorded.");
  else {
    sections.push("| Principle | Test | Expected | Actual | Result |");
    sections.push("| --- | --- | --- | --- | --- |");
    for (const row of db.acid) {
      sections.push(
        `| ${row.principle} | ${row.test} | ${String(row.expected).replaceAll("|", "/")} | ${String(row.actual).replaceAll("|", "/")} | ${row.result} |`,
      );
    }
  }

  sections.push("## Inventory Correctness");
  if (!report.integrity?.length) sections.push("No inventory checks recorded.");
  else {
    sections.push("| Test | Initial | Successful | Failed | Expected | Actual | Result |");
    sections.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const row of report.integrity) {
      sections.push(`| ${row.test} | ${row.initial} | ${row.successful ?? ""} | ${row.failed ?? ""} | ${row.expected} | ${row.actual} | ${row.result} |`);
      if (row.result !== "PASS") {
        sections.push("");
        sections.push("DATA INTEGRITY FAILURE");
      }
    }
  }

  sections.push("## Query Benchmarks (10k tenant)");
  if (!db.queryBenchmarks?.length) sections.push("No benchmarks recorded.");
  else {
    sections.push("| Query | Avg | Median | P95 | Max | Rows | Grade |");
    sections.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const row of db.queryBenchmarks) {
      sections.push(`| ${row.test} | ${row.averageMs} | ${row.medianMs} | ${row.p95Ms} | ${row.maxMs} | ${row.rows ?? ""} | ${row.grade} |`);
    }
  }

  sections.push("## Concurrent DB Reads");
  sections.push(db.concurrentReads?.length ? stageTable(db.concurrentReads) : "Not run.");

  sections.push("## Table and Index Stats");
  if (db.stats?.tables?.length) {
    sections.push("| Table | Total bytes | Table bytes | Index bytes | Live rows | Seq scans | Index scans |");
    sections.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const row of db.stats.tables.slice(0, 15)) {
      sections.push(
        `| ${row.table_name} | ${row.total_bytes} | ${row.table_bytes} | ${row.index_bytes} | ${row.live_rows} | ${row.seq_scans} | ${row.index_scans} |`,
      );
    }
  } else {
    sections.push("No table stats collected.");
  }

  sections.push("## Notes");
  sections.push("- Atomicity: a multi-statement transaction that throws must leave no partial stock or stock_log change.");
  sections.push("- Consistency: unique email/barcode constraints and conditional stock updates must reject invalid states.");
  sections.push("- Isolation: concurrent decrements on one row must leave stock equal to initial minus successful updates.");
  sections.push("- Durability: a committed insert must be readable afterward.");
  sections.push("- Query times are Prisma/SQL timings against the seeded volume. API path overhead is measured separately.");

  return `${sections.join("\n\n")}\n`;
}

function writeDbReport(dir, report) {
  fs.mkdirSync(dir, { recursive: true });
  const md = dbMarkdown(report);
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "report.md"), md);
  fs.writeFileSync(
    path.join(dir, "report.html"),
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(report.id)}</title>
<style>body{font-family:Georgia,serif;max-width:980px;margin:32px auto;line-height:1.45}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d9e2ec;padding:6px 8px}th{background:#f0f4f8}</style>
</head><body><pre style="white-space:pre-wrap;font-family:inherit">${md
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")}</pre></body></html>`,
  );
  fs.writeFileSync(path.join(dir, "database.json"), JSON.stringify(report.suites.database || {}, null, 2));
  if (report.database) {
    fs.writeFileSync(path.join(dir, "database-metrics.json"), JSON.stringify(report.database, null, 2));
  }
}

function html(report) {
  const body = markdown(report)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n\n/g, "<br><br>\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(report.id)}</title>
<style>body{font-family:Georgia,serif;max-width:980px;margin:32px auto;color:#1f2933;line-height:1.45}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #d9e2ec;padding:6px 8px;text-align:left}th{background:#f0f4f8}</style>
</head><body>${body}<h2>Stage tables</h2>${Object.entries(report.suites).map(([name, suite]) => suite.stages?.length ? `<h3>${escapeHtml(name)}</h3>${htmlTable(suite.stages)}` : "").join("")}</body></html>`;
}

function writeReport(dir, report) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "report.md"), markdown(report));
  fs.writeFileSync(path.join(dir, "report.html"), html(report));
  fs.writeFileSync(path.join(dir, "errors.json"), JSON.stringify(collectStages(report).map((stage) => ({
    test: stage.test,
    stage: stage.stage || stage.endpoint,
    errorGroups: stage.errorGroups,
  })), null, 2));
  for (const [name, suite] of Object.entries(report.suites)) {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(suite, null, 2));
  }
  if (report.database) {
    fs.writeFileSync(path.join(dir, "database-metrics.json"), JSON.stringify(report.database, null, 2));
  }
}

function loadMailTimings(root, startedAt) {
  const file = path.join(root, "stress", "runtime", "mail-timings.jsonl");
  if (!fs.existsSync(file)) return { count: 0, averageMs: 0 };
  const start = new Date(startedAt).getTime();
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter((row) => row && new Date(row.at).getTime() >= start);
  const sum = rows.reduce((total, row) => total + Number(row.ms || 0), 0);
  return { count: rows.length, averageMs: rows.length ? Math.round(sum / rows.length) : 0 };
}

module.exports = { loadMailTimings, writeReport, writeDbReport };
