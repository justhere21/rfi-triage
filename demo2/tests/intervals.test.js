import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parseCsv } from "../scripts/lib/csv.js";
import {
  PUBLIC_SOURCES, REPO_ROOT, buildIntervalReport, calculateRows, calendarDays,
  parseIntervalArgs, runIntervalCalculation, serializeIntervalReport
} from "../scripts/calculate-intervals.js";

const silent = { log() {}, error() {} };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const row = (changes = {}) => ({
  record_ID: "TEST-001", project: "Fictional interval fixture",
  received_or_submitted_date_raw: "02/28/2024", received_or_submitted_date_iso: "2024-02-28",
  received_or_submitted_date_semantics: "received date",
  closed_or_response_date_raw: "03/02/2024", closed_or_response_date_iso: "2024-03-02",
  closed_or_response_date_semantics: "closed date", reported_total_days: "3",
  derived_elapsed_calendar_days: "3", quality_notes: "Fictional test note", ...changes
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rfi-intervals-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of PUBLIC_SOURCES) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, file), target);
  }
  return root;
}

function mutateCsv(root, change, file = PUBLIC_SOURCES[0]) {
  const target = path.join(root, file);
  const rows = parseCsv(fs.readFileSync(target, "utf8"));
  change(rows);
  const fields = Object.keys(rows[0]);
  const cell = (value) => /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  fs.writeFileSync(target, fields.join(",") + "\n" + rows.map((record) => fields.map((field) => cell(record[field])).join(",")).join("\n") + "\n");
}

test("exclusive UTC intervals preserve same-day zero, leap days and DST-independent days", () => {
  assert.equal(calendarDays("2026-03-01", "2026-03-01"), 0);
  assert.equal(calendarDays("2024-02-28", "2024-03-01"), 2);
  assert.equal(calendarDays("2025-02-28", "2025-03-01"), 1);
  assert.equal(calendarDays("2026-03-07", "2026-03-09"), 2);
  assert.equal(calendarDays("2026-11-01", "2026-11-02"), 1);
});

test("blank normalized dates remain unknown and raw date text is never used to fill them", () => {
  assert.equal(calendarDays("", "2026-03-02"), null);
  assert.equal(calendarDays("2026-03-01", ""), null);
  assert.equal(calendarDays(" ", ""), null);
  const original = row({ received_or_submitted_date_raw: "6/30/2502\n5", received_or_submitted_date_iso: "", derived_elapsed_calendar_days: "", reported_total_days: "2" });
  const before = structuredClone(original);
  const [record] = calculateRows([original]);
  assert.equal(record.interval_status, "unknown");
  assert.equal(record.recomputed_elapsed_calendar_days, null);
  assert.equal(record.stored_interval_matches, true);
  assert.equal(record.received_or_submitted_date_raw, original.received_or_submitted_date_raw);
  assert.equal(record.reported_total_days, "2");
  assert.equal(record.source_quality_notes[0].code, "missing_normalized_date");
  assert.deepEqual(original, before);
});

test("impossible, non-ISO and reversed dates fail clearly, including when the other date is blank", () => {
  for (const date of ["2025-02-29", "2026-02-30", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", "03/01/2026", "2026-03-01T00:00:00Z", " 2026-03-01"]) {
    assert.throws(() => calendarDays(date, "2026-12-31"), /YYYY-MM-DD|real calendar date/, date);
  }
  assert.throws(() => calendarDays(null, "2026-03-02"), /ISO date string/);
  assert.throws(() => calendarDays("2026-03-02", "2026-03-01"), /precedes/);
  assert.throws(() => calendarDays("", "2026-02-30"), /real calendar date/);
  const [record] = calculateRows([row({ closed_or_response_date_iso: "2024-02-27" })]);
  assert.equal(record.interval_status, "invalid");
  assert.equal(record.errors[0].code, "invalid_date_interval");
});

test("stored mismatches fail while printed-duration differences are preserved as source-quality notes", () => {
  const original = row({ derived_elapsed_calendar_days: "2", reported_total_days: "1" });
  const [record] = calculateRows([original], { sourceFile: "fictional.csv" });
  assert.equal(record.recomputed_elapsed_calendar_days, 3);
  assert.equal(record.derived_elapsed_calendar_days, "2");
  assert.equal(record.reported_total_days, "1");
  assert.equal(record.stored_interval_matches, false);
  assert.ok(record.errors.some((error) => error.code === "stored_interval_mismatch"));
  assert.ok(record.source_quality_notes.some((note) => note.code === "reported_duration_difference"));
  assert.equal(record.quality_notes, "Fictional test note");
  assert.equal(record.source_file, "fictional.csv");
  assert.equal(record.source_record, 1);
});

test("malformed or fabricated stored intervals cannot silently pass verification", () => {
  for (const stored of ["-1", "1.5", "unknown", "03"]) {
    const [record] = calculateRows([row({ derived_elapsed_calendar_days: stored })]);
    assert.ok(record.errors.some((error) => error.code === "invalid_stored_interval"));
  }
  const [missingStored] = calculateRows([row({ derived_elapsed_calendar_days: "" })]);
  assert.ok(missingStored.errors.some((error) => error.code === "stored_interval_mismatch"));
  const [inventedStored] = calculateRows([row({ received_or_submitted_date_iso: "", derived_elapsed_calendar_days: "0" })]);
  assert.ok(inventedStored.errors.some((error) => error.code === "stored_interval_mismatch"));
  const [printedText] = calculateRows([row({ reported_total_days: "unclear printed value" })]);
  assert.deepEqual(printedText.errors, []);
  assert.equal(printedText.reported_total_days, "unclear printed value");
  assert.ok(printedText.source_quality_notes.some((note) => note.code === "unparsed_reported_duration"));
});

test("missing source columns and invalid rows fail instead of receiving invented metadata", () => {
  const missing = row();
  delete missing.received_or_submitted_date_raw;
  const [record] = calculateRows([missing]);
  assert.equal(record.interval_status, "invalid");
  assert.ok(record.errors.some((error) => error.field === "received_or_submitted_date_raw"));
  assert.equal("received_or_submitted_date_raw" in record, false);
  assert.equal(calculateRows([null])[0].errors[0].code, "invalid_record");
  assert.throws(() => calculateRows([]), /nonempty/);
});

test("real public data reproduces 17 IDs, 16 intervals and one unknown without changing source bytes", () => {
  const before = PUBLIC_SOURCES.map((file) => fs.readFileSync(path.join(REPO_ROOT, file)));
  const report = buildIntervalReport();
  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.summary, {
    records: 17, calculated_records: 16, unknown_records: 1, invalid_interval_records: 0,
    failed_records: 0, stored_mismatch_records: 0, reported_difference_records: 8
  });
  assert.equal(new Set(report.records.map((record) => record.record_ID)).size, 17);
  const unknown = report.records.filter((record) => record.interval_status === "unknown");
  assert.deepEqual(unknown.map((record) => record.record_ID), ["LW-PRFI-09"]);
  assert.equal(unknown[0].received_or_submitted_date_raw, "6/30/2502\n5");
  assert.equal(unknown[0].received_or_submitted_date_iso, "");
  assert.equal(unknown[0].derived_elapsed_calendar_days, "");
  const discrepancy = report.records.find((record) => record.record_ID === "LW-PRFI-11");
  assert.equal(discrepancy.reported_total_days, "1");
  assert.equal(discrepancy.recomputed_elapsed_calendar_days, 10);
  assert.equal(report.records.find((record) => record.record_ID === "LW-PRFI-03").recomputed_elapsed_calendar_days, 0);
  assert.equal("mean_calendar_days" in report.summary, false);
  assert.deepEqual(report.projects.map(({ records, calculated_records, unknown_records, aggregation_records, sum_calendar_days, min_calendar_days, max_calendar_days, mean_calendar_days }) => ({ records, calculated_records, unknown_records, aggregation_records, sum_calendar_days, min_calendar_days, max_calendar_days, mean_calendar_days })), [
    { records: 11, calculated_records: 10, unknown_records: 1, aggregation_records: 10, sum_calendar_days: 41, min_calendar_days: 0, max_calendar_days: 14, mean_calendar_days: 4.1 },
    { records: 6, calculated_records: 6, unknown_records: 0, aggregation_records: 6, sum_calendar_days: 38, min_calendar_days: 2, max_calendar_days: 8, mean_calendar_days: 6.333333 }
  ]);
  for (const [index, source] of report.sources.entries()) {
    assert.equal(source.file, PUBLIC_SOURCES[index]);
    assert.equal(source.sha256, hash(before[index]));
    assert.deepEqual(fs.readFileSync(path.join(REPO_ROOT, source.file)), before[index]);
  }
  assert.match(report.method.interpretation, /not GC processing time/);
  assert.equal(serializeIntervalReport(buildIntervalReport()), serializeIntervalReport(report));
});

test("record and project date semantics stay separate rather than pooling different intervals", (t) => {
  const root = fixture(t);
  mutateCsv(root, (rows) => { rows[0].received_or_submitted_date_semantics = "Different source date definition"; });
  const report = buildIntervalReport({ root });
  assert.equal(report.valid, true);
  assert.equal(report.projects.length, 3);
  assert.equal(report.projects[0].aggregation_records, 1);
  assert.equal(report.projects[1].aggregation_records, 9);
});

test("CLI default and --check are read-only and --out writes one deterministic JSON report", (t) => {
  const root = fixture(t);
  const before = PUBLIC_SOURCES.map((file) => fs.readFileSync(path.join(root, file)));
  assert.equal(runIntervalCalculation([], { root, logger: silent }).exitCode, 0);
  assert.equal(runIntervalCalculation(["--check"], { root, logger: silent }).exitCode, 0);
  assert.deepEqual(fs.readdirSync(root), ["data"]);
  const output = path.join(root, "reports", "intervals.json");
  const written = runIntervalCalculation(["--out", output], { root, logger: silent });
  assert.equal(written.exitCode, 0);
  assert.equal(fs.readFileSync(output, "utf8"), serializeIntervalReport(written.report));
  assert.equal(runIntervalCalculation(["--out", output], { root, logger: silent }).exitCode, 0);
  assert.equal(fs.readFileSync(output, "utf8"), serializeIntervalReport(written.report));
  assert.deepEqual(fs.readdirSync(path.dirname(output)), ["intervals.json"]);
  for (const [index, file] of PUBLIC_SOURCES.entries()) assert.deepEqual(fs.readFileSync(path.join(root, file)), before[index]);
});

test("invalid dates, reversed dates or stored mismatches block all report writes", (t) => {
  for (const change of [
    { received_or_submitted_date_iso: "2025-02-30" },
    { closed_or_response_date_iso: "2025-01-01" },
    { derived_elapsed_calendar_days: "999" }
  ]) {
    const root = fixture(t);
    mutateCsv(root, (rows) => Object.assign(rows[0], change));
    const before = fs.readFileSync(path.join(root, PUBLIC_SOURCES[0]));
    const output = path.join(root, "must-not-exist", "report.json");
    const checked = runIntervalCalculation(["--out", output], { root, logger: silent });
    assert.equal(checked.exitCode, 1);
    assert.equal(checked.report.valid, false);
    assert.equal(fs.existsSync(path.dirname(output)), false);
    assert.deepEqual(fs.readFileSync(path.join(root, PUBLIC_SOURCES[0])), before);
  }
});

test("duplicate IDs and unreadable source files produce explicit invalid reports", (t) => {
  const root = fixture(t);
  mutateCsv(root, (rows) => { rows[1].record_ID = rows[0].record_ID; });
  const duplicate = buildIntervalReport({ root });
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.errors.filter((error) => error.code === "duplicate_record_id").length, 2);
  fs.writeFileSync(path.join(root, PUBLIC_SOURCES[0]), 'header\n"unclosed');
  const malformed = buildIntervalReport({ root });
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.some((error) => error.code === "source_error"));
});

test("unknown arguments, ambiguous output flags and source overwrite attempts are rejected", (t) => {
  for (const args of [["--unknown"], ["--out"], ["--out", "--check"], ["--check", "--out", "report.json"], ["--out", "a.json", "--out", "b.json"]]) {
    assert.throws(() => parseIntervalArgs(args));
  }
  const root = fixture(t);
  const source = path.join(root, PUBLIC_SOURCES[0]);
  const before = fs.readFileSync(source);
  assert.equal(runIntervalCalculation(["--out", source], { root, logger: silent }).exitCode, 1);
  const symlink = path.join(root, "linked-report.json");
  fs.symlinkSync(source, symlink);
  assert.equal(runIntervalCalculation(["--out", symlink], { root, logger: silent }).exitCode, 1);
  const hardlink = path.join(root, "shared-report.json");
  fs.linkSync(source, hardlink);
  assert.equal(runIntervalCalculation(["--out", hardlink], { root, logger: silent }).exitCode, 1);
  assert.equal(runIntervalCalculation(["--out", path.join(path.dirname(source), "new-report.json")], { root, logger: silent }).exitCode, 1);
  assert.deepEqual(fs.readFileSync(source), before);
});

test("direct CLI check works offline and unknown options fail without writing", () => {
  const command = path.join(REPO_ROOT, "scripts/calculate-intervals.js");
  const valid = spawnSync(process.execPath, [command, "--check"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /17 public records: 16 calculated, 1 unknown/);
  const invalid = spawnSync(process.execPath, [command, "--bad-argument"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown argument/);
});
