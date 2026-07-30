/**
 * BR Receita CNPJ — full join dry-run NO-WRITE / NO-RUNTIME guard (BR-SOURCE-11A).
 *
 * The single, PURE gate every full-join dry-run must clear before it does anything.
 * It is the code expression of the standing BR-SOURCE blocks: none of the eight
 * approval gates (legal/privacy, temporary storage envelope, field allowlist,
 * identity grain, output sanitization, failure cleanup, operator runbook,
 * no-write/no-runtime) is approved, so the runner may only ever run as a LOCAL,
 * aggregate-only, no-write/no-runtime scaffold.
 *
 * The guard checks two independent things:
 *
 *   1. The DECLARED contract — `noWriteMode` must be true and every escalation flag
 *      (`supabaseWrite`, `runtimeIntegration`, `agent1Integration`, `providerCalls`,
 *      `importExecuted`) must be false. A missing declaration is a failure, not a
 *      default: the caller must state the contract explicitly.
 *
 *   2. DANGEROUS INDICATORS in the surrounding config — a service-role key, a
 *      Supabase URL, an import mode, a runtime endpoint, an Agent 1 switch, or a
 *      provider API key. Their mere PRESENCE fails the guard, because a runner that
 *      can reach any of them is no longer structurally incapable of writing.
 *
 * ── The guard NEVER ─────────────────────────────────────────────────────────────
 *   - reads process.env, opens a client, or performs any I/O (it is pure).
 *   - echoes a detected secret, key, URL, endpoint, or any other value. A failure
 *     reports WHICH indicator tripped (a fixed machine code) and nothing else.
 */

// ─── Declared contract ────────────────────────────────────────────────────────

/**
 * The escalation contract a caller must declare. Every field is required and
 * literal-typed: a caller cannot silently omit one, and cannot pass `true` for an
 * escalation without a type error at every internal call site. Runtime validation
 * still runs, because `unknown` config can reach the guard from a CLI boundary.
 */
export interface BrazilReceitaFullJoinNoWriteContract {
  readonly noWriteMode: true;
  readonly supabaseWrite: false;
  readonly runtimeIntegration: false;
  readonly agent1Integration: false;
  readonly providerCalls: false;
  readonly importExecuted: false;
}

/** The canonical, only-permitted contract value for BR-SOURCE-11A. */
export const BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_CONTRACT: BrazilReceitaFullJoinNoWriteContract = {
  noWriteMode: true,
  supabaseWrite: false,
  runtimeIntegration: false,
  agent1Integration: false,
  providerCalls: false,
  importExecuted: false,
};

// ─── Failure codes ────────────────────────────────────────────────────────────

/**
 * Why the guard refused. Fixed machine codes only — a code never embeds a detected
 * value, path, key, endpoint, or secret.
 */
export type BrazilReceitaFullJoinNoWriteViolationCode =
  | 'no_write_mode_not_declared'
  | 'supabase_write_requested'
  | 'runtime_integration_requested'
  | 'agent1_integration_requested'
  | 'provider_calls_requested'
  | 'import_execution_requested'
  | 'service_role_key_present'
  | 'supabase_url_present'
  | 'import_mode_present'
  | 'runtime_endpoint_present'
  | 'agent1_enabled_present'
  | 'provider_api_key_present';

export const BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_VIOLATION_CODES: readonly BrazilReceitaFullJoinNoWriteViolationCode[] =
  [
    'no_write_mode_not_declared',
    'supabase_write_requested',
    'runtime_integration_requested',
    'agent1_integration_requested',
    'provider_calls_requested',
    'import_execution_requested',
    'service_role_key_present',
    'supabase_url_present',
    'import_mode_present',
    'runtime_endpoint_present',
    'agent1_enabled_present',
    'provider_api_key_present',
  ];

/** The single aggregate error code surfaced on a report when the guard refuses. */
export const BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_GUARD_ERROR_CODE = 'no_write_guard_failed' as const;

// ─── Result ───────────────────────────────────────────────────────────────────

export interface BrazilReceitaFullJoinNoWriteGuardResult {
  readonly ok: boolean;
  /** Every violation found, de-duplicated and in declaration order. Value-free. */
  readonly violations: readonly BrazilReceitaFullJoinNoWriteViolationCode[];
}

const GUARD_PASSED: BrazilReceitaFullJoinNoWriteGuardResult = { ok: true, violations: [] };

// ─── Declared-contract validation ─────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Maps a declared escalation field to the code raised when it is anything other
 * than the literal `false`. `undefined` counts as a violation: the contract must be
 * declared, never inferred.
 */
const ESCALATION_FIELD_CODES: ReadonlyArray<
  readonly [field: string, code: BrazilReceitaFullJoinNoWriteViolationCode]
> = [
  ['supabaseWrite', 'supabase_write_requested'],
  ['runtimeIntegration', 'runtime_integration_requested'],
  ['agent1Integration', 'agent1_integration_requested'],
  ['providerCalls', 'provider_calls_requested'],
  ['importExecuted', 'import_execution_requested'],
];

// ─── Dangerous-indicator detection ────────────────────────────────────────────

/**
 * Config key fragments that indicate the caller is holding something capable of a
 * write, an import, a runtime hop, or a paid provider call. Matched case- and
 * separator-insensitively against every key of the inspected config tree, so
 * `service_role_key`, `serviceRoleKey`, and `SERVICE-ROLE-KEY` all trip the same
 * code. A match on a key whose value is EMPTY (absent / null / '' / false) does not
 * trip: an explicitly-empty placeholder carries no capability.
 */
const DANGEROUS_KEY_FRAGMENTS: ReadonlyArray<
  readonly [fragment: string, code: BrazilReceitaFullJoinNoWriteViolationCode]
> = [
  ['serviceroleke', 'service_role_key_present'],
  ['servicerole', 'service_role_key_present'],
  ['supabaseserviceke', 'service_role_key_present'],
  ['supabaseurl', 'supabase_url_present'],
  ['supabaseendpoint', 'supabase_url_present'],
  ['importmode', 'import_mode_present'],
  ['runtimeendpoint', 'runtime_endpoint_present'],
  ['runtimeurl', 'runtime_endpoint_present'],
  ['agent1enabled', 'agent1_enabled_present'],
  ['providerapike', 'provider_api_key_present'],
  ['apollo', 'provider_api_key_present'],
  ['lusha', 'provider_api_key_present'],
  ['tavily', 'provider_api_key_present'],
  ['hubspot', 'provider_api_key_present'],
  ['slack', 'provider_api_key_present'],
];

/** Normalizes a config key for fragment matching: lowercase, separators removed. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True when a value carries no capability: absent, null, the empty string, `false`,
 * an empty array, or an empty object. Anything else (a non-empty string, a number,
 * `true`, a populated container) is treated as a live capability.
 */
function isEmptyCapability(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

/** Bounds the recursive walk so a hostile/cyclic config can never hang the guard. */
const MAX_CONFIG_WALK_DEPTH = 8;

function collectDangerousIndicators(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  found: Set<BrazilReceitaFullJoinNoWriteViolationCode>,
): void {
  if (depth > MAX_CONFIG_WALK_DEPTH) return;
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) collectDangerousIndicators(item, depth + 1, seen, found);
    return;
  }
  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    if (!isEmptyCapability(child)) {
      for (const [fragment, code] of DANGEROUS_KEY_FRAGMENTS) {
        if (normalized.includes(fragment)) found.add(code);
      }
    }
    collectDangerousIndicators(child, depth + 1, seen, found);
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Validates the declared no-write contract and scans the surrounding config for
 * dangerous indicators. PURE: no I/O, no env read, no client. Returns every
 * violation found (value-free machine codes) so the caller can fail closed with a
 * single sanitized error — it never throws on a violation and never echoes a value.
 *
 * `config` is intentionally `unknown`: it may arrive from a CLI boundary, a test, or
 * an options object, and the guard must be able to inspect all of them.
 */
export function assertBrazilReceitaFullJoinNoWrite(
  config: unknown,
): BrazilReceitaFullJoinNoWriteGuardResult {
  const violations: BrazilReceitaFullJoinNoWriteViolationCode[] = [];

  if (!isRecord(config)) {
    return { ok: false, violations: ['no_write_mode_not_declared'] };
  }

  if (config.noWriteMode !== true) violations.push('no_write_mode_not_declared');
  for (const [field, code] of ESCALATION_FIELD_CODES) {
    if (config[field] !== false) violations.push(code);
  }

  const dangerous = new Set<BrazilReceitaFullJoinNoWriteViolationCode>();
  collectDangerousIndicators(config, 0, new WeakSet<object>(), dangerous);
  for (const code of BRAZIL_RECEITA_FULL_JOIN_NO_WRITE_VIOLATION_CODES) {
    if (dangerous.has(code) && !violations.includes(code)) violations.push(code);
  }

  if (violations.length === 0) return GUARD_PASSED;
  return { ok: false, violations };
}
