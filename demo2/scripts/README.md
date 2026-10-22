# Data preparation and loading

Owner: Louis. These tools prepare and validate separate synthetic and data-team batches for handoff to Ase. Preparation and offline input checks do not call a model or generate new case content. `main` contains data tools only; Ase's agent code, prompts, samples, and results remain on his temporary branches. Agent integration remains his work.

## Synthetic preparation

Run from the repository root:

```sh
npm ci
npm run prepare-data
npm run validate-data
npm test
npm run check-input
```

For this submission's data rationale, source-method limits, and label review, see the [data justification](../docs/data-justification.md) and [data review](../docs/data-review.md). The [demo note](../docs/demo-note.md) separates verified preparation from unverified full-batch agent results.

- `prepare-data` deterministically writes the four prepared synthetic artifacts listed below. It reports source record, converted, and failed counts; invalid records block publication of the batch.
- `validate-data` checks all four checked-in synthetic artifacts against the current raw sources and schema without modifying them. Invalid or stale artifacts produce a nonzero exit code; run `prepare-data` after an intentional source change.
- `test` runs offline preparation, intake, and input-validation checks using temporary fictional fixtures. It does not test or call Ase's model.
- `check-input` validates only the selected prepared input file, defaulting to `data/prepared/synthetic/items.json` with `synthetic` provenance. It imports no agent or Google client code, needs no API credentials, makes no network requests, and writes no files or directories. It does not replace `validate-data`, which also checks synthetic answers, provenance, and reproducibility.

The default batch contains **23 cases**: Emma's 15 RFIs from `data/synthetic/synthetic-rfis.json`, Angie's four emails from `synthetic_emails.csv`, and Angie's four meeting-minute records from `synthetic_minutes.csv`. Angie's eight source answers come from `synthetic_answer_key.csv`; Emma's source labels are embedded in the original RFI JSON.

| Prepared file in `data/prepared/synthetic/` | Purpose |
| --- | --- |
| `items.json` | The handoff input: 23 records checked against the standalone data-preparation contract in `scripts/schemas/input_schema.json`. |
| `answer-key.json` | Separate source labels, original label values, notes, and review status, keyed by item ID. Keep outside model input. |
| `manifest.json` | Source paths and SHA-256 hashes, schema hash, source-row pointers, source format, and any per-record legacy defaults. |
| `validation-report.json` | Source conversion counts, errors, and review warnings. |

Original source cases and labels remain in `data/synthetic/`. The CSV line endings are normalized from CRLF to LF with identical cell values. Ase's 15 smoke-test cases remain on his temporary branches and are not included on `main`. They are different scenarios from Emma's 15, despite similar IDs (`rfi-001` versus `RFI-001`). A future agent integration should distinguish dataset identity and store each dataset's outputs separately.

## Synthetic field mapping and missing information

Emma's current source records already use canonical input fields, IDs `RFI-001`–`RFI-015`, and supplied synthetic dates, submitters, and disciplines. Preparation preserves that metadata and extracts source labels into `answer-key.json`; **the current 23-case batch needs no generated date, submitter, or discipline defaults**.

The converter also supports the earlier RFI source format:

| Legacy source RFI field | Prepared input field |
| --- | --- |
| `id` | `item_id` |
| `question` | `question_text` |
| `drawing_reference` | `drawing_refs` |
| `spec_reference` | `spec_refs` |
| `supporting_documents` | `attachments` |
| `related_rfi` | `related_item_ids` |

Only legacy records missing metadata use the explicit fixture date `2026-03-01`, submitter `Synthetic submitter (unspecified)`, and blank discipline. Any applied defaults are recorded per record in the manifest. These fixtures are not source facts or chronology and are never used for partner records.

CSV records already use input field names; list cells become arrays. Null or missing lists become `[]`, and an absent synthetic location becomes `""`. Intentional missing locations and references remain missing so completeness cases still work. Attachment filenames are simulated declarations; they do not mean documents are present or that the agent has read their contents. Preparation uses no random generation and does not infer missing metadata or relationships.

Only explicit input-side relationships enter the prepared input. `MIN-003` retains an empty input relationship list while the source answer identifies `EMAIL-004`; the answer target remains in the answer key. `RFI-014` retains its supplied `current_drawing_version` as optional evidence, checked as a string by the data tools. The validation contract belongs to these preparation scripts, not Ase's agent. Its use by an agent is a later integration decision for Ase.

## Data-team intake

The partner tool accepts data-team records whose receipt explicitly declares `provenance: "partner"`; it does not necessarily identify an outside company. Team authorship does not reclassify Emma's and Angie's existing synthetic cases or observed public records. Those sources keep their existing separate workflows. No real partner intake has been completed in this repository. The [intake guide](../data/partner/README.md) explains raw-file storage, the receipt template, supported structured JSON/CSV, and field mapping.

After placing the actual supplied source and a completed receipt in the local ignored directories, validate the conversion first:

```sh
npm run prepare-partner -- --input data/partner/raw/RECEIVED_FILE.csv --receipt data/partner/receipts/RECEIPT.json --dry-run
```

Replace the uppercase filenames with the files actually received. A valid receipt requires `dataset_id`, explicit `provenance: "partner"`, `source_name`, `received_date` (`YYYY-MM-DD`), `source_reference`, and `sharing_scope` (`local_only` or `team_use`). The template's `provenance: null` is incomplete. Missing row-level provenance inherits only the completed receipt's declaration; synthetic/public row or receipt values are rejected. Optional `field_map` maps canonical input field names to source column names. Receipt metadata and mapped columns are recorded in the manifest, together with the source hash and record pointers.

The dry run makes no writes or model calls. Fix reported receipt, field, date, ID, provenance, or relationship errors using the supplied source information, then omit `--dry-run` to write:

```text
data/prepared/partner/<dataset_id>/items.json
data/prepared/partner/<dataset_id>/manifest.json
data/prepared/partner/<dataset_id>/validation-report.json
```

An optional `--out-dir DIR` selects another output directory. Raw files remain unchanged. Missing required source fields block intake; the tool supplies no invented date or submitter. Intentional blank location/reference values are retained. Extra source columns, including answers, are excluded from model input; explicitly mapping recognizable answer/label columns or notes into input fields is rejected. Source labels should be stored separately for future review. Mixed provenance is rejected.

`data/partner/raw/`, `data/partner/receipts/`, and `data/prepared/partner/` are ignored by Git. A receipt records sharing scope; it does not publish data or configure agent output. Intake tests in `tests/partner-import.test.js` create fictional inputs in operating-system temporary directories and clean them up; they are not received records.

## Independent offline input checks

`check-input` rejects empty/non-array batches, invalid required fields and dates, unknown fields, unsafe or duplicate IDs, unresolved/self references, and mismatched provenance. Use `--input FILE` to select one prepared JSON array and `--provenance synthetic|partner|observed_public` to declare its single expected provenance. Defaults are the prepared 23-case input and `synthetic`.

To check a prepared partner batch, replace `DATASET_ID` with its actual receipt identifier:

```sh
npm run check-input -- --input data/prepared/partner/DATASET_ID/items.json --provenance partner
```

These commands load only the selected input, never the answer key, and write no outputs. Invalid input returns a nonzero exit code.

## Handoff to Ase

The artifacts are prepared and ready for handoff; they are not yet wired into Ase's agent. Give Ase the selected `items.json`, the separate answer-key path if available, and the manifest and validation report. The desired integration should select one prepared file rather than scan raw JSON, keep answers and source notes out of prompts, preserve provenance separation, and identify output by dataset. Ase owns any loader, prompt, results-directory, or scoring changes needed to implement that interface.

No agent runtime or evaluation command is installed on `main`. `src/`, `prompts/`, and `results/` contain ownership README files only; Ase's executable work and experimental outputs remain on the temporary branches. Use `npm run check-input` for local validation. The data tools make no model calls and do not determine which metadata a future prompt will use.

## Reproduce public date intervals

```sh
npm run intervals -- --check
npm run intervals -- --out data/prepared/public/interval-report.json
```

The first command reads and verifies the two public CSVs without writing. The second saves a deterministic report with source hashes, record pointers, original date strings, normalized dates, recomputed intervals, comparisons with stored values, and per-project/date-semantics summaries. It does not rewrite either source CSV. An invalid normalized date, reversed pair, or inconsistent stored derived interval causes failure; a missing source date remains unknown. Reported source durations are preserved separately, including disagreements with calculated intervals.

The calculation is the exclusive calendar-day difference between readable ISO dates at midnight UTC. It is not business days, verified production delay, first-answer time, or measured GC processing. The current batch has 17 unique IDs, 16 readable date pairs, and one unknown pair. Lee-Whedon's malformed PRFI-09 date remains unparsed. Projects and their received/closed versus submitted/response meanings remain separate; no pooled cross-project mean is interpreted as performance.

## Generate separate controlled scenarios

```sh
npm run generate-synthetic -- --dry-run
npm run generate-synthetic -- --seed 42
```

This is an actual programmatic fixture generator for **10 optional new cases**: six RFIs, two emails, and two meeting-minute records, using distinct `GEN-` identifiers. A versioned scenario recipe and seeded choices construct case text, explicit synthetic metadata, controlled missing fields, related questions, and conflict examples. The default seed is `42`; the same seed and recipe produce the same artifacts. It needs no API credentials or model calls.

The default output is the ignored `data/prepared/generated-synthetic/` directory, containing `items.json`, a separate `answer-key.json`, a manifest, and a validation report. `--out-dir DIR` selects a separate destination; `--dry-run` validates without writes. Do not add these optional cases to the 23-case demo count or describe them as evaluated unless an actual agent run and separately identified results exist. Recipe-derived expected answers still require human review before scoring.

The primary 23 remain Emma's and Angie's versioned source cases. `prepare-data` assembles those sources; `generate-synthetic` creates a different controlled set. The new generator is not evidence of how the original authors composed their cases. See the [generation method and justification](../docs/data-justification.md).

## Review before scoring

The source answer key is preserved, including unresolved differences with planned agent output concepts. Review warnings identify confirmation requests labeled `needs_response=no`, the meanings of respondent and contract risk, and Emma's quality labels/recommended actions as separate evaluation targets. These labels require team review; preparation does not accept, correct, or automatically score them. The data-preparation contract defines inputs only, not an installed agent's outputs.

The files support reproducible input preparation and offline data checks. They do not establish agent integration, model accuracy, accepted labels, fewer clarification cycles, or measured AI benefit. Synthetic, observed public, and partner data remain separate.
