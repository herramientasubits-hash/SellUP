// Bryan 17-11 — buscar contacto por su ID de HubSpot: SellUp → candidatos anteriores → HubSpot.
// Nunca un proveedor (cero créditos). Si ya está aprobado o fue rechazado, sólo se avisa.
// Dobles en memoria. Datos ficticios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HUBSPOT_ID_SEARCH_COPY,
  searchContactByHubSpotId,
  type HubSpotIdContact,
  type HubSpotIdSearchDeps,
  type KnownCandidateMatch,
} from '../hubspot-contact-id-search-core';
import type { KnownContactMatch } from '../linkedin-contact-search-core';

const ID = '987654321';

const HUBSPOT_CONTACT: HubSpotIdContact = {
  id: ID,
  email: 'Ana@Empresa-Ficticia.test',
  firstName: 'Ana',
  lastName: 'Ficticia',
  jobTitle: 'Directora de Talento',
  phone: null,
  mobilePhone: '+57 300 000 0000',
  linkedinUrl: 'https://es.linkedin.com/in/ana-ficticia/',
  ownerId: null,
  associatedCompanyId: '65498491',
};

const KNOWN: KnownContactMatch = { fullName: 'Ana Ficticia', companyName: 'Empresa Ficticia SAS' };

function makeDeps(overrides: Partial<HubSpotIdSearchDeps> = {}) {
  const calls: string[] = [];
  const deps: HubSpotIdSearchDeps = {
    isEnabled: () => true,
    findSellUpContactByHubSpotId: async (id) => {
      calls.push(`sellup-id:${id}`);
      return null;
    },
    findCandidateByHubSpotId: async (id) => {
      calls.push(`candidate-id:${id}`);
      return null;
    },
    findHubSpotContactById: async (id) => {
      calls.push(`hubspot:${id}`);
      return HUBSPOT_CONTACT;
    },
    isHubSpotContactOfferable: async () => {
      calls.push('owner');
      return true;
    },
    findSellUpContactByEmail: async (email) => {
      calls.push(`sellup-email:${email}`);
      return null;
    },
    findPendingCandidateByEmail: async (email) => {
      calls.push(`pending-email:${email}`);
      return null;
    },
    findSellUpContactByLinkedin: async (slug) => {
      calls.push(`sellup-linkedin:${slug}`);
      return null;
    },
    findPendingCandidateByLinkedin: async (slug) => {
      calls.push(`pending-linkedin:${slug}`);
      return null;
    },
    nowIso: () => '2026-11-17T10:00:00.000Z',
    ...overrides,
  };
  return { deps, calls };
}

describe('searchContactByHubSpotId', () => {
  it('bandera apagada: no lee nada', async () => {
    const { deps, calls } = makeDeps({ isEnabled: () => false });
    assert.deepEqual(await searchContactByHubSpotId(ID, deps), { status: 'disabled' });
    assert.deepEqual(calls, []);
  });

  it('un ID que no es sólo números no toca nada', async () => {
    const { deps, calls } = makeDeps();
    const result = await searchContactByHubSpotId('12ab', deps);
    assert.deepEqual(result, { status: 'invalid_input', message: HUBSPOT_ID_SEARCH_COPY.invalid });
    assert.deepEqual(calls, []);
  });

  it('ya es contacto de SellUp: avisa que ya está aprobado y no consulta HubSpot', async () => {
    const { deps, calls } = makeDeps({ findSellUpContactByHubSpotId: async () => KNOWN });
    const result = await searchContactByHubSpotId(ID, deps);
    assert.equal(result.status, 'already_known');
    if (result.status !== 'already_known') return;
    assert.equal(result.where, 'sellup_contact');
    assert.equal(result.matchedBy, 'hubspot_id');
    assert.equal(result.message, HUBSPOT_ID_SEARCH_COPY.knownSellUpContact);
    assert.equal(result.creditsSpent, false);
    assert.equal(calls.some((c) => c.startsWith('hubspot:')), false);
  });

  const candidateCases: Array<[KnownCandidateMatch['status'], string, string]> = [
    ['pending_review', 'sellup_pending_candidate', HUBSPOT_ID_SEARCH_COPY.knownPendingCandidate],
    ['approved', 'sellup_approved_candidate', HUBSPOT_ID_SEARCH_COPY.knownApprovedCandidate],
    ['discarded', 'sellup_discarded_candidate', HUBSPOT_ID_SEARCH_COPY.knownDiscardedCandidate],
  ];
  for (const [status, where, message] of candidateCases) {
    it(`ya hubo un candidato ${status}: sólo avisa (no crea otro ni consulta HubSpot)`, async () => {
      const { deps, calls } = makeDeps({
        findCandidateByHubSpotId: async () => ({ ...KNOWN, candidateId: 'cand-1', status }),
      });
      const result = await searchContactByHubSpotId(ID, deps);
      assert.equal(result.status, 'already_known');
      if (result.status !== 'already_known') return;
      assert.equal(result.where, where);
      assert.equal(result.message, message);
      // Sólo el que está por revisar se puede abrir.
      assert.equal(result.match.candidateId, status === 'pending_review' ? 'cand-1' : null);
      assert.equal(calls.some((c) => c.startsWith('hubspot:')), false);
    });
  }

  it('HubSpot no responde: «no pudimos consultar», que no es «no existe»', async () => {
    const { deps } = makeDeps({
      findHubSpotContactById: async () => {
        throw new Error('HTTP 502');
      },
    });
    assert.deepEqual(await searchContactByHubSpotId(ID, deps), {
      status: 'provider_error',
      message: HUBSPOT_ID_SEARCH_COPY.hubspotUnavailable,
    });
  });

  it('no existe en HubSpot: lo dice y sugiere que quizá era el ID de una empresa', async () => {
    const { deps } = makeDeps({ findHubSpotContactById: async () => null });
    const result = await searchContactByHubSpotId(ID, deps);
    assert.deepEqual(result, { status: 'not_found', message: HUBSPOT_ID_SEARCH_COPY.notFound, creditsSpent: false });
    assert.match(HUBSPOT_ID_SEARCH_COPY.notFound, /ID de una empresa/);
  });

  it('su correo ya es contacto de SellUp: avisa', async () => {
    const seen: string[] = [];
    const { deps } = makeDeps({
      findSellUpContactByEmail: async (email) => {
        seen.push(email);
        return KNOWN;
      },
    });
    const result = await searchContactByHubSpotId(ID, deps);
    assert.equal(result.status, 'already_known');
    if (result.status !== 'already_known') return;
    assert.equal(result.matchedBy, 'email');
    assert.deepEqual(seen, ['ana@empresa-ficticia.test'], 'el correo se compara en minúsculas');
  });

  it('su LinkedIn ya está en «Por revisar»: avisa', async () => {
    const { deps } = makeDeps({ findPendingCandidateByLinkedin: async () => ({ ...KNOWN, candidateId: 'cand-2' }) });
    const result = await searchContactByHubSpotId(ID, deps);
    assert.equal(result.status, 'already_known');
    if (result.status !== 'already_known') return;
    assert.equal(result.where, 'sellup_pending_candidate');
    assert.equal(result.matchedBy, 'linkedin');
  });

  it('de otro vendedor: no se ofrece', async () => {
    const { deps } = makeDeps({ isHubSpotContactOfferable: async () => false });
    const result = await searchContactByHubSpotId(ID, deps);
    assert.equal(result.status, 'already_known');
    if (result.status !== 'already_known') return;
    assert.equal(result.where, 'hubspot_contact');
    assert.equal(result.message, HUBSPOT_ID_SEARCH_COPY.hubspotOtherSeller);
  });

  it('si la regla de dueño falla al decidir, no se ofrece', async () => {
    const { deps } = makeDeps({
      isHubSpotContactOfferable: async () => {
        throw new Error('boom');
      },
    });
    const result = await searchContactByHubSpotId(ID, deps);
    assert.equal(result.status, 'already_known');
  });

  it('nuevo: el candidato sale del contacto de HubSpot, sin proveedores ni créditos', async () => {
    const { deps, calls } = makeDeps();
    const result = await searchContactByHubSpotId(ID, deps);
    assert.equal(result.status, 'found');
    if (result.status !== 'found') return;
    assert.equal(result.data.entryMode, 'hubspot_id_single');
    assert.deepEqual(result.data.providersCalled, []);
    assert.equal(result.data.creditsSpent, 0);
    assert.deepEqual(result.data.hubspotContact, { id: ID, associatedCompanyId: '65498491' });
    assert.equal(result.data.profile.provider, 'hubspot');
    assert.equal(result.data.profile.email, 'ana@empresa-ficticia.test');
    assert.equal(result.data.profile.phone, '+57 300 000 0000');
    assert.equal(result.data.linkedinSlug, 'ana-ficticia');
    assert.equal(result.preview.fullName, 'Ana Ficticia');
    assert.equal(result.preview.hasPhone, true);
    assert.deepEqual(calls, [
      `sellup-id:${ID}`,
      `candidate-id:${ID}`,
      `hubspot:${ID}`,
      'sellup-email:ana@empresa-ficticia.test',
      'pending-email:ana@empresa-ficticia.test',
      'sellup-linkedin:ana-ficticia',
      'pending-linkedin:ana-ficticia',
      'owner',
    ]);
  });

  it('sin correo ni nombre: el candidato se llama por su ID y no se compara correo', async () => {
    const { deps, calls } = makeDeps({
      findHubSpotContactById: async () => ({
        ...HUBSPOT_CONTACT,
        email: null,
        firstName: null,
        lastName: null,
        linkedinUrl: null,
      }),
    });
    const result = await searchContactByHubSpotId(ID, deps);
    assert.equal(result.status, 'found');
    if (result.status !== 'found') return;
    assert.equal(result.data.profile.email, null);
    assert.equal(result.data.profile.fullName, `Contacto de HubSpot ${ID}`);
    assert.equal(calls.some((c) => c.startsWith('sellup-email:')), false);
  });

  it('ID fusionado en HubSpot: se vuelve a mirar SellUp con el ID vigente', async () => {
    const { deps, calls } = makeDeps({
      findHubSpotContactById: async () => ({ ...HUBSPOT_CONTACT, id: '111222333' }),
      findSellUpContactByHubSpotId: async (id) => {
        calls.push(`sellup-id:${id}`);
        return id === '111222333' ? KNOWN : null;
      },
    });
    const result = await searchContactByHubSpotId(ID, deps);
    assert.equal(result.status, 'already_known');
    assert.ok(calls.includes('sellup-id:111222333'));
  });
});
