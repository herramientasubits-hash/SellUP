// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — el candidato de la búsqueda puntual se crea SIEMPRE
// (con o sin empresa) en cuanto la búsqueda encuentra a la persona.
// Dobles en memoria: sin Supabase, sin proveedores, sin HubSpot. Datos ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  QUICK_SEARCH_CREATE_COPY,
  QUICK_SEARCH_NO_COMPANY_NAME,
  buildUnassignedCompany,
  createQuickSearchCandidate,
  type QuickSearchCandidateCreationDeps,
  type QuickSearchCandidateRow,
} from '../contact-quick-search-candidate-core';
import type { LinkedinProviderProfile, SearchedContactData } from '../linkedin-contact-search-core';
import type { CompanyCandidate } from '../types';

const CANONICAL = 'https://www.linkedin.com/in/persona-ficticia-123';

function profile(overrides: Partial<LinkedinProviderProfile> = {}): LinkedinProviderProfile {
  return {
    provider: 'apollo',
    sourceContactId: 'apollo-person-1',
    firstName: 'Ana',
    lastName: 'Ficticia',
    fullName: 'Ana Ficticia',
    title: 'Directora de Talento',
    seniority: 'director',
    country: 'Colombia',
    email: 'ana@empresa-ficticia.test',
    providerCompanyName: 'Empresa Ficticia SAS',
    providerCompanyDomain: 'empresa-ficticia.test',
    providerCompanyWebsiteUrl: 'https://empresa-ficticia.test',
    phoneAvailable: null,
    linkedinUrl: CANONICAL,
    ...overrides,
  };
}

function data(overrides: Partial<SearchedContactData> = {}): SearchedContactData {
  return {
    entryMode: 'linkedin_single',
    linkedinUrl: CANONICAL,
    linkedinSlug: 'persona-ficticia-123',
    profile: profile(),
    hubspotContact: null,
    providersCalled: ['apollo'],
    creditsSpent: 1,
    searchedAt: '2026-10-29T12:00:00.000Z',
    ...overrides,
  };
}

const HUBSPOT_COMPANY: CompanyCandidate = {
  source: 'hubspot',
  name: 'Empresa Ficticia SAS',
  domain: 'empresa-ficticia.test',
  hubspotCompanyId: '65498491',
  matchConfidence: 1,
};

function makeDeps(overrides: Partial<QuickSearchCandidateCreationDeps> = {}) {
  const calls: string[] = [];
  const rows: QuickSearchCandidateRow[] = [];
  const requested: CompanyCandidate[] = [];
  const finalized: Array<Parameters<QuickSearchCandidateCreationDeps['finalizeRun']>[0]> = [];
  const deps: QuickSearchCandidateCreationDeps = {
    findPendingCandidateByLinkedin: async () => null,
    findPendingCandidateByEmail: async () => null,
    createRequest: async (company) => {
      calls.push(`request:${company.source}:${company.name}`);
      requested.push(company);
      return { success: true, requestId: 'req-1' };
    },
    loadRequestAccountId: async () => 'acc-1',
    createRun: async ({ requestId, provider }) => {
      calls.push(`run:${requestId}:${provider}`);
      return { runId: 'run-1' };
    },
    insertCandidate: async (row) => {
      calls.push('insert');
      rows.push(row);
      return { candidateId: 'cand-1' };
    },
    finalizeRun: async (input) => {
      calls.push(`finalize:${input.runId}`);
      finalized.push(input);
    },
    ...overrides,
  };
  return { deps, calls, rows, requested, finalized };
}

describe('createQuickSearchCandidate — con empresa', () => {
  it('crea request, run y candidato pending_review con la empresa resuelta', async () => {
    const { deps, calls, rows, finalized } = makeDeps();
    const result = await createQuickSearchCandidate(
      { data: data(), company: HUBSPOT_COMPANY, companyMatchedBy: 'hubspot_domain' },
      deps,
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.accountId, 'acc-1');
    assert.equal(result.ok && result.company?.name, 'Empresa Ficticia SAS');
    assert.deepEqual(calls, ['request:hubspot:Empresa Ficticia SAS', 'run:req-1:apollo', 'insert', 'finalize:run-1']);
    const row = rows[0];
    assert.equal(row.status, 'pending_review');
    assert.equal(row.linkedin_url, CANONICAL);
    assert.equal(row.phone, null);
    assert.equal(row.source, 'apollo');
    assert.deepEqual(row.enrichment_metadata.company_auto_assignment, {
      status: 'assigned',
      matched_by: 'hubspot_domain',
      company_name: 'Empresa Ficticia SAS',
    });
    assert.equal(finalized[0].companyMatchedBy, 'hubspot_domain');
    assert.equal(finalized[0].entryMode, 'linkedin_single');
  });

  it('la empresa asignada no coincide con la del proveedor ⇒ possible_mismatch', async () => {
    const { deps, rows } = makeDeps();
    const other: CompanyCandidate = { ...HUBSPOT_COMPANY, name: 'Compañía Distinta', domain: 'distinta.test', hubspotCompanyId: '777' };
    const result = await createQuickSearchCandidate({ data: data(), company: other, companyMatchedBy: 'hubspot_name' }, deps);
    assert.equal(result.ok && result.companyConsistency?.status, 'possible_mismatch');
    assert.equal((rows[0].enrichment_metadata.company_consistency as { status: string }).status, 'possible_mismatch');
  });

  it('una empresa de HubSpot sin cuenta resuelta NO detiene la creación', async () => {
    const { deps, calls } = makeDeps({ loadRequestAccountId: async () => null });
    const result = await createQuickSearchCandidate(
      { data: data(), company: HUBSPOT_COMPANY, companyMatchedBy: 'hubspot_domain' },
      deps,
    );
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.accountId, null);
    assert.ok(calls.includes('insert'));
  });
});

describe('createQuickSearchCandidate — sin empresa (decisión A: siempre se crea)', () => {
  it('sin coincidencia única ⇒ request «manual» con lo que dice la fuente y candidato sin empresa', async () => {
    const { deps, requested, rows, calls } = makeDeps();
    const result = await createQuickSearchCandidate({ data: data(), company: null, companyMatchedBy: null }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.company, null);
    assert.equal(result.ok && result.accountId, null);
    assert.equal(requested[0].source, 'manual');
    assert.equal(requested[0].name, 'Empresa Ficticia SAS');
    assert.equal(requested[0].domain, 'empresa-ficticia.test');
    assert.equal(requested[0].sellupAccountId, undefined);
    assert.equal(requested[0].hubspotCompanyId, undefined);
    assert.ok(calls.includes('insert'));
    assert.deepEqual(rows[0].enrichment_metadata.company_auto_assignment, { status: 'unassigned' });
    assert.equal('company_consistency' in rows[0].enrichment_metadata, false);
  });

  it('una empresa «manual» o sin ids se trata como sin empresa', async () => {
    for (const company of [
      { ...HUBSPOT_COMPANY, source: 'manual' as const, hubspotCompanyId: undefined },
      { ...HUBSPOT_COMPANY, hubspotCompanyId: undefined },
    ]) {
      const { deps, requested } = makeDeps();
      const result = await createQuickSearchCandidate({ data: data(), company, companyMatchedBy: 'hubspot_name' }, deps);
      assert.equal(result.ok && result.company, null);
      assert.equal(requested[0].source, 'manual');
    }
  });

  it('la empresa «manual» no usa un dominio genérico y nombra la ausencia', () => {
    const company = buildUnassignedCompany(profile({ providerCompanyName: null, providerCompanyDomain: 'gmail.com' }));
    assert.equal(company.name, QUICK_SEARCH_NO_COMPANY_NAME);
    assert.equal(company.domain, null);
  });
});

describe('createQuickSearchCandidate — HubSpot y correo', () => {
  it('un contacto de HubSpot queda como «Primero HubSpot» con su teléfono y vínculo', async () => {
    const { deps, rows, calls } = makeDeps();
    const hubspotData = data({
      entryMode: 'email_single',
      linkedinUrl: null,
      linkedinSlug: null,
      profile: profile({
        provider: 'hubspot',
        sourceContactId: 'hs-1',
        linkedinUrl: null,
        phone: '+57 300 000 0000',
        providerCompanyName: null,
        providerCompanyDomain: null,
        providerCompanyWebsiteUrl: null,
      }),
      hubspotContact: { id: 'hs-1', associatedCompanyId: '65498491' },
      providersCalled: [],
      creditsSpent: 0,
    });
    const result = await createQuickSearchCandidate(
      { data: hubspotData, company: HUBSPOT_COMPANY, companyMatchedBy: 'hubspot_contact_company' },
      deps,
    );
    assert.equal(result.ok, true);
    const row = rows[0];
    assert.equal(row.source, 'hubspot');
    assert.equal(row.source_contact_id, 'hs-1');
    assert.equal(row.matched_hubspot_contact_id, 'hs-1');
    assert.equal(row.phone, '+57 300 000 0000');
    assert.equal(row.confidence, 1);
    assert.equal(row.enrichment_metadata.hubspot_first, true);
    assert.equal(row.enrichment_metadata.entry_mode, 'email_single');
    assert.equal(row.enrichment_metadata.email_source, 'user_input');
    // El run sólo admite apollo|lusha como intención; un candidato de HubSpot no gastó.
    assert.ok(calls.includes('run:req-1:apollo'));
  });

  it('un proveedor nunca escribe teléfono en el candidato', async () => {
    const { deps, rows } = makeDeps();
    await createQuickSearchCandidate(
      { data: data({ profile: profile({ phone: '+1 555' }) }), company: null, companyMatchedBy: null },
      deps,
    );
    assert.equal(rows[0].phone, null);
  });

  it('si ya entró a «Por revisar» (por LinkedIn o por correo), no se duplica', async () => {
    for (const overrides of [
      { findPendingCandidateByLinkedin: async () => ({ fullName: 'Ana', companyName: null }) },
      { findPendingCandidateByEmail: async () => ({ fullName: 'Ana', companyName: null }) },
    ]) {
      const { deps, calls } = makeDeps(overrides);
      const result = await createQuickSearchCandidate({ data: data(), company: HUBSPOT_COMPANY, companyMatchedBy: null }, deps);
      assert.deepEqual(result, { ok: false, error: 'already_pending', message: QUICK_SEARCH_CREATE_COPY.already_pending });
      assert.deepEqual(calls, []);
    }
  });

  it('fallos de request, run o inserción se informan sin seguir', async () => {
    const cases: Array<[Partial<QuickSearchCandidateCreationDeps>, string]> = [
      [{ createRequest: async () => ({ success: false }) }, 'request_failed'],
      [{ createRun: async () => ({ runId: null }) }, 'run_failed'],
      [{ insertCandidate: async () => ({ candidateId: null }) }, 'insert_failed'],
    ];
    for (const [overrides, error] of cases) {
      const { deps, calls } = makeDeps(overrides);
      const result = await createQuickSearchCandidate({ data: data(), company: null, companyMatchedBy: null }, deps);
      assert.equal(result.ok === false && result.error, error);
      assert.equal(calls.some((c) => c.startsWith('finalize')), false);
    }
  });

  it('crear el candidato no llama a ningún proveedor (las deps no tienen cómo)', () => {
    const { deps } = makeDeps();
    assert.equal('lookupApollo' in deps, false);
    assert.equal('lookupLusha' in deps, false);
  });
});
