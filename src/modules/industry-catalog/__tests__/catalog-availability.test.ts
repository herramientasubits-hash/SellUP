/**
 * A1-LEGACY-PATH-FENCE-1 — Capa 2: typed catalog availability contract.
 *
 * Proves a catalog failure can never again be confused with "no catalog
 * requested". The old `catch { catalog = null }` collapsed both into `null`, and
 * the experience resolver turned `null` into the legacy Apollo form — a config
 * read failure one click away from up to 25 unbudgeted Apollo credits.
 *
 * Every known CatalogLoadError reason is covered, plus an unknown throwable, plus
 * the zero-query `disabled` path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapCatalogLoadFailureToAvailability,
  resolveCatalogAvailability,
  type CatalogAvailability,
  type CatalogUnavailableReason,
} from '@/modules/industry-catalog/catalog-availability';
import { CatalogLoadError } from '@/modules/industry-catalog/loader';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'ind-1', name: 'Tecnología', slug: 'tecnologia', description: null, sortOrder: 1 },
  ],
  subindustries: [
    {
      id: 'sub-1',
      name: 'SaaS',
      slug: 'saas',
      description: null,
      industryId: 'ind-1',
      applicableCountries: null,
      sortOrder: 1,
    },
  ],
};

// ── Pure mapping ──────────────────────────────────────────────────────────────

describe('mapCatalogLoadFailureToAvailability — every known reason', () => {
  it('empty_catalog → empty (not an error state)', () => {
    const r = mapCatalogLoadFailureToAvailability(
      new CatalogLoadError('empty_catalog', 'nothing published'),
    );
    assert.equal(r.status, 'empty');
  });

  it('query_failed → unavailable, retryable', () => {
    const r = mapCatalogLoadFailureToAvailability(
      new CatalogLoadError('query_failed', 'supabase down'),
    );
    assert.equal(r.status, 'unavailable');
    assert.equal(r.status === 'unavailable' && r.reason, 'query_failed');
    assert.equal(r.status === 'unavailable' && r.retryable, true);
  });

  const CONSISTENCY_REASONS: CatalogUnavailableReason[] = [
    'mixed_versions',
    'invalid_industry',
    'invalid_subindustry',
    'duplicate_ids',
    'inconsistent_payload',
  ];

  for (const reason of CONSISTENCY_REASONS) {
    it(`${reason} → unavailable, NOT retryable (retry returns the same broken payload)`, () => {
      const r = mapCatalogLoadFailureToAvailability(
        new CatalogLoadError(
          reason as Exclude<CatalogUnavailableReason, 'unknown'>,
          'broken',
        ),
      );
      assert.equal(r.status, 'unavailable');
      assert.equal(r.status === 'unavailable' && r.reason, reason);
      assert.equal(r.status === 'unavailable' && r.retryable, false);
    });
  }

  it('unknown throwable → unavailable, reason "unknown", NOT retryable', () => {
    const r = mapCatalogLoadFailureToAvailability(new Error('boom'));
    assert.equal(r.status, 'unavailable');
    assert.equal(r.status === 'unavailable' && r.reason, 'unknown');
    assert.equal(r.status === 'unavailable' && r.retryable, false);
  });

  it('non-Error throwable (string) still maps to unknown, never throws', () => {
    const r = mapCatalogLoadFailureToAvailability('kaboom');
    assert.equal(r.status, 'unavailable');
    assert.equal(r.status === 'unavailable' && r.reason, 'unknown');
  });

  it('NEVER returns null for any input', () => {
    const inputs: unknown[] = [
      null,
      undefined,
      0,
      '',
      new Error('x'),
      new CatalogLoadError('query_failed', 'x'),
      new CatalogLoadError('empty_catalog', 'x'),
    ];
    for (const input of inputs) {
      const r: CatalogAvailability = mapCatalogLoadFailureToAvailability(input);
      assert.ok(r !== null && typeof r.status === 'string');
    }
  });
});

// ── Loader envelope ───────────────────────────────────────────────────────────

describe('resolveCatalogAvailability', () => {
  it('requested=false → disabled, and performs ZERO catalog queries', async () => {
    let calls = 0;
    const r = await resolveCatalogAvailability(false, {
      loadCatalog: async () => {
        calls++;
        return CATALOG;
      },
      logEvent: () => {},
    });
    assert.equal(r.status, 'disabled');
    assert.equal(calls, 0, 'no Supabase query when no experience needs the catalog');
  });

  it('successful load → ready, carrying the catalog', async () => {
    const r = await resolveCatalogAvailability(true, {
      loadCatalog: async () => CATALOG,
      logEvent: () => {},
    });
    assert.equal(r.status, 'ready');
    assert.equal(r.status === 'ready' && r.catalog.version, 'v1');
  });

  it('a throwing loader never propagates — returns a typed state instead', async () => {
    const r = await resolveCatalogAvailability(true, {
      loadCatalog: async () => {
        throw new CatalogLoadError('query_failed', 'supabase down');
      },
      logEvent: () => {},
    });
    assert.equal(r.status, 'unavailable');
    assert.equal(r.status === 'unavailable' && r.retryable, true);
  });

  it('disabled is DISTINCT from every failure state (the old null conflation)', async () => {
    const disabled = await resolveCatalogAvailability(false, {
      loadCatalog: async () => CATALOG,
      logEvent: () => {},
    });
    const failed = await resolveCatalogAvailability(true, {
      loadCatalog: async () => {
        throw new CatalogLoadError('query_failed', 'x');
      },
      logEvent: () => {},
    });
    const empty = await resolveCatalogAvailability(true, {
      loadCatalog: async () => {
        throw new CatalogLoadError('empty_catalog', 'x');
      },
      logEvent: () => {},
    });
    assert.notEqual(disabled.status, failed.status);
    assert.notEqual(disabled.status, empty.status);
    assert.notEqual(failed.status, empty.status);
  });
});

// ── Observability: PII-free ───────────────────────────────────────────────────

describe('resolveCatalogAvailability — logged events carry no PII', () => {
  it('emits catalog_load_failed with a static reason code and nothing else', async () => {
    const events: unknown[] = [];
    await resolveCatalogAvailability(true, {
      loadCatalog: async () => {
        throw new CatalogLoadError('inconsistent_payload', 'Subindustry sub-9 broke');
      },
      logEvent: (e) => events.push(e),
    });

    assert.equal(events.length, 1);
    const event = events[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(event).sort(), ['event', 'reason', 'retryable']);
    assert.equal(event.event, 'catalog_load_failed');
    assert.equal(event.reason, 'inconsistent_payload');
    assert.equal(event.retryable, false);

    // The loader's message mentioned a concrete subindustry id — it must not leak.
    assert.doesNotMatch(JSON.stringify(event), /sub-9/);
  });

  it('an empty catalog is reported as empty_catalog, not as a failure reason', async () => {
    const events: { reason: string }[] = [];
    await resolveCatalogAvailability(true, {
      loadCatalog: async () => {
        throw new CatalogLoadError('empty_catalog', 'x');
      },
      logEvent: (e) => events.push(e),
    });
    assert.equal(events[0].reason, 'empty_catalog');
  });

  it('no event is emitted on the happy path or the disabled path', async () => {
    const events: unknown[] = [];
    await resolveCatalogAvailability(true, {
      loadCatalog: async () => CATALOG,
      logEvent: (e) => events.push(e),
    });
    await resolveCatalogAvailability(false, {
      loadCatalog: async () => CATALOG,
      logEvent: (e) => events.push(e),
    });
    assert.equal(events.length, 0);
  });
});
