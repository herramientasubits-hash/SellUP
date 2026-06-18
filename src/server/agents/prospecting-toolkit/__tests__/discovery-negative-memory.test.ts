/**
 * Tests — Discovery Negative Memory (Hito 16AB.43.24)
 *
 * Verifica:
 *   - emptyNegativeMemory devuelve memoria vacía con scope correcto
 *   - isDomainInNegativeMemory normaliza dominios antes de comparar
 *   - countDomainsInNegativeMemory cuenta correctamente
 *   - loadDiscoveryNegativeMemory devuelve empty en error de Supabase
 *   - loadDiscoveryNegativeMemory devuelve empty cuando no hay batches
 *   - loadDiscoveryNegativeMemory carga dominios correctamente con fake client
 *
 * No llama Supabase real ni ningún proveedor externo.
 * Usa Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyNegativeMemory,
  isDomainInNegativeMemory,
  countDomainsInNegativeMemory,
  loadDiscoveryNegativeMemory,
} from '../discovery-negative-memory';
import type { DiscoveryNegativeMemoryScope } from '../discovery-negative-memory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCOPE: DiscoveryNegativeMemoryScope = {
  countryCode: 'CO',
  industryName: 'Tecnología',
  subindustryNames: ['SaaS', 'EdTech'],
  lookbackDays: 30,
};

function makeMemoryWithDomains(domains: string[]) {
  const mem = emptyNegativeMemory(SCOPE);
  for (const d of domains) {
    mem.excludedDomains.add(d);
  }
  return mem;
}

// ─── Fake Supabase client ─────────────────────────────────────────────────────

type FakeBatch = { id: string };
type FakeCandidate = { domain: string | null };

function makeFakeClient(opts: {
  batchError?: boolean;
  batches?: FakeBatch[];
  candidateError?: boolean;
  candidates?: FakeCandidate[];
}) {
  const {
    batchError = false,
    batches = [],
    candidateError = false,
    candidates = [],
  } = opts;

  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          select: () => ({
            eq: () => ({
              gte: () =>
                Promise.resolve({
                  data: batchError ? null : batches,
                  error: batchError ? { message: 'db error' } : null,
                }),
            }),
          }),
        };
      }
      if (table === 'prospect_candidates') {
        return {
          select: () => ({
            in: () => ({
              not: () =>
                Promise.resolve({
                  data: candidateError ? null : candidates,
                  error: candidateError ? { message: 'db error' } : null,
                }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('emptyNegativeMemory', () => {
  it('returns empty set and zero counts', () => {
    const mem = emptyNegativeMemory(SCOPE);
    assert.equal(mem.excludedDomains.size, 0);
    assert.equal(mem.previousCandidateCount, 0);
    assert.equal(mem.previousBatchCount, 0);
    assert.deepEqual(mem.excludedDomainsSample, []);
    assert.equal(mem.scope.countryCode, 'CO');
  });
});

describe('isDomainInNegativeMemory', () => {
  it('returns false for null domain', () => {
    const mem = makeMemoryWithDomains(['acme.com']);
    assert.equal(isDomainInNegativeMemory(null, mem), false);
  });

  it('returns false when memory is empty', () => {
    const mem = emptyNegativeMemory(SCOPE);
    assert.equal(isDomainInNegativeMemory('acme.com', mem), false);
  });

  it('returns true for exact normalized match', () => {
    const mem = makeMemoryWithDomains(['acme.com']);
    assert.equal(isDomainInNegativeMemory('acme.com', mem), true);
  });

  it('normalizes https:// prefix before comparing', () => {
    const mem = makeMemoryWithDomains(['acme.com']);
    assert.equal(isDomainInNegativeMemory('https://acme.com', mem), true);
  });

  it('normalizes www. prefix before comparing', () => {
    const mem = makeMemoryWithDomains(['acme.com']);
    assert.equal(isDomainInNegativeMemory('www.acme.com', mem), true);
  });

  it('returns false for non-matching domain', () => {
    const mem = makeMemoryWithDomains(['acme.com']);
    assert.equal(isDomainInNegativeMemory('other.com', mem), false);
  });
});

describe('countDomainsInNegativeMemory', () => {
  it('returns 0 when memory is empty', () => {
    const mem = emptyNegativeMemory(SCOPE);
    assert.equal(countDomainsInNegativeMemory(['a.com', 'b.com'], mem), 0);
  });

  it('counts matched domains correctly', () => {
    const mem = makeMemoryWithDomains(['a.com', 'b.com']);
    assert.equal(countDomainsInNegativeMemory(['a.com', 'b.com', 'c.com', null], mem), 2);
  });

  it('returns 0 for empty list', () => {
    const mem = makeMemoryWithDomains(['a.com']);
    assert.equal(countDomainsInNegativeMemory([], mem), 0);
  });

  it('handles null entries in domain list', () => {
    const mem = makeMemoryWithDomains(['a.com']);
    assert.equal(countDomainsInNegativeMemory([null, null], mem), 0);
  });
});

describe('loadDiscoveryNegativeMemory', () => {
  it('returns empty memory when batch query errors', async () => {
    const client = makeFakeClient({ batchError: true });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomains.size, 0);
    assert.equal(result.previousBatchCount, 0);
  });

  it('returns empty memory when no batches found', async () => {
    const client = makeFakeClient({ batches: [] });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomains.size, 0);
  });

  it('returns empty memory when candidate query errors', async () => {
    const client = makeFakeClient({
      batches: [{ id: 'batch-1' }],
      candidateError: true,
    });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomains.size, 0);
  });

  it('loads and normalizes domains from candidates', async () => {
    const client = makeFakeClient({
      batches: [{ id: 'batch-1' }, { id: 'batch-2' }],
      candidates: [
        { domain: 'acme.com' },
        { domain: 'https://beta.io' },
        { domain: null },
        { domain: 'acme.com' }, // duplicate
      ],
    });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomains.has('acme.com'), true);
    assert.equal(result.excludedDomains.has('beta.io'), true);
    assert.equal(result.previousBatchCount, 2);
    assert.equal(result.previousCandidateCount, 4);
    // deduplicated: acme.com appears once
    assert.equal(result.excludedDomains.size, 2);
  });

  it('sample is capped at 20 domains', async () => {
    const manyDomains = Array.from({ length: 30 }, (_, i) => ({ domain: `company${i}.com` }));
    const client = makeFakeClient({
      batches: [{ id: 'batch-1' }],
      candidates: manyDomains,
    });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomainsSample.length, 20);
    assert.equal(result.excludedDomains.size, 30);
  });
});
