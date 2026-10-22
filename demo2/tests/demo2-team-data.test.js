import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ROOT, SOURCE, OUTPUT, serialize, readJson } from "../scripts/lib/demo2-data.js";
import {
  TEAM_SOURCE, TEAM_OUTPUT, buildTeamCaseArtifacts, prepareTeamCases, validateTeamCases
} from "../scripts/lib/demo2-team-data.js";

const sourceBytes = () => fs.readFileSync(path.join(ROOT, TEAM_SOURCE), "utf8");
const source = () => JSON.parse(sourceBytes());
const artifacts = () => buildTeamCaseArtifacts();
const completeRecord = () => {
  const fixture = readJson(path.join(ROOT, SOURCE)).cases[0];
  return { ...structuredClone(fixture.rfi), daily_reports: structuredClone(fixture.daily_reports) };
};
function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "demo2-team-cases-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("all ten source cases are audited individually without inventing required metadata", () => {
  const files = artifacts();
  const report = files["compatibility-report.json"];
  assert.equal(report.report_success, true);
  assert.equal(report.import_ready, false);
  assert.deepEqual(report.summary, {
    source_records: 10, blocked_records: 10, ready_inputs: 0,
    original_status_counts: { Closed: 8, Rejected: 1, "In Review": 1 }
  });
  assert.equal(report.records.length, 10);
  assert.deepEqual(files["ready-inputs.json"], []);
  for (const [index, entry] of files["candidate-rfis.json"].entries()) {
    const raw = source()[index];
    assert.equal(entry.source_id, raw.id);
    assert.equal(entry.source_pointer, `/${index}`);
    assert.deepEqual(entry.rfi, { rfi_id: raw.id, title: raw.topic, description: raw.description });
    assert.deepEqual(report.records[index].missing_required_fields.sort(), ["project_id", "submitted_by", "date_submitted", "linked_daily_report_ids"].sort());
    assert.equal(report.records[index].ready_for_model_input, false);
  }
});

test("source annotations and project names stay separate from input candidates and draft labels", () => {
  const files = artifacts();
  assert.equal(files["source-annotations.json"].length, 10);
  for (const [index, entry] of files["source-annotations.json"].entries()) {
    const raw = source()[index];
    assert.equal(entry.source_id, raw.id);
    assert.equal(entry.source_project_name, raw.project);
    assert.deepEqual(entry.annotations, { assignee: raw.assignee, status: raw.status, conflict: raw.conflict });
    assert.equal(entry.semantics_status, "unresolved");
    assert.ok(files["compatibility-report.json"].records[index].blockers.some(({ code }) => code === "annotation_semantics_unresolved"));
  }
  assert.doesNotMatch(serialize(files["candidate-rfis.json"]), /"assignee"|"status"|"conflict"|"expected|"answer/);
  const unsupported = files["compatibility-report.json"].records.flatMap(({ unsupported_vocab }) => unsupported_vocab);
  assert.equal(unsupported.filter(({ field }) => field === "status").length, 9);
  assert.equal(unsupported.filter(({ field }) => field === "assignee").length, 10);
  // The source's string 'None' is retained verbatim; no empty predicted conflict list is fabricated.
  assert.equal(files["source-annotations.json"].filter(({ annotations }) => annotations.conflict === "None").length, 4);
});

test("manifest preserves exact source and schema hashes and records remain deterministic", () => {
  const files = artifacts();
  const manifest = files["manifest.json"];
  assert.equal(manifest.source.file, TEAM_SOURCE);
  for (const entry of [manifest.source, ...manifest.schemas]) {
    assert.equal(entry.sha256, createHash("sha256").update(fs.readFileSync(path.join(ROOT, entry.file))).digest("hex"));
  }
  assert.equal(serialize(files), serialize(artifacts()));
  const changedBytes = sourceBytes() + "\n";
  assert.notEqual(buildTeamCaseArtifacts(changedBytes)["manifest.json"].source.sha256, manifest.source.sha256);
});

test("explicit complete fictional records can be converted with report checks, without source annotations", () => {
  const explicit = completeRecord();
  const files = buildTeamCaseArtifacts(serialize([explicit]));
  assert.equal(files["compatibility-report.json"].summary.ready_inputs, 1);
  assert.deepEqual(files["ready-inputs.json"], [{
    rfi: readJson(path.join(ROOT, SOURCE)).cases[0].rfi,
    daily_reports: explicit.daily_reports
  }]);
  assert.equal(files["compatibility-report.json"].import_ready, true);
});

test("missing links and report bodies cannot silently become empty context, and invalid dates cannot import", () => {
  const cases = [
    (record) => { delete record.linked_daily_report_ids; },
    (record) => { delete record.daily_reports; },
    (record) => { record.date_submitted = "2026-02-30"; },
    (record) => { record.date_submitted = { toString: null }; },
    (record) => { record.daily_reports[0].report_date = { toString: null }; },
    (record) => { record.linked_daily_report_ids = ["ABSENT-REPORT"]; },
    (record) => { record.daily_reports[0].project_id = "WRONG-PROJECT"; },
    (record) => { record.daily_reports[0].work_description = " "; }
  ];
  for (const mutate of cases) {
    const record = completeRecord();
    mutate(record);
    const files = buildTeamCaseArtifacts(serialize([record]));
    assert.equal(files["compatibility-report.json"].summary.ready_inputs, 0);
    assert.equal(files["compatibility-report.json"].summary.blocked_records, 1);
    assert.deepEqual(files["ready-inputs.json"], []);
  }
  const explicitEmpty = completeRecord();
  explicitEmpty.linked_daily_report_ids = [];
  explicitEmpty.daily_reports = [];
  const files = buildTeamCaseArtifacts(serialize([explicitEmpty]));
  assert.equal(files["compatibility-report.json"].summary.ready_inputs, 1);
  assert.ok(files["compatibility-report.json"].records[0].input_warnings.some(({ code }) => code === "preserved_missing_context"));
});

test("conflicting aliases, duplicate IDs, and ambiguous source annotations block a ready input", () => {
  const conflicting = completeRecord();
  conflicting.id = "A-DIFFERENT-ID";
  const aliasFiles = buildTeamCaseArtifacts(serialize([conflicting]));
  assert.equal(aliasFiles["ready-inputs.json"].length, 0);
  assert.ok(aliasFiles["compatibility-report.json"].records[0].blockers.some(({ code }) => code === "alias_conflict"));
  const withAnnotation = completeRecord();
  withAnnotation.status = "Rejected";
  const annotated = buildTeamCaseArtifacts(serialize([withAnnotation]));
  assert.equal(annotated["ready-inputs.json"].length, 0);
  assert.equal(annotated["source-annotations.json"][0].annotations.status, "Rejected");
  const first = completeRecord();
  const duplicate = structuredClone(first);
  duplicate.rfi_id = first.rfi_id.toLowerCase();
  const repeated = buildTeamCaseArtifacts(serialize([first, duplicate]));
  assert.equal(repeated["ready-inputs.json"].length, 0);
  assert.equal(repeated["compatibility-report.json"].summary.blocked_records, 2);
});

test("unknown source and answer fields are quarantined outside all candidate and ready RFIs", () => {
  const raw = source()[0];
  raw.expected_labels = ["SECRET_LABEL"];
  raw.additional_context = "UNMAPPED_SOURCE_TEXT";
  const files = buildTeamCaseArtifacts(serialize([raw]));
  assert.deepEqual(files["source-annotations.json"][0].unmapped_fields.expected_labels, ["SECRET_LABEL"]);
  assert.equal(files["source-annotations.json"][0].unmapped_fields.additional_context, "UNMAPPED_SOURCE_TEXT");
  assert.doesNotMatch(serialize(files["candidate-rfis.json"]), /SECRET_LABEL|UNMAPPED_SOURCE_TEXT|expected_labels|additional_context/);
  assert.deepEqual(files["ready-inputs.json"], []);
});

test("shared reports accept reordered equivalent fields and block every case with conflicting versions", () => {
  const first = completeRecord();
  const second = structuredClone(first);
  second.rfi_id = "SYN2-RFI-SHARED";
  second.daily_reports = [Object.fromEntries(Object.entries(first.daily_reports[0]).reverse())];
  const shared = buildTeamCaseArtifacts(serialize([first, second]));
  assert.equal(shared["compatibility-report.json"].summary.ready_inputs, 2);
  second.daily_reports[0].work_description = "A different reported installation condition under the same report ID.";
  const conflicting = buildTeamCaseArtifacts(serialize([first, second]));
  assert.equal(conflicting["compatibility-report.json"].summary.ready_inputs, 0);
  assert.equal(conflicting["compatibility-report.json"].summary.blocked_records, 2);
  assert.ok(conflicting["compatibility-report.json"].records.every(({ blockers }) => blockers.some(({ code }) => code === "conflicting_report_versions")));
});

test("a malformed date blocks its source row while other complete records are still audited", () => {
  const bad = completeRecord();
  bad.date_submitted = { toString: null };
  const good = completeRecord();
  good.rfi_id = "SYN2-RFI-VALID";
  const files = buildTeamCaseArtifacts(serialize([bad, good]));
  assert.equal(files["compatibility-report.json"].summary.source_records, 2);
  assert.equal(files["compatibility-report.json"].summary.blocked_records, 1);
  assert.equal(files["compatibility-report.json"].summary.ready_inputs, 1);
  assert.equal(files["ready-inputs.json"][0].rfi.rfi_id, good.rfi_id);
});

test("malformed source makes no artifacts and compatibility validation detects changes without rewriting", (t) => {
  const directory = temporaryDirectory(t);
  for (const sourceText of ["[broken", "{}", "[]", "[null]", '["not a record"]']) {
    assert.throws(() => prepareTeamCases({ directory, sourceText }));
    assert.deepEqual(fs.readdirSync(directory), []);
  }
  assert.equal(validateTeamCases({ directory }).valid, false);
  prepareTeamCases({ directory });
  assert.equal(validateTeamCases({ directory }).valid, true);
  const candidateFile = path.join(directory, "candidate-rfis.json");
  const candidates = readJson(candidateFile);
  candidates[0].rfi.submitted_by = "UNSUPPORTED DEFAULT";
  fs.writeFileSync(candidateFile, serialize(candidates));
  const before = fs.readFileSync(candidateFile);
  assert.equal(validateTeamCases({ directory }).valid, false);
  assert.deepEqual(fs.readFileSync(candidateFile), before);
  prepareTeamCases({ directory });
  assert.equal(validateTeamCases({ directory, sourceText: sourceBytes() + "\n" }).valid, false);
});

test("CLI audit check is read-only outside the repository and does not alter source or the separate five-case batch", (t) => {
  const directory = temporaryDirectory(t);
  const beforeSource = fs.readFileSync(path.join(ROOT, TEAM_SOURCE));
  const fiveCaseBefore = Object.fromEntries(fs.readdirSync(path.join(ROOT, OUTPUT)).map((name) => [name, fs.readFileSync(path.join(ROOT, OUTPUT, name), "utf8")]));
  const teamBefore = Object.fromEntries(fs.readdirSync(path.join(ROOT, TEAM_OUTPUT)).map((name) => [name, fs.readFileSync(path.join(ROOT, TEAM_OUTPUT, name), "utf8")]));
  const command = path.join(ROOT, "scripts/prepare-demo2-team.js");
  const env = { ...process.env, OPENAI_API_KEY: "", GEMINI_API_KEY: "" };
  const checked = spawnSync(process.execPath, [command, "--check"], { cwd: directory, env, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /10/);
  assert.match(checked.stdout, /blocked/);
  assert.deepEqual(fs.readdirSync(directory), []);
  assert.deepEqual(fs.readFileSync(path.join(ROOT, TEAM_SOURCE)), beforeSource);
  for (const [name, content] of Object.entries(fiveCaseBefore)) assert.equal(fs.readFileSync(path.join(ROOT, OUTPUT, name), "utf8"), content);
  for (const [name, content] of Object.entries(teamBefore)) assert.equal(fs.readFileSync(path.join(ROOT, TEAM_OUTPUT, name), "utf8"), content);
  const invalid = spawnSync(process.execPath, [command, "--unknown"], { cwd: directory, env, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Usage/);
});
