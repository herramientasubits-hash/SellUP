# BR-SOURCE-11C-R — Local manifest dry-run carve-out decision record

**Source family:** Brazil — Receita Federal do Brasil (RFB), Cadastro Nacional da Pessoa Jurídica (CNPJ) — Dados Abertos (bulk)
**Milestone:** BR-SOURCE-11C-R — Local manifest dry-run carve-out decision record (docs-only)
**Status:** Official decision record of record — **Option B AUTHORIZED and IMPLEMENTED** in BR-SOURCE-11C (see § 13); still **not** a gate approval, and **not** a real-manifest / real-data-file / import / execution / migration authorization
**Predecessor:** BR-SOURCE-11A-LAND — `BRSOURCE11ALANDA — FULL_JOIN_DRY_RUN_RUNNER_SCAFFOLD_MERGED` (PR #163, `main` HEAD `93bf94538d030eaed2536ab54319e101fc839cb4`), validated post-merge by BR-SOURCE-11B — `BRSOURCE11BA — POST_MERGE_SYNTHETIC_RUNNER_VALIDATION_PASSED`
**Blocked milestone this record addresses:** BR-SOURCE-11C — `BRSOURCE11CD — LOCAL_MANIFEST_GUARD_FAILED`
**Last reviewed:** 2026-07-30

**Related documents:**
- Full join dry-run technical design — [`br-receita-cnpj-full-join-dry-run-technical-design.md`](./br-receita-cnpj-full-join-dry-run-technical-design.md)
- Full join approval gates checklist — [`br-receita-cnpj-full-join-approval-gates-checklist.md`](./br-receita-cnpj-full-join-approval-gates-checklist.md)
- Full join remaining gates decision packet — [`br-receita-cnpj-full-join-remaining-gates-decision-packet.md`](./br-receita-cnpj-full-join-remaining-gates-decision-packet.md)
- Full join gate evidence packet — [`br-receita-cnpj-full-join-gate-evidence-packet.md`](./br-receita-cnpj-full-join-gate-evidence-packet.md)
- Full join output sanitization decision record — [`br-receita-cnpj-full-join-output-sanitization-decision-record.md`](./br-receita-cnpj-full-join-output-sanitization-decision-record.md)
- Full join identity grain decision record — [`br-receita-cnpj-full-join-identity-grain-decision-record.md`](./br-receita-cnpj-full-join-identity-grain-decision-record.md)
- Full join field allowlist decision record — [`br-receita-cnpj-full-join-field-allowlist-decision-record.md`](./br-receita-cnpj-full-join-field-allowlist-decision-record.md)
- Manual download & local prep runbook — [`br-receita-cnpj-manual-download-local-prep-runbook.md`](./br-receita-cnpj-manual-download-local-prep-runbook.md)
- Legal/privacy decision record — [`br-receita-cnpj-legal-privacy-decision-record.md`](./br-receita-cnpj-legal-privacy-decision-record.md)

> This document is the **decision record of record**. § 1–12 record why BR-SOURCE-11C was blocked,
> the decision question that blockage raised, the options, and the recommendation. § 13 records the
> owner's answer — **Option B authorized** — and what BR-SOURCE-11C implemented under it.
>
> The Option B authorization covers **synthetic temp-manifest plumbing and its tests, and nothing
> else**. It **approves no gate** and moves no gate out of `not_started`. Nothing here authorizes —
> and nothing here should be read as authorizing — real manifest reading, real data-file reading, a
> dataset download, full-dataset processing, full join execution, import, a Supabase write, a
> production write, a migration, an index change, a runtime change, an adapter/validator change, an
> Agent 1 integration, a provider call, a HubSpot sync, a Slack notification, live generation, full
> expansion, or merge to an operational state.
> **Option B is authorized; real execution is not.**

---

## 1. Status

```text
Decision record status: merged_and_official
Owner decision:         OPTION B AUTHORIZED (phrase received — see § 8, § 13)
Implementation status:  implemented in BR-SOURCE-11C (synthetic temp-manifest only)
Current GO/NO-GO:       GO for Option B only — NO-GO for everything else
```

Explicitly:

```text
This record does not approve GATE-1.
This record does not approve GATE-2.
This record does not approve any gate.
This record does not authorize real manifest execution.
This record does not authorize real data-file dry-run.
This record does not authorize dataset import.
This record does not authorize Supabase writes.
This record does not authorize runtime or Agent 1.
```

The Option B authorization is **narrow by construction**: it authorizes synthetic temp-manifest
plumbing and its tests, and nothing else. See § 13 for what was implemented under it, and § 9 for
the list of things that an Option B authorization deliberately leaves blocked.

§ 1–12 of this record were landed **docs-only** (BR-SOURCE-11C-R): they added no runner, no script,
no test, no fixture, no package change, no migration, no index change, and no UI change. The code
described in § 13 was written separately, in BR-SOURCE-11C, **after** the owner supplied the explicit
authorization phrase recorded in § 8. § 12 documents the safety envelope of the docs-only landing;
the implementation's own envelope is recorded in § 13 and in the BR-SOURCE-11C PR.

Two further clarifications, because past milestones have shown how easily these are conflated:

- **A merged decision record is not an authorization.** Merging § 1–12 made the *question* official;
  it did not answer it. The answer was the owner phrase in § 8, given separately — and that phrase
  authorized Option B alone, not Option C, not Option D, and no gate.
- **A mechanism existing in code is not an approval.** BR-SOURCE-11A already landed the no-write
  guard, the output sanitizer, and the failure-cleanup model. Those are the *mechanisms* of GATE-8,
  GATE-5, and GATE-6 respectively; all three gates remain `not_started` / not approved, exactly as
  recorded in the remaining-gates decision packet § 19.1.

---

## 2. Why BR-SOURCE-11C was blocked

```text
BR-SOURCE-11C attempted to enable local_manifest_dry_run.
The implementation was blocked because local manifest reading is the first filesystem/data-read
step beyond synthetic-only execution.
That decision belongs to GATE-1 Legal/Privacy and GATE-2 Temporary storage envelope.
Both gates remain not_started / not approved.
```

### 2.1 The state BR-SOURCE-11C inherited

BR-SOURCE-11A landed the full join dry-run runner scaffold with two declared run modes:

| Run mode | Behavior as landed in BR-SOURCE-11A |
|----------|-------------------------------------|
| `synthetic_fixture_only` | The default, and the only mode that produces metrics. Scores an injected or built-in synthetic fixture with **zero** file I/O. |
| `local_manifest_dry_run` | Declared and fully gated, but **always refuses**. It first requires an explicit opt-in, and then still returns `local_manifest_execution_not_authorized`. |

The structural consequence, recorded in the technical design § 22.2 and in the remaining-gates
packet § 19.2, is that **the runner performs no filesystem read at all** until GATE-1 and GATE-2 are
approved. BR-SOURCE-11B then validated post-merge that the merged scaffold behaves exactly that way
in synthetic-only mode.

### 2.2 What BR-SOURCE-11C tried to change, and why the guard held

BR-SOURCE-11C set out to make `local_manifest_dry_run` actually do something — to move it from
*declared and always refusing* to *able to read a manifest*. The guard refused, and the milestone
closed as:

```text
BRSOURCE11CD — LOCAL_MANIFEST_GUARD_FAILED
```

The refusal was correct, and it is worth being precise about *why*, because the reason is not
"the guard is overly strict":

1. **It is a category change, not an increment.** Every step from BR-SOURCE-11A through
   BR-SOURCE-11B stayed inside a closed world: synthetic inputs the tests themselves constructed.
   Reading a manifest is the **first** step where the runner's input comes from outside that closed
   world — from a filesystem the project does not own the contents of.
2. **A manifest is a pointer to regulated data.** A manifest's purpose is to describe where the
   real Receita files are and what they contain. Reading one is the act that makes real
   establishment, company, and partner (sócio) data reachable by the runner — including the CNPJ /
   CNPJ básico / CPF families the legal/privacy record treats as the controlling risk.
3. **Reading implies temporary storage.** A manifest read that leads anywhere requires a defined
   envelope: where bytes may live, for how long, under what ceilings, and how they are removed on
   failure. That envelope is precisely GATE-2's subject matter, and it does not exist yet.
4. **The two gates that govern it are the two least-advanced.** GATE-1 (Legal/Privacy) and GATE-2
   (Temporary storage envelope) are both `not_started` / not approved. Unlike GATE-3 … GATE-6, they
   have no proposed contract awaiting signature that a reviewer could simply approve in place.

So the blockage is not a bug in the guard and not a defect in BR-SOURCE-11C's engineering. It is the
guard reporting, accurately, that the milestone had reached a decision that engineering is not
entitled to make.

### 2.3 What the blockage does *not* mean

- It does not mean the runner is broken. BR-SOURCE-11B confirmed the scaffold passes post-merge
  synthetic validation.
- It does not mean manifest plumbing can never be built. It means the *input* to that plumbing is
  the contested question, not the plumbing itself — which is exactly what makes a carve-out
  conceivable (§ 4, Option B).
- It does not change any gate, flag, or readiness state. Every flag in § 10 is unchanged from the
  post-BR-SOURCE-11A state, except that `FULL_JOIN_RUNNER_READY` is now `true` because the scaffold
  merged.

---

## 3. Decision question

```text
Can SellUp authorize a narrow local-manifest dry-run carve-out before full GATE-1/GATE-2 approval,
limited to bounded local execution, aggregate-only output, no writes, no runtime, no import and no
Agent 1?
```

The question is deliberately narrow, and it is worth naming what it is **not** asking:

- It is not asking whether Brazil may be imported. That is `OPS_BR_READY_FOR_IMPORT`, unchanged and
  `false`.
- It is not asking whether the real dataset may be processed. That is `FULL_JOIN_EXECUTION_READY`,
  unchanged and `false`.
- It is not asking the owners to approve GATE-1 or GATE-2 quickly, informally, or by implication.
  A carve-out is explicitly **not** a gate approval; it is a bounded exception whose boundaries the
  owners set, and which leaves both gates `not_started`.
- It is not asking for a standing permission. Any carve-out granted under this record is scoped to
  the single next milestone that consumes it, and expires with that milestone.

The question exists because there are two genuinely different things bundled inside
"enable `local_manifest_dry_run`": **the plumbing** (parse a manifest shape, thread it through the
runner, produce an aggregate report, enforce caps, sanitize output, clean up on failure) and **the
input** (which manifest, describing which files, containing whose data). The plumbing can be built
and tested without ever touching a real manifest. The input cannot be resolved without GATE-1 and
GATE-2. The decision question asks whether the owners want those two separated.

---

## 4. Options

### Option A — Keep `local_manifest_dry_run` fully blocked

```text
Status: safest, slowest.
Effect: 11C remains blocked until GATE-1 and GATE-2 are formally approved.
```

The runner keeps refusing with `local_manifest_execution_not_authorized` in every case. No manifest
plumbing is built. BR-SOURCE-11C stays closed as `BRSOURCE11CD — LOCAL_MANIFEST_GUARD_FAILED` and no
successor milestone touches manifests until both gates carry a signed approval.

- **Pro:** zero new surface area. Nothing to review, nothing to bound, nothing to misread later as
  precedent. The only path forward is the correct one: get GATE-1 and GATE-2 approved.
- **Con:** all manifest plumbing work is serialized behind two gates that have no proposed contract
  yet. When those gates are eventually approved, the project will still be at zero on the plumbing,
  and the first milestone after approval will have to build *and* validate *and* run it — a larger,
  riskier step than it needs to be.
- **Risk if chosen:** low technical risk; schedule risk concentrated at the moment of gate approval.

### Option B — Synthetic temp-manifest carve-out only

```text
Status: recommended immediate option.
Effect: 11C may implement local_manifest_dry_run only for temp synthetic manifests created by tests.
No real manifest.
No Downloads.
No real Receita files.
No production evidence.
```

The runner learns to read *a manifest shape*, exercised exclusively against manifests that the test
suite itself writes into a temporary directory, pointing at synthetic CSV files the test suite also
writes. No real manifest, no operator directory, no real Receita file, and no real identifier is
ever involved. Boundaries are specified in § 6, caps in § 7.

- **Pro:** decouples the plumbing from the input. Engineering can build, test, and harden the whole
  path — manifest parsing, cap enforcement, aggregate-only reporting, output sanitization, failure
  cleanup — while the real-input question stays entirely with GATE-1 and GATE-2.
- **Pro:** the privacy surface is genuinely nil, not merely small. The bytes read are bytes the
  tests just wrote; there is no regulated data anywhere in the loop.
- **Con:** produces **no** evidence about the real dataset. Nothing learned here can be cited as
  GATE-1 or GATE-2 evidence, and nothing measured here says anything about real coverage, real join
  rates, or real eligibility. That limitation must be stated in the milestone's own report, not
  discovered later.
- **Con:** a residual mis-citation risk — a future reader could mistake "manifest reading works" for
  "manifest reading is authorized". § 9 and the flags in § 10 exist to make that misreading
  impossible to sustain.
- **Risk if chosen:** low. The main control needed is a static guard that the forbidden path
  families in § 6 cannot be reached even accidentally.

### Option C — Real manifest metadata-only carve-out

```text
Status: requires explicit owner approval.
Effect: runner may read manifest metadata only, but not open data files.
Requires documented evidence, storage envelope, path policy and sanitized output.
```

The runner may open a real manifest and read its *descriptive* fields — shape, declared period,
declared file inventory, declared row counts — while being structurally prevented from opening any
file the manifest points at.

- **Pro:** yields the first real signal about the operator's actual local preparation without
  reading a single row of regulated data.
- **Con:** it is no longer privacy-nil. A real manifest is an artifact describing real regulated
  files; its path, its file names, and its declared period are themselves information about the
  operator's environment, and every one of them would have to be sanitized out of any report.
- **Con:** it needs machinery that does not exist yet: an approved path policy (which locations are
  legitimate), a storage envelope (what may be held and for how long), and a documented evidence
  trail. Those are GATE-2's deliverables.
- **Con:** "metadata only" is a boundary that must be *enforced*, not merely intended. Distinguishing
  "read the manifest" from "open what the manifest points at" is a real engineering constraint that
  needs its own guard and its own tests.
- **Risk if chosen:** medium. Requires an explicit, separately-signed owner carve-out and a separate
  milestone (§ 11 names it BR-SOURCE-11D-META).

### Option D — Bounded real local data-file dry-run

```text
Status: not recommended yet.
Effect: runner may open real Receita local files under caps.
Requires GATE-1/GATE-2 approval or explicit signed carve-out.
This is the future 11D candidate, not 11C-R.
```

The runner may open real Receita data files under strict row/byte ceilings and produce an
aggregate-only report.

- **Pro:** the only option that produces evidence about the real dataset — which is ultimately what
  the full join dry-run exists to measure.
- **Con:** it reads regulated data. Every GATE-1 concern (lawful basis, purpose limitation, the
  CNPJ / CNPJ básico / CPF and sócio families) and every GATE-2 concern (envelope, ceilings,
  retention, cleanup-on-failure) applies in full and directly.
- **Con:** it depends on all four of the prepared-but-unapproved gates simultaneously — GATE-3
  (field allowlist), GATE-4 (identity grain), GATE-5 (output sanitization), GATE-6 (failure cleanup)
  — plus GATE-7's operator runbook, whose *reproducible by a different operator* criterion cannot be
  satisfied at all until GATE-2 ceilings exist.
- **Risk if chosen now:** high, and unnecessary. Nothing about Option B forecloses Option D; Option
  B strictly reduces the amount of untested code that would be running when Option D is eventually
  attempted.

### 4.1 Option comparison

| | A — fully blocked | B — synthetic temp-manifest | C — real manifest metadata-only | D — bounded real data-file |
|---|---|---|---|---|
| Reads a real manifest | no | no | yes | yes |
| Opens a real data file | no | no | no | yes |
| Reads regulated data | no | no | no | yes |
| Privacy surface | none | none | non-trivial | full |
| Needs GATE-1 / GATE-2 approval first | n/a | no | carve-out or approval | yes |
| Produces real-dataset evidence | no | **no** | partial (declarative only) | yes |
| Unblocks manifest plumbing work | no | yes | yes | yes |
| Recommended now | no | **yes** | no | no |
| Milestone that would consume it | — | BR-SOURCE-11C | BR-SOURCE-11D-META | BR-SOURCE-11D |

---

## 5. Recommended decision

```text
Recommended decision for now: Option B — Synthetic temp-manifest carve-out only.
```

Reason:

```text
It allows engineering to implement and test manifest plumbing without touching real manifests, real
data files, Downloads, CNPJ/CPF/person data, Supabase, runtime or Agent 1.
It preserves GATE-1/GATE-2 authority for any real local manifest or real data-file execution.
```

Expanded, the recommendation rests on four points:

1. **It separates the two questions that BR-SOURCE-11C bundled.** The plumbing question is an
   engineering question. The input question is a legal/privacy question. Option B answers the first
   and leaves the second entirely untouched.
2. **It does not spend any gate authority.** Option B needs no GATE-1 finding and no GATE-2
   envelope, because nothing outside the test suite's own temporary output is ever read. Both gates
   remain `not_started`, and the owners' authority over real manifests and real files is undiminished.
3. **It makes the eventual real-input milestone smaller and safer.** When GATE-1 and GATE-2 are
   approved, the code path that would then handle real input will already have been written,
   capped, sanitized, and regression-tested against synthetic input. The remaining delta is the
   input itself — the part that actually deserves the owners' scrutiny.
4. **Its failure mode is contained.** If the Option B implementation is wrong, the worst case is
   that a test reads a file the test itself wrote. There is no path from an Option B defect to a
   regulated-data exposure, because no regulated data is present in the loop.

**Why not the others, in one line each.** Option A is safe but concentrates all risk into the first
post-approval milestone. Option C spends real owner attention on an artifact whose value is
declarative only, and needs GATE-2 machinery that does not exist. Option D is the eventual
destination, not the next step.

The recommendation is explicitly **conditional on the boundaries in § 6, the caps in § 7, and the
evidence in § 8**. Option B without those boundaries is not the option being recommended.

---

## 6. Proposed carve-out boundaries

These boundaries apply to **Option B only**. They are the complete definition of what "synthetic
temp-manifest carve-out" means; anything not on the allowed list is out of scope by default.

```text
Allowed:
- temp directory generated by tests only;
- synthetic manifest only;
- synthetic CSV files only;
- no real identifiers;
- no CNPJ/CPF/person data;
- no business names from real world;
- no Downloads path;
- no repo data path;
- no source archive path;
- no output inside repo;
- aggregate-only report;
- no-write/no-runtime guard;
- output sanitizer;
- cleanup model;
- caps enforced by tests.
```

```text
Forbidden:
- real manifest;
- manifest.headerless.json;
- sellup-source-data path;
- Downloads path;
- raw-zips;
- extracted;
- manifest-input;
- real Receita files;
- Socios/QSA/CPF family;
- full dataset;
- Supabase;
- import;
- runtime;
- Agent 1;
- providers;
- production evidence claims.
```

### 6.1 Notes on the boundaries

- **"Temp directory generated by tests only"** means the directory is created by the test run and is
  not addressable by a caller. A test may not accept a directory from an environment variable, a CLI
  flag, or a configuration file. If a path can come from outside the test, the boundary is not met.
- **"No output inside repo"** means the runner writes no report, log, or artifact into the working
  tree. The aggregate report is a return value, not a file. This also guarantees no synthetic
  manifest or synthetic CSV can be accidentally committed.
- **"Aggregate-only report"** inherits the existing report contract unchanged: `decision_status`
  asserting all eight gates `not_approved`, `run_scope` all false, `safety` all false, counts, the
  cleanup model, and error entries carrying a fixed error code and stage only — never a raw message,
  a path, or a value.
- **"No production evidence claims"** is a reporting boundary, not a code boundary. Any milestone
  consuming this carve-out must state in its own report that it produced **no** evidence about the
  real dataset and that its results are not citable as GATE-1 or GATE-2 evidence.
- **The forbidden path families are named to be blocked, not to be used.** They appear in this
  document as denylist labels for a static guard. No real, absolute, or complete path is recorded
  here, and none may be recorded in code, tests, fixtures, or reports.
- **The `Socios` / QSA / CPF family stays denylisted end to end**, consistent with the existing
  parser and import-chain denylist. A synthetic manifest may not even *declare* a file in that
  family, because declaring it would exercise a code path that must never exist.

---

## 7. Proposed caps for synthetic temp-manifest only

```text
maxCompanyRows          <= 20
maxEstablishmentRows    <= 20
maxCompanyScanRows      <= 1000
maxBytesPerFile         <= 1_000_000
```

Clarification:

```text
These caps apply only to synthetic temp-manifest tests.
They are not approval for real data-file execution.
Real data caps require GATE-2 approval or explicit owner carve-out.
```

### 7.1 Notes on the caps

- The caps are deliberately **more conservative** than the runner's existing synthetic-fixture
  ceilings. This is not an inconsistency: the existing ceilings govern in-memory fixtures with no
  file I/O, whereas these govern a path that performs file reads, so the tighter number applies.
- `maxBytesPerFile` exists so that a defect cannot turn a bounded read into an unbounded one. A
  synthetic file that would exceed it is a test-authoring error and must fail the test, not be
  truncated silently.
- The caps must be **enforced and asserted**, not merely configured. A cap that is only a default is
  not a cap. Each cap needs at least one test that drives input past it and asserts the refusal.
- A cap being exceeded is a **fail-closed refusal**, not a partial result. The report carries the
  refusal reason as an error code and stage; no partial metrics are emitted.
- These numbers carry no implication whatsoever for real-data ceilings. Real-data ceilings are a
  GATE-2 deliverable and are not proposed, implied, or anticipated by this record.

---

## 8. Evidence required before implementing 11C

```text
- this decision record merged;
- explicit owner phrase authorizing Option B;
- confirmation that real manifests remain forbidden;
- confirmation that no gate is approved by Option B;
- test plan with synthetic temp dirs only;
- static guard checks;
- sanitizer checks;
- no-write/no-runtime checks.
```

The recommended authorization phrase is:

```text
AUTHORIZE OPTION B — SYNTHETIC TEMP-MANIFEST CARVE-OUT ONLY
```

### 8.1 Notes on the evidence

- **All eight items are required.** Any single one missing means BR-SOURCE-11C stays blocked. In
  particular, a merged record without the owner phrase authorizes nothing, and the owner phrase
  given before the record is merged authorizes nothing either — the phrase refers to a record that
  must already be official.
- **The phrase is exact, single-scope, and non-transferable.** It authorizes Option B only. It does
  not authorize Option C or Option D, does not approve GATE-1 or GATE-2, does not cover a second
  milestone, and cannot be extended by inference. Options C and D each require their own separate,
  explicitly-worded authorization, recorded in their own milestone.
- **"Static guard checks"** means the forbidden path families in § 6 are unreachable by construction,
  and that unreachability is asserted by a test — not merely observed to be true at review time.
- **"Sanitizer checks"** means the existing output sanitizer is exercised against the new path, and
  its refusal of a full CNPJ, CNPJ básico, CPF, email, phone, LinkedIn URL, raw row/data payload,
  identity key, normalized tax id, identifier hash, or oversized numeric leaf is asserted on the
  manifest path specifically, not only on the pre-existing synthetic path.
- **"No-write/no-runtime checks"** means the existing guard is exercised on the new path and still
  fails on the mere presence of a dangerous indicator — a service-role key, a Supabase URL, an import
  mode, a runtime endpoint, an Agent 1 switch, or a provider API key.
- **A test plan is not a test.** The test plan is evidence for the authorization decision; the tests
  themselves are written inside BR-SOURCE-11C, after authorization.

---

## 9. What remains blocked

Regardless of any decision recorded here, and regardless of whether Option B is subsequently
authorized, every item below remains blocked:

```text
real manifest execution
Downloads path execution
manifest.headerless.json
real Receita data files
full dataset processing
dataset import
Supabase writes
migrations
runtime
Agent 1
HubSpot/Slack/provider calls
source_company_snapshots writes
production evidence
Brazil live prospect generation
```

### 9.1 Why this list survives an Option B authorization

Option B changes exactly one thing: whether the runner may read a manifest **that the test suite
itself just wrote, in a temporary directory, describing synthetic files**. It changes nothing about
real manifests, real files, real data, persistence, runtime, or Agent 1 — because none of those is
present in the Option B loop at all.

Two consequences follow, and both are load-bearing:

1. **No Option B result is citable as evidence for anything real.** A green Option B test suite is
   evidence that plumbing works. It is not evidence about the dataset, about coverage, about join
   rates, about eligibility, or about either gate. Any report that cites it otherwise is wrong.
2. **The gate owners' authority is untouched.** GATE-1 and GATE-2 remain the sole route to real
   manifest or real data-file execution. A carve-out is a bounded exception to a *code-writing*
   restriction; it is not a partial gate approval, and it creates no precedent for one.

---

## 10. Flags

```text
OPS_BR_LOCAL_MANIFEST_CARVEOUT_DECISION_RECORD_PR_READY  = true
OPS_BR_LOCAL_MANIFEST_CARVEOUT_DECISION_RECORD_OFFICIAL  = true
OPS_BR_LOCAL_MANIFEST_CARVEOUT_OPTION_B_AUTHORIZED       = true
OPS_BR_OPTION_B_SYNTHETIC_TEMP_MANIFEST_DRY_RUN_PR_READY = true
OPS_BR_OPTION_B_SYNTHETIC_TEMP_MANIFEST_DRY_RUN_OFFICIAL = false until merge
OPS_BR_REAL_LOCAL_MANIFEST_AUTHORIZED                    = false
OPS_BR_REAL_LOCAL_DATA_FILE_DRY_RUN_AUTHORIZED           = false

FULL_JOIN_RUNNER_READY                                   = true
FULL_JOIN_EXECUTION_READY                                = false
IMPORT_READY                                             = false
RUNTIME_READY                                            = false
AGENT1_READY                                             = false

OPS_BR_READY_FOR_IMPORT                                  = false
OPS_BR_READY_FOR_PRODUCTION_IMPORT                       = false
OPS_BR_READY_FOR_RUNTIME                                 = false
OPS_BR_LIVE_PROSPECT_GENERATION_READY                    = false
OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED            = false
```

### 10.1 Gate status — UNCHANGED

```text
GATE-1 Legal/Privacy                = not_started / not approved
GATE-2 Temporary storage envelope   = not_started / not approved
GATE-3 Field allowlist              = not_started / not approved
GATE-4 Identity grain               = not_started / not approved
GATE-5 Output sanitization          = not_started / not approved
GATE-6 Failure cleanup              = not_started / not approved
GATE-7 Operator runbook             = not_started / not approved
GATE-8 No-write/no-runtime          = not_started / not approved
```

`FULL_JOIN_RUNNER_READY = true` reflects only that the BR-SOURCE-11A scaffold merged and was
validated post-merge by BR-SOURCE-11B. It says nothing about execution readiness:
`FULL_JOIN_EXECUTION_READY` is and remains `false`.

---

## 11. Next milestone mapping

```text
If Option B is explicitly authorized after this record is merged:
BR-SOURCE-11C may implement synthetic temp-manifest local_manifest_dry_run plumbing.

If real manifest metadata-only is authorized:
A separate BR-SOURCE-11D-META milestone is required.

If bounded real data-file execution is authorized:
A separate BR-SOURCE-11D milestone is required.

No real execution is authorized by this record alone.
```

| Decision | Milestone | Requires |
|----------|-----------|----------|
| Option A | none | nothing — BR-SOURCE-11C stays closed as `BRSOURCE11CD` until GATE-1 and GATE-2 are approved |
| Option B | BR-SOURCE-11C (re-scoped) | this record merged **and** the § 8 owner phrase **and** the § 6 boundaries **and** the § 7 caps |
| Option C | BR-SOURCE-11D-META (new) | its own decision record, its own owner authorization, a GATE-2 path policy and storage envelope |
| Option D | BR-SOURCE-11D (new) | GATE-1 and GATE-2 approved, or an explicit signed carve-out of equivalent scope |

### 11.1 Ordering note

The mapping orders **review**, not approval. Option B landing does not advance Option C, and Option
C landing does not advance Option D. Each requires its own authorization, and none of the three
approves a gate. The independent and always-available path — approving GATE-1 and GATE-2 on their
own merits — remains the shortest route to real execution and is unaffected by any option here.

---

## 12. Safety confirmation

This milestone is **docs-only**. It creates a branch and documentation, and opens a docs-only PR. It
does **not**:

- write, modify, or delete any code, script, test, fixture, or package manifest;
- download, unzip, or import a dataset;
- open, read, commit, or reference a real manifest, dataset, or report;
- execute the runner in any mode, or read any file from the runner core;
- write to Supabase or perform any production write;
- create or modify a migration, or create/alter/validate an index;
- write to `source_company_snapshots`;
- read any environment variable or construct any client;
- integrate runtime, Agent 1, HubSpot, Slack, or any provider;
- change UI;
- construct or print a `record_identity_key` or `normalized_tax_id`;
- print a row, a full CNPJ, a CNPJ básico, a CPF, a name, an address, a contact, or a join key;
- emit a hash, truncation, or fingerprint derived from any identifier;
- record any real, absolute, or complete filesystem path;
- use MCP, admin bypass, or self-approval;
- activate Brazil, approve any gate, or mark Brazil ready for import, runtime, or Agent 1;
- edit `MEMORY.md`;
- merge.

Every cap value, enum member, error code, flag value, and path family name shown above is a schema
name, a class label, a threshold, a zero, a `false`, a denylist label, or an explicit placeholder —
never a real value and never a real location. No secrets, no data dumps, no real CNPJs, no CNPJ
básico values, no CPFs, and no partner (sócio) personal data are reproduced. Local WIP
(`scratchpad/`) and the unrelated in-progress work on the main worktree are untouched by any git
operation: this milestone was prepared in an isolated worktree branched from `origin/main`.

---

## 13. BR-SOURCE-11C implementation record — Option B, and only Option B

BR-SOURCE-11C implements Option B after explicit owner authorization:

```text
AUTHORIZE OPTION B — SYNTHETIC TEMP-MANIFEST CARVE-OUT ONLY
```

This authorizes only synthetic temp-manifest plumbing and tests.
It does not authorize real manifest execution.
It does not authorize real Receita data-file execution.
It does not approve any gate.
It does not authorize import.
It does not authorize Supabase writes.
It does not authorize runtime or Agent 1.

### 13.1 What was implemented

```text
runner:     local_manifest_dry_run runs ONLY behind the full Option B gate.
generator:  br-receita-cnpj-synthetic-temp-manifest.ts creates its OWN temp workspace,
            writes a synthetic manifest + synthetic headerless CSVs, reads only those,
            and removes only the directory it created.
CLI:        --synthetic-temp-manifest (requires --strict and all four caps).
sanitizer:  new filesystem_path_like leak kind — no report may carry a path.
cleanup:    a declared synthetic workspace is a COUNTED artifact forcing cleanup.
```

The gate is a conjunction; every condition is independently fail-closed:

```text
allowLocalManifest          === true
manifestTrust               === 'synthetic_temp_manifest_only'
optionBCarveoutAuthorized   === true
strict                      === true
productionWrites            === false
outputSanitizationVersion   === 'not_approved'   (explicit, not omitted)
maxCompanyRows              stated and <= 20
maxEstablishmentRows        stated and <= 20
maxCompanyScanRows          stated and <= 1000
maxBytesPerFile             stated and <= 1_000_000
localManifestReader         injected
```

A missing cap is refused as `local_manifest_caps_required`, an out-of-bounds cap as
`local_manifest_cap_exceeded` — a cap the caller never stated is a cap nobody agreed to, so it is
never defaulted.

### 13.2 Why a real manifest still cannot be read

Three independent structural reasons, not one policy check:

1. **Trust is checked before authorization.** A manifest whose declared trust is not
   `synthetic_temp_manifest_only` is refused as `local_manifest_execution_not_authorized`, whatever
   else the caller declares — including a declared Option B carve-out.
2. **The runner core owns no filesystem.** It never imports `node:fs`/`node:os` and opens nothing.
   Reading is delegated to an injected reader port, and the ONLY implementation of that port is the
   synthetic generator.
3. **The generator accepts no path.** Its workspace location is chosen inside the module
   (`fs.mkdtempSync` under the OS temp root) and is never returned. There is no parameter, flag, or
   environment variable through which a caller can point it at a real location — the § 6.1 boundary
   ("not addressable by a caller") holds for the controlled CLI exactly as it does for a test.

The CLI additionally refuses `manifest.headerless.json` by basename, and refuses any path containing
`downloads`, `descargas`, `dados_abertos`, `sellup-source-data`, `raw-zips`, `extracted`, or
`manifest-input` — as denylist labels for a static guard, never as usable locations.

### 13.3 What this implementation proves, and what it does not

```text
Proves:      the manifest-reading PLUMBING works and is bounded, sanitized and cleaned up.
Proves NOT:  anything at all about the real dataset.
```

Per § 6.1 ("no production evidence claims"): this milestone produced **no** evidence about the real
Receita dataset. Its counts describe cells the generator itself wrote moments earlier. Nothing
measured here is citable as GATE-1 or GATE-2 evidence, and nothing here speaks to real coverage,
real join rates, or real eligibility. `OPS_BR_REAL_LOCAL_DRY_RUN_HEADERLESS_5_PASSED` stays `false`.

### 13.4 Gate status after BR-SOURCE-11C — UNCHANGED

```text
GATE-1 Legal/Privacy                = not_started / not approved
GATE-2 Temporary storage envelope   = not_started / not approved
GATE-3 Field allowlist              = not_started / not approved
GATE-4 Identity grain               = not_started / not approved
GATE-5 Output sanitization          = not_started / not approved
GATE-6 Failure cleanup              = not_started / not approved
GATE-7 Operator runbook             = not_started / not approved
GATE-8 No-write/no-runtime          = not_started / not approved
```

A mechanism existing and now being exercised is still not an approval: the runner reports all eight
gates `not_approved` on every Option B run, and asserts it in test.
