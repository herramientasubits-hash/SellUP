/**
 * BR Receita CNPJ — the GATE-7 preflight items `P-01` … `P-22` (BR-SOURCE-FAST-TRACK-6).
 *
 * The twenty-two-item preflight BR-SOURCE-10PQR § 6.2 froze, as the operator performs it. It lives in
 * its own module rather than inside `br-receita-cnpj-gate7-operator-runbook` for one reason: it is a
 * closed, owner-frozen enumeration that will be READ far more often than the logic around it, and a
 * checklist buried in the middle of an 800-line module is a checklist nobody re-reads before a run.
 *
 * 🔴 The numbering is 10PQR's and is preserved exactly, including `P-05` sitting where it does —
 * first in SUBSTANCE, fifth in NUMBERING. Renumbering it to put the gate-status check at `P-01` would
 * read better and would break the one-to-one traceability the IDs exist for.
 *
 * ── This module NEVER ────────────────────────────────────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access.
 *   - performs a check. It DESCRIBES twenty-two checks a named human operator performs.
 *   - approves a gate, or authorizes a run, a rehearsal, a benchmark or any operational crossing.
 *   - carries a real local path, a manifest, a file name, a CNPJ, a CPF or a personal name.
 */

// ─── § 16.3 the preflight, item by item ───────────────────────────────────────

/**
 * How an item stands TODAY. Kept distinct from its pass condition, because 10PQR § 6.2's re-scoring
 * update turns on exactly this distinction: an item can move from *unusable* to *usable and failing*,
 * which is progress in the checklist and none at all in the gate.
 */
export type BrazilReceitaGate7PreflightStanding =
  | 'checkable_and_expected_to_pass'
  | 'checkable_and_fails_today'
  | 'operator_environment_dependent';

export interface BrazilReceitaGate7PreflightItem {
  readonly id: string;
  /** One action. The 10K § 11 pass criterion forbids an ambiguous step. */
  readonly action: string;
  /** One pass condition. A warning is never a pass. */
  readonly passCondition: string;
  readonly standing: BrazilReceitaGate7PreflightStanding;
  /** The module or document that owns the value this item checks against, or `null`. */
  readonly authority: string | null;
}

/**
 * `P-01` … `P-22`, as the operator performs them. The 10PQR § 6.2 ordering is preserved exactly,
 * including `P-05` sitting where it does — first in substance, fifth in numbering — because the
 * numbering is the contract's and renumbering it would break the traceability the IDs exist for.
 *
 * 🔴 `operator_environment_dependent` is the honest standing for most items and is NOT a softer
 * "probably fine". It means the answer lives in a machine this module cannot see, so the item is a
 * real check a human performs and fails closed on, not a check this module can pre-satisfy.
 */
export const BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEMS: readonly BrazilReceitaGate7PreflightItem[] = [
  {
    id: 'P-01',
    action: 'confirm the working copy is clean, or that the work is isolated in a dedicated worktree',
    passCondition: 'no uncommitted modification outside a dedicated worktree',
    standing: 'operator_environment_dependent',
    authority: null,
  },
  {
    id: 'P-02',
    action: 'confirm the checked-out branch is the intended one and carries no unintended local change',
    passCondition: 'branch matches the authorization record and the diff against it is empty',
    standing: 'operator_environment_dependent',
    authority: null,
  },
  {
    id: 'P-03',
    action: 'confirm origin/main is the commit the authorization names',
    passCondition: 'the local origin/main SHA equals the authorized SHA, character for character',
    standing: 'operator_environment_dependent',
    authority: null,
  },
  {
    id: 'P-04',
    action: 'confirm every official design and decision document is present at its expected version',
    passCondition: 'each of 10I, 10J, 10K, 10L, 10O and the runbook resolves at its recorded version',
    standing: 'operator_environment_dependent',
    authority: null,
  },
  {
    id: 'P-05',
    action:
      'read the authoritative gate current state and confirm every gate is recorded as approved — this item precedes every other in substance',
    passCondition: 'evaluateBrazilReceitaGate7Preconditions() returns PASS',
    standing: 'checkable_and_fails_today',
    authority: 'br-receita-cnpj-gate-status-current-state',
  },
  {
    id: 'P-06',
    action: 'confirm the dataset root is outside the repository, in the controlled local folder',
    passCondition: 'the resolved dataset root satisfies every workspace constraint',
    standing: 'operator_environment_dependent',
    authority: 'br-receita-cnpj-gate2-recorded-owner-decision',
  },
  {
    id: 'P-07',
    action: 'run the forbidden-family inventory check over the extracted folder',
    passCondition: 'the check prints nothing — no socios, no QSA, no CPF, no person-linked family',
    standing: 'operator_environment_dependent',
    authority: 'runbook § 7',
  },
  {
    id: 'P-08',
    action: 'validate the manifest',
    passCondition: 'a LOCAL FILE manifest validates; a URL manifest is refused outright',
    standing: 'operator_environment_dependent',
    authority: 'br-receita-cnpj-manifest-validator',
  },
  {
    id: 'P-09',
    action: 'inspect the output directory',
    passCondition: 'empty, or containing only artifacts the cleanup contract permits',
    standing: 'operator_environment_dependent',
    authority: 'br-receita-cnpj-gate6-recorded-cleanup-contract',
  },
  {
    id: 'P-10',
    action: 'check for a stale ledger, a lock file, or unresolved residue from an earlier attempt',
    passCondition: 'none present',
    standing: 'operator_environment_dependent',
    authority: 'br-receita-cnpj-full-join-cleanup-coordinator',
  },
  {
    id: 'P-11',
    action: 'read the planned report file names',
    passCondition: 'no real value of any kind appears in any planned name',
    standing: 'operator_environment_dependent',
    authority: 'br-receita-cnpj-gate5-output-contract',
  },
  {
    id: 'P-12',
    action: 'measure free disk on the workspace volume and compare it against the ceiling',
    passCondition:
      'free disk is at or above the minimum-before-start figure, and the reserve figure still holds',
    standing: 'operator_environment_dependent',
    authority: 'br-receita-cnpj-full-join-free-disk + br-receita-cnpj-gate2-recorded-owner-decision',
  },
  {
    id: 'P-13',
    action: 'compare available memory against the GATE-2 RSS, heap and external-memory ceilings',
    passCondition: 'the host can hold all three ceilings simultaneously with headroom',
    standing: 'operator_environment_dependent',
    authority: 'br-receita-cnpj-gate2-recorded-owner-decision',
  },
  {
    id: 'P-14',
    action: 'confirm the planned run has no network dependency and makes no provider call',
    passCondition: 'no network dependency declared and no provider client reachable',
    standing: 'operator_environment_dependent',
    authority: null,
  },
  {
    id: 'P-15',
    action: 'inspect the environment for any Supabase credential',
    passCondition: 'no anon key, no service role key, no connection string, of any kind',
    standing: 'operator_environment_dependent',
    authority: null,
  },
  {
    id: 'P-16',
    action: 'inspect the environment for runtime variables',
    passCondition: 'no runtime environment variable is loaded',
    standing: 'operator_environment_dependent',
    authority: null,
  },
  {
    id: 'P-17',
    action: 'inspect the environment for Agent 1 variables',
    passCondition: 'no Agent 1 environment variable is loaded',
    standing: 'operator_environment_dependent',
    authority: null,
  },
  {
    id: 'P-18',
    action: 'confirm no hosting or feature-flag change is staged or intended',
    passCondition: 'no Vercel, hosting or flag change staged, and none intended during the run',
    standing: 'operator_environment_dependent',
    authority: null,
  },
  {
    id: 'P-19',
    action: 'compare the configured output sanitizer against the GATE-5 contract',
    passCondition:
      'the configuration matches the FROZEN contract AND the contract is APPROVED — the second half fails today',
    standing: 'checkable_and_fails_today',
    authority: 'br-receita-cnpj-gate5-output-contract + gate5-recorded-output-sanitization',
  },
  {
    id: 'P-20',
    action: 'acknowledge the cleanup contract and state the escalation pair from memory',
    passCondition: 'the terminal statuses and the escalation roles are stated correctly',
    standing: 'checkable_and_expected_to_pass',
    authority: 'br-receita-cnpj-gate6-recorded-cleanup-contract',
  },
  {
    id: 'P-21',
    action: 'declare the storage envelope',
    passCondition:
      'the declared envelope is the GATE-2 approved option AND GATE-2 is approved — the second half fails today',
    standing: 'checkable_and_fails_today',
    authority: 'br-receita-cnpj-gate2-recorded-owner-decision',
  },
  {
    id: 'P-22',
    action:
      'confirm the explicit dry-run confirmation flag will be passed, and state what a refusal looks like',
    passCondition: 'the flag is named correctly and the refusal behaviour is stated before starting',
    standing: 'operator_environment_dependent',
    authority: null,
  },
];

/** `OR-A02` as data: every item carries exactly one action and one pass condition. */
export const BRAZIL_RECEITA_GATE7_PREFLIGHT_ITEM_COUNT = 22 as const;

/** `OR-A04`. A failed item stops the procedure; it is never recorded as a warning. */
export const BRAZIL_RECEITA_GATE7_FAILED_PREFLIGHT_ITEM_IS_A_STOP = true as const;

/** `OR-A19`. A warning is never a pass, on any item and on any monitoring signal. */
export const BRAZIL_RECEITA_GATE7_WARNING_IS_EVER_A_PASS = false as const;
