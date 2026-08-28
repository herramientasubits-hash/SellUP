/**
 * AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — `page-fence.ts` puro.
 *
 * Cubre: precedencia de estados al fusionar, aislamiento por ronda+huella+página,
 * el códec slim ↔ `NormalizedApolloOrganization`, la validación de identidad al
 * leer, y la compactación por tamaño (C12: la exposición de una página sin
 * desenlace terminal se conserva, nunca se asienta en cero).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeApolloPageFenceEntries,
  clearApolloPageFenceRound,
  toApolloPageFenceOrganization,
  fromApolloPageFenceOrganization,
  readApolloPageFenceDocument,
  compactApolloPageFenceForSize,
  toApolloDurableResumeState,
  buildApolloPageFenceReadFailureBlock,
  APOLLO_PAGE_FENCE_CONTRACT_VERSION,
  type ApolloPageFenceEntry,
  type ApolloPageFenceDocumentV1,
} from '../page-fence';
import type { NormalizedApolloOrganization } from '../../apollo-organizations-response-normalizer';

const IDENTITY = { idempotencyKey: 'idem-1', requestFingerprint: 'fp-1' };

function entry(overrides: Partial<ApolloPageFenceEntry> = {}): ApolloPageFenceEntry {
  return {
    round_number: 1,
    search_plan_fingerprint: 'fp-round-1',
    page: 1,
    status: 'request_started',
    organizations: [],
    credits: 1,
    results_returned: 0,
    total_pages: null,
    accepted_count: null,
    ...overrides,
  };
}

function fullOrg(): NormalizedApolloOrganization {
  return {
    providerReference: { provider: 'apollo', providerOrganizationId: 'org-1', providerAccountId: 'acct-1' },
    name: 'Empresa Uno',
    primaryDomain: 'empresauno.com',
    normalizedDomains: ['empresauno.com', 'www.empresauno.com'],
    websiteUrl: 'https://empresauno.com',
    linkedinUrl: 'https://linkedin.com/company/empresauno',
    phone: '+57 1 2345678',
    foundedYear: 1999,
    country: 'Colombia',
    city: 'Bogotá',
    industry: 'retail',
    industries: ['retail', 'supermarkets'],
    keywords: ['grocery', 'supermarket'],
    organizationKeywords: ['lms'],
    estimatedNumEmployees: 250,
    shortDescription: 'Una cadena de supermercados.',
    seoDescription: 'SEO desc',
    description: 'Descripción larga.',
    technologies: ['shopify'],
    filledFromAccountFields: [],
  };
}

// ─── Precedencia de fusión (C6/C7/C12) ────────────────────────────────────────

describe('mergeApolloPageFenceEntries · precedencia por estado', () => {
  it('succeeded gana sobre request_started para la MISMA página', () => {
    const base = [entry({ status: 'request_started', organizations: [] })];
    const incoming = [entry({ status: 'succeeded', organizations: [toApolloPageFenceOrganization(fullOrg())] })];
    const merged = mergeApolloPageFenceEntries(base, incoming);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].status, 'succeeded');
    assert.equal(merged[0].organizations.length, 1);
  });

  it('indeterminate NUNCA se pierde ante un request_started más nuevo', () => {
    const base = [entry({ status: 'indeterminate' })];
    const incoming = [entry({ status: 'request_started' })];
    const merged = mergeApolloPageFenceEntries(base, incoming);
    assert.equal(merged[0].status, 'indeterminate', 'la señal de posible cobro no puede desaparecer');
  });

  it('succeeded gana incluso sobre indeterminate: un desenlace terminal manda', () => {
    const base = [entry({ status: 'indeterminate' })];
    const incoming = [entry({ status: 'succeeded', organizations: [toApolloPageFenceOrganization(fullOrg())] })];
    const merged = mergeApolloPageFenceEntries(base, incoming);
    assert.equal(merged[0].status, 'succeeded');
  });

  it('páginas de rondas o huellas distintas NUNCA se confunden (§ C13/C14)', () => {
    const base = [
      entry({ round_number: 1, search_plan_fingerprint: 'fp-round-1', page: 1, status: 'succeeded' }),
    ];
    const incoming = [
      entry({ round_number: 2, search_plan_fingerprint: 'fp-round-2', page: 1, status: 'request_started' }),
    ];
    const merged = mergeApolloPageFenceEntries(base, incoming);
    assert.equal(merged.length, 2, 'dos entradas independientes, no una fusionada');
    assert.equal(merged.find((e) => e.round_number === 1)?.status, 'succeeded');
    assert.equal(merged.find((e) => e.round_number === 2)?.status, 'request_started');
  });

  it('la fusión es conmutativa: A sobre B = B sobre A', () => {
    const a = [entry({ page: 1, status: 'succeeded' })];
    const b = [entry({ page: 1, status: 'indeterminate' }), entry({ page: 2, status: 'succeeded' })];
    const ab = mergeApolloPageFenceEntries(a, b);
    const ba = mergeApolloPageFenceEntries(b, a);
    assert.deepEqual(ab, ba);
  });

  it('C12 — un request_started/indeterminate conserva créditos > 0, nunca se asienta en cero', () => {
    // Este módulo no decide el valor (lo decide production-runner.server.ts),
    // pero SÍ debe conservarlo intacto: una fusión no puede pisarlo con 0.
    const base = [entry({ status: 'request_started', credits: 1 })];
    const incoming = [entry({ status: 'indeterminate', credits: 1 })];
    const merged = mergeApolloPageFenceEntries(base, incoming);
    assert.equal(merged[0].credits, 1, 'la exposición posible nunca se representa como gratis');
  });
});

// ─── AGENT1-APOLLO-DURABLE-FENCE-HARD-CRASH-FIX · adaptador de resumen ────────
//
// `toApolloDurableResumeState` es el ÚNICO lugar donde entradas durables se
// traducen al `ApolloDurableResumeState` que el motor de paginación consume —
// compartido, sin copias, por `production-runner.server.ts` (dos rondas) y
// `incremental-search.ts` (default/legacy). Estas pruebas ejercitan el
// adaptador REAL directamente sobre entradas con `status` genuino, nunca
// construyendo `indeterminatePage` a mano — eso sería probar el resultado que
// se espera, no el código que debe producirlo.

describe('toApolloDurableResumeState · H1/H5/H6 — request_started se trata como indeterminate', () => {
  it('H1/H6 — una entrada `request_started` SOLA (sin succeeded ni indeterminate) bloquea como indeterminatePage, nunca se pierde ni se adopta como succeeded', () => {
    const entries = [
      entry({ round_number: 1, search_plan_fingerprint: 'fp-real-1', page: 2, status: 'request_started', credits: 1 }),
    ];

    const resume = toApolloDurableResumeState(entries);

    assert.deepEqual(resume.succeededPages, [], 'request_started NUNCA se adopta como página ya exitosa');
    assert.deepEqual(resume.indeterminatePage, { page: 2, requestFingerprint: 'fp-real-1' });
  });

  it('H1 — page1 succeeded + page2 request_started: page1 se conserva, page2 bloquea CUALQUIER página nueva', () => {
    const entries = [
      entry({
        round_number: 1,
        search_plan_fingerprint: 'fp-real-2',
        page: 1,
        status: 'succeeded',
        organizations: [toApolloPageFenceOrganization(fullOrg())],
      }),
      entry({ round_number: 1, search_plan_fingerprint: 'fp-real-2', page: 2, status: 'request_started' }),
    ];

    const resume = toApolloDurableResumeState(entries);

    assert.equal(resume.succeededPages.length, 1);
    assert.equal(resume.succeededPages[0].page, 1);
    assert.deepEqual(resume.indeterminatePage, { page: 2, requestFingerprint: 'fp-real-2' });
  });

  it('sin ninguna entrada `request_started`/`indeterminate`: indeterminatePage es null', () => {
    const entries = [
      entry({ round_number: 1, page: 1, status: 'succeeded' }),
      entry({ round_number: 1, page: 2, status: 'succeeded' }),
    ];
    const resume = toApolloDurableResumeState(entries);
    assert.equal(resume.indeterminatePage, null);
    assert.equal(resume.succeededPages.length, 2);
  });

  it('H5 — un `request_started` más nuevo para una página YA succeeded no la downgradea antes del adaptador (fusión) y el adaptador ve succeeded, no indeterminate', () => {
    const base = [entry({ round_number: 1, page: 1, status: 'succeeded', credits: 1 })];
    const staleRetry = [entry({ round_number: 1, page: 1, status: 'request_started', credits: 1 })];
    const merged = mergeApolloPageFenceEntries(base, staleRetry);

    const resume = toApolloDurableResumeState(merged);

    assert.equal(resume.succeededPages.length, 1, 'succeeded sigue siendo la verdad para esa página');
    assert.equal(resume.indeterminatePage, null, 'no hay ninguna página realmente sin desenlace');
  });
});

describe('buildApolloPageFenceReadFailureBlock · BLOQUEADOR 2', () => {
  it('beforeRequest siempre lanza con el motivo, sin importar la página', async () => {
    const block = buildApolloPageFenceReadFailureBlock('connection reset');
    await assert.rejects(
      () => block.beforeRequest({ page: 1, requestFingerprint: 'fp-x' }),
      /durable_page_fence_read_failed: connection reset/,
    );
  });

  it('onSucceeded/onIndeterminate son no-ops inertes (nunca se alcanzan, pero no deben lanzar)', async () => {
    const block = buildApolloPageFenceReadFailureBlock('x');
    await assert.doesNotReject(() =>
      block.onSucceeded({
        page: 1,
        requestFingerprint: 'fp-x',
        organizations: [],
        credits: 0,
        resultsReturned: 0,
        totalPages: null,
        acceptedCount: null,
      }),
    );
    await assert.doesNotReject(() => block.onIndeterminate({ page: 1, requestFingerprint: 'fp-x' }));
  });
});

describe('clearApolloPageFenceRound', () => {
  it('quita sólo las entradas de la ronda indicada', () => {
    const entries = [
      entry({ round_number: 1, page: 1 }),
      entry({ round_number: 1, page: 2 }),
      entry({ round_number: 2, page: 1 }),
    ];
    const cleared = clearApolloPageFenceRound(entries, 1);
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0].round_number, 2);
  });
});

// ─── Códec slim ↔ NormalizedApolloOrganization ────────────────────────────────

describe('toApolloPageFenceOrganization / fromApolloPageFenceOrganization', () => {
  it('ida y vuelta conserva la identidad y los campos que sí viajan', () => {
    const original = fullOrg();
    const slim = toApolloPageFenceOrganization(original);
    const restored = fromApolloPageFenceOrganization(slim);

    assert.equal(restored.providerReference.providerOrganizationId, original.providerReference.providerOrganizationId);
    assert.equal(restored.name, original.name);
    assert.equal(restored.primaryDomain, original.primaryDomain);
    assert.deepEqual(restored.normalizedDomains, original.normalizedDomains);
    assert.equal(restored.industry, original.industry);
    assert.equal(restored.estimatedNumEmployees, original.estimatedNumEmployees);
  });

  it('ni teléfono ni año de fundación viajan: misma disciplina que checkpoint.ts', () => {
    const slim = toApolloPageFenceOrganization(fullOrg());
    assert.ok(!('phone' in slim));
    assert.ok(!('foundedYear' in slim));
    const restored = fromApolloPageFenceOrganization(slim);
    assert.equal(restored.phone, null);
    assert.equal(restored.foundedYear, null);
  });

  it('trunca texto largo y limita arrays, igual que el resto del checkpoint', () => {
    const long = 'x'.repeat(1000);
    const org: NormalizedApolloOrganization = {
      ...fullOrg(),
      description: long,
      keywords: Array.from({ length: 30 }, (_, i) => `keyword-${i}`),
    };
    const slim = toApolloPageFenceOrganization(org);
    assert.ok(slim.description !== null && slim.description.length <= 300);
    assert.ok(slim.keywords.length <= 10);
  });
});

// ─── Lectura validada ──────────────────────────────────────────────────────────

describe('readApolloPageFenceDocument', () => {
  function validDoc(): ApolloPageFenceDocumentV1 {
    return {
      version: APOLLO_PAGE_FENCE_CONTRACT_VERSION,
      fence_version: 3,
      idempotency_key: IDENTITY.idempotencyKey,
      request_fingerprint: IDENTITY.requestFingerprint,
      entries: [entry()],
      compacted: false,
    };
  }

  it('acepta un documento con identidad coincidente', () => {
    const doc = readApolloPageFenceDocument(validDoc(), IDENTITY);
    assert.ok(doc !== null);
    assert.equal(doc?.fence_version, 3);
  });

  it('rechaza un documento de OTRA corrida (idempotency_key distinto)', () => {
    const doc = readApolloPageFenceDocument(
      { ...validDoc(), idempotency_key: 'otra-corrida' },
      IDENTITY,
    );
    assert.equal(doc, null);
  });

  it('rechaza un documento de otra huella de request', () => {
    const doc = readApolloPageFenceDocument(
      { ...validDoc(), request_fingerprint: 'otra-huella' },
      IDENTITY,
    );
    assert.equal(doc, null);
  });

  it('rechaza una versión de contrato distinta, nunca la adivina', () => {
    const doc = readApolloPageFenceDocument({ ...validDoc(), version: 99 }, IDENTITY);
    assert.equal(doc, null);
  });

  it('null y valores no-objeto se leen como ausencia, no como error', () => {
    assert.equal(readApolloPageFenceDocument(null, IDENTITY), null);
    assert.equal(readApolloPageFenceDocument('not-an-object', IDENTITY), null);
    assert.equal(readApolloPageFenceDocument(42, IDENTITY), null);
  });
});

// ─── Compactación por tamaño ───────────────────────────────────────────────────

describe('compactApolloPageFenceForSize', () => {
  it('un documento pequeño no se toca', () => {
    const doc: ApolloPageFenceDocumentV1 = {
      version: APOLLO_PAGE_FENCE_CONTRACT_VERSION,
      fence_version: 1,
      idempotency_key: IDENTITY.idempotencyKey,
      request_fingerprint: IDENTITY.requestFingerprint,
      entries: [entry()],
      compacted: false,
    };
    const result = compactApolloPageFenceForSize(doc, 32 * 1024);
    assert.equal(result.withinLimit, true);
    assert.equal(result.document.compacted, false);
  });

  it('sobre el techo, vacía `organizations` empezando por la entrada más grande y conserva el status', () => {
    const bigOrgs = Array.from({ length: 50 }, (_, i) => toApolloPageFenceOrganization({
      ...fullOrg(),
      providerReference: { provider: 'apollo', providerOrganizationId: `org-${i}`, providerAccountId: null },
    }));
    const doc: ApolloPageFenceDocumentV1 = {
      version: APOLLO_PAGE_FENCE_CONTRACT_VERSION,
      fence_version: 1,
      idempotency_key: IDENTITY.idempotencyKey,
      request_fingerprint: IDENTITY.requestFingerprint,
      entries: [entry({ page: 1, status: 'succeeded', organizations: bigOrgs })],
      compacted: false,
    };
    const result = compactApolloPageFenceForSize(doc, 500);
    assert.equal(result.document.compacted, true);
    // La página sigue marcada succeeded — un reintento NO puede volver a pedirla,
    // aunque haya perdido el detalle de sus organizaciones.
    assert.equal(result.document.entries[0].status, 'succeeded');
    assert.equal(result.document.entries[0].page, 1);
    assert.equal(result.document.entries[0].organizations.length, 0);
  });
});
