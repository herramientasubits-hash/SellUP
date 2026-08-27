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

/**
 * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY § 2 — el contrato de consulta cambió y
 * este doble lo refleja: UNA sola lectura de `prospect_candidates`, sin paso
 * previo por `prospect_batches` y por tanto sin filtro de `source`.
 *
 * El doble FALLA si alguien vuelve a consultar `prospect_batches`: es la forma de
 * que la restricción por `source='agent_1'` no pueda reaparecer en silencio.
 */
type FakeCandidate = {
  batch_id?: string | null;
  domain: string | null;
  name?: string | null;
  status?: string | null;
  source_primary?: string | null;
  review_notes?: string | null;
  metadata?: Record<string, unknown> | null;
};

function makeFakeClient(opts: {
  candidateError?: boolean;
  candidates?: FakeCandidate[];
  onBatchQuery?: () => void;
}) {
  const { candidateError = false, candidates = [], onBatchQuery } = opts;

  return {
    from(table: string) {
      if (table === 'prospect_batches') {
        onBatchQuery?.();
        throw new Error(
          'REGRESIÓN: la memoria negativa volvió a consultar prospect_batches (ámbito por source)',
        );
      }
      if (table === 'prospect_candidates') {
        const resolved = {
          data: candidateError ? null : candidates,
          error: candidateError ? { message: 'db error' } : null,
        };
        return {
          select: () => ({
            gte: () => Promise.resolve(resolved),
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
  it('returns empty memory when the candidate query errors', async () => {
    const client = makeFakeClient({ candidateError: true });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomains.size, 0);
    assert.equal(result.previousBatchCount, 0);
  });

  it('returns empty memory when no candidates exist in the window', async () => {
    const client = makeFakeClient({ candidates: [] });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomains.size, 0);
  });

  it('loads and normalizes domains from candidates', async () => {
    const client = makeFakeClient({
      candidates: [
        { batch_id: 'batch-1', domain: 'acme.com', status: 'needs_review' },
        { batch_id: 'batch-2', domain: 'https://beta.io', status: 'approved' },
        { batch_id: 'batch-2', domain: null, status: 'needs_review' },
        { batch_id: 'batch-1', domain: 'acme.com', status: 'needs_review' },
      ],
    });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomains.has('acme.com'), true);
    assert.equal(result.excludedDomains.has('beta.io'), true);
    assert.equal(result.previousBatchCount, 2);
    assert.equal(result.previousCandidateCount, 4);
    assert.equal(result.excludedDomains.size, 2);
  });

  it('sample is capped at 20 domains', async () => {
    const manyDomains = Array.from({ length: 30 }, (_, i) => ({
      batch_id: 'batch-1',
      domain: `company${i}.com`,
      status: 'needs_review',
    }));
    const client = makeFakeClient({ candidates: manyDomains });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomainsSample.length, 20);
    assert.equal(result.excludedDomains.size, 30);
  });

  // ── § 2 / § 3 · el ámbito histórico ya NO depende de prospect_batches.source ──

  it('§ 2 — una entrega de una fuente NO-agent_1 entra en la memoria histórica', async () => {
    // La fila viene de un lote `socrata_colombia`. Antes de este corte era
    // INVISIBLE, porque el paso 1 filtraba `prospect_batches.source='agent_1'`.
    const client = makeFakeClient({
      candidates: [
        {
          batch_id: 'batch-free-1',
          domain: 'entregada-gratis.com',
          name: 'Entregada Gratis SAS',
          status: 'needs_review',
          source_primary: 'socrata_colombia',
        },
      ],
    });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomains.has('entregada-gratis.com'), true);
    assert.equal(result.previousBatchCount, 1);
  });

  it('§ 3 — smoke/QA/limpieza NO congelan el universo; import y unknown SÍ', async () => {
    const client = makeFakeClient({
      candidates: [
        // Excluidas: no son entregas reales.
        {
          batch_id: 'b-smoke',
          domain: 'smoke.com',
          status: 'needs_review',
          metadata: { smoke_test: true },
        },
        {
          batch_id: 'b-qa',
          domain: 'qa.com',
          status: 'discarded',
          metadata: { qa_cleanup: true },
        },
        {
          batch_id: 'b-synth',
          domain: 'fixture.com',
          status: 'needs_review',
          metadata: { fixture: true },
        },
        // Dentro: están en el universo de SellUp y las autoridades POSTERIORES
        // al pago ya las tratan como duplicadas.
        {
          batch_id: 'b-import',
          domain: 'importada.com',
          status: 'needs_review',
          source_primary: 'external_import',
        },
        {
          batch_id: 'b-prod',
          domain: 'produccion.com',
          status: 'approved',
          source_primary: 'apollo',
        },
      ],
    });
    const result = await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(result.excludedDomains.has('smoke.com'), false);
    assert.equal(result.excludedDomains.has('qa.com'), false);
    assert.equal(result.excludedDomains.has('fixture.com'), false);
    assert.equal(result.excludedDomains.has('importada.com'), true);
    assert.equal(result.excludedDomains.has('produccion.com'), true);
  });

  it('§ 2 — NO consulta prospect_batches (el ámbito por source no puede volver)', async () => {
    let batchQueried = false;
    const client = makeFakeClient({
      candidates: [{ batch_id: 'b1', domain: 'acme.com', status: 'approved' }],
      onBatchQuery: () => {
        batchQueried = true;
      },
    });
    await loadDiscoveryNegativeMemory(client as never, SCOPE);
    assert.equal(batchQueried, false);
  });
});
