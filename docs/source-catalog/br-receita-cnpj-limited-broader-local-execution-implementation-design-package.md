# BR-SOURCE-11O — Limited broader local execution implementation design package

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11O — Limited broader local execution implementation design package (docs-only)
**Status:** `proposed_for_owner_review` — **not** a GATE-2 approval, **not** an authorization for
implementation, code changes, scripts, tests, package manifest changes, limited broader local execution,
broader local execution, temp storage, new real-data execution, re-running the 11H coverage signal, cap
expansion, multi-window sampling, exact coverage percentages, a full-dataset denominator, full join
execution, import, Supabase writes, runtime, or Agent 1, and **not** an approval of any gate
**Predecessor:** BR-SOURCE-11N-LAND — `BRSOURCE11NLANDA — LIMITED_BROADER_LOCAL_EXECUTION_DECISION_RECORD_MERGED`
(PR #191, `main` HEAD `4f452033c8b15b7e66e97bba259cab202c0828b9`, merge method `--merge`, parent count 2)
**Authorization received:** `AUTHORIZE BR-SOURCE-11O — LIMITED BROADER LOCAL EXECUTION IMPLEMENTATION DESIGN PACKAGE`
— authorizes only the preparation of this design package, never GATE-2 approval, never implementation,
never code or script changes, never limited broader local execution, never broader local execution, and
never real-data execution
**Last reviewed:** 2026-08-03

**Related documents:**
- Limited broader local execution decision record (BR-SOURCE-11N) — [`br-receita-cnpj-limited-broader-local-execution-decision-record.md`](./br-receita-cnpj-limited-broader-local-execution-decision-record.md)
- GATE-2 formal decision record (BR-SOURCE-11M) — [`br-receita-cnpj-gate2-formal-decision-record.md`](./br-receita-cnpj-gate2-formal-decision-record.md)
- GATE-2 owner review package (BR-SOURCE-11L) — [`br-receita-cnpj-gate2-owner-review-package.md`](./br-receita-cnpj-gate2-owner-review-package.md)
- GATE-2 controls and evidence template (BR-SOURCE-11K) — [`br-receita-cnpj-gate2-controls-and-evidence-template.md`](./br-receita-cnpj-gate2-controls-and-evidence-template.md)
- GATE-2 route decision package (BR-SOURCE-11J) — [`br-receita-cnpj-gate2-route-decision-package.md`](./br-receita-cnpj-gate2-route-decision-package.md)
- Coverage signal interpretation and GATE-2 route decision record (BR-SOURCE-11I) — [`br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md`](./br-receita-cnpj-coverage-signal-interpretation-and-gate2-route-decision-record.md)
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join remaining gates decision packet — [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
- Full join approval gates checklist (GATE-2 definition, § 6) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Full join output sanitization decision record — [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)

---

> This document is an **implementation design artifact**. BR-SOURCE-11N produced the limited broader local
> execution decision record and documented candidate scope as `proposed_only / not_authorized`. This
> document turns that candidate scope into a **design package only**: it describes the architecture, module
> boundaries, control flow, conceptual CLI/API contract, data-family policy, cap model, join handling,
> output and evidence model, fail-closed design, stop conditions, future test strategy and implementation
> sequencing for a **possible future** limited broader local execution. **§ 1–28 supply that artifact; they
> approve no gate, authorize no implementation, create no code, and authorize no execution.** GATE-2 is
> still `not_started / not approved`, so the only valid current decision is **NO-GO** for execution.

---

## 1. Status

```text
Implementation design package status:                     proposed_for_owner_review
GATE-2 approval status:                                   not_started / not approved
Limited broader local execution implementation design:    not_authorized for implementation
Limited broader local execution implementation status:    not_authorized
Execution status:                                         not_authorized
Current GO/NO-GO:                                         NO-GO
```

Explicitly, this design package does **not** authorize:

```text
This design package does not approve GATE-2.
This design package does not authorize implementation.
This design package does not authorize code changes.
This design package does not authorize scripts.
This design package does not authorize tests.
This design package does not authorize package.json changes.
This design package does not authorize limited broader local execution.
This design package does not authorize broader local execution.
This design package does not authorize temp storage.
This design package does not authorize any new real-data execution.
This design package does not authorize re-running 11H.
This design package does not authorize cap expansion in runtime.
This design package does not authorize multi-window sampling.
This design package does not authorize exact coverage percentages.
This design package does not authorize full dataset denominator claims.
This design package does not authorize full join execution.
This design package does not authorize import.
This design package does not authorize Supabase writes.
This design package does not authorize runtime.
This design package does not authorize Agent 1.
This design package does not approve any gate.
```

---

## 2. Purpose

```text
The purpose of this design package is to describe the architecture, module boundaries, control flow,
safety gates, failure modes and validation plan for a possible future limited broader local execution
implementation.
```

```text
This is a design artifact only. It is not an implementation artifact, not an execution artifact and not a
GATE-2 approval artifact.
```

The practical value of this package is reviewability: an owner, a privacy reviewer and a security reviewer
can evaluate the *shape* of a hypothetical implementation — where the caps live, where the fail-closed
checks sit relative to the first file open, what the evidence packet may and may not contain — without any
code existing, any real file being opened and any new spend, privacy or write surface being created.

---

## 3. Background

```text
11A runner scaffold.
11B synthetic validation.
11C synthetic temp-manifest.
11D real manifest metadata-only.
11E real manifest metadata-only execution.
11F real data-file required-family probe.
11G real required-family join probe.
11H real aggregate-only coverage signal.
11I interpretation of zero and recommendation to stop cap expansion.
11J GATE-2 route decision package.
11K GATE-2 controls and evidence template.
11L GATE-2 owner review package.
11L merge audit documented a process exception: PR #187 was squash-merged instead of merge-committed,
with content/scope/safety valid and no rollback recommended.
11M GATE-2 formal decision record.
11N limited broader local execution decision record.
```

```text
11N documented candidate scope as proposed_only / not_authorized.
11O turns that candidate scope into an implementation design package only.
```

11N recommended **Option C — Keep candidate scope documented but blocked**, and explicitly stated that 11N
itself authorized neither an implementation design package nor GATE-2 nor execution. The separate owner
phrase named in 11N § 23 was received, which is what allows this design package to exist. That phrase
authorized a design package and nothing beyond it.

---

## 4. Design boundary

```text
This package may describe future implementation shape.
It may define proposed modules, proposed CLI flags, proposed control flow, proposed validation strategy
and proposed reporting structure.
It may not create or modify any module, CLI, script, test, package entry or runtime integration.
```

It explicitly excludes:

```text
actual implementation;
execution;
runtime approval;
import approval;
field persistence approval;
identity grain approval;
source_company_snapshots writes;
Supabase writes;
Agent 1 approval;
provider integration;
production/liveness approval.
```

A design description is not an instruction set. No section of this document may be lifted and used as a
runbook, an operator checklist or a command to run. The only executable artifact that could ever exist is
one produced by a separately authorized implementation milestone and validated by a separately authorized
validation milestone.

---

## 5. Preconditions before implementation

```text
GATE-2 explicitly approved later, or owner explicitly authorizes design-only follow-up while keeping
execution blocked;
implementation hito explicitly authorized later;
allowed families confirmed;
forbidden families confirmed;
directory policy confirmed;
temp storage policy confirmed as blocked or separately approved;
output/evidence controls confirmed;
protected data policy confirmed;
fail-closed matrix accepted;
stop conditions accepted;
no import/runtime/Agent1/provider flags introduced;
```

```text
None of these preconditions are satisfied by this package.
This package does not satisfy them.
```

Preconditions are cumulative, not alternative: a later implementation milestone requires all of them, and
the absence of any one of them is a stop, never a default-allow.

---

## 6. Proposed architecture — docs-only

A hypothetical future implementation would be decomposed into single-responsibility layers so that every
safety property is enforced by an identifiable component and can be reviewed in isolation:

```text
control layer;
manifest/control-file validator;
family allowlist/denylist validator;
directory safety validator;
cap validator;
real-file bounded reader;
join-key ephemeral comparator;
aggregate-only reporter;
output sanitizer;
fail-closed validator;
cleanup verifier;
evidence packet builder;
no-write/no-runtime guard;
CLI adapter;
test harness.
```

Proposed responsibility boundaries, described conceptually:

| Layer | Proposed responsibility | Must never do |
|---|---|---|
| Control layer | Sequence the validators, own the abort path, own the exit code | Open files, read rows, format output |
| Manifest/control-file validator | Confirm the control file is well-formed, expected and owner-approved | Read data files, resolve real paths into output |
| Family allowlist/denylist validator | Resolve requested families against allowlist and denylist | Treat an unknown family as allowed |
| Directory safety validator | Confirm the input root, reject traversal, reject symlinks, reject unsafe basenames | Emit any absolute path or real filename |
| Cap validator | Confirm every cap is explicitly present and within the owner-approved maximum | Infer, inherit or escalate a cap |
| Real-file bounded reader | Read strictly within approved caps, stop at the boundary | Buffer beyond the cap, retain rows, seek opportunistically |
| Join-key ephemeral comparator | Compare join keys in memory and discard them immediately | Print, hash, log, persist or return a join key |
| Aggregate-only reporter | Produce bucketed counts | Produce rows, cells, samples or exact percentages |
| Output sanitizer | Inspect every output surface before it leaves the process | Trust an upstream layer's output as already safe |
| Fail-closed validator | Assert that every required control was actually applied | Pass on the basis of absence of evidence |
| Cleanup verifier | Confirm nothing was left behind, on success and on failure | Report cleanup with paths or filenames |
| Evidence packet builder | Assemble the bucketed, path-free evidence record | Include raw evidence of any kind |
| No-write/no-runtime guard | Assert no DB write, no runtime activation, no provider call, no Agent 1 path | Be optional or bypassable by a flag |
| CLI adapter | Parse flags and delegate; nothing else | Contain any policy logic |
| Test harness | Exercise all of the above on synthetic fixtures | Depend on real data to pass |

```text
All names are conceptual unless already present in the repository.
No new files or modules are created by this package.
No existing runtime path is activated by this package.
```

Several of the conceptual layers above correspond to modules that already exist in the repository from the
11A–11H sequence — for example the manifest validator, the file reader, the required-family probe, the
required-family join probe, the aggregate join coverage signal, the output sanitizer, the no-write guard
and the cleanup module under the Receita CNPJ connector directory, plus the existing dry-run runner under
the source-catalog scripts directory. Naming them here is a mapping observation for reviewers, not a change
to them: this package modifies none of them, adds nothing to them and activates none of them. A later
implementation milestone, if separately authorized, should prefer extending those existing modules over
introducing a parallel second architecture.

---

## 7. Proposed control flow — docs-only

```text
1. validate explicit authorization phrase;
2. validate GATE-2 approval state;
3. validate strict mode;
4. validate manifest/control file;
5. validate allowed input root;
6. validate family allowlist/denylist;
7. validate caps;
8. validate temp storage policy;
9. open only authorized family files;
10. read only within approved caps;
11. compare join keys ephemerally if approved;
12. discard protected keys immediately;
13. build aggregate-only bucketed metrics;
14. sanitize all output surfaces;
15. run fail-closed validation;
16. produce evidence packet;
17. verify cleanup;
18. exit without writes or runtime activation.
```

The ordering carries the safety property, not just the completeness. Steps 1–8 are all pre-open checks:
every authorization, policy, family, cap and directory decision must resolve before step 9 touches the
first byte of a real file. A design in which any of steps 1–8 could run after step 9 would be rejected on
review, because a violation discovered after the first open has already produced the read it was meant to
prevent. Steps 14–17 are all post-compute checks that run on both the success and the failure path: an
abort between steps 9 and 13 must still reach sanitization, fail-closed validation, evidence packet and
cleanup verification.

```text
This flow is descriptive only and cannot be used as an execution runbook.
```

---

## 8. Proposed CLI/API contract — docs-only

Conceptual flag names, offered so that reviewers can evaluate whether the surface is explicit enough and
whether any flag could be misused as an escalation path:

```text
--limited-broader-local-execution
--limited-broader-local-execution-authorized
--gate2-approved
--strict
--manifest-control-file
--allowed-input-root
--allowed-family
--forbidden-family
--max-files
--max-files-per-family
--max-bytes-per-file
--max-rows-per-file
--max-total-bytes
--max-total-rows
--max-runtime-seconds
--temp-storage-disabled
--aggregate-only
--no-import
--no-supabase-write
--no-runtime
--no-agent1
--no-provider-calls
```

Proposed contract properties for reviewer evaluation:

```text
every safety flag is explicit; there is no implicit default that widens scope;
the negative guards (--no-import, --no-supabase-write, --no-runtime, --no-agent1, --no-provider-calls)
  are asserted invariants, not toggles: a future implementation must have no code path that turns any of
  them off, and passing the positive inverse of any of them must fail closed;
--gate2-approved is a state assertion validated against the recorded gate state, never a self-declaration
  that grants approval;
--limited-broader-local-execution-authorized is a state assertion validated against a recorded owner
  authorization, never a self-declaration;
an unrecognized flag fails closed rather than being ignored;
a missing cap flag fails closed rather than resolving to a default;
--aggregate-only is mandatory, not optional.
```

```text
These flags are proposed names only.
They are not implemented.
They are not authorized for use.
Passing or documenting these flags must not be interpreted as execution authorization.
```

---

## 9. Proposed data-family policy

```text
candidate allowed families: Empresas and Estabelecimentos only, proposed_only / not_authorized;
support catalog families: blocked unless separately reviewed;
Socios/QSA/CPF/person families: categorically blocked unless separate legal/privacy/security review
approves otherwise;
ZIP opening: blocked unless separately reviewed;
any unexpected family: fail closed.
```

The policy is an allowlist, never a denylist alone. A family that is absent from the allowlist is blocked
even if it is also absent from the denylist, so a newly published family in a future dataset release cannot
become readable by omission.

---

## 10. Proposed cap model

```text
all caps explicit;
no inherited caps;
no automatic cap escalation;
no escalation from zero results;
separate caps for files, files per family, bytes per file, rows per file, total bytes, total rows and
runtime;
cap validation before opening files;
cap overrun stops execution;
cap overrun output must be code-only or bucketed;
```

Proposed cap placeholders, all awaiting owner values:

```text
maxFilesOpened: TBD by owner
maxFilesPerFamily: TBD by owner
maxBytesPerFile: TBD by owner
maxRowsPerFile: TBD by owner
maxTotalBytes: TBD by owner
maxTotalRows: TBD by owner
maxRuntimeSeconds: TBD by owner
```

An unset cap is not an unlimited cap. Absent an explicit owner-approved value, each cap resolves to
`not_authorized` and a future implementation must fail closed rather than default to a permissive value.
The "no escalation from zero results" rule restates the 11I finding: a bounded-window zero is a valid
bounded-window outcome, and it is never on its own a justification to raise a cap.

---

## 11. Proposed directory and temp-storage model

```text
allowedInputRoot: TBD by owner
allowedManifestControlFile: TBD by owner
allowedTempRoot: not_authorized by default
outputRoot: no-output-file or TBD by owner
outputInsideRepoAllowed: false
pathTraversalBlocked: true
symlinkPolicy: block unless separately reviewed
unsafeBasenamePolicy: block
tempStorageStatus: not_authorized
```

```text
No absolute real path may be documented.
No real filename may be documented.
Temp storage requires separate approval.
```

Any owner-approved directory value must be conveyed through the operator channel, never through this or
any other public document. If temp storage were ever separately approved, cleanup on both the success and
the failure path would be mandatory, cleanup evidence would be bucketed and path-free, and no temp artifact
could carry a raw identifier, a join-key hash or a row sample in its contents or in its name.

---

## 12. Proposed join handling model

```text
CNPJ básico/root remains a protected technical join key.
Join key may only be parsed ephemerally if a later approved implementation and execution allow it.
Join key must never be output.
Join key must never be persisted.
Join key must never be hashed.
Join key must never be logged.
Join key must never appear in error messages.
Join key must be discarded immediately after comparison.
No joined rows may be printed.
No joined samples may be produced.
```

The hashing prohibition is deliberate and is not redundant with the output prohibition: a hash of a
low-entropy national identifier is reversible by enumeration, so a hash is treated as the identifier
itself, not as a de-identified substitute. The error-message prohibition is equally deliberate: exception
paths are the most common accidental output surface, so the comparator must never place a key into an
error, a stack context or a diagnostic string.

---

## 13. Proposed output and evidence model

```text
aggregate-only output;
bucketed counts only;
no raw rows;
no raw cells;
no identifiers;
no join keys;
no join-key hashes;
no company names;
no person names;
no addresses;
no emails;
no phones;
no filenames unless separately approved;
no absolute paths;
no joined rows;
no samples;
no exact percentages unless separately approved;
no full dataset denominator unless separately approved;
no coverage proof language;
no coverage guarantee language;
no production inference language.
```

The two language prohibitions are content rules, not formatting rules. A bucketed count may be reported;
a claim that the count proves or guarantees dataset-level coverage may not, and neither may any inference
from a bounded local window to production behavior. Exact percentages and a full-dataset denominator remain
blocked because both convert a bounded-window observation into an apparent dataset-level claim.

---

## 14. Proposed fail-closed design

```text
fail closed on missing authorization phrase;
fail closed on GATE-2 not approved;
fail closed on missing strict mode;
fail closed on missing cap;
fail closed on cap above approved max;
fail closed on forbidden family;
fail closed on unexpected family;
fail closed on unauthorized directory;
fail closed on symlink/path traversal;
fail closed on temp storage without approval;
fail closed on output inside repo;
fail closed on raw row/cell output request;
fail closed on identifier output request;
fail closed on join key output request;
fail closed on exact percentage request without separate approval;
fail closed on full dataset denominator request without separate approval;
fail closed on import/Supabase/runtime/Agent1/provider flag;
fail closed on sanitizer finding.
```

Every case above must abort before any file is opened, except the sanitizer finding, which by construction
can only be detected after metrics exist and must therefore abort before any output leaves the process.
Fail-closed means the absence of an explicit approval is a stop, never a default-allow, and it means an
unexpected condition is a stop rather than a warning.

---

## 15. Proposed stop conditions / kill-switch

```text
stop before opening files if GATE-2 not approved;
stop before opening files if authorization phrase is missing;
stop before opening files if family policy is invalid;
stop before opening files if caps are invalid;
stop before opening files if directory policy is invalid;
stop during execution on cap overrun;
stop during execution on unexpected family;
stop during execution on output leak;
stop during execution on sanitizer finding;
stop during execution on temp cleanup failure;
stop during execution on unknown output surface;
stop during execution on reviewer/operator uncertainty.
```

The final condition is a human kill-switch and is intentionally not machine-evaluated: an operator or
reviewer who is uncertain stops, and the stop needs no further justification.

---

## 16. Proposed test strategy — docs-only

```text
synthetic fixture tests;
synthetic temp-manifest tests;
real manifest metadata-only regression tests;
fail-closed authorization tests;
fail-closed family tests;
fail-closed cap tests;
fail-closed directory tests;
fail-closed temp storage tests;
fail-closed output sanitizer tests;
no-write/no-runtime guard tests;
CLI contract tests;
evidence packet shape tests;
sensitive scan tests;
```

Proposed design properties for that future suite:

```text
every test passes without any real dataset file present;
every fail-closed case in § 14 has at least one negative test asserting the abort, not just the message;
the no-write/no-runtime guard tests assert absence of DB write, runtime activation, provider call and
  Agent 1 path, not merely that a flag was passed;
the evidence packet shape tests assert the prohibited fields are absent, not only that the allowed fields
  are present;
the sensitive scan tests assert that no output surface can carry an identifier, a join key, a hash of
  either, an absolute path or a real filename.
```

```text
No tests are created by this package.
This section is a future test design only.
```

---

## 17. Proposed evidence packet shape

Proposed fields:

```text
authorization_status;
gate2_status;
run_mode;
families_requested;
families_opened_bucket;
files_opened_bucket;
bytes_read_bucket;
rows_read_bucket;
runtime_bucket;
temp_storage_used;
cleanup_status;
join_executed_bucket;
aggregate_output_status;
sanitizer_findings;
fail_closed_findings;
sensitive_scan_findings;
no_write_status;
no_runtime_status;
no_agent1_status;
no_provider_status;
gate_status;
Brazil readiness flags;
decision_status;
```

Prohibited in the evidence packet:

```text
raw rows;
raw cells;
identifiers;
join keys;
hashes derived from identifiers;
absolute paths;
real filenames;
screenshots of real data;
exact coverage percentage unless separately approved;
full dataset denominator unless separately approved.
```

The `_bucket` suffix is load-bearing: those fields carry a bucketed magnitude, never an exact count, so
that no combination of fields can be differenced back into a precise dataset-level figure.

---

## 18. Proposed implementation sequencing

```text
Phase 1 — docs-only design review.
Phase 2 — code implementation in isolated modules only, if separately authorized.
Phase 3 — synthetic-only validation.
Phase 4 — fail-closed validation.
Phase 5 — post-merge validation.
Phase 6 — separate execution authorization decision.
```

```text
11O only completes Phase 1.
No later phase is authorized by 11O.
```

Each phase requires its own explicit owner authorization. Completing one phase never rolls forward into
the next, and no phase may be combined with another to shorten the sequence.

---

## 19. Design options

```text
Option A — Keep design package only and stop.
Effect: No implementation path proceeds.

Option B — Request design changes.
Effect: More documentation only.

Option C — Authorize synthetic-only implementation design follow-up.
Effect: Future hito may design code structure for synthetic-only implementation, still no real execution.

Option D — Authorize implementation hito later.
Effect: Future hito may implement code, but no real execution, no import, no runtime, no Agent 1.

Option E — Escalate to legal/privacy/security before implementation.
Effect: No implementation until external review.

Option F — Authorize execution now.
Status: blocked / not allowed by this design package.
```

---

## 20. Recommended draft decision

```text
Recommended draft decision for 11O: Option A — Keep design package only and stop until owner explicitly
authorizes implementation.
```

```text
11O itself does not authorize Option D.
11O itself does not authorize implementation.
11O itself does not authorize execution.
A separate exact owner phrase is required for any next hito.
```

Rationale for Option A: the design is now written down and reviewable, which is the durable value of this
package. GATE-2 remains closed, so an implementation built now would sit unused behind a gate that has not
been decided, while adding a real code surface, a real test surface and a real maintenance cost to the
repository. Stopping at the design keeps every option open at zero added risk, and the 11I finding — that a
bounded-window zero is not a reason to widen scope — still stands.

---

## 21. Required owner decision fields

```text
Owner:
Review date:
Decision option selected:
Decision status:
Rationale:
Required changes:
Legal/privacy/security escalation required:
Implementation hito authorized:
Synthetic-only validation authorized:
Real-data execution authorized:
Temp storage authorized:
Import authorized:
Supabase writes authorized:
Runtime authorized:
Agent 1 authorized:
Expiration / re-review date:
Owner signature / approval reference:
```

```text
All authorization fields default to false unless explicitly approved later.
```

---

## 22. Proposed future milestone sequence

```text
BR-SOURCE-11P — Limited broader local execution implementation, only if explicitly authorized.
BR-SOURCE-11Q — Post-merge validation for implementation, only if 11P is merged.
BR-SOURCE-11R — Execution authorization decision, only after implementation validation.
BR-SOURCE-11S — Execution runbook, only if execution authorization decision allows it.
```

```text
This sequence is proposed only.
No milestone after 11O is authorized by this package.
```

This sequence refines the 11N § 22 sketch by adding 11S for the runbook. It supersedes earlier letter
mappings for naming purposes only; it changes no authorization, and every milestone in it remains
unauthorized.

---

## 23. Required owner phrase for next step

```text
AUTHORIZE BR-SOURCE-11P — LIMITED BROADER LOCAL EXECUTION IMPLEMENTATION
```

```text
This phrase would authorize only implementation work.
It would not authorize real-data execution.
It would not authorize temp storage unless separately stated.
It would not approve import.
It would not approve Supabase writes.
It would not approve runtime.
It would not approve Agent 1.
```

---

## 24. What remains blocked

```text
GATE-2 approval;
limited broader local execution;
broader local execution;
implementation;
new real coverage execution;
re-running 11H coverage signal;
larger caps;
multi-window sampling;
seeking strategy;
opening additional files;
opening catalog files;
opening Socios/QSA/CPF/person files;
opening ZIPs;
temp storage;
exact percentages;
full dataset denominator;
coverage proof;
coverage guarantee;
production inference;
full join;
full dataset processing;
dataset import;
source_company_snapshots writes;
Supabase writes;
migrations;
runtime;
Agent 1;
provider calls;
UI;
Brazil live prospect generation.
```

---

## 25. Gate status

```text
GATE-1 = not_started / not approved
GATE-2 = not_started / not approved
GATE-3 = not_started / not approved
GATE-4 = not_started / not approved
GATE-5 = not_started / not approved
GATE-6 = not_started / not approved
GATE-7 = not_started / not approved
GATE-8 = not_started / not approved
```

---

## 26. Flags

```text
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_DESIGN_AUTHORIZED = true
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_DESIGN_PR_READY = false until PR
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_DESIGN_OFFICIAL = false until merge

OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_AUTHORIZED = false
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_GATE2_APPROVED = false
OPS_BR_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_MULTI_WINDOW_COVERAGE_SIGNAL_AUTHORIZED = false
OPS_BR_EXACT_COVERAGE_PERCENTAGE_AUTHORIZED = false

OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_DECISION_RECORD_OFFICIAL = true
OPS_BR_GATE2_FORMAL_DECISION_RECORD_OFFICIAL = true
OPS_BR_GATE2_OWNER_REVIEW_PACKAGE_OFFICIAL = true
OPS_BR_GATE2_CONTROLS_EVIDENCE_TEMPLATE_OFFICIAL = true
OPS_BR_GATE2_ROUTE_DECISION_PACKAGE_OFFICIAL = true

FULL_JOIN_RUNNER_READY = true
FULL_JOIN_EXECUTION_READY = false
IMPORT_READY = false
RUNTIME_READY = false
AGENT1_READY = false

OPS_BR_READY_FOR_IMPORT = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT = false
OPS_BR_READY_FOR_RUNTIME = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED = false
```

`OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_DESIGN_PR_READY` flips to `true` only once this
docs-only PR is open; `..._OFFICIAL` flips to `true` only once it is merged. Neither flip changes any
operational flag, and every Brazil-readiness flag stays `false` regardless of either.

---

## 27. Next milestone mapping

```text
If the owner accepts this design package:
BR-SOURCE-11P may implement limited broader local execution code only if separately authorized.

If the owner wants execution:
11P implementation, 11Q validation and 11R execution authorization must happen later.

If the owner wants import:
a later import-readiness process is required after relevant gates.

This design package does not authorize any of those actions.
```

---

## 28. Safety confirmation

```text
This document is docs-only.
It does not authorize implementation.
It does not authorize execution.
It does not approve GATE-2.
It does not approve any gate.
Brazil remains blocked for import, runtime, Agent 1 and live prospect generation.
```

This milestone touched no code, no scripts, no package manifest, no test, no Supabase schema, no migration,
no runtime path, no Agent 1 path, no provider, and no UI. It opened no real dataset file, read no real
manifest, opened no CSV and no ZIP, processed no row, executed no join, and computed no coverage figure.

---

## 29. BR-SOURCE-11P implementation status (appended after 11P)

This section records what the separately-authorized implementation milestone built against § 1–28. It is a
status note; it approves no gate and authorizes no execution.

```text
Implementation milestone:                                 BR-SOURCE-11P
Authorization phrase received:                            AUTHORIZE BR-SOURCE-11P — LIMITED BROADER LOCAL EXECUTION IMPLEMENTATION
Implementation status:                                    fail_closed_scaffold_implemented
GATE-2 approval status:                                   not_started / not approved
Limited broader local execution status:                   not_authorized
Execution status:                                         not_authorized
Real data opened:                                         none
Current GO/NO-GO:                                         NO-GO
```

**What was implemented.** A control layer
(`src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-limited-broader-local-execution.ts`)
exposing the two pure entry points § 6 and § 17 call for — a request evaluator and an evidence-packet
builder — plus a fail-closed CLI mode (`--limited-broader-local-execution`) on the existing dry-run runner,
a narrow output-sanitizer extension for approval language, and a synthetic-only test suite. § 6's guidance
was followed: the family allowlist, the person-family denylist and the no-write/no-runtime guard were
REUSED from the existing 11A/11D/11F modules rather than re-implemented, so each has one definition.

**Why real execution remains impossible.** Two independent structural blocks, neither of which any caller,
flag or argument can lift:

```text
1. The recorded GATE-2 state is `not_approved` and the recorded execution authorization phrase is absent
   (null). Both are module constants. Per § 8 a `--gate2-approved` argument is a state assertion validated
   against the recorded state — so asserting approval is itself a violation, and asserting non-approval is
   simply true. Either way the request is refused.
2. No cap ceiling is owner-approved. § 10 leaves every cap "TBD by owner" and states that an unset cap is
   not an unlimited cap, so the ceiling table is deliberately all-`null` and a FULLY-CAPPED request is
   still refused with `cap_ceiling_not_authorized`. Recording a ceiling would be an authorization decision
   11P does not carry.
```

Both blocks are expressed in the TYPES as well as the logic: `ok` is the literal `false`, the decision
status is a single-member union `'not_authorized'`, and `fileAccessAllowed` is the literal `false`. No
caller can write a branch that proceeds to open a file.

**Why no file can be opened.** The control layer is pure — it imports no `fs` and no `path`, performs no
I/O, reads no environment variable — and it is never given a filesystem path at all: directory policy
arrives as class labels. The CLI mode refuses `--manifest` and `--output` outright and constructs no reader,
no workspace and no probe, so "no file is opened" is a property of the argument surface rather than a
promise about downstream code. Two flags from the § 8 sketch were therefore deliberately NOT implemented:
`--allowed-input-root` and `--manifest-control-file` (both paths), and `--forbidden-family` (which would let
a caller name — and so shrink — the person-family denylist, now a module constant).

**Deviation from § 17, in the safer direction.** `families_requested` is implemented as a class TALLY
(`allowed` / `forbidden` / `unexpected` counts) rather than the raw requested list, because echoing an
arbitrary caller string into an evidence packet could carry an identifier. The tally answers the reviewer's
question without creating the leak.

**Validation performed.** `tsc --noEmit` clean; the new synthetic suite green; the existing BR-SOURCE
11A–11H runner suite green with no change in outcome; ESLint clean on every changed file; one CLI invocation
run with synthetic, path-free arguments only, which refused as designed and exited non-zero.

```text
Flags after 11P:

OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_AUTHORIZED = true
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_PR_READY = true
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_OFFICIAL = false until merge

OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_GATE2_APPROVED = false
OPS_BR_BROADER_LOCAL_EXECUTION_AUTHORIZED = false
OPS_BR_MULTI_WINDOW_COVERAGE_SIGNAL_AUTHORIZED = false
OPS_BR_EXACT_COVERAGE_PERCENTAGE_AUTHORIZED = false

FULL_JOIN_RUNNER_READY = true
FULL_JOIN_EXECUTION_READY = false
IMPORT_READY = false
RUNTIME_READY = false
AGENT1_READY = false

OPS_BR_READY_FOR_IMPORT = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT = false
OPS_BR_READY_FOR_RUNTIME = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED = false
```

Every gate in § 25 remains `not_started / not approved`. 11P approved none of them, and the next milestones
in § 22 (11Q validation, 11R execution authorization, 11S runbook) each still require their own explicit
owner authorization.

---

## 30. Update (BR-SOURCE-11R)

BR-SOURCE-11R creates the execution authorization decision record.
It documents current blockers, owner decision options, required owner fields, minimum conditions before
execution and before a runbook, evidence requirements, stop conditions, a risk table and future milestone
mapping. It does not approve GATE-2. It does not authorize execution, real-data access, caps, input roots,
output roots, temp storage, import, Supabase, runtime or Agent 1. It does not approve any gate. See
[`br-receita-cnpj-execution-authorization-decision-record.md`](./br-receita-cnpj-execution-authorization-decision-record.md).

11R takes the § 29 implementation status as its starting factual state and draws the conclusion that follows
from it: the scaffold exists, was merged and was validated, and it refuses. The two structural blocks
recorded in § 29 — a `not_approved` GATE-2 state with an absent authorization phrase, and an all-`null` cap
ceiling — appear in 11R as the first three of eight non-negotiable blockers, unchanged and unresolved. 11R
adds no flag, no cap, no input root and no execution permission, and the recommended draft decision it
carries is to keep execution blocked.

---

## 31. Update (BR-SOURCE-11S)

BR-SOURCE-11S creates the execution runbook.
It documents roles, checklists, a non-executable command skeleton, stop conditions, an evidence template, an
incident path, a future validation template and milestone mapping. It does not approve GATE-2. It does not
authorize execution, real-data access, caps, input roots, temp storage, import, Supabase, runtime or Agent 1.
It does not approve any gate. See
[`br-receita-cnpj-execution-runbook.md`](./br-receita-cnpj-execution-runbook.md).

The runbook's § 9 command skeleton is drawn from the § 8 conceptual flag contract, with the three flags § 29
records as deliberately unimplemented — the two path-bearing ones and the one that would let a caller name the
person-family denylist — deliberately absent from it as well, and with every cap placeholder naming the future
authorization artifact instead of a value. The § 17 evidence shape reaches the runbook in its § 29 form: class
tallies and buckets, never raw requested lists or exact figures.

BR-SOURCE-11T creates the cap/input policy authorization package. It documents cap categories, input
classes, output policy categories, family allow/deny policy, manifest/control-file policy, temp storage
policy, evidence bucket policy, exact percentage/denominator policy, owner fields, stop conditions and
future milestone mapping. It does not approve GATE-2. It does not authorize execution, real-data access,
caps, input roots, output roots, temp storage, import, Supabase, runtime or Agent 1. It does not approve any
gate. See
[`br-receita-cnpj-cap-input-policy-authorization-package.md`](./br-receita-cnpj-cap-input-policy-authorization-package.md).
The § 8 conceptual flag contract's candidate cap set and the § 29 deliberately-unimplemented path-bearing
flags are unchanged by 11T: the package proposes cap and input-class categories only, never the values this
design's contract sketches as future placeholders.
