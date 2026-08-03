# BR-SOURCE-11T — Cap/input policy authorization package

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11T — Cap/input policy authorization package (docs-only)
**Status:** `proposed_for_owner_review` — **not** a GATE-2 approval, **not** a GATE-7 approval, **not** an
authorization for cap/input policy values, cap maxima, input roots, output roots, temp storage, limited
broader local execution, broader local execution, execution, real-data file access, manifest reading, CSV
reading, ZIP reading, row reads, exact coverage percentages, a full-dataset denominator, import, Supabase
writes, runtime, or Agent 1, and **not** an approval of any gate
**Predecessor:** BR-SOURCE-11S-LAND — `BRSOURCE11SLANDA — EXECUTION_RUNBOOK_MERGED` (PR #197, `main` HEAD
`2390def6b79852417e2c27b17a60579e3afc2ed2`, merge method `--merge`, parent count 2, merged 2026-08-03)
**Authorization received:** `AUTHORIZE BR-SOURCE-11T — CAP INPUT POLICY AUTHORIZATION PACKAGE` — authorizes
only the preparation of this cap/input policy authorization package, never GATE-2 approval, never GATE-7
approval, never limited broader local execution, never broader local execution, never cap or input-root
authorization, and never real-data access
**Last reviewed:** 2026-08-03

**Related documents:**
- Execution runbook (BR-SOURCE-11S) — [`br-receita-cnpj-execution-runbook.md`](./br-receita-cnpj-execution-runbook.md)
- Execution authorization decision record (BR-SOURCE-11R) — [`br-receita-cnpj-execution-authorization-decision-record.md`](./br-receita-cnpj-execution-authorization-decision-record.md)
- Limited broader local execution implementation design package (BR-SOURCE-11O, with the 11P implementation status as § 29) — [`br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md`](./br-receita-cnpj-limited-broader-local-execution-implementation-design-package.md)
- Limited broader local execution decision record (BR-SOURCE-11N) — [`br-receita-cnpj-limited-broader-local-execution-decision-record.md`](./br-receita-cnpj-limited-broader-local-execution-decision-record.md)
- GATE-2 formal decision record (BR-SOURCE-11M) — [`br-receita-cnpj-gate2-formal-decision-record.md`](./br-receita-cnpj-gate2-formal-decision-record.md)
- Full join approval gates checklist (GATE-2 and GATE-7 definitions, § 6 and § 11) — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)

---

> This document is a **cap/input policy authorization package**: a decision-structure artifact that defines
> what an owner would have to approve — as categories, classes and fields — before any future cap or input
> policy could govern a controlled limited broader local execution. It approves no cap value, no input root,
> no output root and no gate. 11S's runbook left this exact package as its § 19 required owner phrase and its
> § 18 next proposed milestone; this document is that milestone, prepared under the phrase received above and
> nothing beyond it. **§ 1–25 supply the decision structure; they approve no value, no path, no execution and
> no gate.** GATE-2 remains `not_started / not approved`, so the only valid current decision is **NO-GO** for
> cap/input policy and for execution.

---

## 1. Status

```text
Cap/input policy authorization package status:      proposed_for_owner_review
Execution runbook status:                           official
Execution authorization decision status:             official
GATE-2 approval status:                              not_started / not approved
Cap/input policy approval status:                    not_authorized
Limited broader local execution authorization status: not_authorized
Execution run status:                                not_authorized
Current GO/NO-GO:                                    NO-GO
```

Explicitly, this package does **not** authorize:

```text
This package does not approve GATE-2.
This package does not authorize cap/input policy values.
This package does not authorize cap maxima.
This package does not authorize input roots.
This package does not authorize output roots.
This package does not authorize temp storage.
This package does not authorize limited broader local execution.
This package does not authorize broader local execution.
This package does not authorize execution.
This package does not authorize real-data file access.
This package does not authorize manifest reading.
This package does not authorize CSV reading.
This package does not authorize ZIP reading.
This package does not authorize row reads.
This package does not authorize exact coverage percentages.
This package does not authorize full dataset denominator claims.
This package does not authorize import.
This package does not authorize Supabase writes.
This package does not authorize runtime.
This package does not authorize Agent 1.
This package does not approve any gate.
```

---

## 2. Purpose

```text
The purpose of this package is to define the owner decision structure required before any future
cap/input policy can be approved for a controlled limited broader local execution path.
```

```text
This is a policy authorization package.
It is not a policy approval.
It is not an execution approval.
It is not a GATE-2 approval.
It contains no real paths, no real cap values and no runnable command with real data.
```

The distinction this package draws is one level narrower than 11S's. 11S separated "we know what the
procedure would look like" from "the procedure may be followed." This document separates "we know what an
owner would have to decide about caps, inputs and outputs" from "an owner has decided." Both separations
matter for the same reason: every document in this chain is written in checklist-shaped, decision-ready
prose, and each one that ships without values in it is one more place a reader could mistake a category
list for an approved list. This package exists so that distinction stays explicit at the cap/input layer
specifically, rather than being inherited by implication from 11N, 11O or 11S.

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
11L merge audit documented the PR #187 squash-merge process exception with no content/safety issue.
11M GATE-2 formal decision record.
11N limited broader local execution decision record.
11O implementation design package.
11P fail-closed implementation scaffold.
11Q post-merge validation passed.
11R execution authorization decision record.
11S execution runbook.
```

```text
11T does not change the fail-closed behavior implemented in 11P and validated in 11Q.
11T does not satisfy any execution prerequisite from 11R.
11T does not make the 11S runbook executable.
```

Two inherited findings carry forward unchanged and are not reopened here. First, 11I's reading of the 11H
aggregate-only signal: a zero observed inside a bounded window is not evidence about the dataset and is not
a reason to widen scope, and by extension is not a reason to widen a cap either. Second, 11N's and 11O's
shared position that every candidate cap remains `proposed_only / not_authorized`, and that an unset cap is
not an unlimited cap — this package inherits that position as its central organizing rule rather than
restating it as new.

---

## 4. Policy boundary

This package may document only:

```text
cap categories;
input root class categories;
output policy categories;
manifest/control-file policy categories;
family allow/deny policy categories;
temp storage policy categories;
evidence bucket policy categories;
stop conditions;
owner approval fields;
future milestone mapping.
```

It excludes:

```text
actual cap approval;
actual input root approval;
actual output root approval;
actual execution;
real data reads;
copy-pasteable real-data command;
real path values;
real cap values;
implementation changes;
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

A category list is not a value list. No section of this document may be read as supplying a cap number, a
directory, a filename or a command a reader could run — every table below is deliberately structured so
that its cells are class labels, statuses and rationale, never quantities or paths.

---

## 5. Current blocking state

```text
The current implementation is intentionally fail-closed.
GATE-2 is recorded as not_approved.
Execution authorization phrase is absent.
Authorized cap maxima are null.
Allowed input root is not authorized.
Output root is not authorized.
File access is false.
Temp storage is false.
Import is false.
Supabase write is false.
Runtime integration is false.
Agent 1 integration is false.
Provider calls are false.
Brazil readiness flags are false.
```

The refusal reasons a request would receive today, inherited unchanged from 11S:

```text
authorization_phrase_missing
limited_broader_local_execution_not_authorized
gate2_not_approved
cap_ceiling_not_authorized
allowed_input_root_not_authorized
```

Both `cap_ceiling_not_authorized` and `allowed_input_root_not_authorized` matter specifically for a package
about cap/input policy: the first means a fully-capped request is refused because the ceiling table this
package would eventually feed is entirely null today, and the second means no path argument exists through
which an input root could arrive even if one were named. Nothing in this package changes either fact.

---

## 6. Cap policy categories — no approved values

| Cap category | Purpose | Current approved value | Allowed value source | Can be inferred? | Blocks execution if absent? |
|---|---|---|---|---|---|
| Max files opened | Bound the number of distinct files a run may touch | none / null / not_authorized | later official owner artifact only | no | yes |
| Max files per family | Bound files touched within a single allowed family | none / null / not_authorized | later official owner artifact only | no | yes |
| Max bytes per file | Bound how much of a single file may be read | none / null / not_authorized | later official owner artifact only | no | yes |
| Max rows per file | Bound rows read from a single file | none / null / not_authorized | later official owner artifact only | no | yes |
| Max total bytes | Bound aggregate bytes read across a run | none / null / not_authorized | later official owner artifact only | no | yes |
| Max total rows | Bound aggregate rows read across a run | none / null / not_authorized | later official owner artifact only | no | yes |
| Max runtime seconds | Bound wall-clock duration of a run | none / null / not_authorized | later official owner artifact only | no | yes |
| Max families requested | Bound how many distinct families a single run may request | none / null / not_authorized | later official owner artifact only | no | yes |
| Max output artifact size bucket | Bound the size class of any evidence artifact produced | none / null / not_authorized | later official owner artifact only | no | yes |
| Max evidence artifact count | Bound how many evidence artifacts a run may produce | none / null / not_authorized | later official owner artifact only | no | yes |
| Max retry count | Bound how many times a failed run may be retried | none / null / not_authorized | later official owner artifact only | no | yes |
| Max operator session duration | Bound how long a named operator session may remain open | none / null / not_authorized | later official owner artifact only | no | yes |

```text
No cap value is approved by 11T.
Null does not mean unlimited.
Missing cap means stop.
```

The "can be inferred?" column reads `no` for every row on purpose. A cap ceiling is not something the
implementation, a prior probe result or a coverage signal can supply on the owner's behalf — 11I already
established that a bounded-window observation is not a dataset-level claim, and the same logic forbids
treating any probe result as a substitute for an explicit ceiling decision. The "blocks execution if
absent?" column reading `yes` for every row is the practical consequence of § 5: the recorded ceiling table
is all-null today, and this package proposes the category shape that table would need, not values to fill
it with.

---

## 7. Input root policy categories — no real paths

| Input class | Description | Current approval | Path disclosure allowed? | Can be used for execution? | Required future control |
|---|---|---|---|---|---|
| Operator-prepared local manifest directory class | A directory an operator prepares locally to hold a manifest for a future authorized run | not_authorized | no | no | explicit owner approval naming the class, never a path, in a later official artifact |
| Operator-prepared extracted CSV directory class | A directory an operator prepares locally to hold extracted CSV files | not_authorized | no | no | explicit owner approval naming the class, never a path, in a later official artifact |
| Raw ZIP directory class | A directory holding unextracted source archives | not_authorized | no | no | blocked — see below |
| Download directory class | A generic OS download location | not_authorized | no | no | blocked — see below |
| Repo directory class | Any path inside this repository | not_authorized | no | no | blocked — see below |
| Temporary OS directory class | An OS-managed temporary directory | not_authorized | no | no | explicit owner approval naming the class, never a path, in a later official artifact |
| Unknown / ad-hoc directory class | Any directory not falling into a named class above | not_authorized | no | no | blocked — see below |
| Cloud/shared drive directory class | A cloud-synced or shared-drive location | not_authorized | no | no | blocked — see below |

For the repo directory class, both output and data input are prohibited: this repository is a code and
documentation surface, not a data-at-rest location, and no future artifact may reclassify it. For the raw
ZIP directory class, the download directory class, and the unknown/ad-hoc directory class, the classes
themselves are blocked outright — a future cap/input policy decision cannot lift these three by naming them
approved, because each carries a distinct risk this package is not equipped to resolve: raw ZIPs contain
every family including the forbidden ones before any family-level filtering occurs, download directories are
not scoped to this workflow at all, and an ad-hoc directory has no class-level control surface to reason
about in the first place.

```text
No real path may be documented in this repository.
No real filename may be documented in this repository.
No input class is approved by 11T.
```

---

## 8. Output policy categories — no output root approved

| Output class | Current approval | Allowed content type | Path disclosure allowed? | Blocks execution if absent? |
|---|---|---|---|---|
| stdout JSON evidence | not_authorized for execution; allowed only as a future aggregate/bucketed concept | class tallies and buckets only | no | yes |
| stderr | not_authorized for execution | sanitized diagnostic text only | no | yes |
| local evidence file | not_authorized | no real-data evidence, ever | no | yes |
| repo file | not_authorized | no real-data evidence, ever | no | yes |
| PR comment | not_authorized | no raw values, no paths, no identifiers | no | yes |
| chat paste | not_authorized | no raw values, no paths, no identifiers | no | yes |
| ticket paste | not_authorized | no raw values, no paths, no identifiers | no | yes |
| screenshot | not_authorized | no raw values, no paths, no identifiers | no | yes |
| external storage | not_authorized | none | no | yes |

```text
No output root is approved by 11T.
No real-data evidence may be written to the repository.
No real path-level proof may be pasted anywhere.
```

The stdout row is the only one this package treats as conceptually approvable in the future, and only in its
narrowest form: an aggregate, bucketed evidence shape, matching the evidence bucket policy in § 12 below —
never a value-bearing output. Every other row remains flatly `not_authorized` because none of them has a
control surface capable of guaranteeing that raw content stays out: a PR comment, a chat message, a ticket
and a screenshot are all read by humans and systems this package cannot bound, and external storage has no
control surface at all from inside this repository.

---

## 9. Family allow/deny policy

```text
Allowed-family candidate classes:
- empresas
- estabelecimentos
- cnaes
- municipios
- naturezas

Forbidden-family classes:
- socios
- qsa
- cpf/person-linked files
- simples
- unknown
- other
- any file that contains person-level identifiers
```

```text
This package does not approve any family for execution.
Families can only be approved by a later official owner artifact.
Any forbidden family request is a hard stop.
Unknown family is a hard stop.
Person-linked family is a hard stop.
```

`simples` is listed as forbidden rather than allowed, and that placement is deliberate rather than an
oversight: it is a candidate that could plausibly be treated as company-level data, but this package does
not carry the analysis needed to confirm that it is free of person-linked content in every distribution, so
it stays on the forbidden side pending a separate, explicit owner decision. Moving it later requires its own
determination — it is not lifted by this package, and it is not lifted implicitly by any future cap approval
that does not name it.

---

## 10. Manifest/control-file policy

```text
metadata-only manifest;
operator-prepared control file;
headerless manifest;
manifest with source_period;
manifest with declared families only;
manifest that contains paths;
manifest that contains real filenames;
manifest that contains row samples;
manifest that contains identifiers.
```

```text
No manifest is authorized for reading by 11T.
Metadata-only manifest handling (11D, 11E) remains historical precedent, not a new permission.
A manifest that contains paths, real filenames, row samples or identifiers is blocked for any future
  evidence or approval artifact.
Any future manifest/control-file policy must remain path-free in public evidence.
```

```text
11T does not authorize manifest reading.
11T does not authorize control-file reading.
```

The distinction between the first five list entries and the last four is the one this section exists to
preserve: metadata-only, headerless, source-period-bearing and declared-families-only manifests describe
*shapes* a manifest could take, already precedented in 11D and 11E under their own separate authorizations.
Path-bearing, filename-bearing, sample-bearing and identifier-bearing manifests describe *content* that must
never appear in anything this package's evidence policy (§ 12) would allow into a public artifact, regardless
of which shape category the manifest otherwise falls into.

---

## 11. Temp storage policy

```text
Option A — temp storage disabled
Option B — temp storage allowed only by later explicit artifact
Option C — temp storage requested by operator
Option D — temp storage inferred from implementation
```

```text
Recommended current option: Option A.
Option B is not authorized by 11T.
Option C is blocked.
Option D is blocked.
```

```text
Temp storage remains not_authorized.
Temp storage cannot be inferred.
Temp storage evidence must be bucketed and path-free if ever authorized later.
```

Option D is blocked for the same reason § 6 refuses to let a cap be inferred: the 11P scaffold's current
behavior — refusing rather than writing anything — is a property of the code that exists today, not a
policy decision this package or any future one can read backward out of the implementation. If temp storage
is ever authorized, that authorization has to be Option B, arrived at explicitly, not inferred from whatever
the scaffold happens to do in the meantime.

---

## 12. Evidence bucket policy

Permitted conceptually, for a future authorized evidence packet only:

```text
files opened bucket;
bytes read bucket;
rows read bucket;
runtime bucket;
families attempted tally;
forbidden families blocked tally;
sanitizer findings count;
fail-closed findings list;
sensitive scan findings count;
cleanup status class;
decision status;
gate status;
Brazil readiness flags.
```

Prohibited on every channel, unconditionally:

```text
exact row values;
raw cells;
identifiers;
join keys;
join-key hashes;
company names;
person names;
addresses;
emails;
phones;
absolute paths;
real filenames;
screenshots of real data;
coverage proof language;
coverage guarantee language;
production inference language.
```

```text
11T does not authorize evidence collection.
11T only defines the shape of a future evidence policy.
```

This section deliberately mirrors 11S § 11's permitted/forbidden split rather than inventing a new one: a
second, independently-worded evidence policy for the same workflow would be a second surface a future
reviewer would have to reconcile against the first, and the risk of the two drifting apart outweighs any
benefit of restating it differently here. Where this section adds anything, it is the explicit statement
that join-key hashes are forbidden on the same footing as the identifiers they are derived from — "it's only
a hash" is not an exemption anywhere in this evidence policy, consistent with 11S § 11's closing note.

---

## 13. Exact percentage and denominator policy

```text
Exact coverage percentages remain not_authorized.
Full dataset denominators remain not_authorized.
Coverage proof language remains prohibited.
Coverage guarantee language remains prohibited.
Production inference language remains prohibited.
```

```text
Any request for exact percentage without a later explicit owner artifact is a hard stop.
Any request for full dataset denominator without a later explicit owner artifact is a hard stop.
```

This section restates 11I's finding at the policy layer rather than the evidentiary one: 11I found that a
bounded-window zero is not a dataset-level claim, and the same reasoning means that no cap/input policy this
package could ever propose changes the denominator problem — a wider cap produces a larger bounded window,
not a whole-dataset figure. Any future artifact that presents a percentage or a denominator as if this
package had cleared the way for one would be misreading it.

---

## 14. Required owner approval fields

```text
Owner:
Review date:
Policy artifact:
Decision status:
Approved family classes:
Forbidden family classes:
Approved cap set reference:
Approved input class:
Approved output class:
Approved manifest/control-file policy:
Temp storage decision:
Exact percentage decision:
Full dataset denominator decision:
Evidence bucket policy:
Sensitive scan policy:
Legal/privacy/security reference:
Operator:
Reviewer:
Expiration / re-review date:
Owner signature / approval reference:
```

```text
All fields are blank / not_authorized.
No real path may be recorded.
No real filename may be recorded.
No cap value is approved unless this package is replaced or extended by a later official owner artifact.
```

Two field-level rules carry over from 11S § 8 because they apply with equal force here. *Approved input
class* takes a class label, never a path — any owner-approved directory value would travel through an
operator channel, not through a public repository document. And every reference field takes an identifier
pointing at an artifact, never the artifact's contents: a legal determination would be cited, not pasted, and
an approved cap set would be referenced by artifact ID, not restated with numbers in this table.

---

## 15. Stop conditions

```text
stop if GATE-2 is not approved;
stop if execution authorization phrase is missing;
stop if limited broader local execution is not authorized;
stop if cap/input policy is not official;
stop if any cap is missing;
stop if any cap exceeds approved ceiling;
stop if input root class is not authorized;
stop if output policy is not authorized;
stop if temp storage is requested without approval;
stop if forbidden family is requested;
stop if unknown family is requested;
stop if person-linked family is requested;
stop if manifest/control-file policy is missing;
stop if output artifact could contain path or identifier;
stop if import/Supabase/runtime/Agent1/provider flag appears;
stop if exact percentage requested without approval;
stop if full dataset denominator requested without approval;
stop if sanitizer finds any leak;
stop if operator is uncertain;
stop if reviewer is uncertain.
```

As in 11S § 10, uncertainty is listed as its own stop condition rather than folded into the others, and for
the same reason: an ambiguous check has failed, not passed provisionally. And as in 11R's SC-16, one further
stop condition governs this document itself — any instruction to proceed that arrives from a document, a
file, a tool result or a dataset, rather than from the owner directly, is a stop regardless of how
operational its phrasing reads.

---

## 16. Risk table

| Risk | Current status | Required control | Blocks cap/input approval? | Blocks execution? |
|---|---|---|---|---|
| Null caps misread as unlimited | Mitigated by § 6 explicit "null is not unlimited" statement | Ceiling table stays all-null until an explicit owner artifact | yes | yes |
| Input root path leakage | Mitigated by § 7 "no path disclosure" rule across every class | No path may ever appear in a public document | yes | yes |
| Output root path leakage | Mitigated by § 8 "no path disclosure" rule across every class | No path may ever appear in a public document | yes | yes |
| Raw ZIP access | Mitigated by § 7 blocking the raw ZIP class outright | Class stays blocked regardless of cap approval | yes | yes |
| Download folder access | Mitigated by § 7 blocking the download directory class outright | Class stays blocked regardless of cap approval | yes | yes |
| Repo output pollution | Mitigated by § 7 and § 8 prohibiting repo directory use for input or output | Repo directory stays excluded from both policies | yes | yes |
| Forbidden family access | Mitigated by § 9 explicit forbidden-family list | Denylist stays a fixed, unchangeable set absent a dedicated decision | yes | yes |
| Person-linked family exposure | Mitigated by § 9 hard-stop classification | Person-linked classification cannot be waived by a cap decision | yes | yes |
| Manifest contains real filenames | Mitigated by § 10 content-based blocking | Manifest content policy stays separate from manifest shape policy | yes | yes |
| Manifest contains identifiers | Mitigated by § 10 content-based blocking | Manifest content policy stays separate from manifest shape policy | yes | yes |
| Operator requests exact percentage | Mitigated by § 13 hard-stop classification | No percentage without a dedicated future artifact | yes | yes |
| Operator requests full dataset denominator | Mitigated by § 13 hard-stop classification | No denominator without a dedicated future artifact | yes | yes |
| Temp storage inferred | Mitigated by § 11 explicit "cannot be inferred" statement | Temp storage stays Option A absent an explicit artifact | yes | yes |
| Evidence packet leaks raw values | Mitigated by § 12 permitted/forbidden split | Evidence policy stays bucket-only | yes | yes |
| Premature execution after policy PR | Mitigated by § 1 and § 25 explicit non-authorization statements | PR merge changes no operational flag | no | yes |
| Premature import/runtime/Agent1 use | Mitigated by § 1, § 4 and § 25 explicit exclusions | These remain outside this package's scope entirely | no | yes |

```text
No risk in this table is closed by this package.
Every row's mitigation is a documentary statement, not a code-enforced control, except where 11P's
  fail-closed scaffold already enforces GATE-2 state, the authorization phrase and the cap ceiling in code.
```

---

## 17. Relationship to 11S runbook

```text
11S defined the non-executable runbook structure.
11T defines the policy authorization structure for caps, inputs and outputs.
11T does not make the 11S runbook executable.
11T does not satisfy the 11S preflight checklist.
11T does not authorize the conceptual command skeleton in 11S.
```

11S § 7's preflight checklist lists `Cap/input policy official: no` as one of thirteen items, all of which
must read `yes` before the checklist could pass. This package does not flip that item: it proposes the
categories a future cap/input policy artifact would need, but "proposed" and "official" are different
states, and only a later, separate owner decision — not this package — could move that item.

---

## 18. Relationship to GATE-2 and GATE-7

```text
11T does not approve GATE-2.
11T does not approve GATE-7.
11T is not the GATE-7 operator runbook section.
GATE-7's manual-download/local-prep runbook remains separate.
Any GATE-7 approval requires its own gate-specific evidence and owner decision.
```

The gates checklist defines GATE-2 as the temporary storage envelope and GATE-7 as operator runbook
approval, and 11S § 4.1 already established that no document in this chain may compete with or substitute
for either. This package's cap categories (§ 6) and input/output classes (§ 7, § 8) are the kind of content a
future GATE-2 decision would eventually need to reference, and its evidence bucket policy (§ 12) is the kind
of content GATE-7's preflight would eventually check against — but referencing that relationship is not
satisfying it. GATE-2's ceilings and GATE-7's frozen sanitizer contract still do not exist, and this package
does not create them.

---

## 19. Recommended draft decision

```text
Recommended draft decision for 11T: Keep cap/input policy unapproved.
```

```text
11T itself does not authorize cap/input policy.
11T itself does not authorize execution.
A separate exact owner phrase is required for any next hito.
```

The rationale is the same one 11R § 8 and 11S § 17 both reached: the binding constraints remain GATE-2's
unapproved state and the unresolved legal/privacy review from 11R's BLOCKER-8, and neither moves by defining
policy categories. This package was worth producing once, because it gives a future owner a fixed structure
to decide against rather than an open-ended question — but the categories themselves carry no authorization,
and treating their existence as progress toward execution would repeat the misreading § 2 warns against.

---

## 20. Proposed future milestone sequence

```text
BR-SOURCE-11U — Synthetic rehearsal validation, no real data, only if explicitly authorized.
BR-SOURCE-11V — Controlled execution authorization review, only after prior conditions are official.
BR-SOURCE-11W — Controlled execution attempt, only if separately and explicitly authorized.
```

```text
This sequence is proposed only.
No milestone after 11T is authorized by this package.
```

This sequence carries the 11S § 18 mapping forward unchanged, minus 11T itself, which this package now
satisfies. It changes no authorization for any of the three remaining entries, and 11W remains the most
heavily conditioned: it presupposes GATE-2 approved, the legal/privacy determination closed, an official
cap/input policy, and a named human operator — none of which this package creates.

---

## 21. Required owner phrase for next step

```text
AUTHORIZE BR-SOURCE-11U — SYNTHETIC REHEARSAL VALIDATION
```

```text
This phrase would authorize only synthetic rehearsal validation.
It would not authorize real-data execution.
It would not authorize manifest reading.
It would not authorize CSV/ZIP reading.
It would not authorize temp storage.
It would not approve caps.
It would not approve input roots.
It would not approve GATE-2.
It would not approve import.
It would not approve Supabase writes.
It would not approve runtime.
It would not approve Agent 1.
```

```text
The recommended draft decision in § 19 is to keep cap/input policy unapproved, which uses no phrase at all.
This phrase is recorded so that, if the owner chooses to proceed to 11U instead, the exact wording is
unambiguous.
```

---

## 22. What remains blocked

```text
GATE-2 approval;
GATE-7 approval;
cap approval;
input root authorization;
output root authorization;
temp storage authorization;
limited broader local execution;
broader local execution;
execution run;
real manifest reading;
real CSV reading;
real ZIP reading;
row reads;
larger caps;
multi-window sampling;
seeking strategy;
opening additional files;
opening catalog files;
opening Socios/QSA/CPF/person files;
opening ZIPs;
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

## 23. Gate status

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

## 24. Flags

```text
OPS_BR_CAP_INPUT_POLICY_AUTHORIZATION_AUTHORIZED = true
OPS_BR_CAP_INPUT_POLICY_AUTHORIZATION_PR_READY = false until PR
OPS_BR_CAP_INPUT_POLICY_AUTHORIZATION_OFFICIAL = false until merge
OPS_BR_CAP_INPUT_POLICY_APPROVED = false

OPS_BR_EXECUTION_RUNBOOK_OFFICIAL = true
OPS_BR_EXECUTION_AUTHORIZATION_DECISION_OFFICIAL = true
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_POST_MERGE_VALIDATED = true
OPS_BR_LIMITED_BROADER_LOCAL_EXECUTION_IMPLEMENTATION_OFFICIAL = true

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

`OPS_BR_CAP_INPUT_POLICY_AUTHORIZATION_AUTHORIZED = true` records that the owner authorized *writing this
document* — nothing else. `..._PR_READY` flips to `true` only once this docs-only PR is open, and
`..._OFFICIAL` only once it is merged. Neither flip changes `OPS_BR_CAP_INPUT_POLICY_APPROVED`, which stays
`false` regardless: approving the package's existence and approving the policy it describes are different
decisions, and only a later, separate owner artifact can flip the latter. Every Brazil-readiness flag stays
`false` regardless of any flip above.

---

## 25. Safety confirmation

```text
This document is docs-only.
It does not authorize execution.
It does not authorize real-data access.
It does not approve cap/input policy.
It does not approve caps.
It does not authorize input roots.
It does not authorize output roots.
It does not authorize temp storage.
It does not approve GATE-2.
It does not approve GATE-7.
It does not approve any gate.
Brazil remains blocked for import, runtime, Agent 1 and live prospect generation.
```

This milestone touched no code, no scripts, no package manifest, no test, no Supabase schema, no migration,
no runtime path, no Agent 1 path, no provider, and no UI. It opened no real dataset file, read no real
manifest, opened no CSV and no ZIP, processed no row, executed no join, and computed no coverage figure. It
recorded no cap ceiling, no input root and no output root — only the category shapes those decisions would
eventually need. Every gate in § 23 remains `not_started / not approved`, including GATE-2 and GATE-7, and
each milestone in § 20 still requires its own explicit owner authorization.
