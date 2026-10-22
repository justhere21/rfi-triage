import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

// Data preparation validates its local contract with no runtime or model client.
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const inputSchema = JSON.parse(readFileSync(new URL("../schemas/input_schema.json", import.meta.url), "utf8"));
const validateInput = ajv.compile(inputSchema);

export const INPUT_FIELDS = [
  "item_id", "item_type", "provenance", "submitted_date", "submitted_by",
  "discipline", "location", "question_text", "drawing_refs", "spec_refs",
  "attachments", "related_item_ids", "current_drawing_version"
];

export function checkItems(items, { provenance = "synthetic", checkRelations = true } = {}) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(items) || !items.length) {
    return { errors: [{ code: "invalid_batch", message: "Input must be a nonempty JSON array" }], warnings };
  }
  const ids = new Set();
  const filenames = new Set();
  const issue = (code, item_id, message) => errors.push({ code, item_id, message });
  for (const item of items) {
    const id = item?.item_id;
    if (!validateInput(item)) issue("input_schema", id ?? null, JSON.stringify(validateInput.errors));
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const field of Object.keys(item)) {
      if (!INPUT_FIELDS.includes(field)) issue("unexpected_input_field", id, `Field ${field} is not model input`);
    }
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
      issue("unsafe_id", id ?? null, "IDs must use letters, digits, underscores, or hyphens");
    } else {
      if (filenames.has(id.toLowerCase())) issue("duplicate_id", id, "Repeated item_id or case-insensitive output filename collision");
      ids.add(id);
      filenames.add(id.toLowerCase());
    }
    if (item.provenance !== provenance) issue("mixed_provenance", id, `Expected provenance ${provenance}`);
    if (typeof item.question_text === "string" && !item.question_text.trim()) issue("empty_question", id, "question_text must not be blank");
    const blank = ["location", "discipline", "submitted_by"].filter((key) => item[key] === "");
    if (blank.length) warnings.push({ code: "preserved_missing_fields", item_id: id, fields: blank });
  }
  for (const item of checkRelations ? items : []) {
    if (!Array.isArray(item?.related_item_ids)) continue;
    for (const related of item.related_item_ids) {
      if (!ids.has(related)) issue("unresolved_relation", item.item_id, `Related item ${related} is absent`);
      if (related === item.item_id) issue("self_relation", item.item_id, "An item cannot refer to itself");
    }
  }
  return { errors, warnings };
}
