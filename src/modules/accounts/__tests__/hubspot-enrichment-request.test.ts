import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENRICHMENT_REQUEST_LOCK_MS,
  decideEnrichmentOwnership,
  isEnrichmentRequestInFlight,
  missingEnrichmentFields,
  summarizeEnrichmentRequest,
  type EnrichmentSnapshot,
} from '../hubspot-enrichment-request';

const REQUESTER = 'user-requester';
const OTHER = 'user-other';

const EMPTY: EnrichmentSnapshot = {
  owner_id: null,
  tax_identifier: null,
  legal_name: null,
  country: null,
  industry: null,
  company_size: null,
};

const FULL: EnrichmentSnapshot = {
  owner_id: REQUESTER,
  tax_identifier: 'LVP123456AB1',
  legal_name: 'LVP REAL ESTATE INVESTMENT S.A. DE C.V.',
  country: 'México',
  industry: 'Bienes raíces',
  company_size: '120',
};

describe('enriquecer empresa de HubSpot — campos', () => {
  it('un texto en blanco cuenta como vacío', () => {
    assert.deepEqual(missingEnrichmentFields({ ...FULL, legal_name: '   ', company_size: null }), [
      'legal_name',
      'company_size',
    ]);
    assert.deepEqual(missingEnrichmentFields(FULL), []);
  });
});

describe('enriquecer empresa de HubSpot — responsable', () => {
  it('sin responsable antes y a nombre de quien pidió después: se le asignó', () => {
    assert.equal(
      decideEnrichmentOwnership({ ownerBefore: null, ownerAfter: REQUESTER, requesterId: REQUESTER }),
      'assigned_to_requester',
    );
  });

  it('ya era de quien pidió', () => {
    assert.equal(
      decideEnrichmentOwnership({ ownerBefore: REQUESTER, ownerAfter: REQUESTER, requesterId: REQUESTER }),
      'already_requester',
    );
  });

  it('de otra persona (o del dueño en HubSpot): no se le quita', () => {
    assert.equal(
      decideEnrichmentOwnership({ ownerBefore: OTHER, ownerAfter: OTHER, requesterId: REQUESTER }),
      'kept_other_owner',
    );
    assert.equal(
      decideEnrichmentOwnership({ ownerBefore: null, ownerAfter: OTHER, requesterId: REQUESTER }),
      'kept_other_owner',
    );
  });
});

describe('enriquecer empresa de HubSpot — pedido en curso', () => {
  const now = Date.parse('2026-11-17T12:00:00.000Z');
  const block = (status: string, startedMsAgo: number) => ({
    hubspot_enrichment_request: { status, started_at: new Date(now - startedMsAgo).toISOString() },
  });

  it('un pedido reciente en curso bloquea otro', () => {
    assert.equal(isEnrichmentRequestInFlight(block('running', 30_000), now), true);
  });

  it('uno viejo (caído) o ya terminado no bloquea', () => {
    assert.equal(isEnrichmentRequestInFlight(block('running', ENRICHMENT_REQUEST_LOCK_MS + 1), now), false);
    assert.equal(isEnrichmentRequestInFlight(block('completed', 1_000), now), false);
    assert.equal(isEnrichmentRequestInFlight(null, now), false);
    assert.equal(isEnrichmentRequestInFlight({}, now), false);
  });
});

describe('enriquecer empresa de HubSpot — resumen', () => {
  it('completó todo y quedó a nombre de quien pidió', () => {
    const summary = summarizeEnrichmentRequest({ before: EMPTY, after: FULL, requesterId: REQUESTER });
    assert.equal(summary.status, 'completed');
    assert.deepEqual(summary.filled, ['tax_identifier', 'legal_name', 'country', 'industry', 'company_size']);
    assert.deepEqual(summary.stillMissing, []);
    assert.equal(summary.ownership, 'assigned_to_requester');
    assert.equal(
      summary.message,
      'Completé número fiscal, razón social, país, industria y tamaño. Quedó a tu nombre.',
    );
  });

  it('parcial: dice qué completó y qué no encontró', () => {
    const after = { ...FULL, tax_identifier: null, legal_name: null };
    const summary = summarizeEnrichmentRequest({ before: EMPTY, after, requesterId: REQUESTER });
    assert.equal(summary.status, 'partial');
    assert.deepEqual(summary.filled, ['country', 'industry', 'company_size']);
    assert.deepEqual(summary.stillMissing, ['tax_identifier', 'legal_name']);
    assert.equal(
      summary.message,
      'Completé país, industria y tamaño. No encontré número fiscal y razón social. Quedó a tu nombre.',
    );
  });

  it('nada encontrado y de otra persona: lo dice con su nombre', () => {
    const before = { ...EMPTY, owner_id: OTHER, country: 'México' };
    const summary = summarizeEnrichmentRequest({
      before,
      after: before,
      requesterId: REQUESTER,
      ownerName: 'Carla Pía',
    });
    assert.equal(summary.status, 'nothing_found');
    assert.deepEqual(summary.filled, []);
    assert.equal(summary.ownership, 'kept_other_owner');
    assert.equal(
      summary.message,
      'No encontré número fiscal, razón social, industria y tamaño en HubSpot ni en las fuentes oficiales. ' +
        'Sigue a nombre de Carla Pía: una empresa tiene un solo responsable.',
    );
  });

  it('ya tenía todo', () => {
    const summary = summarizeEnrichmentRequest({ before: FULL, after: FULL, requesterId: REQUESTER });
    assert.equal(summary.status, 'completed');
    assert.equal(summary.message, 'La empresa ya tenía todos sus datos. Ya estaba a tu nombre.');
  });
});
