/**
 * Tests — Consistencia de identidad (UI helpers) · 17B.4W.6
 *
 * Verifica el mapeo de evidencia de identidad a copy/tono. Sin React rendering,
 * sin red, sin Lusha.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IDENTITY_TONE_STYLES,
  resolveIdentityDisplay,
} from '../contact-candidate-identity-display';
import type { LushaPersonIdentityEvidenceV1 } from '@/modules/contact-enrichment/types';

function evidence(
  identity_consistency: LushaPersonIdentityEvidenceV1['identity_consistency'],
): LushaPersonIdentityEvidenceV1 {
  return {
    prospect_contact_id: 'cid-A',
    prospect_full_name: 'Carolina Herrera',
    prospect_linkedin_url: null,
    enrich_contact_id: 'cid-A',
    enrich_full_name: 'Carolina Herrera',
    enrich_linkedin_url: null,
    id_consistency: 'match',
    name_consistency: 'match',
    identity_consistency,
  };
}

describe('resolveIdentityDisplay', () => {
  it('consistent → Identidad coincidente (tono consistent)', () => {
    const d = resolveIdentityDisplay(evidence('consistent'));
    assert.equal(d.label, 'Identidad coincidente');
    assert.equal(d.tone, 'consistent');
  });

  it('mismatch → Requiere revisión de identidad (tono mismatch)', () => {
    const d = resolveIdentityDisplay(evidence('mismatch'));
    assert.equal(d.label, 'Requiere revisión de identidad');
    assert.equal(d.tone, 'mismatch');
  });

  it('insufficient_evidence → Identidad sin verificar', () => {
    const d = resolveIdentityDisplay(evidence('insufficient_evidence'));
    assert.equal(d.label, 'Identidad sin verificar');
    assert.equal(d.tone, 'unverified');
    assert.match(d.description, /No hay suficiente evidencia técnica/);
  });

  it('legacy/null → Identidad sin verificar con copy de legacy', () => {
    const d = resolveIdentityDisplay(null);
    assert.equal(d.label, 'Identidad sin verificar');
    assert.equal(d.tone, 'unverified');
    assert.match(d.description, /no registró evidencia/);
  });

  it('no afirma propiedad del correo ni verificación de persona', () => {
    for (const state of ['consistent', 'mismatch', 'insufficient_evidence'] as const) {
      const d = resolveIdentityDisplay(evidence(state));
      assert.doesNotMatch(d.description, /correo verificado|propiedad del correo|persona verificada/i);
    }
  });

  it('cada tono tiene estilo definido con tokens del sistema', () => {
    assert.ok(IDENTITY_TONE_STYLES.consistent.includes('emerald'));
    assert.ok(IDENTITY_TONE_STYLES.mismatch.includes('amber'));
    assert.ok(IDENTITY_TONE_STYLES.unverified.includes('muted'));
  });
});
