/**
 * Tests — Lusha People Adapter (Agente 2A · 17B.3)
 *
 * Verifica normalización pura sin llamadas reales.
 * Guardrail crítico: phone nunca aparece en resultado ni en metadata.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLushaDecisionMaker,
  buildLushaUsageMetadata,
  normalizeLushaPersonName,
} from '../lusha-people-adapter';
import type { LushaRawDecisionMaker } from '../lusha-types';

const CTX = {
  companyName: 'Acme Corp',
  companyDomain: 'acme.com',
  countryCode: 'CO',
};

// ── normalizeLushaPersonName ────────────────────────────────────────────────

describe('normalizeLushaPersonName', () => {
  it('normaliza Unicode combinado y capitalización rara', () => {
    assert.equal(normalizeLushaPersonName('Patricia HernáNdez'), 'Patricia Hernández');
  });

  it('normaliza todo mayúsculas', () => {
    assert.equal(normalizeLushaPersonName('PATRICIA HERNÁNDEZ'), 'Patricia Hernández');
  });

  it('normaliza todo minúsculas', () => {
    assert.equal(normalizeLushaPersonName('patricia valencia hernandez'), 'Patricia Valencia Hernandez');
  });

  it('colapsa espacios múltiples', () => {
    assert.equal(normalizeLushaPersonName(' Patricia   Valencia   Hernández '), 'Patricia Valencia Hernández');
  });

  it('preserva conectores en minúsculas', () => {
    assert.equal(normalizeLushaPersonName('MARÍA DEL PILAR DE LA CRUZ'), 'María del Pilar de la Cruz');
  });

  it('no inventa acentos ausentes', () => {
    assert.equal(normalizeLushaPersonName('patricia valencia hernandez'), 'Patricia Valencia Hernandez');
  });

  it('retorna null para null', () => {
    assert.equal(normalizeLushaPersonName(null), null);
  });

  it('retorna null para undefined', () => {
    assert.equal(normalizeLushaPersonName(undefined), null);
  });

  it('retorna null para cadena vacía', () => {
    assert.equal(normalizeLushaPersonName(''), null);
  });

  it('retorna null para cadena solo espacios', () => {
    assert.equal(normalizeLushaPersonName('   '), null);
  });

  it('mantiene el primer token en mayúscula aunque sea conector', () => {
    assert.equal(normalizeLushaPersonName('DE LA ROSA'), 'De la Rosa');
  });

  it('normaliza NFC: combining characters quedan compuestos', () => {
    // 'á' = a + combining acute = á descompuesto
    const input = 'Patrı́cia Hernández';
    const result = normalizeLushaPersonName(input);
    assert.ok(result !== null);
    // Resultado debe estar en NFC (todos los acentos compuestos)
    assert.equal(result, result!.normalize('NFC'));
  });
});

// ── normalizeLushaDecisionMaker ─────────────────────────────────────────────

describe('normalizeLushaDecisionMaker', () => {
  it('normaliza fullName desde campo fullName', () => {
    const raw: LushaRawDecisionMaker = { fullName: 'Ana López' };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    assert.equal(result.fullName, 'Ana López');
  });

  it('normaliza fullName desde campo name cuando no hay fullName', () => {
    const raw: LushaRawDecisionMaker = { name: 'Carlos Ruiz' };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    assert.equal(result.fullName, 'Carlos Ruiz');
  });

  it('construye fullName desde firstName + lastName', () => {
    const raw: LushaRawDecisionMaker = {
      firstName: 'María',
      lastName: 'García',
    };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    assert.equal(result.fullName, 'María García');
  });

  it('usa campo title cuando está presente', () => {
    const raw: LushaRawDecisionMaker = { title: 'VP Sales' };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    assert.equal(result.title, 'VP Sales');
  });

  it('cae a jobTitle cuando title no está', () => {
    const raw: LushaRawDecisionMaker = { jobTitle: 'HR Manager' };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    assert.equal(result.title, 'HR Manager');
  });

  it('preserva email del raw', () => {
    const raw: LushaRawDecisionMaker = { email: 'ana@acme.com' };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    assert.equal(result.email, 'ana@acme.com');
  });

  it('normaliza linkedinUrl relativa agregando prefijo https', () => {
    const raw: LushaRawDecisionMaker = { linkedinUrl: 'ana-lopez' };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    assert.ok(result.linkedinUrl?.startsWith('https://'));
  });

  it('preserva linkedinUrl absoluta sin modificar', () => {
    const raw: LushaRawDecisionMaker = {
      linkedinUrl: 'https://www.linkedin.com/in/ana-lopez',
    };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    assert.equal(result.linkedinUrl, 'https://www.linkedin.com/in/ana-lopez');
  });

  it('NUNCA retorna phone aunque raw tenga phone', () => {
    const raw: LushaRawDecisionMaker = { phone: '+573001234567' };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    assert.equal(result.phone, null);
  });

  it('phone no aparece en metadata', () => {
    const raw: LushaRawDecisionMaker = { phone: '+573001234567' };
    const result = normalizeLushaDecisionMaker(raw, CTX);
    const metaStr = JSON.stringify(result.metadata);
    assert.ok(!metaStr.includes('+573001234567'), 'phone value must not leak into metadata');
    assert.ok(!metaStr.includes('phone_number'), 'phone_number key must not appear');
  });

  it('incluye provider = lusha', () => {
    const result = normalizeLushaDecisionMaker({}, CTX);
    assert.equal(result.provider, 'lusha');
    assert.equal(result.metadata['provider'], 'lusha');
  });

  it('incluye source_endpoint = decision_makers', () => {
    const result = normalizeLushaDecisionMaker({}, CTX);
    assert.equal(result.metadata['source_endpoint'], 'decision_makers');
  });

  it('incluye phone_reveal_enabled = false en metadata', () => {
    const result = normalizeLushaDecisionMaker({}, CTX);
    assert.equal(result.metadata['phone_reveal_enabled'], false);
  });
});

// ── buildLushaUsageMetadata ──────────────────────────────────────────────────

describe('buildLushaUsageMetadata', () => {
  it('construye metadata de uso con phone_reveal_enabled = false', () => {
    const meta = buildLushaUsageMetadata({
      endpoint: 'decision_makers',
      companyName: 'Acme',
      companyDomain: 'acme.com',
      rawResultsCount: 5,
      normalizedCount: 4,
      insertedCandidatesCount: 3,
    });
    assert.equal(meta.provider, 'lusha');
    assert.equal(meta.endpoint, 'decision_makers');
    assert.equal(meta.phone_reveal_enabled, false);
    assert.equal(meta.raw_results_count, 5);
    assert.equal(meta.normalized_count, 4);
    assert.equal(meta.inserted_candidates_count, 3);
  });
});
