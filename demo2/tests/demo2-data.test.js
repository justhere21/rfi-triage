import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ROOT, SOURCE, OUTPUT, serialize, readJson, buildDemo2Dataset,
  checkDemo2Inputs, checkTriageOutputs, prepareDemo2, validateDemo2
} from "../scripts/lib/demo2-data.js";

const source = () => readJson(path.join(ROOT, SOURCE));
const artifacts = () => buildDemo2Dataset();
function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "demo2-data-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function validOutputs() {
  return artifacts()["rfis.json"].map(({ rfi_id }) => ({
    rfi_id, current_assignee: "General Contractor", approval_status: "Pending Review",
    flagged_conflicts: [], recommended_action: "Fictional structural test output; requires human review."
  }));
}

test("fictional source pairs prepare without inventing missing report evidence or loading labels", () => {
  const files = artifacts();
  assert.equal(files["rfis.json"].length, 5);
  assert.equal(files["daily-reports.json"].length, 4);
  assert.equal(files["model-inputs.json"].length, 5);
  assert.equal(files["manifest.json"].provenance, "synthetic");
  const missing = files["model-inputs.json"].find(({ rfi }) => rfi.linked_daily_report_ids.length === 0);
  assert.ok(missing);
  assert.deepEqual(missing.daily_reports, []);
  assert.ok(files["validation-report.json"].warnings.some(({ code }) => code === "preserved_missing_context"));
  for (const item of files["model-inputs.json"]) {
    assert.deepEqual(Object.keys(item).sort(), ["daily_reports", "rfi"]);
    assert.equal(item.rfi.project_id, "DEMO2-FICTIONAL");
    assert.deepEqual(item.daily_reports.map(({ report_id }) => report_id), item.rfi.linked_daily_report_ids);
  }
  assert.doesNotMatch(serialize(files["model-inputs.json"]), /expected_conflict_types|requires_clarification|rationale|draft_for_team_review/);
});

test("manifest hashes identify the exact source and schema bytes without generated timestamps", () => {
  const files = artifacts();
  assert.equal(files["manifest.json"].source.file, SOURCE);
  for (const entry of [files["manifest.json"].source, ...files["manifest.json"].schemas]) {
    const digest = createHash("sha256").update(fs.readFileSync(path.join(ROOT, entry.file))).digest("hex");
    assert.equal(entry.sha256, digest);
  }
  assert.equal(serialize(files), serialize(artifacts()));
});

test("input schema checks reject blank fields, impossible dates, malformed arrays and leaked answers", () => {
  for (const change of [
    (rfi) => { rfi.description = "  "; },
    (rfi) => { rfi.date_submitted = "2026-02-30"; },
    (rfi) => { rfi.linked_daily_report_ids = "SYN2-REPORT-001"; },
    (rfi) => { rfi.expected_labels = ["NO_CONFLICT"]; },
    (rfi) => { delete rfi.submitted_by; }
  ]) {
    const files = artifacts();
    change(files["rfis.json"][0]);
    assert.equal(checkDemo2Inputs(files["rfis.json"], files["daily-reports.json"]).valid, false);
  }
});

test("cross-reference checks reject duplicate IDs, nonexistent links, cross-project data and unlinked reports", () => {
  const mutations = [
    (rfis) => { rfis[1].rfi_id = rfis[0].rfi_id.toLowerCase(); },
    (rfis) => { rfis[0].linked_daily_report_ids = ["ABSENT"]; },
    (rfis) => { rfis[0].linked_daily_report_ids.push(rfis[0].linked_daily_report_ids[0]); },
    (_rfis, reports) => { reports[0].project_id = "ANOTHER-PROJECT"; },
    (_rfis, reports) => { reports.push({ ...reports[0], report_id: "UNLINKED-REPORT" }); },
    (_rfis, reports) => { reports[1].report_id = reports[0].report_id.toLowerCase(); },
    (_rfis, reports) => { reports[0].report_date = "2026-02-30"; },
    (_rfis, reports) => { reports[0].labor_count = -1; },
    (_rfis, reports) => { reports[0].answer_key = "LEAK"; }
  ];
  for (const mutate of mutations) {
    const files = artifacts();
    mutate(files["rfis.json"], files["daily-reports.json"]);
    assert.equal(checkDemo2Inputs(files["rfis.json"], files["daily-reports.json"]).valid, false);
  }
});

test("reports after submission warn about review chronology without inventing a review date", () => {
  const files = artifacts();
  files["daily-reports.json"][0].report_date = "2026-12-01";
  const checked = checkDemo2Inputs(files["rfis.json"], files["daily-reports.json"]);
  assert.equal(checked.valid, true);
  assert.ok(checked.warnings.some(({ code }) => code === "later_report_context"));
});

test("source preparation rejects mixed provenance, answers in input, mismatched pairs and conflicting report versions", () => {
  const mutations = [
    (batch) => { batch.provenance = "observed_public"; },
    (batch) => { batch.answer_key = []; },
    (batch) => { batch.cases[0].expected_outcome = "pass"; },
    (batch) => { batch.cases[0].daily_reports = []; },
    (batch) => { batch.cases[0].daily_reports.push(batch.cases[0].daily_reports[0]); },
    (batch) => {
      const firstReport = batch.cases[0].daily_reports[0];
      batch.cases[1].rfi.linked_daily_report_ids = [firstReport.report_id];
      batch.cases[1].daily_reports = [{ ...firstReport, work_description: "Conflicting revision with same ID." }];
    }
  ];
  for (const mutate of mutations) {
    const batch = source();
    mutate(batch);
    assert.throws(() => buildDemo2Dataset(serialize(batch)), /synthetic provenance|preparation failed/);
  }
});

test("invalid preparation writes nothing and a changed artifact fails reproducibility validation", (t) => {
  const directory = temporaryDirectory(t);
  const invalid = source();
  invalid.cases[0].rfi.linked_daily_report_ids = ["ABSENT"];
  assert.throws(() => prepareDemo2({ directory, sourceText: serialize(invalid) }), /preparation failed/);
  assert.deepEqual(fs.readdirSync(directory), []);
  assert.equal(validateDemo2({ directory }).valid, false);
  prepareDemo2({ directory });
  assert.equal(validateDemo2({ directory }).valid, true);
  const rfisFile = path.join(directory, "rfis.json");
  const rfis = readJson(rfisFile);
  rfis[0].description = "Accidental post-preparation edit.";
  fs.writeFileSync(rfisFile, serialize(rfis));
  const before = fs.readFileSync(rfisFile);
  assert.equal(validateDemo2({ directory }).errors[0].code, "stale_artifact");
  assert.deepEqual(fs.readFileSync(rfisFile), before);
});

test("draft labels are separate and constrained to existing conflict vocabulary, without claiming final workflow labels", () => {
  const key = readJson(path.join(ROOT, "demo2/data/answers/draft-answer-key.json"));
  const schema = readJson(path.join(ROOT, "demo2/schemas/triage_output_schema.json"));
  const allowed = schema.properties.flagged_conflicts.items.properties.conflict_type.enum;
  assert.equal(key.dataset_id, source().dataset_id);
  assert.equal(key.label_status, "draft_for_team_review");
  assert.deepEqual(key.reviewed_by, []);
  assert.deepEqual(key.cases.map(({ rfi_id }) => rfi_id).sort(), artifacts()["rfis.json"].map(({ rfi_id }) => rfi_id).sort());
  for (const entry of key.cases) {
    assert.equal(entry.human_review_required, true);
    assert.equal(typeof entry.requires_clarification, "boolean");
    assert.ok(entry.expected_conflict_types.every((value) => allowed.includes(value)));
    assert.ok(!Object.hasOwn(entry, "approval_status") && !Object.hasOwn(entry, "current_assignee"));
  }
});

test("optional output checks reject enum drift, unknown IDs, omitted cases, extra answer fields and malformed conflicts", () => {
  const ids = artifacts()["rfis.json"].map(({ rfi_id }) => rfi_id);
  assert.equal(checkTriageOutputs(validOutputs(), ids).valid, true);
  const mutations = [
    (outputs) => { outputs[0].approval_status = "GC Review"; },
    (outputs) => { outputs[0].rfi_id = "UNKNOWN"; },
    (outputs) => { outputs.pop(); },
    (outputs) => { outputs[1].rfi_id = outputs[0].rfi_id; },
    (outputs) => { outputs[0].expected_conflict_types = []; },
    (outputs) => { outputs[0].recommended_action = "  "; },
    (outputs) => { outputs[0].flagged_conflicts = [{ conflict_type: "Schedule Mismatch", severity: "H", details: "  " }]; },
    (outputs) => { outputs[0].flagged_conflicts = [{ conflict_type: "Schedule Mismatch", severity: "H", details: "Test", expected: true }]; }
  ];
  for (const mutate of mutations) {
    const outputs = validOutputs();
    mutate(outputs);
    assert.equal(checkTriageOutputs(outputs, ids).valid, false);
  }
  // A schema check deliberately cannot establish that a semantically wrong answer is correct.
  const unscored = validOutputs();
  unscored[0].approval_status = "Approved";
  assert.equal(checkTriageOutputs(unscored, ids).valid, true);
});

test("read-only CLI works outside the repository with no credentials and rejects unsupported flags", (t) => {
  const directory = temporaryDirectory(t);
  const outputsFile = path.join(directory, "outputs.json");
  fs.writeFileSync(outputsFile, serialize(validOutputs()));
  const command = path.join(ROOT, "scripts/validate-demo2.js");
  const before = fs.readFileSync(outputsFile);
  const preparedBefore = Object.fromEntries(fs.readdirSync(path.join(ROOT, OUTPUT)).map((name) => [name, fs.readFileSync(path.join(ROOT, OUTPUT, name), "utf8")]));
  const env = { ...process.env, OPENAI_API_KEY: "", GEMINI_API_KEY: "" };
  const valid = spawnSync(process.execPath, [command, "--outputs", outputsFile], { cwd: directory, env, encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /does not evaluate correctness/);
  assert.deepEqual(fs.readFileSync(outputsFile), before);
  assert.deepEqual(fs.readdirSync(directory), ["outputs.json"]);
  for (const [name, content] of Object.entries(preparedBefore)) assert.equal(fs.readFileSync(path.join(ROOT, OUTPUT, name), "utf8"), content);
  const invalid = spawnSync(process.execPath, [command, "--input", "unknown.json"], { cwd: directory, env, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Usage/);
});
