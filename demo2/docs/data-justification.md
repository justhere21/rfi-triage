# Demo 2 data justification

Updated October 21, 2026. This note covers the compatibility audit of the team's 10 TC source rows and the separate offline preparation of five explicitly fictional SYN2 smoke fixtures. It does not report a model run, application test, API test, deployment, or evaluation result.

## Keep the collections separate

| Collection | Contents | What it can support |
| --- | --- | --- |
| [Existing public collection](../../data/public-rfi/README.md) | 17 curated RFI IDs: 11 Lee-Whedon bundles and six Willis ISD entries. | Source-linked examples and descriptive metadata from prebid/preconstruction records. |
| [Demo 1 primary synthetic collection](../../data/synthetic/README.md) | 23 records: 15 RFIs, four emails, and four meeting-minute records. | The earlier demonstration's separate preparation and review workflow. |
| [Demo 2 team TC source](../data/synthetic) | 10 rows, `TC-01` through `TC-10`, introduced in commit `4764713`. | A compatibility audit of supplied fields and annotations; currently zero ready inputs and 10 blocked rows. |
| [Demo 2 synthetic smoke batch](../data/README.md) | Five new fictional RFI scenarios with explicitly authored daily-report context where supplied. | Small, controlled checks of the new input contract and selected discrepancy patterns. |

The five-case smoke batch has `dataset_id: demo2-synthetic-smoke-v1` and `provenance: synthetic`. Its IDs use the `SYN2` prefix. It is not a new set of observed project records, a conversion of the public collection, or an extension of the earlier 23-record primary batch. The TC and SYN2 batches are not a combined, accepted 15-case evaluation set. Counts from these collections must not be combined into a claim about real construction workflows.

The new smoke cases were drafted with coding-assistant support for team review. Neither the scenarios nor their proposed labels have been accepted as the team's final evaluation set.

The public sources do not supply complete construction-stage daily reports, subcontractor-to-GC routing, current review ownership, or human approval histories. The new fictional daily reports therefore remain separate from those sources. No observed project, person, event, or relationship is asserted by the smoke fixtures.

## Team TC source compatibility

The original extensionless [`demo2/data/synthetic`](../data/synthetic) file is preserved. Its project labels refer to Willis ISD and Lee-Whedon Library, but the file supplies no source citations or workflow evidence establishing that its short scenarios occurred on either real project. It remains a separate team synthetic source, not additional public observations.

The compatibility pipeline maps only `id → rfi_id`, `topic → title`, and the supplied `description`. It retains the project text separately as `source_project_name` pending an explicit project-ID decision. All 10 candidates lack the required canonical `project_id`, `submitted_by`, `date_submitted`, and `linked_daily_report_ids` fields. The source contains no supporting daily reports. An absent link list is not silently replaced with an empty array; no date, submitter, relationship, or report is invented.

Raw `assignee`, `status`, and `conflict` values are separated into source annotations. The source does not define whether these are current-state context or expected outcomes. They are therefore neither a final answer key nor model inputs. Eight rows use `Closed`, one uses `In Review`, and one uses `Rejected`; only the last string matches the existing output-status enum. None of the five distinct assignee strings exactly matches its output-role enum. Six named conflict values fall outside the existing conflict-type enum; the other four rows say `None`, which is a raw source annotation rather than a schema-defined conflict object. Exact vocabulary matching does not establish the meaning or correctness of any annotation.

`npm run prepare-demo2-team` writes a row-level compatibility report, partial candidates, separate annotations, an empty ready-input array, and a source/schema hash manifest under `demo2/data/prepared/team-tc/`. `npm run validate-demo2-team` reconstructs and compares those five artifacts without writing files. The current result is **10 audited rows, zero ready inputs, and 10 blocked rows**. A successful audit preserves and explains this condition; it does not assert that 10 canonical RFIs have passed validation.

The [TC compatibility note](team-tc-compatibility.md) lists each row and the information needed to proceed: explicitly supplied required metadata, documented report linkage or an explicitly confirmed absence of context, and agreement on annotation meaning and vocabulary. No final enum mapping is chosen by this work. The existing RFI/output schemas and evaluation design remain unchanged.

## Why these five cases

The [source fixture](../data/source/synthetic-cases.json) provides five deliberately small scenarios:

| Scenario | Purpose |
| --- | --- |
| Consistent RFI and linked report | A negative control for an unnecessary discrepancy flag. |
| Schedule discrepancy | Compare incompatible work-timing statements. |
| Labor discrepancy | Compare incompatible crew or labor statements. |
| Scope discrepancy | Compare incompatible descriptions of work performed. |
| Insufficient linked-report context | Preserve an intentional lack of supporting context instead of inventing a report. |

These cases provide smoke coverage, not a representative sample or an estimate of issue prevalence. A consistent pair alone does not establish that all approval conditions have been met. An empty report list does not establish that the underlying RFI has no conflicts.

Proposed answers are stored separately in [`draft-answer-key.json`](../data/answers/draft-answer-key.json). Every label remains a draft for team review. The input preparation and validation commands do not read that answer key, establish its correctness, or score a model against it. Reviewers must agree on the expected issue categories and decision rules before using it for evaluation.

## What the preparation step does

The source already supplies explicit fields matching the Demo 2 RFI contract, plus its separately authored daily-report records. `npm run prepare-demo2` separates these into RFI and daily-report arrays, assembles linked model-input objects of the form `{ "rfi": ..., "daily_reports": [...] }`, and writes a manifest and validation report. It does not generate missing metadata, create scenarios, call a model, infer real project events, or copy expected answers into model inputs.

The earlier [preparation schema](../../scripts/schemas/input_schema.json) and the new [RFI schema](../schemas/rfi_schema.json) describe different inputs. Potential field correspondences are limited:

| Earlier field | Demo 2 field | Condition |
| --- | --- | --- |
| `item_id` | `rfi_id` | Preserve the supplied identity; keep dataset prefixes distinct. |
| `submitted_date` | `date_submitted` | Preserve an explicitly supplied valid date. |
| `question_text` | `description` | Preserve the supplied request text. |

These correspondences are not a complete adapter. Required `project_id`, `title`, and `submitted_by` values must be supplied explicitly when absent; they cannot be inferred from a short request or filled with an invented default. Earlier `related_item_ids` do not establish daily-report relationships. The old records do not become paired RFI/report inputs without actual, separately documented supporting records and explicit links. The new smoke fixture supplies its canonical fields directly, so the preparation step requires no such assumptions.

## Validation and traceability

The pipeline uses the existing RFI schema and a supplemental [daily-report schema](../schemas/daily_report_schema.json). The daily-report contract is provisional for integration; it is not presented as a team-approved final interface. The existing RFI and triage-output schemas and [evaluation design](evaluation-design.md) are preserved.

Offline checks cover JSON shape, required fields and supported values, identifiers, explicit report links, and project consistency. Schema-valid empty arrays remain empty. The intentionally missing report context is reported as `preserved_missing_context`, a warning rather than a conversion error. Passing structural validation establishes the shape of the input; it does not establish that the record is complete enough for an approval decision.

The manifest records repository-relative source/schema paths and SHA-256 hashes, per-RFI source pointers, supplied daily-report IDs, and record counts. It adds no generated dates. `npm run validate-demo2` reconstructs the expected five prepared artifacts in memory and compares their bytes with the files on disk without writing anything. This provides a reproducible input handoff, not proof of source-label accuracy or application behavior.

The optional `npm run validate-demo2 -- --outputs path/to/results.json` checks a supplied triage-output array for the output schema, allowed fields and enums, unique RFI IDs, and exact coverage of the prepared batch. That is an output-contract check only. It does not compare predictions with draft answers or validate the reasoning behind an output.

## Workflow and evaluation limits

The [evaluation design](evaluation-design.md) lists workflow stages such as `Submitted`, `GC Review`, `Design Review`, `Awaiting Clarification`, `Approved`, and `Closed`. The [triage-output schema](../schemas/triage_output_schema.json) instead permits `Draft`, `Pending Review`, `Conflict Flagged`, `Approved`, and `Rejected`. This vocabulary conflict remains unresolved. A suggested future alignment must be reviewed by the team before changing either contract or declaring an evaluation mapping final.

The current RFI input has no current workflow-state field or human approval-event history. The smoke batch therefore cannot establish correct status tracking or next-reviewer responsibility (evaluation scenarios A and B). It supplies discrepancy examples for scenario C and only input-level support for parts of D and E: missing-context handling and a consistent comparison case. It does not test enforced approval blocking, final readiness, human authorization, or handoff transitions. A schema-valid `Approved` output would not itself prove that an authorized human approved anything.

The team still needs to agree on the workflow/state contract and draft answer key, integrate the prepared inputs into the application, run the intended cases, save outputs, and execute the evaluation procedure. Until those steps occur, no accuracy, caught/missed/false-flag totals, workflow success rate, or real response-time or clarification-cycle improvement is claimed. The earlier proposed percentage improvements remain hypotheses, not results of this data preparation.
