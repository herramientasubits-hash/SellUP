/**
 * Verification Hardening — Honest Duplicate Source Check (Hotfix 16AB.24.11)
 *
 * Defines the per-source duplicate check contract with strict state invariants.
 *
 * Rules:
 *   not_checked   → checkedAt = null, queryEvidence = null
 *   checked_no_match → checkedAt != null, queryEvidence.queries >= 1, resultCount = 0
 *   check_failed  → preserves technical error; never becomes "no match"
 *
 * Critical: `new_candidate` is a pipeline status, NOT evidence of a CRM query.
 * Never convert new_candidate → checked_no_match automatically.
 *
 * HubSpot is always read-only. No create/update calls are made.
 */

// ─── Status enum ──────────────────────────────────────────────────────────────

export type DuplicateSourceCheckStatus =
  | 'not_checked'
  | 'checked_no_match'
  | 'possible_match'
  | 'confirmed_match'
  | 'check_failed';

// ─── Match record ─────────────────────────────────────────────────────────────

export type DuplicateMatchRecord = {
  matchedId: string;
  matchedName: string | null;
  matchedDomain: string | null;
  confidence: number;
  reason: string;
};

// ─── Per-source check ─────────────────────────────────────────────────────────

export type DuplicateSourceCheck = {
  source: 'sellup' | 'hubspot' | 'internal_pool' | 'candidate_history';
  status: DuplicateSourceCheckStatus;
  matches: DuplicateMatchRecord[];
  checkedAt: string | null;
  queryEvidence: {
    method: string;
    queries: string[];
    providerRequestId?: string | null;
    resultCount?: number | null;
  } | null;
  errorCode: string | null;
};

// ─── HubSpot read-only checker interface ─────────────────────────────────────

export type HubSpotCheckerInput = {
  companyName: string;
  aliases: string[];
  domain: string | null;
  linkedinUrl: string | null;
};

export interface HubSpotDuplicateChecker {
  checkCandidate(input: HubSpotCheckerInput): Promise<DuplicateSourceCheck>;
}

// ─── State invariant validator ────────────────────────────────────────────────

export class DuplicateStateInvariantError extends Error {
  constructor(
    public readonly source: DuplicateSourceCheck['source'],
    public readonly status: DuplicateSourceCheckStatus,
    message: string
  ) {
    super(`[DuplicateSourceCheck:${source}] ${message}`);
    this.name = 'DuplicateStateInvariantError';
  }
}

export function assertHonestDuplicateState(check: DuplicateSourceCheck): void {
  const { source, status, checkedAt, queryEvidence } = check;

  if (status === 'not_checked') {
    if (checkedAt !== null) {
      throw new DuplicateStateInvariantError(
        source, status,
        'not_checked must have checkedAt=null'
      );
    }
    if (queryEvidence !== null) {
      throw new DuplicateStateInvariantError(
        source, status,
        'not_checked must have queryEvidence=null'
      );
    }
    return;
  }

  if (status === 'checked_no_match') {
    if (!checkedAt) {
      throw new DuplicateStateInvariantError(
        source, status,
        'checked_no_match requires a non-null checkedAt timestamp'
      );
    }
    if (!queryEvidence) {
      throw new DuplicateStateInvariantError(
        source, status,
        'checked_no_match requires queryEvidence (proof a real query was made)'
      );
    }
    if (!queryEvidence.queries || queryEvidence.queries.length < 1) {
      throw new DuplicateStateInvariantError(
        source, status,
        'checked_no_match requires at least one query in queryEvidence.queries'
      );
    }
    if (queryEvidence.resultCount !== 0) {
      throw new DuplicateStateInvariantError(
        source, status,
        `checked_no_match requires resultCount=0 but got resultCount=${String(queryEvidence.resultCount)}`
      );
    }
    return;
  }

  if (status === 'check_failed') {
    if (!check.errorCode) {
      throw new DuplicateStateInvariantError(
        source, status,
        'check_failed must preserve an errorCode — never silently swallow errors'
      );
    }
  }
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function makeNotChecked(
  source: DuplicateSourceCheck['source']
): DuplicateSourceCheck {
  return {
    source,
    status: 'not_checked',
    matches: [],
    checkedAt: null,
    queryEvidence: null,
    errorCode: null,
  };
}

export function makeCheckedNoMatch(
  source: DuplicateSourceCheck['source'],
  queries: string[],
  method: string,
  providerRequestId?: string | null
): DuplicateSourceCheck {
  const check: DuplicateSourceCheck = {
    source,
    status: 'checked_no_match',
    matches: [],
    checkedAt: new Date().toISOString(),
    queryEvidence: {
      method,
      queries,
      providerRequestId: providerRequestId ?? null,
      resultCount: 0,
    },
    errorCode: null,
  };
  assertHonestDuplicateState(check);
  return check;
}

export function makeCheckFailed(
  source: DuplicateSourceCheck['source'],
  errorCode: string
): DuplicateSourceCheck {
  const check: DuplicateSourceCheck = {
    source,
    status: 'check_failed',
    matches: [],
    checkedAt: new Date().toISOString(),
    queryEvidence: null,
    errorCode,
  };
  assertHonestDuplicateState(check);
  return check;
}

export function makePossibleMatch(
  source: DuplicateSourceCheck['source'],
  matches: DuplicateMatchRecord[],
  queries: string[],
  method: string
): DuplicateSourceCheck {
  return {
    source,
    status: 'possible_match',
    matches,
    checkedAt: new Date().toISOString(),
    queryEvidence: {
      method,
      queries,
      resultCount: matches.length,
    },
    errorCode: null,
  };
}

export function makeConfirmedMatch(
  source: DuplicateSourceCheck['source'],
  matches: DuplicateMatchRecord[],
  queries: string[],
  method: string
): DuplicateSourceCheck {
  return {
    source,
    status: 'confirmed_match',
    matches,
    checkedAt: new Date().toISOString(),
    queryEvidence: {
      method,
      queries,
      resultCount: matches.length,
    },
    errorCode: null,
  };
}

// ─── Null-object (HubSpot not configured) ─────────────────────────────────────

export const nullHubSpotDuplicateChecker: HubSpotDuplicateChecker = {
  async checkCandidate(): Promise<DuplicateSourceCheck> {
    return makeNotChecked('hubspot');
  },
};

// ─── Production adapter wrapping existing checkHubSpotDuplicates ──────────────

export function createProductionHubSpotDuplicateChecker(): HubSpotDuplicateChecker {
  return {
    async checkCandidate(input: HubSpotCheckerInput): Promise<DuplicateSourceCheck> {
      type HubSpotModule = typeof import('../../../agents/prospecting-toolkit/hubspot-duplicate-checker');
      const { checkHubSpotDuplicates } =
        await import('../../../agents/prospecting-toolkit/hubspot-duplicate-checker') as HubSpotModule;

      const allAliases = [input.companyName, ...input.aliases].filter(Boolean);

      try {
        const outcome = await checkHubSpotDuplicates({
          name: input.companyName,
          domain: input.domain ?? undefined,
          website: input.domain ? `https://${input.domain}` : undefined,
        });

        if (!outcome.connected) {
          return makeNotChecked('hubspot');
        }

        if (outcome.error && (!outcome.matches || outcome.matches.length === 0)) {
          return makeCheckFailed('hubspot', outcome.error);
        }

        const queries = allAliases.slice(0, 5);
        if (input.domain) queries.push(input.domain);

        type OutcomeMatch = (typeof outcome.matches)[number];

        const matches: DuplicateMatchRecord[] = outcome.matches.map((m: OutcomeMatch) => ({
          matchedId: m.matchedId ?? '',
          matchedName: m.matchedName ?? null,
          matchedDomain: m.matchedDomain ?? null,
          confidence: m.confidence,
          reason: m.reason,
        }));

        if (matches.length === 0) {
          return makeCheckedNoMatch('hubspot', queries, 'hubspot_crm_api_search');
        }

        const hasConfirmed = outcome.matches.some((m: OutcomeMatch) => m.status === 'existing_in_hubspot');
        if (hasConfirmed) {
          return makeConfirmedMatch('hubspot', matches, queries, 'hubspot_crm_api_search');
        }

        return makePossibleMatch('hubspot', matches, queries, 'hubspot_crm_api_search');
      } catch (err) {
        const code = err instanceof Error ? err.message.slice(0, 100) : 'unknown_error';
        return makeCheckFailed('hubspot', code);
      }
    },
  };
}

// ─── Manual check record (for Celes-style human-verified entries) ─────────────

export function makeManualCheckedNoMatch(
  source: DuplicateSourceCheck['source'],
  queries: string[],
  checkedAt: string
): DuplicateSourceCheck {
  const check: DuplicateSourceCheck = {
    source,
    status: 'checked_no_match',
    matches: [],
    checkedAt,
    queryEvidence: {
      method: 'manual_human_search',
      queries,
      resultCount: 0,
    },
    errorCode: null,
  };
  assertHonestDuplicateState(check);
  return check;
}
