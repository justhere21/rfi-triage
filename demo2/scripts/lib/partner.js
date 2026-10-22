import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseCsv, listCell } from "./csv.js";
import { checkItems, INPUT_FIELDS } from "./check-items.js";

const schemaText = readFileSync(new URL("../schemas/input_schema.json", import.meta.url), "utf8");
const requiredFields = JSON.parse(schemaText).required;
const listFields = new Set(["drawing_refs", "spec_refs", "attachments", "related_item_ids"]);
const receiptFields = ["dataset_id", "provenance", "source_name", "received_date", "source_reference", "sharing_scope", "field_map", "field_descriptions"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonblank = (value) => typeof value === "string" && value.trim().length > 0;
const safeId = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
const parseJson = (text) => JSON.parse(text.replace(/^\uFEFF/, ""));

function answerColumn(column) {
  const normalized = column.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return /(^|_)(expected|true|answers?|ground_truth|labels?)(_|$)/.test(normalized) ||
    ["notes", "label_set", "route_decision", "recommended_action", "ready_to_route", "needs_response", "respond_from", "due_by", "contract_risk", "flags", "human_review_required", "risk_reason", "duplicate_of", "missing_information"].includes(normalized);
}

function realDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkReceipt(receipt) {
  const errors = [];
  const issue = (field, message) => errors.push({ code: "invalid_receipt", field, message });
  if (!isObject(receipt)) return [{ code: "invalid_receipt", message: "Receipt must be a JSON object" }];
  for (const field of Object.keys(receipt)) {
    if (!receiptFields.includes(field)) issue(field, "Unknown receipt field");
  }
  if (!safeId(receipt.dataset_id)) issue("dataset_id", "Use a nonempty dataset ID containing letters, digits, underscores, or hyphens, beginning with a letter or digit");
  if (receipt.provenance !== "partner") issue("provenance", "Explicitly declare partner provenance; synthetic/observed_public use their separate workflow");
  for (const field of ["source_name", "source_reference"]) {
    if (!nonblank(receipt[field])) issue(field, "A nonblank source value is required");
  }
  if (!realDate(receipt.received_date)) issue("received_date", "Use a real receipt date in YYYY-MM-DD format");
  if (!["local_only", "team_use"].includes(receipt.sharing_scope)) issue("sharing_scope", "Choose local_only or team_use based on the actual sharing permission");
  if (receipt.field_map !== undefined) {
    if (!isObject(receipt.field_map)) issue("field_map", "Field mapping must be an object from canonical input fields to source column names");
    else for (const [field, column] of Object.entries(receipt.field_map)) {
      if (!INPUT_FIELDS.includes(field)) issue(`field_map.${field}`, "Only canonical model input fields may be mapped");
      if (!nonblank(column)) issue(`field_map.${field}`, "Source column name must be a nonblank string");
      else if (answerColumn(column)) issue(`field_map.${field}`, "Answer, label, and notes columns cannot be mapped into model input");
    }
  }
  if (receipt.field_descriptions !== undefined) {
    if (!isObject(receipt.field_descriptions)) issue("field_descriptions", "Field descriptions must be an object");
    else for (const [field, description] of Object.entries(receipt.field_descriptions)) {
      if (!INPUT_FIELDS.includes(field) || typeof description !== "string") issue(`field_descriptions.${field}`, "Descriptions must use canonical input fields and string values");
    }
  }
  return errors;
}

// Read-only intake. The caller decides whether and where a valid batch is saved.
// Tests use fictional files; this function never creates partner records or labels.
export function buildPartnerDataset({ inputPath, receiptPath } = {}) {
  const errors = [];
  const warnings = [];
  let rows = [];
  const candidates = [];
  const failedRows = new Set();
  const excludedColumns = new Set();
  let receipt;
  let receiptBytes;
  let sourceBytes;
  let format;
  const sourcePath = typeof inputPath === "string" ? path.resolve(inputPath) : null;
  const receiptFilePath = typeof receiptPath === "string" ? path.resolve(receiptPath) : null;
  const source = { file: sourcePath ? path.basename(sourcePath) : null, path: sourcePath, sha256: null, records: 0, converted: 0, failed: 0 };

  try {
    if (!receiptFilePath) throw new Error("A receiptPath is required");
    receiptBytes = readFileSync(receiptFilePath);
    receipt = parseJson(receiptBytes.toString("utf8"));
    errors.push(...checkReceipt(receipt));
  } catch (error) {
    errors.push({ code: "unreadable_receipt", message: error.message });
  }

  try {
    if (!sourcePath) throw new Error("An inputPath is required");
    sourceBytes = readFileSync(sourcePath);
    source.sha256 = sha256(sourceBytes);
    format = path.extname(sourcePath).toLowerCase().slice(1);
    if (!["csv", "json"].includes(format)) throw new Error("Partner input must be a .json or .csv file");
    const parsed = format === "csv" ? parseCsv(sourceBytes.toString("utf8"), source.file) : parseJson(sourceBytes.toString("utf8"));
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("Partner input must contain a nonempty array of records");
    rows = parsed;
    source.records = rows.length;
  } catch (error) {
    errors.push({ code: "unreadable_source", source_file: source.file, message: error.message });
  }

  const receiptValid = checkReceipt(receipt).length === 0;
  const columnMapping = Object.fromEntries(INPUT_FIELDS.map((field) => [field, receiptValid ? receipt.field_map?.[field] ?? field : field]));
  const usedColumns = new Set(Object.values(columnMapping));
  for (const row of rows) {
    if (isObject(row)) for (const column of Object.keys(row)) {
      if (!usedColumns.has(column)) excludedColumns.add(column);
    }
  }
  const addRowError = (error, sourceRecord, itemId) => {
    failedRows.add(sourceRecord);
    errors.push({ ...error, source_file: source.file, source_record: sourceRecord, item_id: itemId ?? null });
  };

  for (const [index, row] of rows.entries()) {
    const sourceRecord = index + 1;
    if (!receiptValid) { failedRows.add(sourceRecord); continue; }
    if (!isObject(row)) {
      addRowError({ code: "invalid_source_record", message: "Each source record must be an object" }, sourceRecord);
      continue;
    }
    const itemId = row[columnMapping.item_id];
    if (Object.hasOwn(row, "provenance") && row.provenance !== "partner") {
      addRowError({ code: "mixed_provenance", message: "Supplied provenance must be partner, including when a field mapping is used" }, sourceRecord, itemId);
      continue;
    }
    const missing = requiredFields.filter((field) => field !== "provenance" && !Object.hasOwn(row, columnMapping[field]));
    if (missing.length) {
      for (const field of missing) addRowError({ code: "missing_source_field", field, source_column: columnMapping[field], message: `Required source field ${columnMapping[field]} is absent; no value was invented` }, sourceRecord, itemId);
      warnings.push({ code: "missing_source_fields", source_file: source.file, source_record: sourceRecord, item_id: itemId ?? null, fields: missing });
      continue;
    }
    try {
      // Explicit projection excludes author notes, answer columns, and all extras.
      const item = {};
      for (const field of INPUT_FIELDS) {
        const column = columnMapping[field];
        if (!Object.hasOwn(row, column)) {
          if (field === "provenance") item.provenance = receipt.provenance;
          continue;
        }
        item[field] = listFields.has(field) ? listCell(row[column]) : row[column];
      }
      const checked = checkItems([item], { provenance: "partner", checkRelations: false });
      for (const error of checked.errors) addRowError(error, sourceRecord, item.item_id);
      warnings.push(...checked.warnings.map((warning) => ({ ...warning, source_file: source.file, source_record: sourceRecord })));
      const emptyLists = [...listFields].filter((field) => Array.isArray(item[field]) && item[field].length === 0);
      if (emptyLists.length) warnings.push({ code: "preserved_empty_lists", source_file: source.file, source_record: sourceRecord, item_id: item.item_id, fields: emptyLists });
      if (!checked.errors.length) candidates.push({ item, source_record: sourceRecord });
    } catch (error) {
      addRowError({ code: "conversion", message: error.message }, sourceRecord, itemId);
    }
  }

  // Removing a failed target can reveal other unresolved references. Continue
  // until every surviving row is valid, while any failure still blocks saving.
  let remaining = candidates;
  while (remaining.length) {
    const checked = checkItems(remaining.map(({ item }) => item), { provenance: "partner" });
    if (!checked.errors.length) break;
    for (const error of checked.errors) {
      const affected = remaining.filter(({ item }) => error.code === "duplicate_id"
        ? item.item_id.toLowerCase() === error.item_id?.toLowerCase()
        : item.item_id === error.item_id);
      for (const record of affected) addRowError(error, record.source_record, record.item.item_id);
    }
    const next = remaining.filter((record) => !failedRows.has(record.source_record));
    if (next.length === remaining.length) break;
    remaining = next;
  }
  const items = remaining.map(({ item }) => item);
  source.converted = items.length;
  source.failed = failedRows.size;
  const excluded = [...excludedColumns].sort();
  if (excluded.length) warnings.push({ code: "excluded_source_columns", columns: excluded, message: "These source columns were excluded from model input; source files remain unchanged" });
  const report = {
    valid: errors.length === 0,
    counts: { source_records: source.records, input_records: items.length, failed_source_records: source.failed },
    sources: [source], excluded_columns: excluded, errors, warnings
  };
  const metadata = receiptValid ? Object.fromEntries(receiptFields.filter((field) => Object.hasOwn(receipt, field)).map((field) => [field, receipt[field]])) : null;
  const manifest = {
    dataset_id: receiptValid ? receipt.dataset_id : null,
    provenance: "partner", record_count: items.length,
    source: { ...source, format: format ?? null },
    receipt: { file: receiptFilePath ? path.basename(receiptFilePath) : null, path: receiptFilePath, sha256: receiptBytes ? sha256(receiptBytes) : null, metadata },
    schema_file: "scripts/schemas/input_schema.json", schema_sha256: sha256(schemaText),
    column_mapping: columnMapping, field_descriptions: receiptValid ? receipt.field_descriptions ?? {} : {},
    excluded_columns: excluded,
    generation_method: "Deterministic conversion of supplied partner records using a completed receipt. No synthetic values, labels, or model calls; absent row provenance uses the receipt's explicit partner declaration.",
    records: remaining.map(({ item, source_record }) => ({ item_id: item.item_id, source_file: source.file, source_record }))
  };
  return { items, manifest, report };
}
