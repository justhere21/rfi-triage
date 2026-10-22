import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseCsv, listCell } from "./csv.js";
import { checkItems, INPUT_FIELDS } from "./check-items.js";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const OUTPUT_DIR = "data/prepared/synthetic";
export const SOURCE_FILES = [
  "data/synthetic/synthetic-rfis.json",
  "data/synthetic/synthetic_emails.csv",
  "data/synthetic/synthetic_minutes.csv"
];
export const ANSWER_SOURCE = "data/synthetic/synthetic_answer_key.csv";
export const EMMA_DEFAULTS = {
  submitted_date: "2026-03-01",
  submitted_by: "Synthetic submitter (unspecified)",
  discipline: ""
};
export const serialize = (value) => JSON.stringify(value, null, 2) + "\n";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const stringOrEmpty = (value) => value === null || value === undefined ? "" : value;
function requireFields(row, fields) {
  const missing = fields.filter((field) => !Object.hasOwn(row, field));
  if (missing.length) throw new Error(`Missing source columns: ${missing.join(", ")}`);
}

function isNormalizedRfi(row) {
  return Object.hasOwn(row, "item_id") || Object.hasOwn(row, "question_text");
}

export function convertRfi(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("RFI source record must be an object");
  if (Object.hasOwn(row, "item_type") && row.item_type !== "rfi") throw new Error("RFI source item_type must be rfi");
  if (Object.hasOwn(row, "provenance") && row.provenance !== "synthetic") throw new Error("RFI source provenance must be synthetic");
  if (isNormalizedRfi(row)) {
    // Team-authored normalized inputs retain their supplied fixture metadata.
    // Required columns must exist; legacy defaults cannot conceal schema drift.
    requireFields(row, INPUT_FIELDS.filter((field) => field !== "current_drawing_version"));
    const item = convertMessage(row);
    if (row.current_drawing_version !== undefined) item.current_drawing_version = row.current_drawing_version;
    return item;
  }
  const item = {
    item_id: row.id,
    item_type: "rfi",
    provenance: "synthetic",
    submitted_date: row.submitted_date ?? EMMA_DEFAULTS.submitted_date,
    submitted_by: row.submitted_by ?? EMMA_DEFAULTS.submitted_by,
    discipline: row.discipline ?? EMMA_DEFAULTS.discipline,
    location: stringOrEmpty(row.location),
    question_text: row.question,
    drawing_refs: listCell(row.drawing_reference),
    spec_refs: listCell(row.spec_reference),
    attachments: listCell(row.supporting_documents),
    related_item_ids: listCell(row.related_rfi)
  };
  if (row.current_drawing_version !== undefined) item.current_drawing_version = row.current_drawing_version;
  return item;
}

export function convertMessage(row) {
  requireFields(row, INPUT_FIELDS.filter((field) => field !== "current_drawing_version"));
  // Explicit fields prevent notes, expected answers, or CSV extras from leaking.
  return {
    item_id: row.item_id, item_type: row.item_type, provenance: row.provenance,
    submitted_date: row.submitted_date, submitted_by: row.submitted_by,
    discipline: row.discipline, location: row.location, question_text: row.question_text,
    drawing_refs: listCell(row.drawing_refs), spec_refs: listCell(row.spec_refs),
    attachments: listCell(row.attachments), related_item_ids: listCell(row.related_item_ids)
  };
}

function messageAnswer(row) {
  requireFields(row, ["item_id", "true_flags", "true_related_item_ids", "true_needs_response", "true_respond_from", "true_contract_risk", "notes"]);
  if (!["yes", "no"].includes(row.true_needs_response)) throw new Error(`Invalid yes/no answer for ${row.item_id}`);
  const risk = row.true_contract_risk.toLowerCase();
  if (!["low", "medium", "high"].includes(risk)) throw new Error(`Invalid risk answer for ${row.item_id}`);
  return {
    needs_response: row.true_needs_response === "yes",
    respond_from: row.true_respond_from || null,
    contract_risk: risk,
    flags: row.true_flags === "none" ? [] : listCell(row.true_flags),
    related_item_ids: listCell(row.true_related_item_ids)
  };
}

export function buildDataset(root = REPO_ROOT) {
  const items = [];
  const answerKey = [];
  const records = [];
  const sources = [];
  const errors = [];
  const warnings = [];
  const read = (file) => readFileSync(path.join(root, file), "utf8");
  for (const [sourceIndex, file] of SOURCE_FILES.entries()) {
    const raw = read(file);
    const rows = sourceIndex === 0 ? JSON.parse(raw) : parseCsv(raw, file);
    if (!Array.isArray(rows) || !rows.length) throw new Error(`${file}: expected a nonempty array of records`);
    const summary = { file, sha256: hash(raw), records: rows.length, converted: 0, failed: 0 };
    for (const [index, row] of rows.entries()) {
      try {
        const item = sourceIndex === 0 ? convertRfi(row) : convertMessage(row);
        const checked = checkItems([item], { checkRelations: false });
        if (checked.errors.length) throw new Error(checked.errors.map((error) => error.message).join("; "));
        const record = { item_id: item.item_id, source_file: file, source_record: index + 1 };
        if (sourceIndex === 0) {
          record.source_format = isNormalizedRfi(row) ? "normalized" : "legacy";
          record.synthetic_defaults = record.source_format === "legacy"
            ? Object.fromEntries(Object.entries(EMMA_DEFAULTS).filter(([key]) => row[key] === null || row[key] === undefined))
            : {};
          record.source_title = row.title ?? null;
          record.modeled_on = row.modeled_on ?? null;
          if (!Array.isArray(row.expected_labels) || !row.expected_labels.length ||
              row.expected_labels.some((label) => typeof label !== "string" || !label.trim()) ||
              !["route", "revise", "review"].includes(row.expected_route_decision)) {
            throw new Error(`Missing or invalid source labels for ${item.item_id}`);
          }
          answerKey.push({
            item_id: item.item_id, label_set: "rfi_quality", source_file: file, source_record: index + 1,
            review_status: "source_labels_require_team_review",
            expected: { labels: row.expected_labels, recommended_action: row.expected_route_decision },
            original_labels: { expected_labels: row.expected_labels, expected_route_decision: row.expected_route_decision },
            notes: row.notes ?? ""
          });
        }
        items.push(item);
        summary.converted++;
        records.push(record);
      } catch (error) {
        // A bad record blocks publication of the entire prepared batch.
        summary.failed++;
        errors.push({ code: "conversion", source_file: file, source_record: index + 1, message: error.message });
      }
    }
    sources.push(summary);
  }
  const rawAnswers = read(ANSWER_SOURCE);
  const answerRows = parseCsv(rawAnswers, ANSWER_SOURCE);
  const answerSummary = { file: ANSWER_SOURCE, sha256: hash(rawAnswers), records: answerRows.length, converted: 0, failed: 0 };
  for (const [index, row] of answerRows.entries()) {
    try {
      answerKey.push({
        item_id: row.item_id, label_set: "message_triage", source_file: ANSWER_SOURCE, source_record: index + 1,
        review_status: "source_labels_require_team_review", expected: messageAnswer(row),
        original_labels: Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith("true_"))),
        notes: row.notes
      });
      answerSummary.converted++;
    } catch (error) {
      answerSummary.failed++;
      errors.push({ code: "answer_conversion", item_id: row.item_id, message: error.message });
    }
  }
  const checked = checkItems(items);
  errors.push(...checked.errors);
  warnings.push(...checked.warnings);
  const itemIds = new Set(items.map((item) => item.item_id));
  const answerIds = new Set();
  for (const answer of answerKey) {
    if (answerIds.has(answer.item_id)) errors.push({ code: "duplicate_answer", item_id: answer.item_id, message: "Repeated answer ID" });
    answerIds.add(answer.item_id);
    if (!itemIds.has(answer.item_id)) errors.push({ code: "orphan_answer", item_id: answer.item_id, message: "Answer has no input item" });
    for (const related of answer.expected.related_item_ids ?? []) {
      if (!itemIds.has(related)) errors.push({ code: "unresolved_answer_relation", item_id: answer.item_id, message: `Answer references absent ${related}` });
    }
  }
  for (const item_id of itemIds) {
    if (!answerIds.has(item_id)) errors.push({ code: "missing_answer", item_id, message: "No source answer found" });
  }
  for (const answer of answerKey.filter((answer) => answer.expected.needs_response === false)) {
    warnings.push({ code: "needs_response_definition_review", item_id: answer.item_id, message: "Source answer says no, but the message asks for confirmation. Agree on the response-need definition before scoring; source answer retained." });
  }
  for (const answer of answerKey) {
    const input = items.find((item) => item.item_id === answer.item_id);
    const answerOnlyRelations = (answer.expected.related_item_ids ?? []).filter((id) => !input?.related_item_ids.includes(id));
    if (answerOnlyRelations.length) warnings.push({
      code: "answer_only_relationship", item_id: answer.item_id,
      message: `Source answer identifies ${answerOnlyRelations.join(", ")}; retained only in the answer key, not added to model input.`
    });
  }
  const defaultedRecords = records.filter((record) => Object.keys(record.synthetic_defaults ?? {}).length);
  if (defaultedRecords.length) warnings.push({
    code: "synthetic_defaults",
    message: `${defaultedRecords.length} legacy RFI records received documented defaults: missing dates use synthetic 2026-03-01, unspecified submitters use a labeled placeholder, and unknown disciplines stay blank. See each manifest record for the fields actually defaulted; these values are not observed facts or chronology.`
  });
  warnings.push(
    { code: "synthetic_metadata", message: "Supplied dates, submitters, disciplines, and other metadata belong to team-authored synthetic scenarios; they do not establish observed project events or chronology." },
    { code: "synthetic_attachments", message: "Attachment names are simulated declarations, not verified on-disk documents. No source content or document-access claim is generated." },
    { code: "output_contract_review", message: "RFI quality labels are separate evaluation targets described in evaluation-design.md. Agree on a vocabulary and any external evaluator mapping before scoring. Routing readiness/recommended_action is an evaluation concept, not a source fact; do not infer unrelated response or risk answers from these labels." },
    { code: "risk_and_respondent_review", message: "Source answers use schedule/coordination risk and sometimes the submitter as respondent. Agree on the contract-risk and respondent definitions before scoring." }
  );
  const report = {
    valid: errors.length === 0,
    counts: { input_records: items.length, answer_records: answerKey.length, failed_source_records: sources.reduce((sum, source) => sum + source.failed, 0) + answerSummary.failed },
    sources, answer_source: answerSummary, errors, warnings
  };
  const manifest = {
    dataset_id: "synthetic-labeled-v1", provenance: "synthetic", record_count: items.length,
    input_file: `${OUTPUT_DIR}/items.json`, answer_key_file: `${OUTPUT_DIR}/answer-key.json`,
    schema_file: "scripts/schemas/input_schema.json", schema_sha256: hash(read("scripts/schemas/input_schema.json")),
    sources, answer_source: answerSummary,
    generation_method: "Deterministic field mapping of existing team-authored synthetic cases. No random generation or model calls.",
    synthetic_defaults: Object.assign({}, ...defaultedRecords.map((record) => record.synthetic_defaults)),
    defaulted_record_count: defaultedRecords.length,
    legacy_default_policy: EMMA_DEFAULTS,
    date_default_reason: "Only legacy RFI sources missing a date use fixed arbitrary fixture date 2026-03-01 to satisfy the schema. Normalized sources preserve their supplied required metadata. Consult per-record synthetic_defaults for actual application; no fixture date is an observed event or timeline.",
    records
  };
  return { items, answerKey, manifest, report };
}

export function artifacts(dataset) {
  return {
    "items.json": dataset.items,
    "answer-key.json": dataset.answerKey,
    "manifest.json": dataset.manifest,
    "validation-report.json": dataset.report
  };
}
