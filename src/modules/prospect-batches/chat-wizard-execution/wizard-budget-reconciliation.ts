/**
 * wizard-budget-reconciliation.ts — Server-side credit estimation, period calculation,
 * and consumed-credit reader for the wizard budget guardrails.
 *
 * Server-only. Never import from client components.
 * Connected to executeProspectWizardGenerationAction in 16AB.43.17.
 */

// ── Credit estimation ─────────────────────────────────────────────────────────
//
// Constants mirror the actual wizard pipeline:
//   DEFAULT_MAX_ROUNDS in incremental-search.ts
//   buildCleanMultiQueryDiscoveryQueries in query-builder.ts → 5 queries per round
//   creditsForSearchDepth in tavily-usage-logging.ts → basic/standard = 1, deep = 2

const WIZARD_DEFAULT_ROUNDS = 2;
const WIZARD_DEFAULT_QUERIES_PER_ROUND = 5;

function creditsForDepth(searchDepth: string): number {
  return searchDepth === 'deep' ? 2 : 1;
}

/**
 * Returns the maximum Tavily credits a single wizard execution may consume.
 * Derived from the actual pipeline controls — never accepted from the client.
 *
 * Current config: 2 rounds × 5 queries × 1 credit = 10.
 *
 * @param opts.searchDepth - Optional override for testing. Defaults to 'standard' (1 credit/query).
 */
export function estimateWizardTavilyMaxCredits(opts?: { searchDepth?: string }): number {
  const depth = opts?.searchDepth ?? 'standard';
  return WIZARD_DEFAULT_ROUNDS * WIZARD_DEFAULT_QUERIES_PER_ROUND * creditsForDepth(depth);
}

// ── Period calculation ────────────────────────────────────────────────────────

/**
 * Returns the first day of the current month in the given IANA timezone as 'YYYY-MM-01'.
 *
 * @param timezone - IANA timezone (e.g. 'America/Bogota')
 * @param clock - Injectable clock for tests; defaults to () => new Date().
 */
export function getPilotBudgetPeriodStart(
  timezone: string,
  clock: () => Date = () => new Date(),
): string {
  const now = clock();
  // 'en-CA' locale outputs YYYY-MM-DD without locale-specific separators.
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // e.g. '2026-06-17'

  // Replace day component with '01' to get first day of month.
  const lastDash = formatted.lastIndexOf('-');
  return `${formatted.slice(0, lastDash + 1)}01`;
}

// ── Consumed credits reader ───────────────────────────────────────────────────
//
// Queries provider_usage_logs filtered by batch_id, provider_key='tavily', and
// operation_key='multi_query_web_search'. Returns the sum of credits_used.
//
// Returns null when: DB error, zero rows found, or any row has null credits_used.
// Callers MUST treat null as unverifiable and confirm conservatively.
// Zero rows → null because logging may have silently failed (usage_logging_failed).

type CreditsRow = { credits_used: number | null };
type CreditsQueryResult = { data: CreditsRow[] | null; error: { message: string } | null };

// Three chained .eq() calls finishing with a Promise — matches Supabase's builder.
type CreditsQuery3 = Promise<CreditsQueryResult>;
type CreditsQuery2 = { eq(col: string, val: string): CreditsQuery3 };
type CreditsQuery1 = { eq(col: string, val: string): CreditsQuery2 };
type CreditsSelectBuilder = { eq(col: string, val: string): CreditsQuery1 };

export type ConsumedCreditsDbClient = {
  from(table: string): {
    select(columns: string): CreditsSelectBuilder;
  };
};

/**
 * Reads total Tavily credits consumed for a batch from provider_usage_logs.
 *
 * Returns null when consumption cannot be verified. Callers confirm conservatively.
 * Returns a positive integer when all rows have non-null credits_used.
 */
export async function readWizardConsumedCreditsFromDb(
  batchId: string,
  db: ConsumedCreditsDbClient,
): Promise<number | null> {
  const { data, error } = await db
    .from('provider_usage_logs')
    .select('credits_used')
    .eq('batch_id', batchId)
    .eq('provider_key', 'tavily')
    .eq('operation_key', 'multi_query_web_search');

  if (error || !data || data.length === 0) return null;

  let total = 0;
  for (const row of data) {
    if (row.credits_used === null || row.credits_used === undefined) return null;
    total += row.credits_used;
  }
  return total;
}
