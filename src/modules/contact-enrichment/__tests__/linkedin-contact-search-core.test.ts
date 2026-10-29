// AGENT2A-LINKEDIN-CONTACT-SEARCH (F2) — núcleo de «Buscar contacto por LinkedIn».
// AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE: ya no hay vista previa firmada; la búsqueda devuelve
// los datos y la creación del candidato se prueba en `contact-quick-search-candidate-core.test.ts`.
//
// Dobles en memoria: sin Supabase, sin Apollo, sin Lusha, sin HubSpot, sin créditos.
// URLs, nombres y correos ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LINKEDIN_SEARCH_COPY,
  searchContactByLinkedin as searchCore,
  type LinkedinProviderLookup,
  type LinkedinProviderProfile,
  type LinkedinProviderUsage,
  type LinkedinSearchDeps,
  type SearchedContactData,
} from '../linkedin-contact-search-core';

/** Los datos encontrados de cada búsqueda, por juego de deps (antes: lo que se firmaba). */
const FOUND_DATA = new WeakMap<LinkedinSearchDeps, SearchedContactData[]>();
async function searchContactByLinkedin(raw: unknown, deps: LinkedinSearchDeps) {
  const result = await searchCore(raw, deps);
  if (result.status === 'found') FOUND_DATA.get(deps)?.push(result.data);
  return result;
}

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
  const signed: SearchedContactData[] = [];
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
    nowIso: () => '2026-10-26T12:00:00.000Z',
    ...overrides,
  };
  FOUND_DATA.set(deps, signed);
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
      hasLinkedin: true,
      hasPhone: false,
      suggestedCompanyQuery: 'empresa-ficticia.test',
    });
    assert.equal(JSON.stringify(result.preview).includes('linkedin.com'), false);
    // El LinkedIn del candidato es el pegado (canónico), aunque el proveedor diga otro.
    assert.equal(result.data.entryMode, 'linkedin_single');
    assert.equal(result.data.profile.linkedinUrl, CANONICAL);
  });
});
