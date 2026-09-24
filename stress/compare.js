const fs = require("fs");
const path = require("path");

function loadSummary(dir) {
  const file = path.join(dir, "summary.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No summary.json in ${dir}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stagesOf(report) {
  const rows = [];
  for (const [suite, data] of Object.entries(report.suites || {})) {
    for (const stage of data.stages || []) {
      rows.push({
        key: `${suite}:${stage.test}:${stage.stage || stage.endpoint || stage.concurrency}`,
        label: `${suite} ${stage.test} ${stage.stage || stage.endpoint || ""}`.trim(),
        requestsPerSecond: stage.requestsPerSecond,
        p95: stage.latency?.p95Ms,
        errorRate: stage.errorRate,
      });
    }
  }
  return rows;
}

function percentChange(before, after) {
  if (!before) return "n/a";
  const delta = ((after - before) / before) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

function main() {
  const [leftDir, rightDir] = process.argv.slice(2);
  if (!leftDir || !rightDir) {
    throw new Error("Usage: npm run stress:compare -- stress/results/<run-a> stress/results/<run-b>");
  }

  const left = loadSummary(leftDir);
  const right = loadSummary(rightDir);
  const rightByKey = new Map(stagesOf(right).map((row) => [row.key, row]));
  const lines = [`# Compare ${left.id} -> ${right.id}`, ""];

  for (const before of stagesOf(left)) {
    const after = rightByKey.get(before.key);
    if (!after) continue;
    lines.push(`${before.label} throughput:`);
    lines.push(`${before.requestsPerSecond} req/s -> ${after.requestsPerSecond} req/s`);
    lines.push(percentChange(before.requestsPerSecond, after.requestsPerSecond));
    lines.push("");
    lines.push(`${before.label} p95:`);
    lines.push(`${before.p95} ms -> ${after.p95} ms`);
    lines.push(percentChange(before.p95, after.p95));
    lines.push("");
  }

  const output = lines.join("\n");
  const outFile = path.join(rightDir, "compare.md");
  fs.writeFileSync(outFile, output);
  console.log(output);
  console.log(`Wrote ${outFile}`);
}

main();
