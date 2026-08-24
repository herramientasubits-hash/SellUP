/**
 * BR Receita CNPJ — RECORDED GATE-8 contract approval (BR-SOURCE-GATE-ROUND-1).
 *
 * GATE-8 is the no-write / no-runtime guarantee (10K § 12). Its *Pass criteria* demand that no-write
 * be "enforced by the CLI contract, not by convention or reviewer vigilance" — proofs about a runner
 * that 10K § 4 forbids writing until every gate is approved.
 *
 * The 10PQR packet named that deadlock and took a position on it: the CONTRACT is approvable now,
 * and the PROOFS land with the implementation. It also recorded both failure modes — treating the
 * proofs as prerequisites deadlocks the gate; treating the contract as sufficient for execution
 * voids it. The owners approved along exactly that line.
 *
 * ── 🔴 APPROVED_AS_CONTRACT is not an operating permission ───────────────────
 *
 * This is the whole point of the value, and the one thing a future reader must not soften. What is
 * approved is the SHAPE a future runner must have. Nothing may run. GATE-8's own *Allows* clause is
 * conditional on every other gate being approved, and through BR-SOURCE-FAST-TRACK-7 they were not.
 *
 * 🔴 **Update (BR-SOURCE-FAST-TRACK-8): that condition is now SATISFIED, and this section does not
 * soften by one word.** GATE-7's joint owner approval made it eight of eight, so 10K § 15 reads `GO` —
 * the narrow GO it defines: *a future runner implementation PR may be PROPOSED, still no execution*.
 * GATE-8's contract is what such a PR must satisfy, which is precisely what "the SHAPE a future
 * runner must have" always meant. Nothing may still run:
 * `BRAZIL_RECEITA_GATE8_AUTHORIZES_OPERATIONS` stays `false`, and execution needs the separate
 * explicit authorization of a future milestone.
 *
 * The invariants below therefore stay exactly as they are. This record does not flip one of them,
 * and it does not import a module that could.
 *
 * ── This module NEVER (fail-closed by construction) ──────────────────────────
 *   - performs I/O of any kind: no fs, no path, no network, no env, no process access. It has no
 *     imports at all.
 *   - emits an `OwnerDecisionArtifact` section. 13A has no `gate8` section, and inventing one would
 *     let a structural validator report an approval nobody recorded in that shape.
 *   - flips, reads or reproduces a writable copy of any safety invariant, cap or flag.
 *   - authorizes a run, a benchmark, a benchmark retry, real-data access, snapshot persistence, an
 *     import, a Supabase write, a migration, a runtime path, Agent 1, Agent 2A or a provider call.
 *   - resets or influences the real-benchmark attempt ledger.
 *   - carries a personal name, a signature, a mail address, a real path, a CNPJ or a CPF.
 */

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * The recorded decision value. Deliberately NOT the bare string `approved`: a reader scanning for
 * approved gates must not be able to mistake a contract approval for an operating one.
 */
export const BRAZIL_RECEITA_GATE8_STATUS = 'APPROVED_AS_CONTRACT' as const;

/** Whether this approval authorizes operations. It does not, and the constant says so as data. */
export const BRAZIL_RECEITA_GATE8_AUTHORIZES_OPERATIONS = false as const;

/**
 * The joint approvers GATE-8 requires (10K § 12): repo safety owner AND technical owner. Roles only,
 * and neither may be the implementer of the gate's subject (10K § 3).
 */
export const BRAZIL_RECEITA_GATE8_SAFETY_APPROVER_ROLE = 'repo safety owner' as const;
export const BRAZIL_RECEITA_GATE8_TECHNICAL_APPROVER_ROLE = 'technical owner' as const;
export const BRAZIL_RECEITA_GATE8_APPROVAL_IS_JOINT = true as const;

/** The date the human decision was relayed and recorded. */
export const BRAZIL_RECEITA_GATE8_APPROVAL_DATE = '2026-08-21' as const;

// ─── The invariants this approval keeps ───────────────────────────────────────

/**
 * The safety invariants that stay exactly as they are.
 *
 * 🔴 These are OBSERVATIONS of a state this record preserves, not a second copy that could drift
 * from the real one. `maxOutputRows: 0` lives in the resource-envelope proposal; the null sink lives
 * in the engine contract; snapshot persistence, runtime, Agent 1 Brazil and production live in their
 * own modules. This record deliberately imports NONE of them: a record that could read a flag is a
 * record that could be built to report a flipped one as unflipped.
 *
 * A test asserts each of these against its real owner, which is the only place the assertion means
 * anything.
 */
export const BRAZIL_RECEITA_GATE8_PRESERVED_INVARIANTS = {
  maxOutputRows: 0,
  nullBenchmarkSinkActive: true,
  snapshotPersistence: false,
  runtime: false,
  agent1Brazil: false,
  production: false,
} as const;

// ─── What the contract still owes ─────────────────────────────────────────────

/**
 * The proofs this contract approval defers to the implementation, ENUMERATED.
 *
 * The 10PQR position is that these are proofs about code that does not exist. Enumerating them is
 * what stops "approved as a contract" from becoming "approved, and nobody remembers what for": each
 * entry is a future obligation, and a runner that lands without discharging one of them has not
 * satisfied this gate however green its tests are.
 */
export const BRAZIL_RECEITA_GATE8_REQUIRED_IMPLEMENTATION_PROOFS: readonly string[] = [
  'allowlist-only emit',
  'no prohibited key material',
  'bounded output',
  'staging',
  'atomic publish',
  'rollback',
  'integrity validation',
  'fail-closed runtime',
  'no import or runtime crossing without subsequent authorization',
] as const;

/**
 * Engineering that stays OUTSIDE this gate and outside this round.
 *
 * Atomic publish and the engine-to-snapshot bridge are named in the required proofs above as things
 * a future runner must demonstrate — and they are also unbuilt engineering. Naming them here keeps
 * the two facts from collapsing: the CONTRACT covers them, the CODE does not exist, and this record
 * is not a design for either.
 */
export const BRAZIL_RECEITA_GATE8_POST_GATE_ENGINEERING: readonly string[] = [
  'atomic publish',
  'engine to snapshot bridge',
] as const;

// ─── Restrictions ─────────────────────────────────────────────────────────────

/** The bounds this approval carries, enumerated per 10K § 14. */
export const BRAZIL_RECEITA_GATE8_RESTRICTIONS: readonly string[] = [
  'approved as a contract only; no operation of any kind is authorized',
  // BR-SOURCE-FAST-TRACK-8: this entry read "the runner may not be written: GATE-8 Allows is
  // conditional on every other gate being approved". That condition is now satisfied — GATE-7's joint
  // owner approval made it eight of eight — so the entry is restated rather than left as a claim that
  // is no longer true. What replaces it is the narrow grant 10K § 15 actually makes, and the grant is
  // the MATRIX'S, never GATE-8's alone.
  'a future runner implementation PR may be PROPOSED (10K § 15, all eight gates approved) and must satisfy this contract; proposing is not executing, and GATE-8 alone grants nothing',
  'no benchmark run and no benchmark attempt-budget reset',
  'no real Receita data read',
  'no snapshot persistence and no import',
  'no Supabase write and no migration',
  'no runtime activation and no Agent 1 Brazil enablement',
  'no provider, HubSpot or Slack call',
  'no operational flag is flipped by this approval',
  'every deferred proof remains owed, and a runner that skips one has not satisfied this gate',
  'downstream and sibling gates remain independently required',
] as const;
