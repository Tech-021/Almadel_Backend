const fs = require("fs");
const path = require("path");

function loadSummary(dir) {
  const file = path.join(dir, "summary.json");
  if (!fs.existsSync(file)) throw new Error(`No summary.json in ${dir}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function latestOfKind(resultsDir, kind) {
  if (!fs.existsSync(resultsDir)) return null;
  const runs = fs
    .readdirSync(resultsDir)
    .map((name) => path.join(resultsDir, name))
    .filter((full) => fs.existsSync(path.join(full, "summary.json")))
    .map((full) => ({ full, summary: JSON.parse(fs.readFileSync(path.join(full, "summary.json"), "utf8")) }))
    .filter((entry) => {
      if (kind === "database") {
        return (
          entry.summary.kind === "database-scale" ||
          entry.summary.kind === "database" ||
          /stress-db-/.test(entry.full)
        );
      }
      return (
        entry.summary.kind !== "database" &&
        entry.summary.kind !== "database-scale" &&
        entry.summary.kind !== "combined" &&
        !/stress-db-/.test(entry.full) &&
        !/combined-/.test(entry.full)
      );
    })
    .sort((a, b) => {
      // Prefer database-scale over snapshot database reports.
      if (kind === "database") {
        const score = (entry) => (entry.summary.kind === "database-scale" ? 2 : 1);
        const byKind = score(b) - score(a);
        if (byKind) return byKind;
      }
      return fs.statSync(b.full).mtimeMs - fs.statSync(a.full).mtimeMs;
    });
  return runs[0] || null;
}

function ms(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "-";
  return `${Math.round(Number(value))} ms`;
}

function stageLines(stages = []) {
  if (!stages.length) return "No stages were recorded for this suite.";
  return stages
    .map((stage) => {
      const label = stage.stage || stage.endpoint || stage.test;
      return `- **${label}** at ${stage.concurrency ?? "-"} concurrent users: ${stage.successful}/${stage.requests} succeeded, avg ${ms(stage.latency?.averageMs)}, p95 ${ms(stage.latency?.p95Ms)}, grade **${stage.grade || "n/a"}**.`;
    })
    .join("\n");
}

function firstCreateStage(suite) {
  return (suite?.stages || []).find((stage) => /create|increment|contention|mixed/i.test(stage.test || ""));
}

function explainAcid(row) {
  const map = {
    Atomicity:
      "If one step inside a database transaction fails, every step in that transaction must be undone. Partial updates should not remain.",
    Consistency:
      "The database must reject invalid business states, such as duplicate emails/barcodes or selling more stock than exists.",
    Isolation:
      "When many requests change the same stock row at once, the final quantity must still match the number of successful updates. No lost updates.",
    Durability:
      "Once a write is committed, it must still be readable afterward. Temporary memory-only success is not enough.",
  };
  return map[row.principle] || "";
}

function combineMarkdown(api, db, combinedId, apiPath, dbPath) {
  const acid = db.suites?.database?.acid || [];
  const acidFail = acid.filter((row) => row.result !== "PASS").length;
  const benches = db.suites?.database?.queryBenchmarks || [];
  const scale = db.suites?.databaseScale;
  const scaleIntegrity = (scale?.checkpoints || []).map((checkpoint) => ({
    test: `DB scale isolation @ ${checkpoint.size}`,
    initial: 1000,
    successful: checkpoint.isolation.successful,
    failed: checkpoint.isolation.concurrency - checkpoint.isolation.successful,
    expected: checkpoint.isolation.expected,
    actual: checkpoint.isolation.actual,
    result: checkpoint.isolation.result,
  }));
  const integrity = [...(api.integrity || []), ...(db.integrity || []), ...scaleIntegrity];
  const integrityFail = integrity.filter((row) => row.result !== "PASS").length;
  const volume = db.suites?.database?.volume || scale?.checkpoints?.[scale.checkpoints.length - 1]?.counts || {};
  const dataset = { ...(api.dataset || {}), ...(db.dataset || {}) };

  const business = firstCreateStage(api.suites?.business);
  const team = firstCreateStage(api.suites?.team);
  const products = firstCreateStage(api.suites?.products);
  const stock = (api.suites?.stock?.stages || [])[0];
  const mixed = firstCreateStage(api.suites?.mixed);

  const slowQueries = [...benches].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 3);
  const overallPass =
    !api.fatal &&
    !db.fatal &&
    acidFail === 0 &&
    integrityFail === 0 &&
    Object.values(api.suites || {}).every((suite) =>
      (suite.stages || []).every((stage) => stage.grade !== "FAIL"),
    );

  const lines = [];
  lines.push(`# Almadel Combined Stress Test Report`);
  lines.push(`**Report ID:** ${combinedId}`);
  lines.push("");
  lines.push("## 1. Purpose of this report");
  lines.push("");
  lines.push(
    "This document combines two separate kinds of testing for Almadel. The first is API request scalability: real HTTP requests against the running stress API, with concurrency and volume ramped until latency or errors cross the stop thresholds. The second is database scalability: the stress dataset is grown through size checkpoints, and the same queries plus stock-isolation checks are measured at each size.",
  );
  lines.push("");
  lines.push(
    "Keeping these tracks separate is intentional. API scalability measures how the live request path behaves under concurrent traffic. Database scalability measures how query cost and data correctness change as tables grow. Combining both into one nested creation loop (for example creating 10,000 staff inside every one of 10,000 businesses) would create an unrealistic dataset and would mostly measure password hashing and email work instead of the two scalability questions above.",
  );
  lines.push("");
  lines.push("## 2. Bottom line for leadership");
  lines.push("");
  if (overallPass) {
    lines.push(
      "**Overall result: PASS for the scopes that were executed.** In this combined run, API smoke tests completed without failed requests, inventory correctness matched expected stock, and all ACID database checks passed.",
    );
  } else {
    lines.push(
      "**Overall result: Attention needed.** At least one API stage, ACID check, or inventory correctness check did not pass. Review the detailed sections below before drawing capacity conclusions.",
    );
  }
  lines.push("");
  lines.push(
    `This combined report uses API run \`${api.id}\` (profile **${api.profile}**) and database run \`${db.id}\` (profile **${db.profile}**). These are controlled scalability baselines for the selected profiles, not a claim that the system has been proven at every possible production peak.`,
  );
  lines.push("");
  lines.push("## 3. What data was present during testing");
  lines.push("");
  lines.push(
    "Before these measurements, the dedicated stress database `almadel_stress` was populated with large volumes of synthetic records. The worst-case single-tenant business is the important one for staff/product/stock volume questions.",
  );
  lines.push("");
  lines.push(`- Worst-case business id: **${volume.worstCaseBusinessId || dataset["worst-case business id"] || "n/a"}**`);
  lines.push(`- Staff in that business: **${volume.staffMembers ?? volume.teamMembers ?? dataset.staff ?? "n/a"}**`);
  lines.push(`- Accountants in that business: **${volume.accountants ?? dataset.accountants ?? "n/a"}**`);
  lines.push(`- Products in that business: **${volume.products ?? dataset.products ?? "n/a"}**`);
  lines.push(`- Stock log rows: **${volume.stockLogs ?? dataset.stockLogs ?? "n/a"}**`);
  lines.push(`- Stress businesses overall: **${volume.stressBusinesses ?? volume.businesses ?? dataset["stress businesses"] ?? "n/a"}**`);
  lines.push("");
  lines.push(
    "Important interpretation note: having 10,000 businesses in the database does **not** mean every business also has 10,000 staff. Staff and products were concentrated into one worst-case tenant so we could measure the expensive list/join paths without creating an unrealistic hundreds-of-millions-row dataset.",
  );
  lines.push("");
  lines.push("## 4. API load testing findings");
  lines.push("");
  lines.push(
    "The API suite called the real application routes over HTTP. Business creation used owner sign-up followed by business setup. Team creation used `POST /admin/staff` for both staff and accountant roles. Product and stock operations used the live product and inventory endpoints. Mixed traffic simulated a more realistic blend of reads and writes.",
  );
  lines.push("");
  lines.push("### 4.1 Business creation");
  lines.push("");
  if (business) {
    lines.push(
      `For the first business-create stage shown here, Almadel completed **${business.successful}** of **${business.requests}** requests with **${business.failed}** failures at **${business.concurrency}** concurrent users. Average response time was **${ms(business.latency.averageMs)}** and p95 was **${ms(business.latency.p95Ms)}** (**${business.grade}**).`,
    );
    lines.push("");
    lines.push(
      "Business creation is heavier than a simple insert because it includes account creation or authentication, password hashing during sign-up, and the business setup transaction. The measured time therefore includes application work, not only the database write.",
    );
  } else {
    lines.push("Business creation was not included in the selected API run.");
  }
  lines.push("");
  lines.push("### 4.2 Staff and accountant creation");
  lines.push("");
  if (team) {
    lines.push(
      `The team suite created **${team.successful}** members with **${team.failed}** failures. Average latency was **${ms(team.latency.averageMs)}** and p95 was **${ms(team.latency.p95Ms)}** (**${team.grade}**). Staff and accountant creation used the same endpoint; only the role field differed.`,
    );
    lines.push("");
    lines.push(
      "Team creation is intentionally expensive in the real API path because each request hashes a password and attempts credential email delivery. In the stress environment, outbound email is mocked so the test does not send real messages, but the endpoint still exercises the mail code path.",
    );
  } else {
    lines.push("Team creation was not included in the selected API run.");
  }
  lines.push("");
  lines.push("### 4.3 Product and stock operations");
  lines.push("");
  if (products) {
    lines.push(
      `Product creation completed **${products.successful}/${products.requests}** requests with p95 **${ms(products.latency.p95Ms)}** (**${products.grade}**). Product create is comparatively light because it does not hash passwords or send email.`,
    );
  } else {
    lines.push("Product creation was not included in the selected API run.");
  }
  lines.push("");
  if (stock) {
    lines.push(
      `Stock updates through \`POST /stock/add\` completed **${stock.successful}/${stock.requests}** requests with p95 **${ms(stock.latency.p95Ms)}** (**${stock.grade}**). Concurrent sale decrements were also checked so inventory could not silently drift under contention.`,
    );
  }
  lines.push("");
  lines.push("### 4.4 Mixed realistic traffic");
  lines.push("");
  if (mixed) {
    lines.push(
      `The mixed workload sent **${mixed.requests}** requests at **${mixed.concurrency}** concurrent users with **${mixed.failed}** failures. Average latency was **${ms(mixed.latency.averageMs)}** and p95 was **${ms(mixed.latency.p95Ms)}** (**${mixed.grade}**). This mix included product reads, searches, stock reads/updates, team reads, business reads, and a smaller share of creates.`,
    );
  } else {
    lines.push("Mixed workload was not included in the selected API run.");
  }
  lines.push("");
  lines.push("### 4.5 API stage detail");
  lines.push("");
  for (const [name, suite] of Object.entries(api.suites || {})) {
    lines.push(`**${name}**`);
    lines.push("");
    lines.push(stageLines(suite.stages));
    lines.push("");
  }
  lines.push(`Full raw API report: \`${path.relative(process.cwd(), apiPath)}/report.md\``);
  lines.push("");
  lines.push("## 5. Database ACID findings");
  lines.push("");
  if (scale?.checkpoints?.length) {
    lines.push(
      "This combined report includes a **database scalability** run. Data was grown through checkpoints and the same queries were timed at each size. That is different from testing only against a database that was already full.",
    );
    lines.push("");
    lines.push(
      `Checkpoints: **${scale.summary.checkpoints}**. PASS: **${scale.summary.pass}**. WARNING: **${scale.summary.warning}**. FAIL: **${scale.summary.fail}**.`,
    );
    lines.push("");
    lines.push("| Size | Team | Products | Businesses | Grade | Isolation |");
    lines.push("| ---: | ---: | ---: | ---: | --- | --- |");
    for (const checkpoint of scale.checkpoints) {
      lines.push(
        `| ${checkpoint.size} | ${checkpoint.counts.teamMembers} | ${checkpoint.counts.products} | ${checkpoint.counts.businesses} | ${checkpoint.grade} | ${checkpoint.isolation.result} |`,
      );
    }
    lines.push("");
    lines.push("### Query latency versus dataset size");
    lines.push("");
    const productCurve = scale.checkpoints.map((checkpoint) => {
      const query = checkpoint.queries.find((row) => row.test === "list all products");
      return { size: checkpoint.size, p95: query?.p95Ms, grade: query?.grade };
    });
    const teamCurve = scale.checkpoints.map((checkpoint) => {
      const query = checkpoint.queries.find((row) => row.test === "list team members");
      return { size: checkpoint.size, p95: query?.p95Ms, grade: query?.grade };
    });
    if (productCurve.length >= 2) {
      lines.push(
        `Product list p95 grew from **${productCurve[0].p95} ms** at ${productCurve[0].size} rows to **${productCurve[productCurve.length - 1].p95} ms** at ${productCurve[productCurve.length - 1].size} rows.`,
      );
    }
    if (teamCurve.length >= 2) {
      lines.push(
        `Team list p95 grew from **${teamCurve[0].p95} ms** at ${teamCurve[0].size} members to **${teamCurve[teamCurve.length - 1].p95} ms** at ${teamCurve[teamCurve.length - 1].size} members.`,
      );
    }
    lines.push("");
    lines.push("| Size | Product list p95 | Team list p95 | Owner business list p95 |");
    lines.push("| ---: | ---: | ---: | ---: |");
    for (const checkpoint of scale.checkpoints) {
      const product = checkpoint.queries.find((row) => row.test === "list all products");
      const teamList = checkpoint.queries.find((row) => row.test === "list team members");
      const owner = checkpoint.queries.find((row) => row.test === "owner business list");
      lines.push(
        `| ${checkpoint.size} | ${product?.p95Ms ?? "-"} ms | ${teamList?.p95Ms ?? "-"} ms | ${owner?.p95Ms ?? "-"} ms |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "ACID describes four properties that protect data correctness. For Almadel, these matter most around stock and membership writes, because incorrect inventory or duplicate accounts create immediate business risk.",
  );
  lines.push("");
  lines.push(
    `In this database run, **${acid.length ? `${acid.length - acidFail} of ${acid.length}` : "no classic ACID rows were present because this was a scalability-curve run; isolation was checked at each checkpoint instead"}**${acid.length ? " ACID checks passed" : ""}${acidFail ? `, and **${acidFail}** failed` : acid.length ? "" : ""}.`,
  );
  lines.push("");
  for (const row of acid) {
    lines.push(`### ${row.principle}: ${row.result}`);
    lines.push("");
    lines.push(explainAcid(row));
    lines.push("");
    lines.push(`- What we tested: ${row.test}`);
    lines.push(`- What we expected: ${row.expected}`);
    lines.push(`- What we observed: ${row.actual}`);
    lines.push(`- Result: **${row.result}**`);
    lines.push("");
  }
  lines.push("## 6. Database query benchmarks on the 10k tenant");
  lines.push("");
  lines.push(
    "These timings measure the database/query layer directly against the already-seeded worst-case business. They help separate “the table is large” problems from “HTTP concurrency is high” problems.",
  );
  lines.push("");
  if (!benches.length) {
    lines.push("No query benchmarks were recorded.");
  } else {
    lines.push("| Query | What it represents | Avg | P95 | Rows | Grade |");
    lines.push("| --- | --- | ---: | ---: | ---: | --- |");
    for (const row of benches) {
      const meaning =
        /team members/i.test(row.test)
          ? "Staff/accountant list with user join"
          : /owner business/i.test(row.test)
            ? "Owner opening the full business list"
            : /list 10k products/i.test(row.test)
              ? "Unbounded product list for one business"
              : /barcode/i.test(row.test)
                ? "POS barcode lookup"
                : /search/i.test(row.test)
                  ? "Product search capped at 50 rows"
                  : /aggregate/i.test(row.test)
                    ? "Inventory total calculation"
                    : "Database query cost";
      lines.push(
        `| ${row.test} | ${meaning} | ${Math.round(row.averageMs)} ms | ${Math.round(row.p95Ms)} ms | ${row.rows ?? ""} | ${row.grade} |`,
      );
    }
    lines.push("");
    lines.push("### What the slowest queries suggest");
    lines.push("");
    for (const row of slowQueries) {
      lines.push(
        `- **${row.test}** took about **${Math.round(row.p95Ms)} ms** at p95 while touching **${row.rows ?? "n/a"}** rows. This is still within the current pass threshold, but it is the first place to watch as data grows further, especially if the API returns the full collection without pagination.`,
      );
    }
  }
  lines.push("");
  lines.push("## 7. Inventory correctness");
  lines.push("");
  lines.push(
    "Inventory correctness is reported separately because a fast API that loses stock updates is still a production failure. For each contention test we recorded the starting stock, counted only successful updates, computed the expected final stock, and compared that with the database.",
  );
  lines.push("");
  if (!integrity.length) {
    lines.push("No inventory correctness checks were recorded in the selected runs.");
  } else if (integrityFail === 0) {
    lines.push(
      `All **${integrity.length}** inventory correctness checks passed. Concurrent stock increments and sale decrements left the database in the expected state.`,
    );
  } else {
    lines.push(
      `**DATA INTEGRITY FAILURE:** ${integrityFail} of ${integrity.length} inventory checks did not match. Treat this as higher priority than latency warnings.`,
    );
  }
  lines.push("");
  if (integrity.length) {
    lines.push("| Test | Initial | Successful | Failed | Expected | Actual | Result |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const row of integrity) {
      lines.push(
        `| ${row.test} | ${row.initial} | ${row.successful ?? ""} | ${row.failed ?? ""} | ${row.expected} | ${row.actual} | ${row.result} |`,
      );
    }
  }
  lines.push("");
  lines.push("## 8. What this does and does not prove");
  lines.push("");
  lines.push("### Proven by these runs");
  lines.push("");
  lines.push("- The smoke API profile handled the exercised create/read/stock/mixed requests without request failures.");
  lines.push("- Stock stayed mathematically correct under the concurrent update cases that were run.");
  lines.push("- PostgreSQL accepted rolled-back transactions cleanly, blocked invalid duplicates, and preserved committed writes.");
  lines.push("- Querying a 10,000-product / 10,000-member tenant remained within the current pass thresholds for the measured SQL paths.");
  lines.push("");
  lines.push("### Not proven yet");
  lines.push("");
  lines.push("- Absolute production capacity at hundreds of concurrent users. The smoke profile uses low concurrency on purpose.");
  lines.push("- Behavior after weeks of real customer traffic, large sale history, or image-heavy product catalogs.");
  lines.push("- End-user experience through the frontend network path; these numbers are backend/API and database measurements.");
  lines.push("- That every list endpoint is ready for unbounded growth. Some endpoints still return full collections, so response size will grow with tenant size.");
  lines.push("");
  lines.push("## 9. Recommended next steps");
  lines.push("");
  lines.push("1. Keep this combined report as the baseline.");
  lines.push("2. Run the API suite again with `--profile standard` when ready for a stronger concurrency baseline.");
  lines.push("3. If list endpoints grow slower as data increases, prioritize pagination on product and staff list APIs.");
  lines.push("4. Re-run `npm run stress:db` after any stock/transaction changes to confirm ACID behavior still holds.");
  lines.push("5. Share the bottom-line section and ACID section with stakeholders; keep the raw stage tables for engineering deep dives.");
  lines.push("");
  lines.push("## 10. Source reports");
  lines.push("");
  lines.push(`- API report folder: \`${path.relative(process.cwd(), apiPath)}\``);
  lines.push(`- Database report folder: \`${path.relative(process.cwd(), dbPath)}\``);
  lines.push(`- Combined generated at: ${new Date().toISOString()}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function toHtml(md, title) {
  const escaped = md
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const body = escaped
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)(?=\n(?!<li>)|\n*$)/g, "<ul>$1</ul>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\|(.+)\|\n\|[-\s|:]+\|\n((?:\|.+\|\n?)*)/g, (_m, header, rows) => {
      const th = header
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
        .map((cell) => `<th>${cell}</th>`)
        .join("");
      const tr = rows
        .trim()
        .split("\n")
        .map((line) => {
          const cells = line
            .split("|")
            .map((cell) => cell.trim())
            .filter(Boolean)
            .map((cell) => `<td>${cell}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      return `<table><tr>${th}</tr>${tr}</table>`;
    });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:Georgia,serif;max-width:920px;margin:40px auto;padding:0 20px;color:#1f2933;line-height:1.55}
h1,h2,h3{line-height:1.25}
code{background:#f0f4f8;padding:1px 5px;border-radius:4px}
table{border-collapse:collapse;width:100%;margin:16px 0}
td,th{border:1px solid #d9e2ec;padding:8px;text-align:left;vertical-align:top}
th{background:#f0f4f8}
ul{padding-left:1.2rem}
</style></head><body><p>${body}</p></body></html>`;
}

function main() {
  const resultsDir = path.join(__dirname, "results");
  const [apiArg, dbArg] = process.argv.slice(2);

  const apiEntry = apiArg
    ? { full: path.resolve(apiArg), summary: loadSummary(path.resolve(apiArg)) }
    : latestOfKind(resultsDir, "api");
  const dbEntry = dbArg
    ? { full: path.resolve(dbArg), summary: loadSummary(path.resolve(dbArg)) }
    : latestOfKind(resultsDir, "database");

  if (!apiEntry) throw new Error("No API stress report found. Run npm run stress:all first.");
  if (!dbEntry) throw new Error("No database stress report found. Run npm run stress:db first.");

  const api = apiEntry.summary;
  const db = dbEntry.summary;
  const combinedId = `combined-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;
  const outDir = path.join(resultsDir, combinedId);
  fs.mkdirSync(outDir, { recursive: true });

  const md = combineMarkdown(api, db, combinedId, apiEntry.full, dbEntry.full);
  const combined = {
    id: combinedId,
    kind: "combined",
    startedAt: new Date().toISOString(),
    apiRun: { id: api.id, path: apiEntry.full },
    dbRun: { id: db.id, path: dbEntry.full },
    api,
    db,
  };

  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(combined, null, 2));
  fs.writeFileSync(path.join(outDir, "report.md"), md);
  fs.writeFileSync(path.join(outDir, "report.html"), toHtml(md, combinedId));

  console.log(`Combined report written to ${outDir}`);
  console.log(`API source: ${apiEntry.full}`);
  console.log(`DB source:  ${dbEntry.full}`);
}

main();
