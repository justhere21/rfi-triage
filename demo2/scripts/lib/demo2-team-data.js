import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { ROOT, serialize, checkDemo2Inputs } from "./demo2-data.js";

export const TEAM_SOURCE = "demo2/data/synthetic";
export const TEAM_OUTPUT = "demo2/data/prepared/team-tc";
const SCHEMAS = [
  "demo2/schemas/rfi_schema.json",
  "demo2/schemas/triage_output_schema.json",
  "demo2/schemas/daily_report_schema.json"
];
const ALIASES = { rfi_id: "id", title: "topic" };
const ANNOTATIONS = ["assignee", "status", "conflict"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readSource = () => fs.readFileSync(path.join(ROOT, TEAM_SOURCE));
const same = (left, right) => isDeepStrictEqual(left, right);

function contracts() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return SCHEMAS.map((file) => {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    const schema = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    return { file, sha256: hash(bytes), schema, validate: ajv.compile(schema) };
  });
}

function sourceBytes(sourceText) {
  if (typeof sourceText === "string") return Buffer.from(sourceText, "utf8");
  if (Buffer.isBuffer(sourceText)) return sourceText;
  throw new Error("Team-case source must be JSON text or a Buffer.");
}

export function buildTeamCaseArtifacts(sourceText = readSource()) {
  const bytes = sourceBytes(sourceText);
  const source = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(source) || !source.length || source.some((row) => !object(row))) {
    throw new Error("Team-case source must be a nonempty JSON array of objects.");
  }
  const [rfiContract, outputContract, reportContract] = contracts();
  const fields = Object.keys(rfiContract.schema.properties);
  const recognized = new Set([...fields, ...Object.values(ALIASES), "project", ...ANNOTATIONS, "daily_reports"]);
  const vocabulary = {
    status: outputContract.schema.properties.approval_status.enum,
    assignee: outputContract.schema.properties.current_assignee.enum,
    conflict: outputContract.schema.properties.flagged_conflicts.items.properties.conflict_type.enum
  };
  const candidates = [];
  const annotations = [];
  const records = [];
  const contexts = [];
  const statusCounts = new Map();

  for (const [index, row] of source.entries()) {
    const sourceId = own(row, "id") ? structuredClone(row.id) : (own(row, "rfi_id") ? structuredClone(row.rfi_id) : null);
    const sourcePointer = `/${index}`;
    const rfi = {};
    const mappings = [];
    const blockers = [];
    for (const field of fields) {
      const alias = ALIASES[field];
      if (own(row, field)) {
        rfi[field] = structuredClone(row[field]);
        mappings.push({ source_field: field, target_field: field, method: "explicit" });
      }
      if (alias && own(row, alias)) {
        mappings.push({ source_field: alias, target_field: field, method: "alias" });
        if (own(row, field) && !same(row[field], row[alias])) {
          blockers.push({ code: "alias_conflict", source_field: alias, target_field: field, canonical_value: structuredClone(row[field]), alias_value: structuredClone(row[alias]) });
        } else if (!own(row, field)) rfi[field] = structuredClone(row[alias]);
      }
    }
    const missing = rfiContract.schema.required.filter((field) => !own(rfi, field));
    if (missing.length) blockers.push({ code: "missing_required_fields", fields: missing });
    const schemaValid = rfiContract.validate(rfi);
    const schemaErrors = schemaValid ? [] : structuredClone(rfiContract.validate.errors);
    if (!schemaValid) blockers.push({ code: "rfi_schema", message: "The partial candidate does not satisfy the current RFI schema." });
    for (const field of rfiContract.schema.required) {
      if (typeof rfi[field] === "string" && !rfi[field].trim()) blockers.push({ code: "blank_required_field", field });
    }
    if (own(rfi, "rfi_id") && (typeof rfi.rfi_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(rfi.rfi_id))) {
      blockers.push({ code: "invalid_rfi_id", rfi_id: rfi.rfi_id });
    }
    const suppliedAnnotations = ANNOTATIONS.filter((field) => own(row, field));
    const rowAnnotations = Object.fromEntries(suppliedAnnotations.map((field) => [field, structuredClone(row[field])]));
    if (suppliedAnnotations.length) {
      blockers.push({ code: "annotation_semantics_unresolved", fields: suppliedAnnotations, message: "Clarify whether these values are initial state, expected answers, or display-only notes before model use." });
    }
    const unsupported = suppliedAnnotations.filter((field) => !vocabulary[field].includes(row[field]))
      .map((field) => ({ field, value: structuredClone(row[field]), allowed_values: vocabulary[field] }));
    if (own(row, "status")) {
      const label = typeof row.status === "string" ? row.status : serialize(row.status).trim();
      statusCounts.set(label, (statusCounts.get(label) ?? 0) + 1);
    }
    const unmapped = Object.fromEntries(Object.entries(row).filter(([field]) => !recognized.has(field)).map(([field, value]) => [field, structuredClone(value)]));
    if (Object.keys(unmapped).length) {
      blockers.push({ code: "unmapped_source_fields", fields: Object.keys(unmapped), message: "Unmapped source content is retained separately and requires review before model use." });
    }
    const hasContext = own(row, "daily_reports") && Array.isArray(row.daily_reports);
    let inputErrors = [];
    let inputWarnings = [];
    if (!hasContext) {
      blockers.push({ code: "missing_daily_reports", message: "An explicit daily_reports array is required; absent context is not replaced with an empty array." });
    } else {
      const checked = checkDemo2Inputs([rfi], row.daily_reports);
      inputErrors = checked.errors;
      inputWarnings = checked.warnings;
      if (!checked.valid) blockers.push({ code: "input_contract", errors: checked.errors });
    }
    candidates.push({ source_id: sourceId, source_pointer: sourcePointer, rfi });
    annotations.push({
      source_id: sourceId,
      source_pointer: sourcePointer,
      source_project_name: own(row, "project") ? structuredClone(row.project) : null,
      annotations: rowAnnotations,
      semantics_status: suppliedAnnotations.length ? "unresolved" : "not_supplied",
      unmapped_fields: unmapped
    });
    records.push({
      source_id: sourceId,
      source_pointer: sourcePointer,
      rfi_id: rfi.rfi_id ?? null,
      mappings,
      missing_required_fields: missing,
      schema_errors: schemaErrors,
      blockers,
      unsupported_vocab: unsupported,
      input_errors: inputErrors,
      input_warnings: inputWarnings,
      ready_for_model_input: false
    });
    contexts.push(hasContext ? row.daily_reports : null);
  }

  // IDs must remain unambiguous across the complete source, not only within each row.
  const rfiIds = new Map();
  candidates.forEach(({ rfi }, index) => {
    if (typeof rfi.rfi_id !== "string") return;
    const key = rfi.rfi_id.toLowerCase();
    if (!rfiIds.has(key)) rfiIds.set(key, []);
    rfiIds.get(key).push(index);
  });
  for (const indices of rfiIds.values()) {
    if (indices.length < 2) continue;
    for (const index of indices) records[index].blockers.push({ code: "duplicate_rfi_id", rfi_id: candidates[index].rfi.rfi_id, source_pointers: indices.map((i) => records[i].source_pointer) });
  }
  const reportIds = new Map();
  contexts.forEach((reports, index) => {
    for (const report of reports ?? []) {
      if (!object(report) || typeof report.report_id !== "string") continue;
      const key = report.report_id.toLowerCase();
      if (!reportIds.has(key)) reportIds.set(key, []);
      reportIds.get(key).push({ index, report });
    }
  });
  for (const entries of reportIds.values()) {
    if (entries.every(({ report }) => same(report, entries[0].report))) continue;
    const indices = [...new Set(entries.map(({ index }) => index))];
    for (const index of indices) records[index].blockers.push({ code: "conflicting_report_versions", report_id: entries[0].report.report_id, source_pointers: indices.map((i) => records[i].source_pointer) });
  }
  const readyInputs = [];
  records.forEach((record, index) => {
    record.ready_for_model_input = record.blockers.length === 0;
    if (record.ready_for_model_input) readyInputs.push({ rfi: candidates[index].rfi, daily_reports: structuredClone(contexts[index]) });
  });
  const summary = {
    source_records: source.length,
    blocked_records: records.filter((record) => !record.ready_for_model_input).length,
    ready_inputs: readyInputs.length,
    original_status_counts: Object.fromEntries(statusCounts)
  };
  const limitations = [
    "A successful compatibility report is not a successful model-input import or an evaluation result.",
    "The source filename says synthetic; record origin and annotation meanings require team confirmation and are not inferred from real project names.",
    "Project names, dates, submitters, daily-report evidence, workflow state and approval history are never invented or inferred.",
    "Source annotations and unmapped fields remain outside candidate RFIs and ready model inputs; they are not finalized answer labels.",
    "Ready means structurally usable input only, not verified completeness, correct routing, human approval, model accuracy or deployment readiness."
  ];
  return {
    "compatibility-report.json": {
      report_success: true,
      import_ready: summary.blocked_records === 0,
      syntax: { valid_json: true, top_level: "nonempty_array", records_are_objects: true },
      summary,
      records,
      limitations
    },
    "candidate-rfis.json": candidates,
    "source-annotations.json": annotations,
    "ready-inputs.json": readyInputs,
    "manifest.json": {
      source: { file: TEAM_SOURCE, sha256: hash(bytes) },
      schemas: [rfiContract, outputContract, reportContract].map(({ file, sha256 }) => ({ file, sha256 })),
      summary,
      record_sources: records.map(({ source_id, source_pointer, rfi_id }) => ({ source_id, source_pointer, rfi_id })),
      limitations
    }
  };
}

export function prepareTeamCases({ directory = path.join(ROOT, TEAM_OUTPUT), sourceText = readSource() } = {}) {
  const artifacts = buildTeamCaseArtifacts(sourceText);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(artifacts)) fs.writeFileSync(path.join(directory, name), serialize(value));
  return artifacts["compatibility-report.json"];
}

export function validateTeamCases({ directory = path.join(ROOT, TEAM_OUTPUT), sourceText = readSource() } = {}) {
  const artifacts = buildTeamCaseArtifacts(sourceText);
  const errors = [];
  for (const [name, value] of Object.entries(artifacts)) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file)) errors.push({ code: "missing_artifact", file: `${TEAM_OUTPUT}/${name}` });
    else if (fs.readFileSync(file, "utf8") !== serialize(value)) errors.push({ code: "stale_artifact", file: `${TEAM_OUTPUT}/${name}` });
  }
  return { valid: errors.length === 0, errors, report: artifacts["compatibility-report.json"] };
}
