const fs = require("fs");
const path = require("path");

const { ROOT } = require("./lib/config");
const { writeReport } = require("./lib/report");

const resultsDir = path.join(ROOT, "stress", "results");
const requested = process.argv[2];
const target = requested
  ? path.resolve(requested)
  : latestRun(resultsDir);

if (!target) {
  console.log("No stress results yet. Reports are written at the end of npm run stress:all.");
  process.exit(0);
}

const summary = JSON.parse(fs.readFileSync(path.join(target, "summary.json"), "utf8"));
writeReport(target, summary);
console.log(`Regenerated report in ${target}`);

function latestRun(dir) {
  if (!fs.existsSync(dir)) return null;
  const runs = fs.readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((full) => fs.existsSync(path.join(full, "summary.json")))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return runs[0] || null;
}
