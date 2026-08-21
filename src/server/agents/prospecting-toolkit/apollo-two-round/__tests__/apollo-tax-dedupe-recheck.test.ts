/**
 * AGENT1-APOLLO-TAX-DEDUPE-RECHECK-1
 *
 * Deterministic guard for the strong POST-IDENTITY duplicate recheck that
 * PR #292 added to the Apollo macro-v2 runtime.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * The single authorized live Apollo QA run (batch 28636188…, Production SHA
 * 59e1b4a2) produced a real strong Colombia match — Quimiolab, NIT 830024737,
 * confidence 0.85 — but the Supabase edge logs for that run showed only three
 * of the four `accounts` queries the canonical SellUp checker issues when a tax
 * identifier is supplied: the `tax_identifier` tier was absent from the log.
 *
 * Edge logs are a sampled transport, not a contract: a missing line cannot
 * distinguish "the query was never issued" from "the query was not recorded".
 * These tests replace that ambiguity with a deterministic assertion at the
 * narrowest boundary that still proves the real thing — the literal HTTP
 * request the Supabase client emits — so the tax tier can never be silently
 * dropped again without a red test.
 *
 * NO network: `globalThis.fetch` is replaced by a recorder. No provider calls,
 * no Production reads, no Lusha/Apollo/Tavily traffic.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://tax-dedupe-recheck.test.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

// ============================================================
// Fixture — verbatim from the live run (nothing invented)
// ============================================================

/** The exact `co_siis` snapshot row Production matched for Quimiolab. */
const QUIMIOLAB_SNAPSHOT_ROW: Record<string, unknown> = {
  id: 'db4eba50-1c7d-4367-a552-51dc6a6ee946',
  source_key: 'co_siis',
  country_code: 'CO',
  tax_id: '830024737',
  normalized_tax_id: '830024737',
  legal_name: 'QUIMIOLAB SAS',
  normalized_legal_name: 'quimiolab',
  sector: 'COMERCIO',
  city: 'BOGOTA D.C.-BOGOTA D.C.',
  source_year: 2024,
  record_identity_key: 'tax:830024737',
};

const QUIMIOLAB_TAX_IDENTIFIER = '830024737';
const QUIMIOLAB_LEGAL_NAME = 'QUIMIOLAB SAS';
const COLOMBIA_STRONG_CONFIDENCE = 0.85;

// ============================================================
// HTTP recorder — the narrowest boundary that proves the query
// ============================================================

interface RecordedRequest {
  url: string;
  decoded: string;
}

let recorded: RecordedRequest[] = [];
let respondWith: (decodedUrl: string) => unknown[] = () => [];
let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  recorded = [];
  respondWith = () => [];
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url =
      typeof input === 'string'
        ? input
        : String((input as { url?: string })?.url ?? input);
    const decoded = decodeURIComponent(url);
    recorded.push({ url, decoded });
    return new Response(JSON.stringify(respondWith(decoded)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const accountsRequests = () => recorded.filter((r) => r.decoded.includes('/rest/v1/accounts?'));

const taxTierRequests = () =>
  accountsRequests().filter((r) => r.decoded.includes('tax_identifier=ilike.'));

// ============================================================
// Helpers — build the real seam with the real resolver
// ============================================================

async function runSeam(overrides?: {
  name?: string;
  domain?: string;
  website?: string;
  snapshotRows?: Record<string, unknown>[];
}) {
  const { createColombiaOfficialSourceResolver } = await import(
    '../../../prospect-intake/resolvers/colombia-official-source-resolver'
  );
  const { deriveOfficialIdentityForApolloCandidate } = await import(
    '../apollo-shared-intake-bridge'
  );

  const rows = overrides?.snapshotRows ?? [QUIMIOLAB_SNAPSHOT_ROW];
  const resolver = createColombiaOfficialSourceResolver({
    querySnapshots: async (_normalizedName: string, exact: boolean) => (exact ? rows : []),
  });

  return deriveOfficialIdentityForApolloCandidate({
    candidate: {
      name: overrides?.name ?? 'Quimiolab',
      domain: overrides?.domain ?? 'quimiolab.com.co',
      website: overrides?.website ?? 'http://www.quimiolab.com.co',
      country: 'Colombia',
      countryCode: 'CO',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    webSearchResult: null,
    criteria: { country: 'Colombia', countryCode: 'CO', sector: 'Salud & Farmacéuticos' },
    resolvers: [resolver],
  });
}

// ============================================================
// § 5 — the assertion the live run could not make
// ============================================================

test('a strong official tax identity reaches the SellUp checker as a real tax_identifier query', async () => {
  const outcome = await runSeam();

  // The seam produced the strong identity the live run produced.
  assert.equal(outcome.strongIdentityAvailable, true);
  assert.equal(outcome.officialSourceMetadata.status, 'matched');
  assert.equal(outcome.officialSourceMetadata.confidence, COLOMBIA_STRONG_CONFIDENCE);

  // The recheck actually ran, and its canonical input carries the tax identifier.
  assert.notEqual(outcome.strongDuplicateRecheck, null);
  assert.equal(
    outcome.strongDuplicateRecheck?.input?.taxIdentifier,
    QUIMIOLAB_TAX_IDENTIFIER,
    'the canonical duplicate input must carry the official tax identifier',
  );

  // …and it became a real lookup on the wire, not just a field on an object.
  const taxQueries = taxTierRequests();
  assert.equal(
    taxQueries.length,
    1,
    `expected exactly one accounts tax_identifier lookup, got ${taxQueries.length}. ` +
      `accounts requests seen:\n${accountsRequests().map((r) => r.decoded).join('\n')}`,
  );
  assert.match(taxQueries[0].decoded, /tax_identifier=ilike\.%830024737%/);
});

test('the tax tier is attempted BEFORE the weaker name tiers', async () => {
  await runSeam();

  const decoded = accountsRequests().map((r) => r.decoded);
  const taxIndex = decoded.findIndex((d) => d.includes('tax_identifier=ilike.'));
  const normalizedNameIndex = decoded.findIndex((d) => d.includes('normalized_name=eq.'));
  const nameIlikeIndex = decoded.findIndex((d) => d.includes('name=ilike.'));

  assert.ok(taxIndex >= 0, 'tax tier must be attempted');
  assert.ok(normalizedNameIndex >= 0, 'normalized_name tier must be attempted');
  assert.ok(
    taxIndex < normalizedNameIndex,
    'the tax identity tier must precede the normalized-name tier',
  );
  assert.ok(taxIndex < nameIlikeIndex, 'the tax identity tier must precede the name-ilike tier');
});

// ============================================================
// § 7 — the exact tax duplicate case the recheck exists for
// ============================================================

test('same tax identifier on a DIFFERENT domain is caught as an existing SellUp account', async () => {
  const EXISTING_ACCOUNT = {
    id: 'acc-11111111-2222-3333-4444-555555555555',
    name: 'Quimiolab S.A.S.',
    normalized_name: 'quimiolab sas',
    domain: 'otro-dominio-quimiolab.com',
    website: 'https://otro-dominio-quimiolab.com',
    country_code: 'CO',
    tax_identifier: '830.024.737',
  };

  // Only the tax tier resolves; domain and name tiers find nothing.
  respondWith = (decoded) =>
    decoded.includes('tax_identifier=ilike.') ? [EXISTING_ACCOUNT] : [];

  const outcome = await runSeam({ domain: 'new-company-example.co', website: 'https://new-company-example.co' });

  assert.equal(outcome.strongIdentityAvailable, true);
  const recheck = outcome.strongDuplicateRecheck;
  assert.notEqual(recheck, null);
  assert.equal(
    recheck?.status,
    'existing_in_sellup',
    'a tax-identity collision must be reported as an existing SellUp account',
  );

  const sellupMatch = recheck?.matches.find((m) => m.source === 'sellup');
  assert.equal(sellupMatch?.matchedId, EXISTING_ACCOUNT.id, 'the matched account must propagate');
  assert.equal(sellupMatch?.matchedTaxIdentifier, EXISTING_ACCOUNT.tax_identifier);

  // It was the TAX signal, not the domain, that found it.
  assert.ok(
    !recheck?.matches.some((m) => m.reason?.toLowerCase().includes('dominio')),
    'the match must not be attributed to the domain tier',
  );
});

// ============================================================
// § 8 — strong identity, no duplicate anywhere
// ============================================================

test('a strong tax identity with no duplicate still attempts the lookup and stays a new candidate', async () => {
  respondWith = () => [];

  const outcome = await runSeam();

  assert.equal(taxTierRequests().length, 1, 'the tax lookup must still be attempted');
  assert.notEqual(outcome.strongDuplicateRecheck, null);
  assert.notEqual(
    outcome.strongDuplicateRecheck?.status,
    'existing_in_sellup',
    'no duplicate rows means the candidate must not be marked as existing',
  );
  // Tax identity is an IDENTITY signal — it must not by itself satisfy any
  // downstream eligibility gate.
  assert.equal(outcome.typedColumns.tax_identifier, QUIMIOLAB_TAX_IDENTIFIER);
});

// ============================================================
// § 9 — documented precedence: an exact domain match short-circuits
// ============================================================

test('an exact domain match short-circuits before the tax tier (documented canonical precedence)', async () => {
  const DOMAIN_ACCOUNT = {
    id: 'acc-domain-0000-0000-0000-000000000000',
    name: 'Quimiolab',
    normalized_name: 'quimiolab',
    domain: 'quimiolab.com.co',
    website: 'http://www.quimiolab.com.co',
    country_code: 'CO',
    tax_identifier: null,
  };

  respondWith = (decoded) => (decoded.includes('domain=eq.quimiolab.com.co') ? [DOMAIN_ACCOUNT] : []);

  const outcome = await runSeam();

  assert.equal(outcome.strongDuplicateRecheck?.status, 'existing_in_sellup');
  // This is INTENTIONAL in the canonical checker: tier 1 (domain, confidence 95)
  // is a stronger and cheaper signal than tier 2 (tax, confidence 92), so it
  // returns immediately. Changing this precedence is an architecture decision,
  // not a bug fix — it is asserted here so a silent change is caught.
  assert.equal(
    taxTierRequests().length,
    0,
    'an exact domain match is expected to return before the tax tier is queried',
  );
});

// ============================================================
// § 6 — the same identity is threaded to the HubSpot checker
// ============================================================

test('the HubSpot checker receives the same strong tax identity through the canonical input', async () => {
  const outcome = await runSeam();

  // `checkCompanyDuplicate` builds ONE enriched input and hands the SAME object
  // to both checkers in parallel, so the input it reports is what HubSpot saw.
  assert.equal(outcome.strongDuplicateRecheck?.input?.taxIdentifier, QUIMIOLAB_TAX_IDENTIFIER);
  assert.equal(outcome.strongDuplicateRecheck?.input?.legalName, QUIMIOLAB_LEGAL_NAME);
  assert.ok(
    outcome.strongDuplicateRecheck?.checkedSources !== undefined,
    'the recheck must report which sources were consulted',
  );
});

// ============================================================
// § 10 / § 11 — writer projection and canonical identity key
// ============================================================

test('a writer-eligible candidate with this identity projects the official tax columns', async () => {
  const outcome = await runSeam();

  assert.deepEqual(outcome.typedColumns, {
    tax_identifier: QUIMIOLAB_TAX_IDENTIFIER,
    tax_identifier_type: 'NIT',
    legal_name: QUIMIOLAB_LEGAL_NAME,
    legal_status: null,
  });
});

test('the canonical identity key uses the tax tier for a strong official identity', async () => {
  const { buildProspectCandidateIdentityKey } = await import(
    '../../prospect-candidate-identity-key'
  );

  const withTax = buildProspectCandidateIdentityKey({
    name: 'Quimiolab',
    domain: 'quimiolab.com.co',
    website: 'http://www.quimiolab.com.co',
    countryCode: 'CO',
    taxIdentifier: QUIMIOLAB_TAX_IDENTIFIER,
  });
  assert.equal(withTax, `tax:co:${QUIMIOLAB_TAX_IDENTIFIER}`);

  // Without the official identity the same candidate falls back to the domain
  // tier — this is the pre-#292 behaviour, kept as the contrast case.
  const withoutTax = buildProspectCandidateIdentityKey({
    name: 'Quimiolab',
    domain: 'quimiolab.com.co',
    website: 'http://www.quimiolab.com.co',
    countryCode: 'CO',
    taxIdentifier: null,
  });
  assert.equal(withoutTax, 'domain:quimiolab.com.co');
});

// ============================================================
// § 13 — regression invariant
// ============================================================

test('INVARIANT: a low-confidence official match never reaches the tax tier or the typed columns', async () => {
  // Same registry row, but the candidate name only partially matches, so the
  // resolver can never return a strong identity.
  const { createColombiaOfficialSourceResolver } = await import(
    '../../../prospect-intake/resolvers/colombia-official-source-resolver'
  );
  const { deriveOfficialIdentityForApolloCandidate } = await import(
    '../apollo-shared-intake-bridge'
  );

  const resolver = createColombiaOfficialSourceResolver({
    // Exact lookup misses; only the partial lookup returns the row.
    querySnapshots: async (_name: string, exact: boolean) =>
      exact ? [] : [QUIMIOLAB_SNAPSHOT_ROW],
  });

  const outcome = await deriveOfficialIdentityForApolloCandidate({
    candidate: {
      name: 'Quimiolab Distribuciones',
      domain: 'quimiolab-distribuciones.com.co',
      website: 'http://quimiolab-distribuciones.com.co',
      country: 'Colombia',
      countryCode: 'CO',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    webSearchResult: null,
    criteria: { country: 'Colombia', countryCode: 'CO', sector: 'Salud & Farmacéuticos' },
    resolvers: [resolver],
  });

  assert.equal(outcome.strongIdentityAvailable, false);
  assert.equal(outcome.strongDuplicateRecheck, null, 'no strong identity ⇒ no recheck');
  assert.equal(outcome.typedColumns.tax_identifier, null, 'weak identity must not fill columns');
  assert.equal(taxTierRequests().length, 0, 'weak identity must not query the tax tier');
});
