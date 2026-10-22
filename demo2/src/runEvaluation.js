import fs from "node:fs";
import path from "node:path";
import { PREPARED_DIR, loadDailyReportPool, processQueue } from "./pipeline.js";

const rfisPath = process.argv[2] ?? path.join(PREPARED_DIR, "rfis.json");

function statusOf(record) {
  if (record.status === "invalid") return "INVALID";
  if (record.status === "error") return "ERROR";
  if (record.evaluation.status === "no_answer_key") return "NO KEY";
  return record.evaluation.passed ? "PASS" : "FAIL";
}

const list = (values = []) => (values.length ? values.join(", ") : "—");

function printRow(record) {
  const evaluation = record.evaluation ?? {};
  console.log(
    record.key.padEnd(16) +
      statusOf(record).padEnd(10) +
      (record.triage_result?.approval_status ?? "—").padEnd(20) +
      list(evaluation.caught).padEnd(22) +
      list(evaluation.missed).padEnd(22) +
      list(evaluation.false_flags).padEnd(22) +
      (evaluation.gate_violation ? "YES" : "—")
  );
  if (record.status === "invalid") {
    for (const error of record.validation.errors) {
      console.error(`  ↳ ${error.code} ${error.field}: ${error.message}`);
    }
  }
  if (record.error) console.error(`  ↳ ${record.error}`);
}

async function main() {
  const rfis = JSON.parse(fs.readFileSync(rfisPath, "utf8"));
  if (!Array.isArray(rfis)) throw new Error(`${rfisPath} must contain a JSON array of RFIs`);

  const header =
    "RFI".padEnd(16) + "RESULT".padEnd(10) + "AI STATUS".padEnd(20) +
    "CAUGHT".padEnd(22) + "MISSED".padEnd(22) + "FALSE FLAGS".padEnd(22) + "GATE VIOLATION";
  console.log(header);
  console.log("-".repeat(header.length));

  const records = await processQueue(rfis, { dailyReportPool: loadDailyReportPool() }, printRow);

  const count = (predicate) => records.filter(predicate).length;
  console.log("\nSummary");
  console.log("-------");
  console.log(`RFIs processed:      ${records.length}`);
  console.log(`Passed:              ${count((r) => r.evaluation?.passed)}`);
  console.log(`With missed issues:  ${count((r) => r.evaluation?.missed?.length)}`);
  console.log(`With false flags:    ${count((r) => r.evaluation?.false_flags?.length)}`);
  console.log(`Gate violations:     ${count((r) => r.evaluation?.gate_violation)}`);
  console.log(`Invalid input:       ${count((r) => r.status === "invalid")}`);
  console.log(`Errors:              ${count((r) => r.status === "error")}`);

  if (records.some((r) => !r.evaluation?.passed)) process.exitCode = 1;
}

main();
