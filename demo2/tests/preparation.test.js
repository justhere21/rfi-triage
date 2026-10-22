import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCsv, listCell } from "../scripts/lib/csv.js";
import { checkItems, INPUT_FIELDS } from "../scripts/lib/check-items.js";
import {
  ANSWER_SOURCE, EMMA_DEFAULTS, OUTPUT_DIR, REPO_ROOT, SOURCE_FILES,
  artifacts, buildDataset, convertRfi, serialize
} from "../scripts/lib/prepare.js";
import { validatePrepared } from "../scripts/validate-data.js";

const read = (file, root = REPO_ROOT) => fs.readFileSync(path.join(root, file), "utf8");
const readJson = (file, root = REPO_ROOT) => JSON.parse(read(file, root));
const dataset = buildDataset();
const itemById = (id) => structuredClone(dataset.items.find((item) => item.item_id === id));
const codes = (items) => checkItems(items).errors.map((issue) => issue.code);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rfi-preparation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ["scripts/schemas/input_schema.json", ...SOURCE_FILES, ANSWER_SOURCE]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, file), target);
  }
  return root;
}

function mutateRfis(root, edit) {
  const records = readJson(SOURCE_FILES[0], root);
  edit(records);
  fs.writeFileSync(path.join(root, SOURCE_FILES[0]), serialize(records));
}

function writePrepared(root) {
  const directory = path.join(root, OUTPUT_DIR);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(artifacts(buildDataset(root)))) {
    fs.writeFileSync(path.join(directory, name), serialize(value));
  }
}

test("preparation produces exactly the 23 labeled source cases and 15/4/4 types", () => {
  assert.equal(dataset.report.valid, true);
  assert.deepEqual(dataset.report.errors, []);
  assert.deepEqual(dataset.report.counts, {
    input_records: 23, answer_records: 23, failed_source_records: 0
  });
  const expectedIds = [
    ...Array.from({ length: 15 }, (_, index) => `RFI-${String(index + 1).padStart(3, "0")}`),
    ...["EMAIL", "MIN"].flatMap((prefix) => Array.from({ length: 4 }, (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`))
  ];
  assert.deepEqual(dataset.items.map((item) => item.item_id), expectedIds);
  assert.deepEqual(dataset.answerKey.map((answer) => answer.item_id), expectedIds);
  assert.deepEqual(Object.fromEntries(["rfi", "email", "minutes"].map((type) => [type, dataset.items.filter((item) => item.item_type === type).length])), {
    rfi: 15, email: 4, minutes: 4
  });
  assert.deepEqual(dataset.report.sources.map(({ records, converted, failed }) => ({ records, converted, failed })), [
    { records: 15, converted: 15, failed: 0 },
    { records: 4, converted: 4, failed: 0 },
    { records: 4, converted: 4, failed: 0 }
  ]);
});

test("model inputs contain only approved fields while source labels remain separately lossless", () => {
  for (const item of dataset.items) {
    assert.equal(item.provenance, "synthetic");
    assert.ok(Object.keys(item).every((field) => INPUT_FIELDS.includes(field)));
    for (const field of Object.keys(item)) assert.doesNotMatch(field, /expected|true_|answer|label|notes|title|modeled_on/);
  }
  for (const source of readJson(SOURCE_FILES[0])) {
    const answer = dataset.answerKey.find((row) => row.item_id === source.item_id);
    assert.deepEqual(answer.original_labels, {
      expected_labels: source.expected_labels,
      expected_route_decision: source.expected_route_decision
    });
    assert.deepEqual(answer.expected, {
      labels: source.expected_labels, recommended_action: source.expected_route_decision
    });
    assert.equal(answer.notes, source.notes);
    assert.equal(answer.review_status, "source_labels_require_team_review");
    assert.equal("needs_response" in answer.expected, false);
  }
  for (const source of parseCsv(read(ANSWER_SOURCE))) {
    const answer = dataset.answerKey.find((row) => row.item_id === source.item_id);
    assert.deepEqual(answer.original_labels, Object.fromEntries(Object.entries(source).filter(([field]) => field.startsWith("true_"))));
    assert.equal(answer.expected.needs_response, source.true_needs_response === "yes");
    assert.equal(answer.expected.contract_risk, source.true_contract_risk.toLowerCase());
    assert.equal(answer.expected.respond_from, source.true_respond_from);
    assert.deepEqual(answer.expected.flags, source.true_flags === "none" ? [] : listCell(source.true_flags));
  }
});

test("related input IDs preserve only explicit source references without answer leakage", () => {
  const relations = dataset.items.filter((item) => item.related_item_ids.length).map(({ item_id, related_item_ids }) => ({ item_id, related_item_ids }));
  assert.deepEqual(relations, [
    { item_id: "RFI-002", related_item_ids: ["RFI-010"] },
    { item_id: "RFI-012", related_item_ids: ["RFI-013"] },
    { item_id: "RFI-013", related_item_ids: ["RFI-012"] }
  ]);
  assert.deepEqual(itemById("MIN-003").related_item_ids, []);
  assert.deepEqual(dataset.answerKey.find((answer) => answer.item_id === "MIN-003").expected.related_item_ids, ["EMAIL-004"]);
});

test("current drawing evidence and intentional missing information survive conversion", () => {
  assert.deepEqual(itemById("RFI-014").drawing_refs, ["A3.2 Revision 1"]);
  assert.equal(itemById("RFI-014").current_drawing_version, "A3.2 Revision 3");
  assert.equal(itemById("RFI-003").location, "");
  assert.deepEqual(itemById("RFI-003").spec_refs, []);
  assert.deepEqual(itemById("RFI-004").drawing_refs, []);
  assert.deepEqual(itemById("EMAIL-002").attachments, []);
  assert.deepEqual(itemById("EMAIL-003").drawing_refs, []);
  assert.deepEqual(itemById("EMAIL-003").spec_refs, []);
  assert.deepEqual(itemById("EMAIL-001").spec_refs, ["23 31 13"]);
  assert.deepEqual(itemById("RFI-001").attachments, ["ceiling-coordination-markup.pdf"]);
  assert.ok(dataset.report.warnings.some((warning) => warning.code === "preserved_missing_fields" && warning.item_id === "RFI-003"));
});

test("normalized source metadata is preserved without applying legacy defaults", () => {
  for (const source of readJson(SOURCE_FILES[0])) {
    const item = itemById(source.item_id);
    for (const field of ["submitted_date", "submitted_by", "discipline"]) assert.equal(item[field], source[field]);
    const record = dataset.manifest.records.find((record) => record.item_id === source.item_id);
    assert.deepEqual(record.synthetic_defaults, {});
    assert.equal(record.source_format, "normalized");
    assert.equal(record.source_file, SOURCE_FILES[0]);
    assert.ok(record.source_record >= 1 && record.source_record <= 15);
  }
  assert.equal(itemById("RFI-001").submitted_date, "2026-09-16");
  assert.equal(itemById("RFI-015").submitted_date, "2026-09-30");
  assert.equal(itemById("RFI-001").submitted_by, "Synthetic Test Case");
  assert.equal(itemById("RFI-001").discipline, "Electrical / Architectural");
  assert.deepEqual(dataset.manifest.synthetic_defaults, {});
  assert.equal(dataset.manifest.defaulted_record_count, 0);
  assert.deepEqual(dataset.manifest.legacy_default_policy, EMMA_DEFAULTS);
  assert.equal(dataset.report.warnings.some((warning) => warning.code === "synthetic_defaults"), false);
  assert.ok(dataset.report.warnings.some((warning) => warning.code === "synthetic_metadata"));
  assert.equal(itemById("EMAIL-001").submitted_date, "2026-03-16");
  assert.equal(itemById("EMAIL-001").submitted_by, "Cascade Mechanical");
  assert.equal(itemById("EMAIL-001").discipline, "M");
  assert.deepEqual(artifacts(buildDataset()), artifacts(dataset));
  assert.equal(serialize(artifacts(buildDataset())), serialize(artifacts(dataset)));
  for (const source of dataset.manifest.sources) assert.match(source.sha256, /^[a-f0-9]{64}$/);
});

test("legacy labeled sources retain defaults, explicit metadata and separate answers", (t) => {
  const root = fixture(t);
  const legacy = {
    id: "SYN-LEGACY-001", title: "Legacy author cue", question: "Please confirm the wall detail.",
    location: null, drawing_reference: ["A1.1 Revision 1"], spec_reference: null,
    supporting_documents: null, current_drawing_version: "A1.1 Revision 2",
    expected_labels: ["INCOMPLETE", "MISSING_LOCATION"], expected_route_decision: "revise",
    notes: "Private source explanation"
  };
  const explicit = {
    ...legacy, id: "SYN-LEGACY-002", location: "Room 100", related_rfi: "SYN-LEGACY-001",
    submitted_date: "2026-03-05", submitted_by: "Legacy fixture author", discipline: "A"
  };
  fs.writeFileSync(path.join(root, SOURCE_FILES[0]), serialize([legacy, explicit]));
  const changed = buildDataset(root);
  assert.equal(changed.report.valid, true);
  assert.equal(changed.items.length, 10);
  const first = changed.items[0];
  assert.equal(first.item_id, legacy.id);
  assert.equal(first.question_text, legacy.question);
  assert.equal(first.location, "");
  assert.deepEqual(first.drawing_refs, legacy.drawing_reference);
  assert.deepEqual(first.spec_refs, []);
  assert.deepEqual(first.attachments, []);
  assert.equal(first.current_drawing_version, legacy.current_drawing_version);
  for (const [field, value] of Object.entries(EMMA_DEFAULTS)) assert.equal(first[field], value);
  assert.equal("notes" in first, false);
  assert.equal("title" in first, false);
  assert.equal("expected_labels" in first, false);
  assert.deepEqual(changed.manifest.records[0].synthetic_defaults, EMMA_DEFAULTS);
  assert.equal(changed.manifest.records[0].source_format, "legacy");
  assert.equal(changed.manifest.records[0].source_title, legacy.title);
  assert.deepEqual(changed.manifest.records[1].synthetic_defaults, {});
  assert.equal(changed.items[1].submitted_date, explicit.submitted_date);
  assert.equal(changed.items[1].submitted_by, explicit.submitted_by);
  assert.equal(changed.items[1].discipline, explicit.discipline);
  assert.deepEqual(changed.items[1].related_item_ids, [legacy.id]);
  assert.equal(changed.manifest.defaulted_record_count, 1);
  assert.deepEqual(changed.manifest.synthetic_defaults, EMMA_DEFAULTS);
  assert.ok(changed.report.warnings.some((warning) => warning.code === "synthetic_defaults" && warning.message.startsWith("1 legacy RFI records")));
  assert.deepEqual(changed.answerKey[0].original_labels.expected_labels, legacy.expected_labels);
});

test("normalized RFIs reject contradictory provenance/type and missing required columns", () => {
  const source = readJson(SOURCE_FILES[0])[0];
  for (const provenance of ["partner", "observed_public", null]) {
    assert.throws(() => convertRfi({ ...source, provenance }), /provenance must be synthetic/);
  }
  for (const item_type of ["email", "minutes", null]) {
    assert.throws(() => convertRfi({ ...source, item_type }), /item_type must be rfi/);
  }
  for (const field of ["submitted_date", "submitted_by", "discipline", "attachments", "item_id", "question_text"]) {
    const missing = { ...source };
    delete missing[field];
    assert.throws(() => convertRfi(missing), /Missing source columns/);
  }
  const nullDate = convertRfi({ ...source, submitted_date: null });
  assert.equal(nullDate.submitted_date, null);
  assert.ok(codes([nullDate]).includes("input_schema"));
});

test("contradictory normalized source metadata blocks the prepared batch", (t) => {
  const root = fixture(t);
  mutateRfis(root, (records) => { records[0].provenance = "partner"; });
  const changed = buildDataset(root);
  assert.equal(changed.report.valid, false);
  assert.equal(changed.report.sources[0].failed, 1);
  assert.ok(changed.report.errors.some((issue) => /provenance must be synthetic/.test(issue.message)));
  assert.equal(changed.items.some((item) => item.item_id === "RFI-001"), false);
});

test("explicit RFI source metadata overrides defaults without manufacturing assumptions", (t) => {
  const root = fixture(t);
  mutateRfis(root, (records) => Object.assign(records[0], {
    submitted_date: "2026-03-05", submitted_by: "Fixture author", discipline: "A"
  }));
  const changed = buildDataset(root);
  assert.equal(changed.report.valid, true);
  assert.equal(changed.items[0].submitted_date, "2026-03-05");
  assert.equal(changed.items[0].submitted_by, "Fixture author");
  assert.equal(changed.items[0].discipline, "A");
  assert.deepEqual(changed.manifest.records[0].synthetic_defaults, {});
});

test("CSV parser handles BOM, CRLF, quoted commas, escaped quotes, multiline text and blank lines", () => {
  const source = '\uFEFFitem_id,text,empty\r\nONE,"A, B and ""quoted""\r\nnext line",\r\n\r\nTWO,last,\r\n';
  assert.deepEqual(parseCsv(source), [
    { item_id: "ONE", text: 'A, B and "quoted"\r\nnext line', empty: "" },
    { item_id: "TWO", text: "last", empty: "" }
  ]);
  assert.deepEqual(parseCsv('id,text\nONE,"final quoted cell"'), [{ id: "ONE", text: "final quoted cell" }]);
});

test("CSV parser rejects malformed quotes, row widths and ambiguous headers", () => {
  for (const source of ['id,text\nONE,"unclosed', 'id,text\nONE,"closed"extra', 'id,text\nONE,un"quoted']) {
    assert.throws(() => parseCsv(source, "bad.csv"), /bad\.csv:.*(quoted cell|unexpected character)/);
  }
  assert.throws(() => parseCsv("id,text\nONE"), /has 1 cells; expected 2/);
  assert.throws(() => parseCsv("id,text\nONE,two,extra"), /has 3 cells; expected 2/);
  assert.throws(() => parseCsv("id,id\nONE,TWO"), /duplicate column/);
  assert.throws(() => parseCsv("id,\nONE,TWO"), /empty or duplicate/);
  assert.throws(() => parseCsv("\n\r\n"), /missing header/);
});

test("array cells preserve specification spaces, support JSON or pipes and reject bad types", () => {
  assert.deepEqual(listCell("23 31 13"), ["23 31 13"]);
  assert.deepEqual(listCell("A1 | A2||"), ["A1", "A2"]);
  assert.deepEqual(listCell('["A1", "23 31 13"]'), ["A1", "23 31 13"]);
  assert.deepEqual(listCell(null), []);
  assert.deepEqual(listCell(undefined), []);
  assert.deepEqual(listCell(""), []);
  assert.deepEqual(listCell(["A1"]), ["A1"]);
  for (const invalid of [1, {}, ["A1", 2], '["A1", 2]', "[invalid"]) assert.throws(() => listCell(invalid));
});

test("input validation rejects missing schema fields and impossible dates", () => {
  const missing = itemById("RFI-006");
  delete missing.drawing_refs;
  assert.ok(codes([missing]).includes("input_schema"));
  assert.ok(codes([{ ...itemById("RFI-006"), submitted_date: "2026-02-30" }]).includes("input_schema"));
  assert.ok(codes([{ ...itemById("RFI-006"), current_drawing_version: 3 }]).includes("input_schema"));
});

test("input validation rejects duplicate or unsafe IDs and empty input or questions", () => {
  assert.ok(codes([itemById("RFI-006"), itemById("RFI-006")]).includes("duplicate_id"));
  assert.ok(codes([itemById("RFI-006"), { ...itemById("RFI-006"), item_id: "rfi-006" }]).includes("duplicate_id"));
  for (const id of ["", "../outside", "A/B", "A\\B", "A B", "a\n"]) {
    assert.ok(codes([{ ...itemById("RFI-006"), item_id: id }]).includes("unsafe_id"), `Rejected ${JSON.stringify(id)}`);
  }
  assert.ok(codes([]).includes("invalid_batch"));
  assert.ok(codes({}).includes("invalid_batch"));
  assert.ok(codes([{ ...itemById("RFI-006"), question_text: "  " }]).includes("empty_question"));
});

test("input validation blocks answer leakage, unresolved or self relations and mixed provenance", () => {
  for (const field of ["title", "expected_labels", "expected_route_decision", "notes", "true_needs_response", "modeled_on"]) {
    assert.ok(codes([{ ...itemById("RFI-006"), [field]: "withheld answer" }]).includes("unexpected_input_field"), `Blocked ${field}`);
  }
  assert.ok(codes([{ ...itemById("RFI-006"), related_item_ids: ["ABSENT"] }]).includes("unresolved_relation"));
  assert.ok(codes([{ ...itemById("RFI-006"), related_item_ids: ["RFI-006"] }]).includes("self_relation"));
  assert.ok(codes([{ ...itemById("RFI-006"), provenance: "partner" }]).includes("mixed_provenance"));
  assert.deepEqual(codes([itemById("RFI-003")]), []);
});

test("a corrupt source record reports its failure while retaining valid records from all files", (t) => {
  const root = fixture(t);
  mutateRfis(root, (records) => { records[0].question_text = ""; });
  const changed = buildDataset(root);
  assert.equal(changed.report.valid, false);
  assert.deepEqual(changed.report.counts, { input_records: 22, answer_records: 22, failed_source_records: 1 });
  assert.equal(changed.report.sources[0].converted, 14);
  assert.equal(changed.report.sources[0].failed, 1);
  assert.deepEqual(changed.report.sources.slice(1).map((source) => source.converted), [4, 4]);
  assert.ok(changed.items.some((item) => item.item_id === "EMAIL-004"));
  assert.ok(changed.items.some((item) => item.item_id === "MIN-004"));
  assert.ok(changed.report.errors.some((issue) => issue.code === "conversion" && issue.source_record === 1));
});

test("missing source labels block a valid prepared report instead of inventing an answer", (t) => {
  const root = fixture(t);
  mutateRfis(root, (records) => { delete records[0].expected_labels; });
  const changed = buildDataset(root);
  assert.equal(changed.report.valid, false);
  assert.equal(changed.report.counts.failed_source_records, 1);
  assert.ok(changed.report.errors.some((issue) => /Missing or invalid source labels/.test(issue.message)));
  assert.equal(changed.items.some((item) => item.item_id === "RFI-001"), false);
  assert.equal(changed.answerKey.some((answer) => answer.item_id === "RFI-001"), false);
});

test("invalid message answer values are reported and missing answers block batch validity", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ANSWER_SOURCE), read(ANSWER_SOURCE, root).replace(",no,Cascade Mechanical,", ",unknown,Cascade Mechanical,"));
  const changed = buildDataset(root);
  assert.equal(changed.report.valid, false);
  assert.deepEqual(changed.report.counts, { input_records: 23, answer_records: 22, failed_source_records: 1 });
  assert.ok(changed.report.errors.some((issue) => issue.code === "answer_conversion" && issue.item_id === "EMAIL-001"));
  assert.ok(changed.report.errors.some((issue) => issue.code === "missing_answer" && issue.item_id === "EMAIL-001"));
});

test("malformed source files cannot silently become a successful empty dataset", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, SOURCE_FILES[0]), "{}");
  assert.throws(() => buildDataset(root), /expected a nonempty array/);
  fs.writeFileSync(path.join(root, SOURCE_FILES[0]), "[broken JSON");
  assert.throws(() => buildDataset(root), SyntaxError);
});

test("missing CSV list columns fail conversion instead of silently creating empty arrays", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, SOURCE_FILES[1]), read(SOURCE_FILES[1], root).replace("attachments", "attachment_typo"));
  const changed = buildDataset(root);
  assert.equal(changed.report.valid, false);
  assert.equal(changed.report.sources[1].converted, 0);
  assert.equal(changed.report.sources[1].failed, 4);
  assert.ok(changed.report.errors.some((issue) => issue.code === "conversion" && /Missing source columns: attachments/.test(issue.message)));
});

test("missing answer columns fail rather than silently erase source label fields", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, ANSWER_SOURCE), read(ANSWER_SOURCE, root).replace("true_related_item_ids", "relationship_typo"));
  const changed = buildDataset(root);
  assert.equal(changed.report.valid, false);
  assert.equal(changed.report.answer_source.failed, 8);
  assert.equal(changed.answerKey.length, 15);
  assert.ok(changed.report.errors.some((issue) => issue.code === "answer_conversion" && /Missing source columns: true_related_item_ids/.test(issue.message)));
});

test("checked-in prepared artifacts exactly reproduce the current raw sources", () => {
  for (const [name, value] of Object.entries(artifacts(dataset))) {
    assert.equal(read(`${OUTPUT_DIR}/${name}`), serialize(value), `${name} is reproducible`);
  }
});

test("offline validation accepts current artifacts without rewriting them", (t) => {
  const root = fixture(t);
  writePrepared(root);
  const names = Object.keys(artifacts(dataset));
  const before = names.map((name) => read(`${OUTPUT_DIR}/${name}`, root));
  const checked = validatePrepared(root);
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(names.map((name) => read(`${OUTPUT_DIR}/${name}`, root)), before);
});

test("offline validation reports missing prepared files without creating artifacts", (t) => {
  const root = fixture(t);
  const checked = validatePrepared(root);
  assert.equal(checked.valid, false);
  assert.equal(checked.errors.filter((issue) => issue.code === "unreadable_artifact").length, 4);
  assert.equal(fs.existsSync(path.join(root, OUTPUT_DIR)), false);
});

test("offline validation detects source changes and preserves stale prepared files for review", (t) => {
  const root = fixture(t);
  writePrepared(root);
  const before = read(`${OUTPUT_DIR}/items.json`, root);
  mutateRfis(root, (records) => { records[0].question_text += " Additional source context."; });
  const checked = validatePrepared(root);
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some((issue) => issue.code === "stale_artifact" && issue.file.endsWith("items.json")));
  assert.equal(read(`${OUTPUT_DIR}/items.json`, root), before);
});

test("offline validation detects modified inputs with leaked answers and changed answer keys", (t) => {
  const root = fixture(t);
  writePrepared(root);
  const items = readJson(`${OUTPUT_DIR}/items.json`, root);
  items[0].expected_labels = ["INJECTED_ANSWER"];
  fs.writeFileSync(path.join(root, OUTPUT_DIR, "items.json"), serialize(items));
  const answers = readJson(`${OUTPUT_DIR}/answer-key.json`, root);
  answers[0].expected.labels = ["ALTERED_SOURCE_LABEL"];
  fs.writeFileSync(path.join(root, OUTPUT_DIR, "answer-key.json"), serialize(answers));
  const checked = validatePrepared(root);
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some((issue) => issue.code === "unexpected_input_field"));
  for (const name of ["items.json", "answer-key.json"]) {
    assert.ok(checked.errors.some((issue) => issue.code === "stale_artifact" && issue.file.endsWith(name)));
  }
  assert.deepEqual(readJson(`${OUTPUT_DIR}/items.json`, root)[0].expected_labels, ["INJECTED_ANSWER"]);
});

test("offline validation rejects unreadable artifacts and broken sources without writes", (t) => {
  const root = fixture(t);
  writePrepared(root);
  fs.writeFileSync(path.join(root, OUTPUT_DIR, "manifest.json"), "[invalid");
  const unreadable = validatePrepared(root);
  assert.equal(unreadable.valid, false);
  assert.ok(unreadable.errors.some((issue) => issue.code === "unreadable_artifact" && issue.file.endsWith("manifest.json")));
  assert.equal(read(`${OUTPUT_DIR}/manifest.json`, root), "[invalid");
  fs.writeFileSync(path.join(root, SOURCE_FILES[0]), "[invalid");
  const broken = validatePrepared(root);
  assert.equal(broken.valid, false);
  assert.ok(broken.errors.some((issue) => issue.code === "source_error"));
});
