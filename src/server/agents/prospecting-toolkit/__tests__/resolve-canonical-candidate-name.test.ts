/**
 * Tests — Canonical Candidate Name Resolution (Hito 16K-L)
 *
 * Verifica:
 *   - Caso Dinámica CD: título genérico con marca embebida → extrae "Dinámica CD"
 *   - Caso SITECO: nombre de empresa real → passthrough sin modificación
 *   - Título genérico sin separador → usa nombre inferido de dominio (fallback B)
 *   - Título genérico sin identityResolution → passthrough
 *   - original_detected_name siempre preservado
 *   - Metadatos de trazabilidad completos cuando applied=true
 *
 * Sin llamadas externas. Sin Supabase. Sin LLM. Determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCanonicalCandidateName } from '../resolve-canonical-candidate-name';

// ─── Caso principal: Dinámica CD ──────────────────────────────────────────────

describe('resolveCanonicalCandidateName — Dinámica CD (título SEO + marca en sufijo)', () => {
  const dinamicaInput = {
    detectedName: 'Consultoría ERP, CRM, HCM',
    sourceTitle: 'Consultoría ERP, CRM, HCM – dinámica cd',
    domain: 'dinamicacd.com.co',
    identityResolution: {
      inferred_company_name: 'Dinamicacd',
      identity_source: 'domain_inferred' as const,
    },
  };

  it('applied debe ser true', () => {
    const result = resolveCanonicalCandidateName(dinamicaInput);
    assert.equal(result.applied, true);
  });

  it('canonicalName debe ser "Dinámica CD" (extrae marca del sufijo del título)', () => {
    const result = resolveCanonicalCandidateName(dinamicaInput);
    assert.equal(result.canonicalName, 'Dinámica CD');
  });

  it('source debe ser "title_suffix"', () => {
    const result = resolveCanonicalCandidateName(dinamicaInput);
    assert.equal(result.source, 'title_suffix');
  });

  it('originalDetectedName preserva el nombre genérico original', () => {
    const result = resolveCanonicalCandidateName(dinamicaInput);
    assert.equal(result.originalDetectedName, 'Consultoría ERP, CRM, HCM');
  });

  it('normalizedCanonicalName es la versión normalizada del nombre canónico', () => {
    const result = resolveCanonicalCandidateName(dinamicaInput);
    // "Dinámica CD" normalizado → "dinamica cd"
    assert.ok(result.normalizedCanonicalName.includes('dinamica'));
  });

  it('confidence es "high" cuando se extrae del título', () => {
    const result = resolveCanonicalCandidateName(dinamicaInput);
    assert.equal(result.confidence, 'high');
  });
});

// ─── Caso SITECO: nombre real → passthrough ───────────────────────────────────

describe('resolveCanonicalCandidateName — SITECO (nombre real sin modificación)', () => {
  const sitecoInput = {
    detectedName: 'SITECO',
    sourceTitle: 'SITECO - Soluciones Integrales de Tecnología y Consultoría',
    domain: 'sitecosoluciones.com',
    identityResolution: null, // nombre real: no se aplica identity resolution
  };

  it('applied debe ser false (nombre real no se modifica)', () => {
    const result = resolveCanonicalCandidateName(sitecoInput);
    assert.equal(result.applied, false);
  });

  it('canonicalName es igual al nombre original "SITECO"', () => {
    const result = resolveCanonicalCandidateName(sitecoInput);
    assert.equal(result.canonicalName, 'SITECO');
  });

  it('source debe ser "passthrough"', () => {
    const result = resolveCanonicalCandidateName(sitecoInput);
    assert.equal(result.source, 'passthrough');
  });

  it('originalDetectedName preservado como "SITECO"', () => {
    const result = resolveCanonicalCandidateName(sitecoInput);
    assert.equal(result.originalDetectedName, 'SITECO');
  });
});

// ─── Fallback B: título genérico sin separador → usa nombre inferido de dominio ─

describe('resolveCanonicalCandidateName — fallback a domain_inferred cuando el título no tiene separador', () => {
  const noSeparatorInput = {
    detectedName: 'Consultoría ERP, CRM, HCM',
    sourceTitle: 'Consultoría ERP, CRM, HCM',  // sin separador de marca
    domain: 'dinamicacd.com.co',
    identityResolution: {
      inferred_company_name: 'Dinamicacd',
      identity_source: 'domain_inferred' as const,
    },
  };

  it('applied debe ser true (usa fallback de dominio)', () => {
    const result = resolveCanonicalCandidateName(noSeparatorInput);
    assert.equal(result.applied, true);
  });

  it('canonicalName es el nombre inferido del dominio', () => {
    const result = resolveCanonicalCandidateName(noSeparatorInput);
    assert.equal(result.canonicalName, 'Dinamicacd');
  });

  it('source debe ser "domain_inferred"', () => {
    const result = resolveCanonicalCandidateName(noSeparatorInput);
    assert.equal(result.source, 'domain_inferred');
  });

  it('confidence es "medium" para inferencia de dominio', () => {
    const result = resolveCanonicalCandidateName(noSeparatorInput);
    assert.equal(result.confidence, 'medium');
  });
});

// ─── Sin identityResolution: passthrough incluso con título genérico ──────────

describe('resolveCanonicalCandidateName — sin identityResolution → passthrough', () => {
  const noIdentityInput = {
    detectedName: 'Consultoría ERP, CRM, HCM',
    sourceTitle: 'Consultoría ERP, CRM, HCM – dinámica cd',
    domain: null,
    identityResolution: null,  // ownership gate no generó identidad inferida
  };

  it('applied debe ser false cuando identityResolution es null', () => {
    const result = resolveCanonicalCandidateName(noIdentityInput);
    assert.equal(result.applied, false);
  });

  it('canonicalName igual al nombre detectado (no se modifica)', () => {
    const result = resolveCanonicalCandidateName(noIdentityInput);
    assert.equal(result.canonicalName, 'Consultoría ERP, CRM, HCM');
  });

  it('source es "passthrough"', () => {
    const result = resolveCanonicalCandidateName(noIdentityInput);
    assert.equal(result.source, 'passthrough');
  });
});

// ─── Variantes de separadores soportados ─────────────────────────────────────

describe('resolveCanonicalCandidateName — variantes de separadores', () => {
  const baseIdentityResolution = {
    inferred_company_name: 'Acme',
    identity_source: 'domain_inferred' as const,
  };

  it('en-dash (—) como separador', () => {
    const result = resolveCanonicalCandidateName({
      detectedName: 'Consultoría ERP, CRM, HCM',
      sourceTitle: 'Consultoría ERP, CRM, HCM — Acme Corp',
      domain: 'acme.com',
      identityResolution: baseIdentityResolution,
    });
    assert.equal(result.applied, true);
    assert.equal(result.source, 'title_suffix');
    assert.ok(result.canonicalName.toLowerCase().includes('acme'));
  });

  it('guion con espacios ( - ) como separador', () => {
    const result = resolveCanonicalCandidateName({
      detectedName: 'Software ERP',
      sourceTitle: 'Software ERP - Acme Corp',
      domain: 'acme.com',
      identityResolution: baseIdentityResolution,
    });
    assert.equal(result.applied, true);
    assert.equal(result.source, 'title_suffix');
  });
});

// ─── original_detected_name siempre preservado ────────────────────────────────

describe('resolveCanonicalCandidateName — trazabilidad: originalDetectedName siempre presente', () => {
  const cases = [
    {
      label: 'cuando applied=true (título)',
      input: {
        detectedName: 'Consultoría ERP, CRM, HCM',
        sourceTitle: 'Consultoría ERP, CRM, HCM – Dinámica CD',
        domain: 'dinamicacd.com.co',
        identityResolution: { inferred_company_name: 'Dinamicacd', identity_source: 'domain_inferred' as const },
      },
    },
    {
      label: 'cuando applied=true (dominio)',
      input: {
        detectedName: 'Consultoría ERP, CRM, HCM',
        sourceTitle: null,
        domain: 'dinamicacd.com.co',
        identityResolution: { inferred_company_name: 'Dinamicacd', identity_source: 'domain_inferred' as const },
      },
    },
    {
      label: 'cuando applied=false (passthrough)',
      input: {
        detectedName: 'SITECO',
        sourceTitle: null,
        domain: 'sitecosoluciones.com',
        identityResolution: null,
      },
    },
  ];

  for (const { label, input } of cases) {
    it(`${label}: originalDetectedName === detectedName`, () => {
      const result = resolveCanonicalCandidateName(input);
      assert.equal(result.originalDetectedName, input.detectedName);
    });
  }
});
