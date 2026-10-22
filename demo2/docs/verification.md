# Demo 2 offline verification

Verified on **2026-10-21 at 14:18 PDT (America/Los_Angeles)** using a clean `git archive` of commit [`702b3f17970de7ac979aef31bf02c292ca994418`](https://github.com/LouisLin69/info492-rfi-coordination/commit/702b3f17970de7ac979aef31bf02c292ca994418). The archive contained committed files only; the existing checkout and raw data were not modified. This record covers the data implementation at that commit, before the deployment and readiness documentation was added.

Runtime: **Node.js v24.18.0**, **npm 11.16.0**. Dependencies were installed in the temporary archive with the committed lockfile. Installation succeeded with six packages added; lifecycle scripts, audit requests, and funding output were disabled. The temporary archive was removed after verification.

## Commands and results

All commands ran from the temporary repository root and exited with code `0`.

| Command | Observed result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Clean dependency installation succeeded. |
| `npm test` | **94 passed**, 0 failed, 0 skipped. |
| `npm run validate-demo2` | Five reproducible SYN2 inputs and four supplied daily reports; one preserved missing-context warning for `SYN2-RFI-005`. No files written. |
| `npm run validate-demo2-team` | Compatibility artifacts reproduced for all 10 TC source rows: **10 blocked, 0 ready model inputs**. Audit succeeded; import remains blocked. No files written. |
| `npm run validate-data` | Demo 1's 23 inputs and 23 separate source answers validated; all four prepared artifacts current. Eleven documented warnings retained. No files changed. |
| `npm run intervals -- --check` | Seventeen public records checked: 16 calculated intervals, one unknown, zero failures and zero stored mismatches. Eight printed-duration differences retained as source-quality warnings. No files changed. |

## Meaning and limits

These results establish clean dependency installation, passing automated checks, and reproducible offline data artifacts. The SYN2 missing-report warning is intentional preserved context, and the TC audit's successful exit does not make its blocked records ready for import. The public date intervals remain descriptive source measurements, with different date meanings across projects; they do not measure GC delay or AI benefit.

No model, credentials, external application API, application startup, production build, hosted deployment, or approval workflow was exercised. The repository at the checked commit supplied no runnable Demo 2 application or build/start scripts. No triage-output file was available for the optional output-contract check. Status mappings, provisional daily-report fields, and draft answer labels still require team agreement. Data validation therefore does not establish application behavior, approval enforcement, accuracy, or deployment readiness.

Repeat the commands above after changing the source data, schemas, scripts, dependency lockfile, or application integration. See the [data guide](../data/README.md) for preparation commands and the distinction between blocked TC candidates and the separate SYN2 smoke batch.

## Readiness follow-up

After adding the run/deployment guide, local readiness checker, documentation links, and access-check record on October 21, the working-tree regression completed with **99 passed tests**, zero failures, and zero skipped tests. `npm run check-demo2-readiness` passed its offline checks and explicitly reported the application as blocked; it did not run or deploy an application. The existing 23-case validation and 17-record interval check also passed again.

This follow-up is a working-tree check of the added readiness work. The clean-archive installation record above remains scoped to `702b3f1` and its 94 tests. No dependencies or lockfile entries changed in the follow-up.
