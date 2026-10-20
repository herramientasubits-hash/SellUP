import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HUBSPOT_FIRST_MIN_RELEVANT_WITH_EMAIL,
  isSatisfiedByHubSpot,
  selectHubSpotFirstCandidates,
} from '../hubspot-first-core';
import type { ExistingContactSnapshot } from '@/modules/contact-enrichment/types';

function contact(overrides: Partial<ExistingContactSnapshot> & { id: string }): ExistingContactSnapshot {
  return {
    source: 'hubspot',
    fullName: 'Ana Pérez',
    firstName: 'Ana',
    lastName: 'Pérez',
    email: 'ana@empresa.com',
    phone: null,
    linkedinUrl: null,
    title: 'Gerente de Recursos Humanos',
    completeness: { hasEmail: true, hasPhone: false, hasLinkedin: false },
    ...overrides,
  };
}

const NONE = new Set<string>();

describe('Primero HubSpot — selección', () => {
  it('un contacto de RR. HH. de HubSpot entra como candidato pending_review, sin proveedor', () => {
    const result = selectHubSpotFirstCandidates({
      hubspotContacts: [contact({ id: 'h1' })],
      sellupContacts: [],
      alreadyInRunHubspotIds: NONE,
    });
    assert.equal(result.rows.length, 1);
    const row = result.rows[0];
    assert.equal(row.source, 'hubspot');
    assert.equal(row.source_contact_id, 'h1');
    assert.equal(row.matched_hubspot_contact_id, 'h1');
    assert.equal(row.status, 'pending_review');
    assert.equal(row.duplicate_status, 'no_match');
    assert.equal(result.relevantWithEmail, 1);
  });

  it('no entra lo que ya es contacto de SellUp (por correo o LinkedIn)', () => {
    const result = selectHubSpotFirstCandidates({
      hubspotContacts: [
        contact({ id: 'h1', email: 'ANA@empresa.com' }),
        contact({ id: 'h2', email: 'otro@empresa.com', linkedinUrl: 'https://linkedin.com/in/luis/' }),
      ],
      sellupContacts: [
        contact({ id: 's1', source: 'sellup', email: 'ana@empresa.com' }),
        contact({ id: 's2', source: 'sellup', email: null, linkedinUrl: 'https://linkedin.com/in/luis' }),
      ],
      alreadyInRunHubspotIds: NONE,
    });
    assert.equal(result.rows.length, 0);
    assert.equal(result.skippedKnownInSellUp, 2);
  });

  it('no entra quien no es del perfil, sin nombre real, ni lo que ya está en la corrida', () => {
    const result = selectHubSpotFirstCandidates({
      hubspotContacts: [
        contact({ id: 'h1', title: 'Conductor de reparto', email: 'x@e.com' }),
        contact({ id: 'h2', fullName: 'HubSpot Contact h2' }),
        contact({ id: 'h3', email: 'c@e.com' }),
      ],
      sellupContacts: [],
      alreadyInRunHubspotIds: new Set(['h3']),
    });
    assert.equal(result.rows.length, 0);
    assert.equal(result.skippedNotRelevant, 1);
    assert.equal(result.skippedNoName, 1);
    assert.equal(result.skippedAlreadyInRun, 1);
  });

  it('sin correo cuenta como candidato pero no para saltarse a los proveedores', () => {
    const result = selectHubSpotFirstCandidates({
      hubspotContacts: [contact({ id: 'h1', email: null, completeness: { hasEmail: false, hasPhone: false, hasLinkedin: true }, linkedinUrl: 'https://linkedin.com/in/a' })],
      sellupContacts: [],
      alreadyInRunHubspotIds: NONE,
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.relevantWithEmail, 0);
  });
});

describe('Primero HubSpot — ¿bastan?', () => {
  it('bastan al llegar al mínimo de relevantes con correo', () => {
    assert.equal(HUBSPOT_FIRST_MIN_RELEVANT_WITH_EMAIL, 3);
    assert.equal(isSatisfiedByHubSpot(2), false);
    assert.equal(isSatisfiedByHubSpot(3), true);
    assert.equal(isSatisfiedByHubSpot(1, 1), true);
  });
});
