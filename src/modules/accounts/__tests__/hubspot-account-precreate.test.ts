/**
 * La empresa de una cuenta (creada a mano o desde un contacto) llega a HubSpot por la
 * misma guarda que la aprobación de prospectos: liquidación, búsqueda en vivo y falla
 * cerrada. Una coincidencia en vivo pasa a revisión, no se crea encima.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideAccountPreCreate } from '../hubspot-account-precreate';
import type { HubSpotPreCreateGuardResult } from '../../prospect-batches/hubspot-precreate-guard';
import { resolveAccountHubSpotCompany, type HubSpotCompanyResolutionDeps } from '../hubspot-company-resolution-runtime';

const HERE = dirname(fileURLToPath(import.meta.url));

const liveMatch = (companyIds: string[]): HubSpotPreCreateGuardResult => ({
  allowed: false,
  syncStatus: 'blocked_duplicate',
  reason: 'hubspot_live_match',
  companyIds,
  matchedBy: ['domain'],
});

describe('decideAccountPreCreate', () => {
  it('sólo un no_match explícito deja crear', () => {
    assert.deepEqual(decideAccountPreCreate({ allowed: true }), { ok: true });
  });

  it('una empresa en liquidación no se crea', () => {
    const decision = decideAccountPreCreate({
      allowed: false,
      syncStatus: 'blocked_inactive_or_liquidation',
      reason: 'inactive_or_liquidation_signal',
    });
    assert.deepEqual(decision, { ok: false, error: 'blocked_inactive_or_liquidation' });
  });

  it('si HubSpot no respondió no se crea', () => {
    const decision = decideAccountPreCreate({
      allowed: false,
      syncStatus: 'failed_lookup',
      reason: 'hubspot_live_check_failed',
      error: 'timeout',
    });
    assert.deepEqual(decision, { ok: false, error: 'failed_lookup' });
  });

  it('una coincidencia en vivo no se crea y se devuelve para revisión', () => {
    assert.deepEqual(decideAccountPreCreate(liveMatch(['hs-1'])), {
      ok: false,
      error: 'blocked_duplicate',
      liveMatch: { hubspotCompanyId: 'hs-1', matchedBy: ['domain'] },
    });
  });

  it('«es otra empresa»: la descartada no vuelve a bloquear', () => {
    assert.deepEqual(decideAccountPreCreate(liveMatch(['hs-1']), { rejectedCompanyIds: ['hs-1'] }), { ok: true });
  });

  it('«es otra empresa» pero aparece una distinta: esa pasa a revisión', () => {
    const decision = decideAccountPreCreate(liveMatch(['hs-1', 'hs-2']), { rejectedCompanyIds: ['hs-1'] });
    assert.equal(decision.ok, false);
    assert.equal(!decision.ok && 'liveMatch' in decision && decision.liveMatch.hubspotCompanyId, 'hs-2');
  });
});

describe('resolveAccountHubSpotCompany con coincidencia en vivo', () => {
  it('la deja pendiente de revisión en vez de fallar o crear', async () => {
    const updates: Array<{ metadata: Record<string, unknown> }> = [];
    const deps: HubSpotCompanyResolutionDeps = {
      loadAccount: async () => ({
        id: 'acc-1',
        name: 'Empresa S.A.',
        domain: 'empresa.com',
        country: 'Colombia',
        countryCode: 'CO',
        city: null,
        region: null,
        taxIdentifier: null,
        legalName: null,
        companySize: null,
        hubspotCompanyId: null,
        metadata: {},
      }),
      checkCompanyMatch: async () => ({ hubspotMatchStatus: 'no_match' as never, match: null }),
      createCompany: async () => ({
        ok: false,
        error: 'blocked_duplicate',
        liveMatch: {
          hubspotCompanyId: 'hs-1',
          name: null,
          domain: null,
          matchMethod: 'domain',
          confidence: 0,
          reason: 'hubspot_live_match',
        },
      }),
      updateAccount: async (_id, patch) => {
        updates.push(patch);
      },
      nowIso: '2026-10-26T00:00:00.000Z',
    };
    const result = await resolveAccountHubSpotCompany('acc-1', deps);
    assert.equal(result.status, 'pending_review');
    assert.equal(updates.length, 1);
    const pending = updates[0].metadata.hubspot_pending_match as Record<string, unknown>;
    assert.equal(pending.hubspot_company_id, 'hs-1');
  });
});

describe('el cableado real', () => {
  const source = readFileSync(join(HERE, '..', 'hubspot-company-resolution-wiring.ts'), 'utf8');

  it('corre la guarda antes de cada createHubSpotCompany', () => {
    const fn = source.slice(source.indexOf('async function createCompanyForAccount('));
    const guard = fn.indexOf('runHubSpotPreCreateGuard(');
    assert.ok(guard > 0);
    assert.ok(guard < fn.indexOf('createHubSpotCompany({'));
  });

  it('«es otra empresa» también pasa por la guarda', () => {
    const fn = source.slice(source.indexOf('export async function createHubSpotCompanyForAccountWired('));
    assert.ok(fn.includes('createCompanyForAccount(account, { rejectedCompanyIds: rejected })'));
  });
});
