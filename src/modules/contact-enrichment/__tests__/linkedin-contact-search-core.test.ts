// AGENT2A-LINKEDIN-CONTACT-SEARCH (F2) — núcleo de «Buscar contacto por LinkedIn».
//
// Dobles en memoria: sin Supabase, sin Apollo, sin Lusha, sin HubSpot, sin créditos.
// URLs, nombres y correos ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LINKEDIN_CREATE_COPY,
  LINKEDIN_SEARCH_COPY,
  createLinkedinContactCandidate,
  searchContactByLinkedin,
  type LinkedinCandidateCreationDeps,
  type LinkedinCandidateRow,
  type LinkedinProviderLookup,
  type LinkedinProviderProfile,
  type LinkedinProviderUsage,
  type LinkedinSearchDeps,
  type LinkedinSearchPreviewData,
} from '../linkedin-contact-search-core';
import type { CompanyCandidate } from '../types';

const URL_OK = 'https://es.linkedin.com/in/persona-ficticia-123/?trk=x';
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
    ...overrides,
  };
}

const APOLLO_USAGE: LinkedinProviderUsage = {
  provider_key: 'apollo',
  operation_key: 'person_match',
  credits_used: 1,
  status: 'success',
  results_returned: 1,
};
const LUSHA_USAGE: LinkedinProviderUsage[] = [
  { provider_key: 'lusha', operation_key: 'lusha_contact_search', credits_used: null, status: 'success', results_returned: 1 },
  { provider_key: 'lusha', operation_key: 'lusha_contact_enrich', credits_used: 1, status: 'success', results_returned: 1 },
];

function makeSearchDeps(overrides: Partial<LinkedinSearchDeps> = {}) {
  const calls: string[] = [];
  const logged: LinkedinProviderUsage[] = [];
  const signed: LinkedinSearchPreviewData[] = [];
  const deps: LinkedinSearchDeps = {
    isEnabled: () => true,
    findSellUpContactByLinkedin: async (slug) => {
      calls.push(`sellup-linkedin:${slug}`);
      return null;
    },
    findPendingCandidateByLinkedin: async (slug) => {
      calls.push(`pending-linkedin:${slug}`);
      return null;
    },
    lookupApollo: async (url) => {
      calls.push(`apollo:${url}`);
      return { kind: 'found', profile: profile(), usage: [APOLLO_USAGE] };
    },
    lookupLusha: async (url) => {
      calls.push(`lusha:${url}`);
      return { kind: 'found', profile: profile({ provider: 'lusha', sourceContactId: 'lusha-1' }), usage: LUSHA_USAGE };
    },
    findSellUpContactByEmail: async (email) => {
      calls.push(`sellup-email:${email}`);
      return null;
    },
    findHubSpotContactByEmail: async (email) => {
      calls.push(`hubspot-email:${email}`);
      return null;
    },
    logUsage: async (entry) => {
      logged.push(entry);
    },
    signPreview: (data) => {
      signed.push(data);
      return 'signed-token';
    },
    nowIso: () => '2026-10-26T12:00:00.000Z',
    ...overrides,
  };
  return { deps, calls, logged, signed };
}

const providerCalls = (calls: string[]) => calls.filter((c) => c.startsWith('apollo:') || c.startsWith('lusha:'));

describe('searchContactByLinkedin — validación', () => {
  it('URL inválida o de empresa: mensaje claro y ningún proveedor (cero créditos)', async () => {
    for (const raw of ['https://www.linkedin.com/company/empresa-ficticia', 'https://example.test/in/x', '', 42]) {
      const { deps, calls, logged } = makeSearchDeps();
      const result = await searchContactByLinkedin(raw, deps);
      assert.equal(result.status, 'invalid_url');
      assert.deepEqual(calls, []);
      assert.deepEqual(logged, []);
    }
    const { deps } = makeSearchDeps();
    const company = await searchContactByLinkedin('linkedin.com/company/empresa-ficticia', deps);
    assert.equal(company.status === 'invalid_url' && company.reason, 'company_page');
    assert.match(company.status === 'invalid_url' ? company.message : '', /página de empresa/);
  });

  it('con la bandera apagada no hace nada', async () => {
    const { deps, calls } = makeSearchDeps({ isEnabled: () => false });
    assert.deepEqual(await searchContactByLinkedin(URL_OK, deps), { status: 'disabled' });
    assert.deepEqual(calls, []);
  });
});

describe('searchContactByLinkedin — deduplicación antes de gastar', () => {
  it('un contacto de SellUp con ese LinkedIn no llama a Apollo ni a Lusha', async () => {
    const { deps, calls, logged } = makeSearchDeps({
      findSellUpContactByLinkedin: async () => ({ fullName: 'Ana Ficticia', companyName: 'Empresa Ficticia SAS' }),
    });
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status, 'already_known');
    assert.equal(result.status === 'already_known' && result.where, 'sellup_contact');
    assert.equal(result.status === 'already_known' && result.creditsSpent, false);
    assert.equal(result.status === 'already_known' && result.message, LINKEDIN_SEARCH_COPY.knownSellUpContact);
    assert.deepEqual(providerCalls(calls), []);
    assert.deepEqual(logged, []);
  });

  it('un candidato por revisar con ese LinkedIn tampoco gasta', async () => {
    const { deps, calls } = makeSearchDeps({
      findPendingCandidateByLinkedin: async () => ({ fullName: 'Ana Ficticia', companyName: null }),
    });
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status === 'already_known' && result.where, 'sellup_pending_candidate');
    assert.deepEqual(providerCalls(calls), []);
  });

  it('se busca por el slug normalizado (misma clave en los dos lados)', async () => {
    const { deps, calls } = makeSearchDeps();
    await searchContactByLinkedin(URL_OK, deps);
    assert.ok(calls.includes('sellup-linkedin:persona-ficticia-123'));
    assert.ok(calls.includes(`apollo:${CANONICAL}`));
  });
});

describe('searchContactByLinkedin — Apollo primero, Lusha si no trae datos', () => {
  it('Apollo con email: no se llama a Lusha', async () => {
    const { deps, calls, logged, signed } = makeSearchDeps();
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status, 'found');
    assert.deepEqual(providerCalls(calls), [`apollo:${CANONICAL}`]);
    assert.deepEqual(logged, [APOLLO_USAGE]);
    assert.equal(signed[0].profile.provider, 'apollo');
    assert.equal(signed[0].creditsSpent, 1);
    assert.equal(signed[0].linkedinUrl, CANONICAL);
  });

  it('Apollo no encuentra: va a Lusha y registra el gasto de los dos', async () => {
    const { deps, calls, logged, signed } = makeSearchDeps({
      lookupApollo: async (url) => {
        calls.push(`apollo:${url}`);
        return { kind: 'not_found', usage: [APOLLO_USAGE] };
      },
    });
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status, 'found');
    assert.deepEqual(providerCalls(calls), [`apollo:${CANONICAL}`, `lusha:${CANONICAL}`]);
    assert.deepEqual(logged, [APOLLO_USAGE, ...LUSHA_USAGE]);
    assert.equal(signed[0].profile.provider, 'lusha');
    assert.deepEqual(signed[0].providersCalled, ['apollo', 'lusha']);
    // Un costo desconocido (búsqueda de Lusha) deja el total desconocido: nunca un 0 inventado.
    assert.equal(signed[0].creditsSpent, null);
  });

  it('Apollo encuentra a la persona SIN email: Lusha completa', async () => {
    const { deps, calls, signed } = makeSearchDeps({
      lookupApollo: async (url) => {
        calls.push(`apollo:${url}`);
        return { kind: 'found', profile: profile({ email: null }), usage: [APOLLO_USAGE] };
      },
    });
    await searchContactByLinkedin(URL_OK, deps);
    assert.deepEqual(providerCalls(calls), [`apollo:${CANONICAL}`, `lusha:${CANONICAL}`]);
    assert.equal(signed[0].profile.provider, 'lusha');
  });

  it('ninguno trae email: se muestra el perfil de Apollo sin correo', async () => {
    const { deps, signed } = makeSearchDeps({
      lookupApollo: async () => ({ kind: 'found', profile: profile({ email: null }), usage: [APOLLO_USAGE] }),
      lookupLusha: async () => ({ kind: 'not_found', usage: LUSHA_USAGE.slice(0, 1) }),
    });
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status, 'found');
    assert.equal(result.status === 'found' && result.hubspotCheck, 'skipped_no_email');
    assert.equal(signed[0].profile.provider, 'apollo');
  });

  it('perfil no encontrado: «No encontramos datos para este perfil», sin crear nada', async () => {
    const { deps, signed } = makeSearchDeps({
      lookupApollo: async () => ({ kind: 'not_found', usage: [APOLLO_USAGE] }),
      lookupLusha: async () => ({ kind: 'not_found', usage: LUSHA_USAGE.slice(0, 1) }),
    });
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.deepEqual(result, { status: 'not_found', message: LINKEDIN_SEARCH_COPY.notFound, creditsSpent: true });
    assert.deepEqual(signed, []);
  });

  it('error del proveedor: mensaje distinto de «no encontrado»', async () => {
    const error: LinkedinProviderLookup = { kind: 'error', message: 'HTTP_500', usage: [] };
    const { deps } = makeSearchDeps({
      lookupApollo: async () => error,
      lookupLusha: async () => ({ kind: 'not_found', usage: [] }),
    });
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status, 'provider_error');
    assert.notEqual(result.status === 'provider_error' && result.message, LINKEDIN_SEARCH_COPY.notFound);
  });

  it('ningún proveedor disponible: error del proveedor (no «no encontrado»)', async () => {
    const { deps, logged } = makeSearchDeps({
      lookupApollo: async () => ({ kind: 'unavailable', usage: [] }),
      lookupLusha: async () => ({ kind: 'unavailable', usage: [] }),
    });
    assert.equal((await searchContactByLinkedin(URL_OK, deps)).status, 'provider_error');
    assert.deepEqual(logged, []);
  });
});

describe('searchContactByLinkedin — el email encontrado contra SellUp y HubSpot', () => {
  it('el email ya es contacto de SellUp: no hay vista previa ni firma', async () => {
    const { deps, calls, signed } = makeSearchDeps({
      findSellUpContactByEmail: async () => ({ fullName: 'Ana Ficticia', companyName: 'Otra SAS' }),
    });
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status === 'already_known' && result.matchedBy, 'email');
    assert.equal(result.status === 'already_known' && result.creditsSpent, true);
    assert.ok(!calls.some((c) => c.startsWith('hubspot-email')));
    assert.deepEqual(signed, []);
  });

  it('el email ya existe en HubSpot: no se crea candidato y se avisa del gasto', async () => {
    const { deps, signed } = makeSearchDeps({
      findHubSpotContactByEmail: async () => ({ fullName: 'Ana Ficticia', companyName: null }),
    });
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status === 'already_known' && result.where, 'hubspot_contact');
    assert.equal(result.status === 'already_known' && result.message, LINKEDIN_SEARCH_COPY.knownHubSpotByEmail);
    assert.deepEqual(signed, []);
  });

  it('HubSpot caído no bloquea: vista previa con el aviso', async () => {
    const { deps } = makeSearchDeps({
      findHubSpotContactByEmail: async () => {
        throw new Error('HTTP 503');
      },
    });
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status === 'found' && result.hubspotCheck, 'unavailable');
  });

  it('la vista previa trae nombre, cargo, empresa del proveedor y datos; sin la URL', async () => {
    const { deps } = makeSearchDeps();
    const result = await searchContactByLinkedin(URL_OK, deps);
    assert.equal(result.status, 'found');
    if (result.status !== 'found') return;
    assert.deepEqual(result.preview, {
      provider: 'apollo',
      fullName: 'Ana Ficticia',
      title: 'Directora de Talento',
      providerCompanyName: 'Empresa Ficticia SAS',
      providerCompanyDomain: 'empresa-ficticia.test',
      email: 'ana@empresa-ficticia.test',
      phoneAvailable: null,
      suggestedCompanyQuery: 'empresa-ficticia.test',
    });
    assert.equal(JSON.stringify(result.preview).includes('linkedin'), false);
    assert.equal(result.token, 'signed-token');
  });
});

// ── Paso 2 ────────────────────────────────────────────────────────────────────

const PREVIEW: LinkedinSearchPreviewData = {
  linkedinUrl: CANONICAL,
  linkedinSlug: 'persona-ficticia-123',
  profile: profile(),
  providersCalled: ['apollo'],
  creditsSpent: 1,
  searchedAt: '2026-10-26T12:00:00.000Z',
};

const HUBSPOT_COMPANY: CompanyCandidate = {
  source: 'hubspot',
  name: 'Empresa Ficticia SAS',
  domain: 'empresa-ficticia.test',
  hubspotCompanyId: '65498491',
  matchConfidence: 1,
};

function makeCreateDeps(overrides: Partial<LinkedinCandidateCreationDeps> = {}) {
  const calls: string[] = [];
  const rows: LinkedinCandidateRow[] = [];
  const requests = new Map<string, string | null>();
  const runs = new Map<string, { requestId: string; accountId: string | null }>();
  const deps: LinkedinCandidateCreationDeps = {
    isEnabled: () => true,
    verifyPreview: (token) => (token === 'ok' ? { ok: true, data: PREVIEW } : { ok: false, expired: token === 'expired' }),
    findPendingCandidateByLinkedin: async () => null,
    createRequest: async (company) => {
      calls.push(`request:${company.name}`);
      requests.set('req-1', 'acc-1');
      return { success: true, requestId: 'req-1' };
    },
    loadRequestAccountId: async (requestId) => requests.get(requestId) ?? null,
    createRun: async ({ requestId, provider }) => {
      calls.push(`run:${requestId}:${provider}`);
      // Como el RPC: el run copia el account_id de su request.
      runs.set('run-1', { requestId, accountId: requests.get(requestId) ?? null });
      return { runId: 'run-1' };
    },
    insertCandidate: async (row) => {
      calls.push('insert');
      rows.push(row);
      return { candidateId: 'cand-1' };
    },
    finalizeRun: async ({ runId }) => {
      calls.push(`finalize:${runId}`);
    },
    ...overrides,
  };
  return { deps, calls, rows, runs };
}

describe('createLinkedinContactCandidate', () => {
  it('no se crea un candidato sin empresa (ni manual)', async () => {
    for (const company of [null, undefined, { ...HUBSPOT_COMPANY, source: 'manual' as const, hubspotCompanyId: undefined }, { ...HUBSPOT_COMPANY, hubspotCompanyId: undefined }]) {
      const { deps, calls } = makeCreateDeps();
      const result = await createLinkedinContactCandidate({ token: 'ok', company }, deps);
      assert.deepEqual(result, { ok: false, error: 'company_required', message: LINKEDIN_CREATE_COPY.company_required });
      assert.deepEqual(calls, []);
    }
  });

  it('el run nace con account_id y el candidato queda pending_review con el LinkedIn canónico', async () => {
    const { deps, calls, rows, runs } = makeCreateDeps();
    const result = await createLinkedinContactCandidate({ token: 'ok', company: HUBSPOT_COMPANY }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.accountId, 'acc-1');
    assert.deepEqual(calls, ['request:Empresa Ficticia SAS', 'run:req-1:apollo', 'insert', 'finalize:run-1']);
    assert.equal(runs.get('run-1')?.accountId, 'acc-1');
    const row = rows[0];
    assert.equal(row.enrichment_run_id, 'run-1');
    assert.equal(row.status, 'pending_review');
    assert.equal(row.source, 'apollo');
    assert.equal(row.source_contact_id, 'apollo-person-1');
    assert.equal(row.linkedin_url, CANONICAL);
    assert.equal(row.phone, null);
    assert.equal(row.duplicate_status, 'no_match');
    assert.equal(row.enrichment_metadata.entry_mode, 'linkedin_single');
  });

  it('sin cuenta resuelta no se crea el run (evita B1b)', async () => {
    const { deps, calls } = makeCreateDeps({
      loadRequestAccountId: async () => null,
    });
    const result = await createLinkedinContactCandidate({ token: 'ok', company: HUBSPOT_COMPANY }, deps);
    assert.equal(result.ok === false && result.error, 'account_unresolved');
    assert.ok(!calls.some((c) => c.startsWith('run:') || c === 'insert'));
  });

  it('recalcula company_consistency: la empresa elegida no coincide con la del proveedor', async () => {
    const { deps, rows } = makeCreateDeps();
    const other: CompanyCandidate = { ...HUBSPOT_COMPANY, name: 'Compañía Distinta', domain: 'distinta.test', hubspotCompanyId: '777' };
    const result = await createLinkedinContactCandidate({ token: 'ok', company: other }, deps);
    assert.equal(result.ok && result.companyConsistency.status, 'possible_mismatch');
    const stored = rows[0].enrichment_metadata.company_consistency as { status: string };
    assert.equal(stored.status, 'possible_mismatch');
  });

  it('la empresa del proveedor coincide: match', async () => {
    const { deps } = makeCreateDeps();
    const result = await createLinkedinContactCandidate({ token: 'ok', company: HUBSPOT_COMPANY }, deps);
    assert.equal(result.ok && result.companyConsistency.status, 'match');
  });

  it('vista previa inválida o caducada: nada se crea', async () => {
    for (const [token, error] of [['bad', 'invalid_preview'], ['expired', 'expired_preview']] as const) {
      const { deps, calls } = makeCreateDeps();
      const result = await createLinkedinContactCandidate({ token, company: HUBSPOT_COMPANY }, deps);
      assert.equal(result.ok === false && result.error, error);
      assert.deepEqual(calls, []);
    }
  });

  it('si entró a «Por revisar» mientras se elegía la empresa, no se duplica', async () => {
    const { deps, calls } = makeCreateDeps({
      findPendingCandidateByLinkedin: async () => ({ fullName: 'Ana Ficticia', companyName: null }),
    });
    const result = await createLinkedinContactCandidate({ token: 'ok', company: HUBSPOT_COMPANY }, deps);
    assert.equal(result.ok === false && result.error, 'already_pending');
    assert.deepEqual(calls, []);
  });

  it('crear el candidato no llama a ningún proveedor (las deps no tienen cómo)', async () => {
    const { deps } = makeCreateDeps();
    assert.equal('lookupApollo' in deps, false);
    assert.equal('lookupLusha' in deps, false);
  });
});
