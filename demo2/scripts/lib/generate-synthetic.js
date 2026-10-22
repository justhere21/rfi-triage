import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { checkItems } from "./check-items.js";

export const RECIPE_VERSION = "controlled-synthetic-v1";
export const DEFAULT_GENERATION_SEED = 42;
const FIXTURE_DATE = "2026-03-10";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    throw new Error("Seed must be an integer from 0 through 4294967295");
  }
  return seed;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

// Controlled augmentation, independent of the team's original 23 source cases.
// Each recipe constructs source text plus a deliberate, documented issue state.
export function buildGeneratedDataset({ seed = DEFAULT_GENERATION_SEED } = {}) {
  validateSeed(seed);
  const random = seededRandom(seed);
  const integer = (minimum, maximum) => minimum + Math.floor(random() * (maximum - minimum + 1));
  const room = `Room ${integer(101, 499)}`;
  const secondRoom = `Room ${integer(501, 899)}`;
  const door = `D-${integer(10, 99)}`;
  const drawing = `TEST-M${integer(101, 499)}`;
  const architectural = `TEST-A${integer(101, 499)}`;
  const specifiedThickness = integer(1, 3);
  const drawingThickness = specifiedThickness + integer(1, 3);
  const dimension = integer(34, 46);
  const id = (type, number) => `GEN-${seed}-${type}-${String(number).padStart(3, "0")}`;
  const items = [];
  const answerKey = [];
  const records = [];
  const add = ({ type, number, recipe, text, labels, action, changes = [], fields = {} }) => {
    const item = {
      item_id: id(type === "rfi" ? "RFI" : type === "email" ? "EMAIL" : "MIN", number),
      item_type: type, provenance: "synthetic", submitted_date: FIXTURE_DATE,
      submitted_by: "Controlled synthetic generator (fictional)", discipline: "A",
      location: room, question_text: text, drawing_refs: [architectural], spec_refs: [],
      attachments: [], related_item_ids: [], ...fields
    };
    items.push(item);
    answerKey.push({
      item_id: item.item_id, label_set: "controlled_quality_fixture",
      review_status: "recipe_expectations_require_team_review",
      expected: { labels: [...labels, "NEEDS_HUMAN_REVIEW"], recommended_action: action },
      basis: { recipe_version: RECIPE_VERSION, recipe_id: recipe, controlled_changes: changes }
    });
    records.push({ item_id: item.item_id, recipe_id: recipe, recipe_record: records.length + 1, controlled_changes: changes });
  };
  const conflictText = `At ${room}, drawing ${drawing} calls for ${drawingThickness} inches of pipe insulation while specification 23 07 19 calls for ${specifiedThickness} inches. Please confirm the required thickness.`;
  const doorText = `For door ${door} at ${room}, please confirm whether its lever should be installed at ${dimension} inches above the finished floor as indicated on ${architectural}.`;

  add({ type: "rfi", number: 1, recipe: "complete_single_question", text: doorText, labels: ["READY"], action: "route", fields: { spec_refs: ["08 71 00"] } });
  add({ type: "rfi", number: 2, recipe: "remove_required_location", text: `Please confirm whether the duct shown on ${drawing} may shift ${integer(6, 18)} inches east to avoid the cable tray.`, labels: ["INCOMPLETE", "MISSING_LOCATION"], action: "revise", changes: ["location deliberately blank; text supplies no room"], fields: { discipline: "M", location: "", drawing_refs: [drawing], spec_refs: ["23 31 13"] } });
  add({ type: "rfi", number: 3, recipe: "explicit_document_disagreement", text: conflictText, labels: ["POSSIBLE_CONFLICT"], action: "review", changes: ["drawing and specification thicknesses deliberately differ"], fields: { discipline: "M", drawing_refs: [drawing], spec_refs: ["23 07 19"], attachments: [`${drawing}-fictional-markup.pdf`] } });
  add({ type: "rfi", number: 4, recipe: "related_paraphrase", text: `Following ${id("RFI", 1)}, can the team reconfirm the ${dimension}-inch lever height for door ${door} in ${room}? This repeats the earlier hardware question.`, labels: ["RELATED_OR_DUPLICATE"], action: "review", changes: ["rephrase the first generated request and cite its ID; exact duplication is not asserted"], fields: { related_item_ids: [id("RFI", 1)], spec_refs: ["08 71 00"] } });
  add({ type: "rfi", number: 5, recipe: "remove_drawing_reference", text: `For ${secondRoom}, please identify the applicable partition-plan detail and confirm the wall endpoint at the corridor intersection; the drawing number was omitted.`, labels: ["INCOMPLETE", "MISSING_DRAWING_REFERENCE"], action: "revise", changes: ["drawing reference deliberately omitted from text and list"], fields: { location: secondRoom, drawing_refs: [], spec_refs: ["09 21 16"] } });
  add({ type: "rfi", number: 6, recipe: "bundle_separate_questions", text: `For ${secondRoom}, please confirm the ceiling height, decide whether the sprinkler heads should move, and approve a different door finish.`, labels: ["UNCLEAR_QUESTION"], action: "revise", changes: ["combine three distinct decisions in one request"], fields: { location: secondRoom } });
  add({ type: "email", number: 1, recipe: "simple_access_request", text: `Please confirm whether the coordination team may enter ${room} for a walkthrough on 2026-03-17. No drawing decision is requested.`, labels: ["READY"], action: "route", fields: { discipline: "General", drawing_refs: [] } });
  add({ type: "email", number: 2, recipe: "declared_photo_not_attached", text: `A field obstruction at ${secondRoom} blocks the route shown on ${drawing}. Please review the attached field photo and advise; the photo was omitted from this message.`, labels: ["INCOMPLETE", "MISSING_SUPPORTING_DOCUMENTATION"], action: "revise", changes: ["text requests photo review but attachment list deliberately empty"], fields: { discipline: "M", location: secondRoom, drawing_refs: [drawing], spec_refs: ["23 31 13"] } });
  add({ type: "minutes", number: 1, recipe: "explicit_meeting_action", text: `Coordination meeting action: the General Contractor will confirm who owns the ceiling query for ${room} by 2026-03-17. The location and action owner were agreed in this fictional meeting.`, labels: ["READY"], action: "route", fields: { discipline: "General", drawing_refs: [] } });
  add({ type: "minutes", number: 2, recipe: "repeat_conflict_in_minutes", text: `Meeting follow-up to ${id("RFI", 3)}: the team again asks whether ${drawingThickness}-inch or ${specifiedThickness}-inch insulation is required at ${room}. The drawing/specification disagreement remains open.`, labels: ["RELATED_OR_DUPLICATE", "POSSIBLE_CONFLICT"], action: "review", changes: ["repeat the generated insulation disagreement as a related meeting action"], fields: { discipline: "M", drawing_refs: [drawing], spec_refs: ["23 07 19"], related_item_ids: [id("RFI", 3)] } });

  const checked = checkItems(items, { provenance: "synthetic" });
  const sourceFiles = [
    ["scripts/lib/generate-synthetic.js", new URL("./generate-synthetic.js", import.meta.url)],
    ["scripts/generate-synthetic.js", new URL("../generate-synthetic.js", import.meta.url)]
  ].map(([file, url]) => ({ file, sha256: sha256(readFileSync(url)) }));
  const report = {
    valid: checked.errors.length === 0,
    counts: { input_records: items.length, answer_records: answerKey.length, rfi: 6, email: 2, minutes: 2 },
    errors: checked.errors,
    warnings: [...checked.warnings,
      { code: "optional_generated_dataset", message: "These ten optional controlled fixtures do not replace or add to the primary 23-case demo batch." },
      { code: "recipe_expectations", message: "Answers express the intended recipe state and require team review; they are not accepted ground truth or measurements of model accuracy." },
      { code: "fictional_source_metadata", message: "Dates, submitter, rooms, references, and actions are deterministic fictional fixtures, not received project records." },
      { code: "simulated_attachments", message: "Attachment filenames are declarations only; this generator creates no attachments or verified document evidence." }
    ]
  };
  const manifest = {
    dataset_id: `${RECIPE_VERSION}-seed-${seed}`, provenance: "synthetic",
    dataset_role: "Optional controlled augmentation; separate from the original team-authored 23 cases",
    recipe_version: RECIPE_VERSION, seed, record_count: items.length, fixture_date: FIXTURE_DATE,
    generation_method: "Seeded template construction with explicit controlled changes; no source-case rewriting, unseeded randomness, timestamps, API calls, or model generation",
    original_case_authorship: "The original 23 cases remain team-authored and were not generated by this script",
    source_files: sourceFiles, schema_file: "scripts/schemas/input_schema.json",
    schema_sha256: sha256(readFileSync(new URL("../schemas/input_schema.json", import.meta.url))),
    records
  };
  return { items, answerKey, manifest, report };
}
