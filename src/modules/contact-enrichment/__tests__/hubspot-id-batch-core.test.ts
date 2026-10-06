/**
 * AGENT2A D1 — Búsqueda por lotes con ID de HubSpot: núcleo puro.
 *
 * Parseo de la entrada (espacios, comas, repetidos, 1–10 IDs) y el recorrido por
 * empresa: resolver por ID → request → enrutado automático. Dobles en memoria:
 * sin Supabase, sin HubSpot, sin proveedores.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HUBSPOT_ID_BATCH_MAX_IDS,
  parseHubSpotIdBatchInput,
  pickCandidateForHubSpotId,
  processHubSpotIdBatchItem,
  summarizeHubSpotIdBatch,
  type HubSpotIdBatchItemDeps,
} from '../hubspot-id-batch-core';
import type { CompanyCandidate, CompanyResolutionResult } from '../types';
import type { RunAutomaticContactEnrichmentForRequestResult } from '../automatic-routing-action-core';

// ── Parseo ────────────────────────────────────────────────────────────────────

describe('parseHubSpotIdBatchInput', () => {
  it('quita todos los espacios y separa por comas (ejemplo del enunciado)', () => {
    const parsed = parseHubSpotIdBatchInput(' 65498491, 65498497 ,\n984654 ');
    assert.deepEqual(parsed, { ok: true, ids: ['65498491', '65498497', '984654'], duplicatesRemoved: 0 });
  });

  it('un espacio dentro de un ID también se elimina (queda de corrido)', () => {
    const parsed = parseHubSpotIdBatchInput('6549 8491');
    assert.deepEqual(parsed, { ok: true, ids: ['65498491'], duplicatesRemoved: 0 });
  });

  it('acepta 1 solo ID', () => {
    const parsed = parseHubSpotIdBatchInput('984654');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.ok && parsed.ids, ['984654']);
  });

  it('ignora comas sobrantes y tramos vacíos', () => {
    const parsed = parseHubSpotIdBatchInput(',111,,222,');
    assert.deepEqual(parsed, { ok: true, ids: ['111', '222'], duplicatesRemoved: 0 });
  });

  it('busca cada ID repetido una sola vez y conserva el orden', () => {
    const parsed = parseHubSpotIdBatchInput('222,111,222,111');
    assert.deepEqual(parsed, { ok: true, ids: ['222', '111'], duplicatesRemoved: 2 });
  });

  it('vacío o solo comas/espacios → empty', () => {
    assert.deepEqual(parseHubSpotIdBatchInput(''), { ok: false, reason: 'empty' });
    assert.deepEqual(parseHubSpotIdBatchInput(' , ,  '), { ok: false, reason: 'empty' });
  });

  it('rechaza lo que no sea solo dígitos (sin buscar nada)', () => {
    const parsed = parseHubSpotIdBatchInput('123,abc,45-6,abc');
    assert.deepEqual(parsed, { ok: false, reason: 'invalid', invalid: ['abc', '45-6'] });
  });

  it('el máximo es 10 IDs distintos', () => {
    assert.equal(HUBSPOT_ID_BATCH_MAX_IDS, 10);
    const ten = Array.from({ length: 10 }, (_, i) => String(1000 + i)).join(',');
    assert.equal(parseHubSpotIdBatchInput(ten).ok, true);

    const eleven = Array.from({ length: 11 }, (_, i) => String(1000 + i)).join(',');
    assert.deepEqual(parseHubSpotIdBatchInput(eleven), { ok: false, reason: 'too_many', count: 11 });
  });

  it('11 IDs con un repetido son 10 distintos: se aceptan', () => {
    const ids = Array.from({ length: 10 }, (_, i) => String(1000 + i));
    const parsed = parseHubSpotIdBatchInput([...ids, ids[0]].join(','));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.duplicatesRemoved, 1);
  });
});

// ── Dobles ────────────────────────────────────────────────────────────────────

function resolution(candidates: CompanyCandidate[], skippedHubSpot = false): CompanyResolutionResult {
  return {
    resolved: candidates.length > 0,
    singleMatch: candidates.length === 1,
    candidates,
    selected: candidates.length === 1 ? candidates[0] : undefined,
    skippedHubSpot,
  };
}

function routing(
  overrides: Partial<RunAutomaticContactEnrichmentForRequestResult> = {},
): RunAutomaticContactEnrichmentForRequestResult {
  return {
    success: true,
    status: 'no_fallback_needed',
    automaticRoutingEnabled: true,
    fallbackExecuted: false,
    attempt1AttemptId: 'att-1',
    attempt2AttemptId: null,
    blockedReason: null,
    reusedExistingCandidates: 0,
    providerCandidatesCreated: { apollo: 3, lusha: null },
    failedProviders: [],
    ...overrides,
  } as RunAutomaticContactEnrichmentForRequestResult;
}

const HUBSPOT_ACME: CompanyCandidate = {
  source: 'hubspot',
  hubspotCompanyId: '65498491',
  name: 'Acme SAS',
  domain: 'acme.co',
  country: 'Colombia',
  countryCode: 'CO',
  matchConfidence: 1,
};

function makeDeps(overrides: Partial<HubSpotIdBatchItemDeps> = {}) {
  const calls: string[] = [];
  const deps: HubSpotIdBatchItemDeps = {
    resolveCompany: async (id) => {
      calls.push(`resolve:${id}`);
      return resolution([HUBSPOT_ACME]);
    },
    createRequest: async (candidate) => {
      calls.push(`request:${candidate.name}`);
      return { success: true, requestId: 'req-1' };
    },
    loadRequestAccountId: async (requestId) => {
      calls.push(`account:${requestId}`);
      return 'acc-1';
    },
    countPendingCandidatesForAccount: async (accountId) => {
      calls.push(`pending:${accountId}`);
      return 2;
    },
    runAutomaticRouting: async (requestId) => {
      calls.push(`routing:${requestId}`);
      return routing();
    },
    ...overrides,
  };
  return { deps, calls };
}

// ── Recorrido por empresa ─────────────────────────────────────────────────────

describe('processHubSpotIdBatchItem', () => {
  it('empresa encontrada: request + pendientes previos ANTES de buscar + contactos nuevos', async () => {
    const { deps, calls } = makeDeps({
      runAutomaticRouting: async (requestId) => {
        calls.push(`routing:${requestId}`);
        return routing({ providerCandidatesCreated: { apollo: 3, lusha: 2 } });
      },
    });
    const result = await processHubSpotIdBatchItem('65498491', deps);

    assert.deepEqual(calls, [
      'resolve:65498491',
      'request:Acme SAS',
      'account:req-1',
      'pending:acc-1',
      'routing:req-1',
    ]);
    assert.deepEqual(result, {
      hubspotCompanyId: '65498491',
      status: 'processed',
      name: 'Acme SAS',
      country: 'Colombia',
      accountId: 'acc-1',
      contactsFound: 5,
      previousPendingContacts: 2,
      routingDisabled: false,
      errorMessage: null,
    });
  });

  it('ID inexistente en SellUp y HubSpot: se salta sin crear request ni gastar créditos', async () => {
    const { deps, calls } = makeDeps({
      resolveCompany: async (id) => {
        calls.push(`resolve:${id}`);
        return resolution([]);
      },
    });
    const result = await processHubSpotIdBatchItem('999999999999', deps);
    assert.equal(result.status, 'not_found');
    assert.deepEqual(calls, ['resolve:999999999999']);
  });

  it('HubSpot caído no se confunde con «no existe»: queda como error', async () => {
    const { deps, calls } = makeDeps({
      resolveCompany: async () => resolution([], true),
    });
    const result = await processHubSpotIdBatchItem('65498491', deps);
    assert.equal(result.status, 'error');
    assert.match(result.errorMessage ?? '', /HubSpot/);
    assert.ok(!calls.some((c) => c.startsWith('request:')));
  });

  it('si la request no se crea, no se busca y se informa el motivo', async () => {
    const { deps, calls } = makeDeps({
      createRequest: async () => ({ success: false, error: 'Ya hay un enriquecimiento en curso' }),
    });
    const result = await processHubSpotIdBatchItem('65498491', deps);
    assert.equal(result.status, 'error');
    assert.equal(result.name, 'Acme SAS');
    assert.equal(result.errorMessage, 'Ya hay un enriquecimiento en curso');
    assert.ok(!calls.some((c) => c.startsWith('routing:')));
  });

  it('enrutado bloqueado → error con el motivo, conservando nombre y pendientes previos', async () => {
    const { deps } = makeDeps({
      runAutomaticRouting: async () => routing({ success: false, blockedReason: 'budget_exceeded' }),
    });
    const result = await processHubSpotIdBatchItem('65498491', deps);
    assert.equal(result.status, 'error');
    assert.equal(result.errorMessage, 'budget_exceeded');
    assert.equal(result.previousPendingContacts, 2);
  });

  it('búsqueda automática apagada: se marca, 0 contactos', async () => {
    const { deps } = makeDeps({
      runAutomaticRouting: async () =>
        routing({ automaticRoutingEnabled: false, providerCandidatesCreated: { apollo: null, lusha: null } }),
    });
    const result = await processHubSpotIdBatchItem('65498491', deps);
    assert.equal(result.status, 'processed');
    assert.equal(result.routingDisabled, true);
    assert.equal(result.contactsFound, 0);
  });

  it('una excepción inesperada no tumba el lote: fila error', async () => {
    const { deps } = makeDeps({
      resolveCompany: async () => {
        throw new Error('boom');
      },
    });
    const result = await processHubSpotIdBatchItem('65498491', deps);
    assert.equal(result.status, 'error');
    assert.equal(result.errorMessage, 'boom');
  });

  it('el país cae al código ISO si es lo único que hay', async () => {
    const { deps } = makeDeps({
      resolveCompany: async () =>
        resolution([{ ...HUBSPOT_ACME, source: 'sellup', sellupAccountId: 'acc-9', country: null, countryCode: 'MX' }]),
      loadRequestAccountId: async () => null,
    });
    const result = await processHubSpotIdBatchItem('65498491', deps);
    assert.equal(result.country, 'MX');
    assert.equal(result.accountId, 'acc-9');
  });
});

describe('pickCandidateForHubSpotId', () => {
  it('prefiere la cuenta de SellUp vinculada al ID', () => {
    const sellup: CompanyCandidate = { ...HUBSPOT_ACME, source: 'sellup', sellupAccountId: 'acc-1' };
    assert.equal(pickCandidateForHubSpotId('65498491', resolution([HUBSPOT_ACME, sellup])), sellup);
  });

  it('ignora candidatos con otro ID', () => {
    assert.equal(
      pickCandidateForHubSpotId('1', resolution([{ ...HUBSPOT_ACME, hubspotCompanyId: '2' }])),
      null,
    );
  });
});

describe('summarizeHubSpotIdBatch', () => {
  it('separa procesadas, no encontradas y errores, y suma los contactos', async () => {
    const { deps } = makeDeps();
    const ok = await processHubSpotIdBatchItem('65498491', deps);
    const summary = summarizeHubSpotIdBatch([
      ok,
      { ...ok, hubspotCompanyId: '777', status: 'not_found', name: null, contactsFound: 0, previousPendingContacts: 0 },
      { ...ok, hubspotCompanyId: '888', status: 'error', errorMessage: 'x' },
    ]);
    assert.equal(summary.processed.length, 1);
    assert.deepEqual(summary.notFoundIds, ['777']);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.totalContactsFound, 3);
    assert.equal(summary.totalPreviousPending, 2);
  });
});
