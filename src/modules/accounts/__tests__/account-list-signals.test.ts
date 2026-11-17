/**
 * «Lista de empresas» (dueño 17-11): contactos aprobados / por revisar /
 * rechazados, última actividad (la más reciente entre HubSpot y SellUp),
 * próxima actividad agendada y estado comercial en HubSpot. Sin red ni base.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAccountListSignals,
  candidateAccountId,
  commercialStatusFromAvailability,
  enrichmentRunStatusLabel,
  lastActivityOf,
  latestIso,
  type AccountActivityRows,
} from '../list-signals';
import { describeAccountOwnerCheck } from '../account-owner-hubspot';
import {
  hubSpotSignalFromProperties,
  readHubSpotAccountListSignals,
  resetHubSpotAccountListSignalsCache,
} from '@/server/integrations/hubspot-account-list-signals.server';
import {
  buildHubSpotOwnerDirectory,
  HUBSPOT_CLIENT_LIFECYCLE_VALUE,
} from '@/server/integrations/hubspot-free-company-policy';
import { resetHubSpotOwnerDirectoryCache } from '@/server/integrations/hubspot-free-company-pool.server';

const NOW = new Date('2026-11-17T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function rows(overrides: Partial<AccountActivityRows> = {}): AccountActivityRows {
  return {
    accounts: [
      { id: 'a1', created_at: '2026-10-01T10:00:00Z' },
      { id: 'a2', created_at: '2026-11-01T10:00:00Z' },
    ],
    contacts: [],
    runs: [],
    candidates: [],
    packs: [],
    comments: [],
    audit: [],
    ...overrides,
  };
}

describe('cifras de contactos por empresa', () => {
  it('cuenta aprobados (contactos) y, de los candidatos, por revisar y rechazados', () => {
    const signals = buildAccountListSignals(
      rows({
        contacts: [
          { account_id: 'a1', created_at: '2026-10-02T10:00:00Z' },
          { account_id: 'a1', created_at: '2026-10-03T10:00:00Z' },
          { account_id: 'otra', created_at: '2026-10-03T10:00:00Z' },
        ],
        candidates: [
          { id: 'c1', status: 'pending_review', reviewedAt: null, runAccountId: 'a1', reassignedAccountId: null },
          { id: 'c2', status: 'discarded', reviewedAt: '2026-10-05T10:00:00Z', runAccountId: 'a1', reassignedAccountId: null },
          { id: 'c3', status: 'discarded', reviewedAt: '2026-10-06T10:00:00Z', runAccountId: 'a1', reassignedAccountId: null },
        ],
      }),
    );
    assert.equal(signals.a1.contactsApproved, 2);
    assert.equal(signals.a1.contactsPending, 1);
    assert.equal(signals.a1.contactsRejected, 2);
    assert.equal(signals.a2.contactsApproved, 0);
  });

  it('un candidato reasignado cuenta en la empresa nueva, no en la de su búsqueda', () => {
    const candidate = { id: 'c1', status: 'pending_review', reviewedAt: null, runAccountId: 'a1', reassignedAccountId: 'a2' };
    assert.equal(candidateAccountId(candidate), 'a2');
    // Llega dos veces (por la búsqueda de a1 y por la reasignación a a2): cuenta una.
    const signals = buildAccountListSignals(rows({ candidates: [candidate, { ...candidate }] }));
    assert.equal(signals.a1.contactsPending, 0);
    assert.equal(signals.a2.contactsPending, 1);
  });

  it('la última búsqueda de contactos es la más reciente, con su resultado', () => {
    const signals = buildAccountListSignals(
      rows({
        runs: [
          { account_id: 'a1', status: 'completed', created_at: '2026-10-10T10:00:00Z' },
          { account_id: 'a1', status: 'failed', created_at: '2026-11-10T10:00:00Z' },
        ],
      }),
    );
    assert.equal(signals.a1.lastEnrichmentAt, '2026-11-10T10:00:00Z');
    assert.equal(signals.a1.lastEnrichmentStatus, 'failed');
    assert.equal(enrichmentRunStatusLabel('failed'), 'Falló');
    assert.equal(enrichmentRunStatusLabel(null), null);
  });
});

describe('última actividad: la más reciente entre HubSpot y SellUp', () => {
  it('SellUp: creación, contactos, búsquedas, revisiones, primer contacto, comentarios y cambios', () => {
    const signals = buildAccountListSignals(
      rows({
        contacts: [{ account_id: 'a1', created_at: '2026-10-02T10:00:00Z' }],
        packs: [{ account_id: 'a1', created_at: '2026-10-20T10:00:00Z' }],
        comments: [{ account_id: 'a1', created_at: '2026-11-12T10:00:00Z' }],
        audit: [{ account_id: 'a2', created_at: '2026-11-15T10:00:00Z' }],
      }),
    );
    assert.equal(signals.a1.sellupLastActivityAt, '2026-11-12T10:00:00Z');
    assert.equal(signals.a1.comments, 1);
    assert.equal(signals.a2.sellupLastActivityAt, '2026-11-15T10:00:00Z');
  });

  it('gana la fecha más reciente y dice de dónde salió', () => {
    assert.deepEqual(
      lastActivityOf({ hubspotLastActivityAt: '2026-11-16T10:00:00.000Z', sellupLastActivityAt: '2026-11-01T10:00:00Z' }),
      { at: '2026-11-16T10:00:00.000Z', source: 'hubspot' },
    );
    assert.deepEqual(
      lastActivityOf({ hubspotLastActivityAt: '2026-10-01T10:00:00.000Z', sellupLastActivityAt: '2026-11-01T10:00:00+00:00' }),
      { at: '2026-11-01T10:00:00+00:00', source: 'sellup' },
    );
    assert.deepEqual(lastActivityOf({ hubspotLastActivityAt: null, sellupLastActivityAt: '2026-11-01T10:00:00Z' }), {
      at: '2026-11-01T10:00:00Z',
      source: 'sellup',
    });
    assert.equal(lastActivityOf({ hubspotLastActivityAt: null, sellupLastActivityAt: null }), null);
    assert.equal(latestIso('x', null, '2026-01-01T00:00:00Z'), '2026-01-01T00:00:00Z');
  });

  it('HubSpot: sin Company ID «No está en HubSpot»; con ID y sin lectura «Sin lectura»', () => {
    const signals = buildAccountListSignals(
      rows(),
      new Map([['a1', 'not_linked' as const]]),
    );
    assert.equal(signals.a1.hubspotStatus, 'not_linked');
    assert.equal(signals.a2.hubspotStatus, 'unavailable');
  });

  it('con lectura de HubSpot trae estado, última y próxima actividad', () => {
    const signals = buildAccountListSignals(
      rows(),
      new Map([
        ['a1', { status: 'free' as const, lastActivityAt: '2026-11-16T10:00:00.000Z', nextActivityAt: '2026-11-20T15:00:00.000Z' }],
      ]),
    );
    assert.equal(signals.a1.hubspotStatus, 'free');
    assert.equal(signals.a1.hubspotLastActivityAt, '2026-11-16T10:00:00.000Z');
    assert.equal(signals.a1.hubspotNextActivityAt, '2026-11-20T15:00:00.000Z');
  });
});

describe('estado comercial en HubSpot (misma regla que «empresa libre»)', () => {
  const owners = buildHubSpotOwnerDirectory(
    [
      { id: '1', firstName: 'Sales', lastName: 'Colombia' },
      { id: '3', firstName: 'Jorge', lastName: 'Gamarra' },
    ],
    [],
  );

  it('cliente, negocio abierto, actividad reciente o agendada, con dueño y libre', () => {
    assert.equal(hubSpotSignalFromProperties({ lifecyclestage: HUBSPOT_CLIENT_LIFECYCLE_VALUE }, owners, NOW).status, 'customer');
    assert.equal(hubSpotSignalFromProperties({ hs_num_open_deals: '2' }, owners, NOW).status, 'open_deal');
    assert.equal(
      hubSpotSignalFromProperties({ notes_last_updated: String(NOW.getTime() - 3 * DAY), hubspot_owner_id: '1' }, owners, NOW).status,
      'recent_activity',
    );
    assert.equal(
      hubSpotSignalFromProperties({ notes_next_activity_date: String(NOW.getTime() + DAY), hubspot_owner_id: '1' }, owners, NOW).status,
      'scheduled_activity',
    );
    assert.equal(hubSpotSignalFromProperties({ hubspot_owner_id: '3' }, owners, NOW).status, 'taken');
    assert.equal(hubSpotSignalFromProperties({ hubspot_owner_id: '1' }, owners, NOW).status, 'free');
    assert.equal(commercialStatusFromAvailability({ free: true, reason: 'no_owner' }), 'free');
  });

  it('la última actividad es la más reciente de las tres propiedades; la próxima, `notes_next_activity_date`', () => {
    const signal = hubSpotSignalFromProperties(
      {
        notes_last_updated: '2026-11-10T10:00:00.000Z',
        notes_last_contacted: '2026-11-12T10:00:00.000Z',
        hs_last_sales_activity_timestamp: '2026-11-01T10:00:00.000Z',
        notes_next_activity_date: '2026-11-25T14:00:00.000Z',
        hubspot_owner_id: '3',
      },
      owners,
      NOW,
    );
    assert.equal(signal.lastActivityAt, '2026-11-12T10:00:00.000Z');
    assert.equal(signal.nextActivityAt, '2026-11-25T14:00:00.000Z');
  });

  it('sin directorio de dueños no adivina si el dueño es persona o bolsa', () => {
    assert.equal(hubSpotSignalFromProperties({ hubspot_owner_id: '3' }, null, NOW).status, 'unavailable');
  });
});

describe('lectura de HubSpot para la lista', () => {
  beforeEach(() => {
    resetHubSpotAccountListSignalsCache();
    resetHubSpotOwnerDirectoryCache();
  });

  function fakeHubSpot(companies: Record<string, Record<string, unknown>>, calls: string[] = []) {
    return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const href = String(url);
      calls.push(href);
      if (href.includes('/crm/v3/owners')) {
        const archived = href.includes('archived=true');
        return new Response(
          JSON.stringify({ results: archived ? [] : [{ id: '3', firstName: 'Jorge', lastName: 'Gamarra' }] }),
          { status: 200 },
        );
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { inputs: Array<{ id: string }> };
      const results = body.inputs
        .filter((input) => companies[input.id])
        .map((input) => ({ id: input.id, properties: companies[input.id] }));
      return new Response(JSON.stringify({ results }), { status: results.length === body.inputs.length ? 200 : 207 });
    };
  }

  it('lee en lote; las que HubSpot no devuelve quedan «No encontrada»', async () => {
    const calls: string[] = [];
    const result = await readHubSpotAccountListSignals(['111', '222', 'no-numérico'], {
      fetchFn: fakeHubSpot({ '111': { hubspot_owner_id: '3' } }, calls),
      resolveToken: async () => 'token',
      now: NOW,
    });
    assert.equal(result.get('111')?.status, 'taken');
    assert.equal(result.get('222')?.status, 'not_found');
    assert.equal(result.has('no-numérico'), false);
    assert.equal(calls.filter((url) => url.includes('batch/read')).length, 1);
  });

  it('guarda lo leído unos minutos: la siguiente carga no vuelve a pedirlo', async () => {
    const calls: string[] = [];
    const fetchFn = fakeHubSpot({ '111': { hubspot_owner_id: '3' } }, calls);
    await readHubSpotAccountListSignals(['111'], { fetchFn, resolveToken: async () => 'token', now: NOW });
    const before = calls.length;
    const again = await readHubSpotAccountListSignals(['111'], { fetchFn, resolveToken: async () => 'token', now: NOW });
    assert.equal(again.get('111')?.status, 'taken');
    assert.equal(calls.length, before);
  });

  it('sin token o con HubSpot caído no lanza: devuelve lo que haya', async () => {
    const empty = await readHubSpotAccountListSignals(['111'], { resolveToken: async () => null, now: NOW });
    assert.equal(empty.size, 0);
    const down = await readHubSpotAccountListSignals(['111'], {
      fetchFn: async () => new Response('boom', { status: 500 }),
      resolveToken: async () => 'token',
      now: NOW,
    });
    assert.equal(down.size, 0);
  });

  it('no espera a HubSpot más del plazo', async () => {
    const started = Date.now();
    const result = await readHubSpotAccountListSignals(['111'], {
      fetchFn: () => new Promise<Response>(() => {}),
      resolveToken: async () => 'token',
      now: NOW,
      deadlineMs: 50,
    });
    assert.equal(result.size, 0);
    assert.ok(Date.now() - started < 1_000);
  });
});

describe('¿el responsable es el dueño en HubSpot?', () => {
  it('sin lectura guardada con correo: «Sin dato»', () => {
    assert.deepEqual(describeAccountOwnerCheck('u1', null), { check: 'unknown', email: null });
    assert.deepEqual(describeAccountOwnerCheck('u1', { hubspot_owner_id: '3' }), { check: 'unknown', email: null });
  });

  it('coincide, es otra persona de SellUp o no tiene usuario (la misma regla del aviso de la ficha)', () => {
    const snapshot = (sellupUserId: string | null) => ({
      hubspot_owner_id: '3',
      email: 'Jorge@Ubits.co',
      sellup_user_id: sellupUserId,
      read_at: '2026-11-01T10:00:00Z',
    });
    assert.deepEqual(describeAccountOwnerCheck('u1', snapshot('u1')), { check: 'match', email: 'jorge@ubits.co' });
    assert.deepEqual(describeAccountOwnerCheck('u1', snapshot('u2')), { check: 'other_sellup_user', email: 'jorge@ubits.co' });
    assert.deepEqual(describeAccountOwnerCheck('u1', snapshot(null)), { check: 'not_in_sellup', email: 'jorge@ubits.co' });
  });
});
