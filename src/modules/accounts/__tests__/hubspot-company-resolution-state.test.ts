import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPendingMatchReviewMetadata,
  buildResolvedCompanyMetadata,
  readPendingHubSpotMatch,
} from '../hubspot-company-resolution-state';

describe('buildPendingMatchReviewMetadata', () => {
  it('escribe el bloque pending_match_review preservando el resto de metadata', () => {
    const result = buildPendingMatchReviewMetadata({
      existing: { keep: 'this' },
      match: {
        hubspotCompanyId: '12345',
        name: 'Autotransportes El Bisonte SA',
        domain: 'bisonte.com.mx',
        matchMethod: 'name',
        confidence: 65,
        reason: 'Match por nombre con confianza baja (65%)',
      },
      nowIso: '2026-08-27T21:30:00.000Z',
    });
    assert.equal(result.keep, 'this');
    assert.equal(result.hubspot_sync_status, 'pending_match_review');
    const pending = readPendingHubSpotMatch(result);
    assert.ok(pending);
    assert.equal(pending?.hubspotCompanyId, '12345');
    assert.equal(pending?.confidence, 65);
  });
});

describe('buildResolvedCompanyMetadata', () => {
  it('limpia hubspot_pending_match y marca synced', () => {
    const withPending = buildPendingMatchReviewMetadata({
      existing: {},
      match: {
        hubspotCompanyId: '12345',
        name: 'X',
        domain: null,
        matchMethod: 'name',
        confidence: 65,
        reason: 'r',
      },
      nowIso: '2026-08-27T21:30:00.000Z',
    });
    const resolved = buildResolvedCompanyMetadata({
      existing: withPending,
      nowIso: '2026-08-27T21:35:00.000Z',
    });
    assert.equal(resolved.hubspot_sync_status, 'synced');
    assert.equal(readPendingHubSpotMatch(resolved), null);
    assert.equal(
      Object.hasOwn(resolved, 'hubspot_pending_match'),
      false,
      'la clave hubspot_pending_match debe eliminarse por completo, no sólo quedar undefined',
    );
  });
});

describe('readPendingHubSpotMatch — lectura defensiva', () => {
  it('devuelve null si metadata es null/undefined', () => {
    assert.equal(readPendingHubSpotMatch(null), null);
    assert.equal(readPendingHubSpotMatch(undefined), null);
  });

  it('devuelve null si hubspot_pending_match no tiene forma válida', () => {
    assert.equal(readPendingHubSpotMatch({ hubspot_pending_match: 'not-an-object' }), null);
    assert.equal(readPendingHubSpotMatch({ hubspot_pending_match: {} }), null);
    assert.equal(
      readPendingHubSpotMatch({ hubspot_pending_match: { hubspot_company_id: 123 } }),
      null,
      'un id que no es string no cuenta como pendiente válido',
    );
  });

  it('rellena los campos opcionales ausentes con valores seguros, no lanza', () => {
    const pending = readPendingHubSpotMatch({
      hubspot_pending_match: { hubspot_company_id: 'hs-1' },
    });
    assert.ok(pending);
    assert.equal(pending?.hubspotCompanyId, 'hs-1');
    assert.equal(pending?.name, null);
    assert.equal(pending?.confidence, 0);
  });
});
