import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const SOURCE = "demo2/data/source/synthetic-cases.json";
export const OUTPUT = "demo2/data/prepared/synthetic";
const SCHEMAS = [
  "demo2/schemas/rfi_schema.json",
  "demo2/schemas/daily_report_schema.json",
  "demo2/schemas/triage_output_schema.json"
];
export const serialize = (value) => JSON.stringify(value, null, 2) + "\n";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

function contracts() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return SCHEMAS.map((file) => {
    const bytes = read(file);
    const schema = JSON.parse(bytes);
    return { file, sha256: hash(bytes), schema, validate: ajv.compile(schema) };
  });
}

function checkRecord(record, contract, kind, id, errors) {
  if (!contract.validate(record)) {
    errors.push({ code: `${kind}_schema`, id: id ?? null, details: structuredClone(contract.validate.errors) });
  }
  if (!object(record)) return;
  for (const key of Object.keys(record)) {
    // The team's original schemas allow extra keys; the data handoff must not.
    if (!Object.hasOwn(contract.schema.properties, key)) {
      errors.push({ code: "unexpected_input_field", id: id ?? null, field: key });
    }
  }
  for (const key of contract.schema.required ?? []) {
    if (typeof record[key] === "string" && !record[key].trim()) {
      errors.push({ code: "blank_required_field", id: id ?? null, field: key });
    }
  }
}

function indexRecords(records, key, kind, contract, errors) {
  const index = new Map();
  const folded = new Set();
  for (const record of records) {
    const id = record?.[key];
    checkRecord(record, contract, kind, id, errors);
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
      errors.push({ code: "invalid_id", kind, id: id ?? null });
      continue;
    }
    if (folded.has(id.toLowerCase())) errors.push({ code: "duplicate_id", kind, id });
    else { index.set(id, record); folded.add(id.toLowerCase()); }
  }
  return index;
}

export function checkDemo2Inputs(rfis, dailyReports) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(rfis) || !rfis.length || !Array.isArray(dailyReports)) {
    return { valid: false, errors: [{ code: "invalid_batch", message: "RFIs must be a nonempty array and daily reports must be an array." }], warnings };
  }
  const [rfiContract, reportContract] = contracts();
  indexRecords(rfis, "rfi_id", "rfi", rfiContract, errors);
  const reports = indexRecords(dailyReports, "report_id", "daily_report", reportContract, errors);
  const linked = new Set();
  for (const rfi of rfis) {
    if (!Array.isArray(rfi?.linked_daily_report_ids)) continue;
    if (!rfi.linked_daily_report_ids.length) {
      warnings.push({ code: "preserved_missing_context", rfi_id: rfi.rfi_id, message: "No daily report is linked. Schema validity does not establish completeness or approval readiness." });
    }
    const seen = new Set();
    for (const reportId of rfi.linked_daily_report_ids) {
      if (seen.has(reportId)) errors.push({ code: "duplicate_link", rfi_id: rfi.rfi_id, report_id: reportId });
      seen.add(reportId);
      const report = reports.get(reportId);
      if (!report) errors.push({ code: "unresolved_report", rfi_id: rfi.rfi_id, report_id: reportId });
      else {
        linked.add(reportId);
        if (report.project_id !== rfi.project_id) {
          errors.push({ code: "cross_project_report", rfi_id: rfi.rfi_id, report_id: reportId });
        }
        if (typeof report.report_date === "string" && typeof rfi.date_submitted === "string" && report.report_date > rfi.date_submitted) {
          warnings.push({ code: "later_report_context", rfi_id: rfi.rfi_id, report_id: reportId, message: "The report postdates submission; establish the review time before using it as evidence." });
        }
      }
    }
  }
  for (const reportId of reports.keys()) {
    if (!linked.has(reportId)) errors.push({ code: "unlinked_report", report_id: reportId });
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function buildDemo2Dataset(sourceText = read(SOURCE)) {
  const source = JSON.parse(sourceText.replace(/^\uFEFF/, ""));
  const sourceErrors = [];
  if (!object(source) || source.provenance !== "synthetic" || typeof source.dataset_id !== "string" || !source.dataset_id.trim() ||
      typeof source.description !== "string" || !source.description.trim() || !Array.isArray(source.cases) || !source.cases.length) {
    throw new Error("Demo 2 source requires dataset_id, synthetic provenance, a description, and nonempty cases.");
  }
  for (const key of Object.keys(source)) {
    if (!["dataset_id", "provenance", "description", "cases"].includes(key)) sourceErrors.push({ code: "unexpected_source_field", field: key });
  }
  const rfis = [];
  const reportsById = new Map();
  for (const [index, entry] of source.cases.entries()) {
    if (!object(entry) || !object(entry.rfi) || !Array.isArray(entry.daily_reports)) {
      sourceErrors.push({ code: "invalid_source_case", source_pointer: `/cases/${index}` });
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!["rfi", "daily_reports"].includes(key)) sourceErrors.push({ code: "unexpected_source_field", source_pointer: `/cases/${index}`, field: key });
    }
    rfis.push(structuredClone(entry.rfi));
    const localIds = new Set();
    for (const report of entry.daily_reports) {
      const id = report?.report_id;
      if (localIds.has(id)) sourceErrors.push({ code: "duplicate_source_report", source_pointer: `/cases/${index}`, report_id: id ?? null });
      localIds.add(id);
      if (reportsById.has(id) && serialize(reportsById.get(id)) !== serialize(report)) {
        sourceErrors.push({ code: "conflicting_report_versions", report_id: id ?? null });
      } else reportsById.set(id, structuredClone(report));
    }
    if (Array.isArray(entry.rfi.linked_daily_report_ids)) {
      const expected = new Set(entry.rfi.linked_daily_report_ids);
      if (expected.size !== localIds.size || [...localIds].some((id) => !expected.has(id))) {
        sourceErrors.push({ code: "source_pairing_mismatch", rfi_id: entry.rfi.rfi_id });
      }
    }
  }
  const dailyReports = [...reportsById.values()];
  const checked = checkDemo2Inputs(rfis, dailyReports);
  const errors = [...sourceErrors, ...checked.errors];
  if (errors.length) throw new Error(`Demo 2 preparation failed:\n${serialize(errors)}`);
  const modelInputs = rfis.map((rfi) => ({
    rfi,
    daily_reports: rfi.linked_daily_report_ids.map((id) => reportsById.get(id))
  }));
  const counts = { rfis: rfis.length, daily_reports: dailyReports.length, model_inputs: modelInputs.length };
  const manifest = {
    dataset_id: source.dataset_id,
    provenance: source.provenance,
    source: { file: SOURCE, sha256: hash(sourceText) },
    schemas: contracts().map(({ file, sha256 }) => ({ file, sha256 })),
    counts,
    record_sources: source.cases.map((entry, index) => ({
      rfi_id: entry.rfi.rfi_id, source_pointer: `/cases/${index}`, daily_report_ids: entry.rfi.linked_daily_report_ids
    }))
  };
  const validationReport = {
    dataset_id: source.dataset_id,
    provenance: "synthetic",
    valid: true,
    validation_scope: "Input structure, dates, IDs, source pairing, project boundaries, and reproducibility only.",
    counts,
    errors: [],
    warnings: checked.warnings,
    limitations: [
      "All records are fictional smoke fixtures, separate from the public 17 records and Demo 1 primary 23 cases.",
      "No answer key is read by the preparation or input-validation pipeline; labels require separate team review.",
      "Current workflow state, routing history, and human approval events are not defined by the current RFI input schema.",
      "No model, application, endpoint, approval enforcement, accuracy, or real project time saving has been tested."
    ]
  };
  return {
    "rfis.json": rfis,
    "daily-reports.json": dailyReports,
    "model-inputs.json": modelInputs,
    "manifest.json": manifest,
    "validation-report.json": validationReport
  };
}

export function checkTriageOutputs(outputs, rfiIds) {
  const errors = [];
  if (!Array.isArray(outputs) || !outputs.length) {
    return { valid: false, errors: [{ code: "invalid_output_batch", message: "Outputs must be a nonempty JSON array." }] };
  }
  const outputContract = contracts()[2];
  const expected = new Set(rfiIds);
  const seen = new Set();
  for (const output of outputs) {
    const id = output?.rfi_id;
    checkRecord(output, outputContract, "triage_output", id, errors);
    if (seen.has(id)) errors.push({ code: "duplicate_output", rfi_id: id ?? null });
    seen.add(id);
    if (!expected.has(id)) errors.push({ code: "unknown_output_rfi", rfi_id: id ?? null });
    for (const conflict of Array.isArray(output?.flagged_conflicts) ? output.flagged_conflicts : []) {
      if (!object(conflict)) continue;
      for (const key of Object.keys(conflict)) {
        if (!["conflict_type", "severity", "details"].includes(key)) errors.push({ code: "unexpected_output_field", rfi_id: id, field: key });
      }
      if (typeof conflict.details === "string" && !conflict.details.trim()) errors.push({ code: "blank_conflict_details", rfi_id: id });
    }
  }
  for (const id of expected) if (!seen.has(id)) errors.push({ code: "missing_output_rfi", rfi_id: id });
  return { valid: errors.length === 0, errors };
}

export function prepareDemo2({ directory = path.join(ROOT, OUTPUT), sourceText = read(SOURCE) } = {}) {
  const artifacts = buildDemo2Dataset(sourceText);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(artifacts)) fs.writeFileSync(path.join(directory, name), serialize(value));
  return artifacts["validation-report.json"];
}

export function validateDemo2({ directory = path.join(ROOT, OUTPUT), sourceText = read(SOURCE) } = {}) {
  const artifacts = buildDemo2Dataset(sourceText);
  const errors = [];
  for (const [name, value] of Object.entries(artifacts)) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) errors.push({ code: "missing_artifact", file: `${OUTPUT}/${name}` });
    else if (fs.readFileSync(file, "utf8") !== serialize(value)) errors.push({ code: "stale_artifact", file: `${OUTPUT}/${name}` });
  }
  return { valid: errors.length === 0, errors, report: artifacts["validation-report.json"] };
}
