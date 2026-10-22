import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildPartnerDataset } from "../scripts/lib/partner.js";
import { INPUT_FIELDS } from "../scripts/lib/check-items.js";
import { runPartnerPreparation, parsePartnerArgs } from "../scripts/prepare-partner.js";
import { loadPreparedItems } from "../scripts/check-input.js";

// Every record and receipt in this test file is fictional and exists only in
// temporary directories. No fixture represents an actual partner delivery.
const root = fileURLToPath(new URL("../", import.meta.url));
const silent = { log() {}, error() {} };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const fictionalReceipt = (changes = {}) => ({
  dataset_id: "fictional-test-delivery", provenance: "partner", source_name: "Fictional test sender",
  received_date: "2026-03-10", source_reference: "Fictional test fixture, not a real delivery",
  sharing_scope: "local_only", ...changes
});
const fictionalItem = (id = "FICTIONAL-001", changes = {}) => ({
  item_id: id, item_type: "rfi", submitted_date: "2026-03-09",
  submitted_by: "Fictional fixture author", discipline: "A", location: "Fictional room",
  question_text: "Fictional test question.\nPlease confirm the detail.",
  drawing_refs: ["TEST-A1"], spec_refs: [], attachments: [], related_item_ids: [], ...changes
});

function fixture(t, { records = [fictionalItem()], receipt = fictionalReceipt(), sourceText, extension = "json", sourceName } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rfi-fictional-partner-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputPath = path.join(directory, sourceName ?? `fictional-input.${extension}`);
  const receiptPath = path.join(directory, "fictional-receipt.json");
  fs.writeFileSync(inputPath, sourceText ?? json(records));
  fs.writeFileSync(receiptPath, json(receipt));
  return { directory, inputPath, receiptPath, output: path.join(directory, "prepared") };
}

function codes(dataset) { return dataset.report.errors.map((error) => error.code); }
function writeReceipt(files, receipt) { fs.writeFileSync(files.receiptPath, json(receipt)); }
function cliArgs(files) { return ["--input", files.inputPath, "--receipt", files.receiptPath, "--out-dir", files.output]; }
function csv(headers, records) {
  const cell = (value) => {
    const text = Array.isArray(value) ? JSON.stringify(value) : String(value ?? "");
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  return headers.map(cell).join(",") + "\r\n" + records.map((record) => headers.map((field) => cell(record[field])).join(",")).join("\r\n") + "\r\n";
}

test("partner JSON intake preserves actual supplied metadata and traces source bytes without writing", (t) => {
  const item = fictionalItem("FICTIONAL-001", { provenance: "partner", current_drawing_version: "TEST-A1 Rev 2" });
  const files = fixture(t, { records: [item] });
  const sourceBefore = fs.readFileSync(files.inputPath);
  const receiptBefore = fs.readFileSync(files.receiptPath);
  const prepared = buildPartnerDataset(files);
  assert.equal(prepared.report.valid, true);
  assert.deepEqual(prepared.items, [item]);
  assert.deepEqual(prepared.report.counts, { source_records: 1, input_records: 1, failed_source_records: 0 });
  assert.equal(prepared.manifest.dataset_id, "fictional-test-delivery");
  assert.equal(prepared.manifest.provenance, "partner");
  assert.equal(prepared.manifest.source.path, files.inputPath);
  assert.equal(prepared.manifest.source.file, path.basename(files.inputPath));
  assert.equal(prepared.manifest.source.sha256, hash(sourceBefore));
  assert.equal(prepared.manifest.receipt.sha256, hash(receiptBefore));
  assert.deepEqual(prepared.manifest.receipt.metadata, fictionalReceipt());
  assert.equal(prepared.manifest.schema_file, "scripts/schemas/input_schema.json");
  assert.equal(prepared.manifest.schema_sha256, hash(fs.readFileSync(path.join(root, "scripts/schemas/input_schema.json"))));
  assert.deepEqual(prepared.manifest.records, [{ item_id: item.item_id, source_file: path.basename(files.inputPath), source_record: 1 }]);
  assert.deepEqual(fs.readFileSync(files.inputPath), sourceBefore);
  assert.deepEqual(fs.readFileSync(files.receiptPath), receiptBefore);
  assert.equal(fs.existsSync(files.output), false);
});

test("partner intake adds only absent partner provenance and retains multiline text and blank source fields", (t) => {
  const item = fictionalItem("FICTIONAL-001", { submitted_by: "", discipline: "", location: "", drawing_refs: null, spec_refs: "23 31 13", attachments: "TEST-photo|TEST-markup", related_item_ids: "" });
  const files = fixture(t, { records: [item] });
  const prepared = buildPartnerDataset(files);
  assert.equal(prepared.report.valid, true);
  assert.deepEqual(prepared.items[0], { ...item, provenance: "partner", drawing_refs: [], spec_refs: ["23 31 13"], attachments: ["TEST-photo", "TEST-markup"], related_item_ids: [] });
  assert.ok(prepared.report.warnings.some((warning) => warning.code === "preserved_missing_fields" && warning.fields.includes("location")));
  assert.ok(prepared.report.warnings.some((warning) => warning.code === "preserved_empty_lists"));
  assert.equal(prepared.items[0].submitted_date, "2026-03-09");
  assert.equal(prepared.items[0].question_text, item.question_text);
});

test("mapped partner CSV supports quoted commas, multiline cells, arrays, and receipt field descriptions", (t) => {
  const item = fictionalItem("FICTIONAL-001", { question_text: 'Fictional "quoted", question\r\nSecond line', drawing_refs: "TEST-A1|TEST-A2" });
  const map = { item_id: "Record", question_text: "Question", submitted_date: "Date" };
  const source = Object.fromEntries(Object.entries(item).map(([field, value]) => [map[field] ?? field, value]));
  const descriptions = { item_id: "Source record identifier", question_text: "Verbatim request text" };
  const files = fixture(t, { extension: "csv", sourceText: "\uFEFF" + csv(Object.keys(source), [source]), receipt: fictionalReceipt({ field_map: map, field_descriptions: descriptions, sharing_scope: "team_use" }) });
  const prepared = buildPartnerDataset(files);
  assert.equal(prepared.report.valid, true);
  assert.equal(prepared.items[0].item_id, "FICTIONAL-001");
  assert.equal(prepared.items[0].question_text, item.question_text);
  assert.deepEqual(prepared.items[0].drawing_refs, ["TEST-A1", "TEST-A2"]);
  assert.equal(prepared.manifest.column_mapping.item_id, "Record");
  assert.deepEqual(prepared.manifest.field_descriptions, descriptions);
  assert.equal(prepared.manifest.receipt.metadata.sharing_scope, "team_use");
});

test("answer fields and unknown source columns are excluded by name with no content leakage", (t) => {
  const extras = { expected_labels: ["SECRET-LABEL"], true_flags: "SECRET-FLAG", notes: "SECRET-NOTE", internal_code: "SECRET-CODE" };
  const files = fixture(t, { records: [fictionalItem("FICTIONAL-001", extras)] });
  const prepared = buildPartnerDataset(files);
  assert.equal(prepared.report.valid, true);
  assert.deepEqual(prepared.report.excluded_columns, Object.keys(extras).sort());
  assert.ok(Object.keys(prepared.items[0]).every((field) => INPUT_FIELDS.includes(field)));
  assert.doesNotMatch(json(prepared), /SECRET-/);
  assert.ok(prepared.report.warnings.some((warning) => warning.code === "excluded_source_columns"));
});

test("every required source field must exist, with no synthetic defaults for absent values", (t) => {
  const files = fixture(t);
  for (const field of Object.keys(fictionalItem())) {
    const item = fictionalItem();
    delete item[field];
    fs.writeFileSync(files.inputPath, json([item]));
    const prepared = buildPartnerDataset(files);
    assert.equal(prepared.report.valid, false, `Missing ${field} fails`);
    assert.ok(prepared.report.errors.some((error) => error.code === "missing_source_field" && error.field === field));
    assert.deepEqual(prepared.items, []);
    assert.equal(prepared.report.counts.failed_source_records, 1);
  }
});

test("blank or invalid source dates fail without replacement by receipt or synthetic dates", (t) => {
  const files = fixture(t);
  for (const submitted_date of ["", null, "2026-02-30", "March 9, 2026", "2026-03-09T00:00:00Z"]) {
    fs.writeFileSync(files.inputPath, json([fictionalItem("FICTIONAL-001", { submitted_date })]));
    const prepared = buildPartnerDataset(files);
    assert.equal(prepared.report.valid, false);
    assert.ok(codes(prepared).includes("input_schema"));
    assert.deepEqual(prepared.items, []);
  }
});

test("incomplete receipt template and invalid receipt dates, IDs, permissions, and metadata are rejected", (t) => {
  const files = fixture(t);
  const invalid = [
    JSON.parse(fs.readFileSync(path.join(root, "data/partner/receipt-template.json"), "utf8")),
    null, [], fictionalReceipt({ dataset_id: "../outside" }), fictionalReceipt({ dataset_id: " " }),
    fictionalReceipt({ source_name: " " }), fictionalReceipt({ source_reference: "" }),
    fictionalReceipt({ received_date: "2026-02-29" }), fictionalReceipt({ received_date: "2026-02-30" }),
    fictionalReceipt({ received_date: "" }), fictionalReceipt({ sharing_scope: "public" }),
    fictionalReceipt({ provenance: undefined }), fictionalReceipt({ provenance: "synthetic" }),
    fictionalReceipt({ provenance: "observed_public" }),
    fictionalReceipt({ extra: "unknown" }), fictionalReceipt({ field_descriptions: { notes: "not model input" } }),
    fictionalReceipt({ field_descriptions: { question_text: 1 } })
  ];
  for (const receipt of invalid) {
    writeReceipt(files, receipt);
    const prepared = buildPartnerDataset(files);
    assert.equal(prepared.report.valid, false, JSON.stringify(receipt));
    assert.ok(codes(prepared).includes("invalid_receipt"));
    assert.equal(prepared.items.length, 0);
  }
  writeReceipt(files, fictionalReceipt({ received_date: "2024-02-29" }));
  assert.equal(buildPartnerDataset(files).report.valid, true);
});

test("receipt mappings cannot inject answers or map unknown model fields", (t) => {
  const files = fixture(t);
  const maps = [
    { expected_labels: "question_text" }, { question_text: "expected_labels" },
    { question_text: "true_flags" }, { question_text: "notes" },
    { question_text: "ground_truth_answer" }, { question_text: "expectedLabels" },
    { question_text: "answer-key" }, { question_text: "recommended_action" },
    { question_text: "ready_to_route" }, { question_text: "rfi_expected_labels" },
    { question_text: "needs_response" }, { question_text: "" }, { question_text: 1 }
  ];
  for (const field_map of maps) {
    writeReceipt(files, fictionalReceipt({ field_map }));
    const prepared = buildPartnerDataset(files);
    assert.equal(prepared.report.valid, false, JSON.stringify(field_map));
    assert.ok(codes(prepared).includes("invalid_receipt"));
  }
  writeReceipt(files, fictionalReceipt({ field_map: { drawing_refs: "absent_reference_column" } }));
  assert.ok(codes(buildPartnerDataset(files)).includes("missing_source_field"));
});

test("supplied synthetic, public, blank, and mapped non-partner provenance is rejected", (t) => {
  const files = fixture(t);
  for (const provenance of ["synthetic", "observed_public", "", null]) {
    fs.writeFileSync(files.inputPath, json([fictionalItem("FICTIONAL-001", { provenance })]));
    assert.ok(codes(buildPartnerDataset(files)).includes("mixed_provenance"));
  }
  fs.writeFileSync(files.inputPath, json([fictionalItem("FICTIONAL-001", { origin: "synthetic" })]));
  writeReceipt(files, fictionalReceipt({ field_map: { provenance: "origin" } }));
  assert.ok(codes(buildPartnerDataset(files)).includes("mixed_provenance"));
  fs.writeFileSync(files.inputPath, json([fictionalItem("FICTIONAL-001", { provenance: "synthetic", origin: "partner" })]));
  assert.ok(codes(buildPartnerDataset(files)).includes("mixed_provenance"));
});

test("partner validation reports row pointers, duplicate IDs, unsafe IDs and missing or self relations", (t) => {
  const files = fixture(t);
  const batches = [
    { rows: [fictionalItem(), fictionalItem()], code: "duplicate_id" },
    { rows: [fictionalItem(), fictionalItem("fictional-001")], code: "duplicate_id" },
    { rows: [fictionalItem("../outside")], code: "unsafe_id" },
    { rows: [fictionalItem("FICTIONAL-001", { related_item_ids: ["ABSENT"] })], code: "unresolved_relation" },
    { rows: [fictionalItem("FICTIONAL-001", { related_item_ids: ["FICTIONAL-001"] })], code: "self_relation" }
  ];
  for (const { rows, code } of batches) {
    fs.writeFileSync(files.inputPath, json(rows));
    const prepared = buildPartnerDataset(files);
    assert.equal(prepared.report.valid, false);
    assert.ok(codes(prepared).includes(code));
    assert.ok(prepared.report.errors.filter((error) => error.code === code).every((error) => error.source_record >= 1));
    assert.equal(prepared.report.sources[0].converted + prepared.report.sources[0].failed, rows.length);
  }
});

test("valid partner relationships are preserved and partial failures retain successful rows with accurate counters", (t) => {
  const records = [fictionalItem("FICTIONAL-001", { related_item_ids: ["FICTIONAL-002"] }), fictionalItem("FICTIONAL-002")];
  const files = fixture(t, { records });
  assert.deepEqual(buildPartnerDataset(files).items[0].related_item_ids, ["FICTIONAL-002"]);
  records.push(fictionalItem("FICTIONAL-003", { question_text: "" }));
  fs.writeFileSync(files.inputPath, json(records));
  const prepared = buildPartnerDataset(files);
  assert.equal(prepared.report.valid, false);
  assert.deepEqual(prepared.items.map((item) => item.item_id), ["FICTIONAL-001", "FICTIONAL-002"]);
  assert.deepEqual(prepared.report.sources.map(({ records, converted, failed }) => ({ records, converted, failed })), [{ records: 3, converted: 2, failed: 1 }]);
  assert.ok(prepared.report.errors.some((error) => error.source_record === 3 && error.code === "empty_question"));
});

test("malformed CSV headers, source arrays, rows, list cells and unreadable receipts fail safely", (t) => {
  const files = fixture(t);
  for (const records of [{}, [], [null], [1], [fictionalItem("FICTIONAL-001", { drawing_refs: [1] })]]) {
    fs.writeFileSync(files.inputPath, json(records));
    assert.equal(buildPartnerDataset(files).report.valid, false);
  }
  fs.writeFileSync(files.inputPath, "[broken");
  assert.ok(codes(buildPartnerDataset(files)).includes("unreadable_source"));
  fs.writeFileSync(files.inputPath, json([fictionalItem()]));
  fs.writeFileSync(files.receiptPath, "{broken");
  assert.ok(codes(buildPartnerDataset(files)).includes("unreadable_receipt"));
  writeReceipt(files, fictionalReceipt());
  const csvPath = path.join(files.directory, "bad.csv");
  for (const source of ["item_id,item_id\nONE,TWO\n", "item_id,\nONE,TWO\n", "item_id,text\nONE\n", "item_id,text\nONE,\"unclosed"]) {
    fs.writeFileSync(csvPath, source);
    assert.ok(codes(buildPartnerDataset({ inputPath: csvPath, receiptPath: files.receiptPath })).includes("unreadable_source"));
  }
  fs.writeFileSync(csvPath, csv(Object.keys(fictionalItem()).filter((field) => field !== "attachments"), [fictionalItem()]));
  assert.ok(codes(buildPartnerDataset({ inputPath: csvPath, receiptPath: files.receiptPath })).includes("missing_source_field"));
});

test("partner CLI dry-run and invalid input create no outputs and preserve original source bytes", (t) => {
  const files = fixture(t);
  const sourceBefore = fs.readFileSync(files.inputPath);
  const receiptBefore = fs.readFileSync(files.receiptPath);
  assert.equal(runPartnerPreparation([...cliArgs(files), "--dry-run"], { logger: silent }).exitCode, 0);
  assert.equal(fs.existsSync(files.output), false);
  assert.deepEqual(fs.readFileSync(files.inputPath), sourceBefore);
  assert.deepEqual(fs.readFileSync(files.receiptPath), receiptBefore);
  fs.writeFileSync(files.inputPath, json([fictionalItem("FICTIONAL-001", { submitted_date: "" })]));
  const invalidBytes = fs.readFileSync(files.inputPath);
  assert.equal(runPartnerPreparation(cliArgs(files), { logger: silent }).exitCode, 1);
  assert.equal(fs.existsSync(files.output), false);
  assert.deepEqual(fs.readFileSync(files.inputPath), invalidBytes);
  assert.throws(() => parsePartnerArgs(["--input", files.inputPath]), /Usage/);
});

test("partner CLI writes exactly three artifacts and prepared input passes standalone offline validation", (t) => {
  const files = fixture(t);
  const sourceBefore = fs.readFileSync(files.inputPath);
  const receiptBefore = fs.readFileSync(files.receiptPath);
  const prepared = runPartnerPreparation(cliArgs(files), { logger: silent });
  assert.equal(prepared.exitCode, 0);
  assert.deepEqual(fs.readdirSync(files.output).sort(), ["items.json", "manifest.json", "validation-report.json"]);
  assert.deepEqual(fs.readFileSync(files.inputPath), sourceBefore);
  assert.deepEqual(fs.readFileSync(files.receiptPath), receiptBefore);
  const input = path.join(files.output, "items.json");
  const inputBefore = fs.readFileSync(input);
  const items = loadPreparedItems(input, { provenance: "partner" });
  assert.equal(items.length, 1);
  assert.equal(items[0].item_id, "FICTIONAL-001");
  assert.equal(items[0].provenance, "partner");
  assert.deepEqual(fs.readFileSync(input), inputBefore);
  assert.deepEqual(fs.readdirSync(files.output).sort(), ["items.json", "manifest.json", "validation-report.json"]);
});

test("partner CLI refuses to overwrite a source, receipt, symlink target, or synthetic prepared directory", (t) => {
  const files = fixture(t, { sourceName: "items.json" });
  const before = fs.readFileSync(files.inputPath);
  assert.throws(() => runPartnerPreparation(["--input", files.inputPath, "--receipt", files.receiptPath, "--out-dir", files.directory], { logger: silent }), /overwrite/);
  assert.deepEqual(fs.readFileSync(files.inputPath), before);
  fs.mkdirSync(files.output);
  fs.symlinkSync(files.inputPath, path.join(files.output, "items.json"));
  assert.throws(() => runPartnerPreparation(cliArgs(files), { logger: silent }), /overwrite|symlink/);
  assert.deepEqual(fs.readFileSync(files.inputPath), before);
  fs.unlinkSync(path.join(files.output, "items.json"));
  fs.linkSync(files.inputPath, path.join(files.output, "items.json"));
  assert.throws(() => runPartnerPreparation(cliArgs(files), { logger: silent }), /hard link|overwrite/);
  assert.deepEqual(fs.readFileSync(files.inputPath), before);
  fs.unlinkSync(path.join(files.output, "items.json"));
  const unrelated = path.join(files.directory, "unrelated-synthetic-items.json");
  fs.writeFileSync(unrelated, "Unrelated synthetic artifact must stay unchanged\n");
  fs.symlinkSync(unrelated, path.join(files.output, "items.json"));
  assert.throws(() => runPartnerPreparation(cliArgs(files), { logger: silent }), /symlink/);
  assert.equal(fs.readFileSync(unrelated, "utf8"), "Unrelated synthetic artifact must stay unchanged\n");
  const receiptCollision = fixture(t, { sourceName: "raw.json" });
  const receiptTarget = path.join(receiptCollision.directory, "manifest.json");
  fs.renameSync(receiptCollision.receiptPath, receiptTarget);
  const receiptBefore = fs.readFileSync(receiptTarget);
  assert.throws(() => runPartnerPreparation(["--input", receiptCollision.inputPath, "--receipt", receiptTarget, "--out-dir", receiptCollision.directory], { logger: silent }), /overwrite/);
  assert.deepEqual(fs.readFileSync(receiptTarget), receiptBefore);
  const synthetic = path.join(root, "data/prepared/synthetic");
  assert.throws(() => runPartnerPreparation(["--input", files.inputPath, "--receipt", files.receiptPath, "--out-dir", synthetic], { logger: silent }), /outside data\/prepared\/synthetic/);
  assert.throws(() => runPartnerPreparation(["--input", files.inputPath, "--receipt", files.receiptPath, "--out-dir", path.join(synthetic, "fictional-not-created")], { logger: silent }), /outside data\/prepared\/synthetic/);
});
