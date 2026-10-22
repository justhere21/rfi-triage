import { serialize } from "./lib/demo2-data.js";
import { prepareTeamCases, validateTeamCases } from "./lib/demo2-team-data.js";

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--check")) {
    throw new Error("Usage: npm run prepare-demo2-team -- [--check]");
  }
  let report;
  if (args.length) {
    const checked = validateTeamCases();
    if (!checked.valid) throw new Error(`Team-case compatibility artifacts are missing or stale; review source changes and rerun preparation:\n${serialize(checked.errors)}`);
    report = checked.report;
  } else report = prepareTeamCases();
  const { source_records, blocked_records, ready_inputs } = report.summary;
  console.log(`${args.length ? "Verified reproducible" : "Prepared"} compatibility artifacts for ${source_records} team source records: ${blocked_records} blocked, ${ready_inputs} ready model inputs.`);
  console.log(`Compatibility report succeeded; import readiness is ${report.import_ready ? "structurally ready" : "blocked"}. No source records were changed, annotations finalized, or models called.${args.length ? " No files written." : ""}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
