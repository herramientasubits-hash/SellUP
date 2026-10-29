// AGENT2A-LINKEDIN-CONTACT-SEARCH (F2) — adaptadores de Apollo y Lusha para un perfil de LinkedIn.
// Dobles de los clientes: sin red ni créditos. Datos ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  lookupApolloByEmail,
  lookupApolloByLinkedin,
  lookupLushaByEmail,
  lookupLushaByLinkedin,
} from '../linkedin-contact-search-providers.server';
import type { MatchPersonParams } from '@/server/integrations/apollo-client';

const URL = 'https://www.linkedin.com/in/persona-ficticia';

describe('lookupApolloByLinkedin', () => {
  it('people/match por linkedin_url, sin revelar teléfono, 1 crédito', async () => {
    const sent: MatchPersonParams[] = [];
    const result = await lookupApolloByLinkedin(URL, {
      getApiKey: async () => 'k',
      matchPerson: async (params) => {
        sent.push(params);
        return {
          success: true,
          data: {
            id: 'apollo-1',
            first_name: 'Ana',
            last_name: 'Ficticia',
            title: 'Directora de Talento',
            email: 'ana@empresa-ficticia.test',
            linkedin_url: URL,
            phone_numbers: [],
            organization: { id: 'o1', name: 'Empresa Ficticia SAS', website_url: 'https://www.empresa-ficticia.test' },
          },
        };
      },
    });
    assert.deepEqual(sent, [{ linkedin_url: URL, reveal_personal_emails: true }]);
    assert.equal('reveal_phone_number' in sent[0], false);
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') return;
    assert.equal(result.profile.email, 'ana@empresa-ficticia.test');
    assert.equal(result.profile.providerCompanyDomain, 'empresa-ficticia.test');
    assert.deepEqual(result.usage.map((u) => [u.operation_key, u.credits_used]), [['person_match', 1]]);
  });

  it('sin persona: no encontrado (con su gasto); sin clave: no se llama', async () => {
    const notFound = await lookupApolloByLinkedin(URL, { getApiKey: async () => 'k', matchPerson: async () => ({ success: true, data: undefined }) });
    assert.equal(notFound.kind, 'not_found');
    assert.equal(notFound.usage.length, 1);
    let called = false;
    const noKey = await lookupApolloByLinkedin(URL, {
      getApiKey: async () => null,
      matchPerson: async () => {
        called = true;
        return { success: true };
      },
    });
    assert.deepEqual(noKey, { kind: 'unavailable', usage: [] });
    assert.equal(called, false);
  });

  it('error HTTP: error con costo desconocido (null, nunca 0)', async () => {
    const result = await lookupApolloByLinkedin(URL, {
      getApiKey: async () => 'k',
      matchPerson: async () => ({ success: false, error: { error: 'HTTP_500', message: 'x', statusCode: 500 } }),
    });
    assert.equal(result.kind, 'error');
    assert.equal(result.usage[0].credits_used, null);
  });
});

describe('lookupLushaByLinkedin', () => {
  it('busca por linkedinUrl y revela SÓLO emails del contacto encontrado', async () => {
    const searched: unknown[] = [];
    const enriched: Array<{ contacts: Array<{ id: string }>; reveal: string[] }> = [];
    const result = await lookupLushaByLinkedin(URL, {
      isEnabled: () => true,
      getApiKey: async () => 'k',
      timeoutMs: 1000,
      search: async (input) => {
        searched.push(input.contacts);
        return {
          ok: true,
          status: 'success',
          resultsReturned: 1,
          creditsCharged: null,
          sanitizedResults: [{ id: 'lusha-1', fullName: 'Ana Ficticia', title: 'Directora', companyName: 'Empresa Ficticia SAS', companyDomain: 'empresa-ficticia.test', linkedinUrl: URL, has: null, canReveal: null }],
        };
      },
      enrich: async (input) => {
        enriched.push({ contacts: input.contacts, reveal: input.reveal });
        return {
          ok: true,
          status: 'success',
          resultsReturned: 1,
          creditsCharged: 1,
          sanitizedResults: [{ id: 'lusha-1', hasEmail: true, hasPhone: false, firstName: 'Ana', lastName: 'Ficticia', fullName: 'Ana Ficticia', title: 'Directora', companyName: 'Empresa Ficticia SAS', companyDomain: 'empresa-ficticia.test', internalEmail: 'Ana@Empresa-Ficticia.test' }],
        };
      },
    });
    assert.deepEqual(searched, [[{ linkedinUrl: URL }]]);
    assert.deepEqual(enriched, [{ contacts: [{ id: 'lusha-1' }], reveal: ['emails'] }]);
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') return;
    assert.equal(result.profile.provider, 'lusha');
    assert.equal(result.profile.email, 'ana@empresa-ficticia.test');
    assert.deepEqual(result.usage.map((u) => [u.operation_key, u.credits_used]), [
      ['lusha_contact_search', null],
      ['lusha_contact_enrich', 1],
    ]);
  });

  it('sin resultados en la búsqueda: no se enriquece (no se paga el enrich)', async () => {
    let enrichCalled = false;
    const result = await lookupLushaByLinkedin(URL, {
      isEnabled: () => true,
      getApiKey: async () => 'k',
      timeoutMs: 1000,
      search: async () => ({ ok: false, status: 'no_results', resultsReturned: 0 }),
      enrich: async () => {
        enrichCalled = true;
        return { ok: true, status: 'success', resultsReturned: 0 };
      },
    });
    assert.equal(result.kind, 'not_found');
    assert.equal(enrichCalled, false);
  });

  it('Lusha apagado o sin clave: no se llama', async () => {
    const off = await lookupLushaByLinkedin(URL, { isEnabled: () => false });
    assert.deepEqual(off, { kind: 'unavailable', usage: [] });
    const noKey = await lookupLushaByLinkedin(URL, { isEnabled: () => true, getApiKey: async () => null });
    assert.deepEqual(noKey, { kind: 'unavailable', usage: [] });
  });

  it('error del proveedor en la búsqueda: error', async () => {
    const result = await lookupLushaByLinkedin(URL, {
      isEnabled: () => true,
      getApiKey: async () => 'k',
      timeoutMs: 1000,
      search: async () => ({ ok: false, status: 'provider_error', resultsReturned: 0 }),
    });
    assert.equal(result.kind, 'error');
  });
});

// ── AGENT2A-LINKEDIN-EMAIL-REVIEW-INLINE — por correo ─────────────────────────

const EMAIL = 'ana@empresa-ficticia.test';

describe('lookupApolloByEmail', () => {
  it('people/match por email, sin revelar correos ni teléfono; trae el LinkedIn', async () => {
    const sent: MatchPersonParams[] = [];
    const result = await lookupApolloByEmail(' Ana@Empresa-Ficticia.test ', {
      getApiKey: async () => 'k',
      matchPerson: async (params) => {
        sent.push(params);
        return {
          success: true,
          data: {
            id: 'apollo-1',
            first_name: 'Ana',
            last_name: 'Ficticia',
            title: 'Directora de Talento',
            email: 'email_not_unlocked@domain.com',
            linkedin_url: URL,
            phone_numbers: [],
            organization: { id: 'o1', name: 'Empresa Ficticia SAS', website_url: 'https://www.empresa-ficticia.test' },
          },
        };
      },
    });
    assert.deepEqual(sent, [{ email: EMAIL }]);
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') return;
    // Correo bloqueado en Apollo ⇒ queda el que se buscó.
    assert.equal(result.profile.email, EMAIL);
    assert.equal(result.profile.linkedinUrl, URL);
    assert.equal(result.profile.providerCompanyDomain, 'empresa-ficticia.test');
  });
});

describe('lookupLushaByEmail', () => {
  it('sólo contacts/search por email (sin enrich); perfil con LinkedIn y empresa', async () => {
    const searched: unknown[] = [];
    const result = await lookupLushaByEmail(EMAIL, {
      isEnabled: () => true,
      getApiKey: async () => 'k',
      timeoutMs: 1000,
      search: async (input) => {
        searched.push(input.contacts);
        return {
          ok: true,
          status: 'success',
          resultsReturned: 1,
          creditsCharged: 1,
          sanitizedResults: [{ id: 'lusha-1', fullName: 'Ana Ficticia', title: 'Directora', companyName: 'Empresa Ficticia SAS', companyDomain: 'empresa-ficticia.test', linkedinUrl: URL, has: null, canReveal: null }],
        };
      },
    });
    assert.deepEqual(searched, [[{ email: EMAIL }]]);
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') return;
    assert.equal(result.profile.provider, 'lusha');
    assert.equal(result.profile.email, EMAIL);
    assert.equal(result.profile.linkedinUrl, URL);
    assert.equal(result.profile.firstName, 'Ana');
    assert.deepEqual(result.usage.map((u) => [u.operation_key, u.credits_used]), [['lusha_contact_search', 1]]);
  });

  it('sin resultados: no encontrado; apagado: no se llama', async () => {
    const none = await lookupLushaByEmail(EMAIL, {
      isEnabled: () => true,
      getApiKey: async () => 'k',
      timeoutMs: 1000,
      search: async () => ({ ok: false, status: 'no_results', resultsReturned: 0 }),
    });
    assert.equal(none.kind, 'not_found');
    assert.deepEqual(await lookupLushaByEmail(EMAIL, { isEnabled: () => false }), { kind: 'unavailable', usage: [] });
  });
});
