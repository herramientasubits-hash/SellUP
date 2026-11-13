/**
 * Auditoría de permisos B (13-11) — reglas PURAS de alcance en Contactos / Agente 2.
 *
 *  - «Por revisar» (y Duplicados / Rechazados) usan la MISMA regla que el acceso por id:
 *    la búsqueda la lanzó alguien del alcance O su empresa es de alguien del alcance.
 *  - El selector de empresa de «Buscar contactos» sólo ofrece cuentas SellUp del alcance
 *    (HubSpot no se filtra).
 *  - Reasignar la empresa de un candidato exige que la cuenta DESTINO esté en el alcance.
 *  - Growth puede revelar / buscar más números / ver lo comprado / revisar un reveal trabado.
 *
 * Sin red ni base de datos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  byIsoDesc,
  CANDIDATE_SCOPE_BRANCHES,
  candidateAccountScopeOrClause,
  candidateRunEmbedForBranch,
  isContactRunInScope,
  mergeScopedCandidateRows,
} from '../candidate-scope';
import { runReassignCandidateCompany } from '../candidate-company-reassignment-core';
import { PHONE_REVEAL_AUTHORIZED_ROLE_KEYS } from '../phone-reveal-authorized-roles';
import { CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS } from '../candidate-stored-phones-authorized-roles';
import { SEARCH_MORE_PHONES_AUTHORIZED_ROLE_KEYS } from '../search-more-phones-planner';
import { MANUAL_RECOVERY_AUTHORIZED_ROLE_KEYS } from '../phone-reveal-manual-recovery-core';
import { LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS } from '../lusha-phone-fallback-core';
import {
  isSellUpMatchInScope,
  resolveCompanyForContactEnrichment,
} from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import type { SellUpAccountMatch } from '@/server/agents/contact-enrichment-toolkit/types';
import type { CompanyCandidate } from '../types';

describe('Por revisar — lista y acceso por id con la misma regla', () => {
  it('hay dos ramas: quién lanzó la búsqueda y de quién es la empresa', () => {
    assert.deepEqual([...CANDIDATE_SCOPE_BRANCHES], ['triggered_by', 'account']);
    assert.match(candidateRunEmbedForBranch('triggered_by'), /contact_enrichment_runs!inner/);
    assert.match(candidateRunEmbedForBranch('account'), /account:accounts!inner \( owner_id, created_by \)/);
    assert.equal(
      candidateAccountScopeOrClause(['u1', 'u2']),
      'owner_id.in.(u1,u2),created_by.in.(u1,u2)',
    );
  });

  it('lo que la lista une es exactamente lo que el acceso por id deja ver', () => {
    const scope = ['u-lider', 'u-vendedor'];
    const byTrigger = { triggered_by: 'u-vendedor', account_owner_id: 'u-otro', account_created_by: null };
    const byAccount = { triggered_by: 'u-otro', account_owner_id: 'u-lider', account_created_by: null };
    const neither = { triggered_by: 'u-otro', account_owner_id: 'u-otro', account_created_by: 'u-otro' };
    assert.equal(isContactRunInScope(byTrigger, scope), true);
    assert.equal(isContactRunInScope(byAccount, scope), true);
    assert.equal(isContactRunInScope(neither, scope), false);
  });

  it('unir las ramas no repite candidatos, ordena y respeta el tope', () => {
    const a = [
      { id: 'c1', created_at: '2026-11-10T00:00:00Z' },
      { id: 'c2', created_at: '2026-11-12T00:00:00Z' },
    ];
    const b = [
      { id: 'c2', created_at: '2026-11-12T00:00:00Z' },
      { id: 'c3', created_at: '2026-11-11T00:00:00Z' },
    ];
    const merged = mergeScopedCandidateRows([a, b], byIsoDesc((r) => r.created_at), 10);
    assert.deepEqual(merged.map((r) => r.id), ['c2', 'c3', 'c1']);
    assert.deepEqual(
      mergeScopedCandidateRows([a, b], byIsoDesc((r) => r.created_at), 2).map((r) => r.id),
      ['c2', 'c3'],
    );
  });

  it('byIsoDesc deja los nulos al final', () => {
    const rows = [{ at: null }, { at: '2026-01-01' }, { at: '2026-02-01' }];
    assert.deepEqual(
      [...rows].sort(byIsoDesc((r) => r.at)).map((r) => r.at),
      ['2026-02-01', '2026-01-01', null],
    );
  });
});

describe('Buscar contactos — selector de empresa sólo con cuentas del alcance', () => {
  const MINE: SellUpAccountMatch = {
    id: 'acc-mine',
    name: 'Acme Uno',
    domain: 'acme.com',
    country: 'Colombia',
    country_code: 'CO',
    hubspot_company_id: null,
    owner_id: 'u-yo',
    created_by: null,
  };
  const OTHER_TEAM: SellUpAccountMatch = { ...MINE, id: 'acc-other', name: 'Acme Dos', owner_id: 'u-otro', created_by: 'u-otro' };

  it('regla: responsable o creador en el alcance; null = sin filtro', () => {
    assert.equal(isSellUpMatchInScope(MINE, ['u-yo']), true);
    assert.equal(isSellUpMatchInScope(OTHER_TEAM, ['u-yo']), false);
    assert.equal(isSellUpMatchInScope(OTHER_TEAM, null), true);
    assert.equal(isSellUpMatchInScope({ owner_id: null, created_by: 'u-yo' }, ['u-yo']), true);
  });

  it('una cuenta de otro equipo no se ofrece; HubSpot sigue apareciendo', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { companyName: 'Acme' },
      {
        searchSellUpByAccountId: async () => null,
        searchSellUpByHubSpotId: async () => [],
        searchSellUpByDomain: async () => [],
        searchSellUpByName: async () => [MINE, OTHER_TEAM],
        searchHubSpot: async () => [{ id: 'hs-1', name: 'Acme HS', domain: 'acmehs.com', website: null, country: 'Colombia' }],
        getHubSpotCompanyById: async () => [],
        sellupScopeUserIds: ['u-yo'],
      },
    );
    const ids = result.candidates.map((c) => c.sellupAccountId ?? c.hubspotCompanyId);
    assert.deepEqual(ids, ['acc-mine', 'hs-1']);
  });

  it('por id exacto: una cuenta ajena es como si no existiera', async () => {
    const result = await resolveCompanyForContactEnrichment(
      { sellupAccountId: 'acc-other' },
      {
        searchSellUpByAccountId: async () => OTHER_TEAM,
        searchSellUpByHubSpotId: async () => [],
        searchSellUpByDomain: async () => [],
        searchSellUpByName: async () => [],
        searchHubSpot: async () => [],
        getHubSpotCompanyById: async () => [],
        sellupScopeUserIds: ['u-yo'],
      },
    );
    assert.equal(result.candidates.length, 0);
  });
});

describe('Reasignar empresa — la cuenta destino debe estar en el alcance', () => {
  const candidate = {
    id: 'cand-1',
    status: 'pending_review',
    email: null,
    enrichment_metadata: {},
    run: { account_id: null, hubspot_company_id: null, company_name: 'X', company_domain: null, country_code: null },
  };
  const sellup: CompanyCandidate = {
    source: 'sellup',
    sellupAccountId: 'acc-other',
    name: 'Otra empresa',
    domain: 'otra.com',
    countryCode: 'CO',
    matchConfidence: 1,
  };

  it('fuera del alcance ⇒ ACCOUNT_OUT_OF_SCOPE y no escribe', async () => {
    const writes: string[] = [];
    const result = await runReassignCandidateCompany('cand-1', { source: 'sellup', sellupAccountId: 'acc-other' }, {
      actorId: 'u-yo',
      nowIso: '2026-11-13T00:00:00.000Z',
      loadCandidate: async () => candidate,
      resolveCompany: async () => sellup,
      resolveOrCreateAccount: async () => ({ accountId: 'acc-x', outcome: 'created' }),
      writeCandidateMetadata: async (id) => {
        writes.push(id);
        return { updated: true };
      },
      isAccountInScope: async () => false,
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.code, 'ACCOUNT_OUT_OF_SCOPE');
    assert.deepEqual(writes, []);
  });

  it('dentro del alcance ⇒ reasigna', async () => {
    const result = await runReassignCandidateCompany('cand-1', { source: 'sellup', sellupAccountId: 'acc-other' }, {
      actorId: 'u-yo',
      nowIso: '2026-11-13T00:00:00.000Z',
      loadCandidate: async () => candidate,
      resolveCompany: async () => sellup,
      resolveOrCreateAccount: async () => ({ accountId: 'acc-x', outcome: 'created' }),
      writeCandidateMetadata: async () => ({ updated: true }),
      isAccountInScope: async (id) => id === 'acc-other',
    });
    assert.equal(result.ok, true);
  });
});

describe('Teléfonos — Growth dentro de su alcance; herramientas de admin sin cambios', () => {
  it('Growth revela, busca más números, ve lo comprado y revisa un reveal trabado', () => {
    for (const list of [
      PHONE_REVEAL_AUTHORIZED_ROLE_KEYS,
      CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS,
      SEARCH_MORE_PHONES_AUTHORIZED_ROLE_KEYS,
      MANUAL_RECOVERY_AUTHORIZED_ROLE_KEYS,
    ]) {
      assert.deepEqual([...list], ['admin', 'commercial_manager', 'commercial_lead', 'seller_bd', 'growth']);
    }
  });

  it('el fallback manual de Lusha sigue siendo de administración (no se ensancha)', () => {
    assert.equal(LUSHA_PHONE_FALLBACK_AUTHORIZED_ROLE_KEYS.includes('growth'), false);
  });
});
