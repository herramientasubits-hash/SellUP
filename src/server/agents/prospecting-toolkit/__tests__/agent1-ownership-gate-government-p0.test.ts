/**
 * AGENT1-OWNERSHIP-GATE-GOVERNMENT-P0
 *
 * El Ownership Gate rechazaba entidades públicas colombianas REALES y net-new
 * cuyo nombre oficial y cuyo dominio oficial no comparten una subcadena literal:
 *
 *   "Alcaldía de Segovia"   ↔ segovia-antioquia.gov.co  (municipio + departamento)
 *   "Ministerio de Ambiente" ↔ minambiente.gov.co        (abreviatura institucional)
 *
 * Causa raíz: todo el matching se hacía sobre cadenas CONCATENADAS
 * (`normalizeForDomain` elimina espacios y guiones), nunca sobre tokens. Con el
 * sustantivo institucional dentro del nombre ("alcaldía", "ministerio") y el
 * calificativo dentro del dominio (departamento, abreviatura), ninguna de las
 * cuatro reglas de subcadena podía coincidir.
 *
 * Este hito NO afirma «.gov.co ⇒ aceptar»: exige correspondencia demostrable
 * entre los tokens del nombre y los del dominio. Sector ≠ ownership.
 *
 * Sin red, sin proveedor, sin base. Determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
} from '../company-ownership-gate';
import { evaluateCandidatePreWriterAdmission } from '../apollo-pre-writer-target-conditions';
import type { ProspectingPipelineCandidate } from '../types';
import type { NoveltyIndex } from '../novelty-checker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ownership(name: string, domain: string) {
  return evaluateCompanyOwnership(name, `https://www.${domain}`, domain);
}

function assertOwnershipPass(name: string, domain: string) {
  const result = ownership(name, domain);
  assert.equal(
    isBlockedByCompanyOwnership(result),
    false,
    `${name} + ${domain} debe pasar ownership. confidence=${result.confidence} reason=${result.reason}`,
  );
  assert.equal(result.allowed, true, `${name} + ${domain}: allowed debe ser true`);
  assert.ok(
    result.matchedSignals.length > 0,
    `${name} + ${domain}: un pase debe declarar la señal que lo justificó`,
  );
}

function assertOwnershipReject(name: string, domain: string) {
  const result = ownership(name, domain);
  assert.equal(
    isBlockedByCompanyOwnership(result),
    true,
    `${name} + ${domain} debe seguir bloqueado. confidence=${result.confidence} reason=${result.reason}`,
  );
  assert.equal(result.allowed, false, `${name} + ${domain}: allowed debe ser false`);
}

function makeCandidate(
  overrides: Partial<ProspectingPipelineCandidate> & { name: string },
): ProspectingPipelineCandidate {
  return {
    domain: 'testcompany.com.co',
    website: 'https://testcompany.com.co',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Gobierno',
    scoring: {
      qualityLabel: 'high_quality_new',
      confidenceScore: 0.85,
      fitScore: 0.8,
      dataCompletenessScore: 0.9,
      recommendedAction: 'add_to_pipeline',
      reasons: [],
      warnings: [],
      blockers: [],
    },
    websiteVerification: null,
    duplicateCheck: null,
    sourceUrl: null,
    sourceTitle: null,
    sourceSnippet: null,
    inferredNameSource: 'title',
    searchTrace: null,
    llmEvaluation: null,
    ...overrides,
  } as unknown as ProspectingPipelineCandidate;
}

// ─── A. Entidades territoriales ───────────────────────────────────────────────

describe('P0 § A — entidades territoriales: municipio + departamento en el dominio', () => {
  it('1. Alcaldía de Segovia + segovia-antioquia.gov.co → PASS', () => {
    assertOwnershipPass('Alcaldía de Segovia', 'segovia-antioquia.gov.co');
  });

  it('Alcaldía Municipal de Segovia (forma larga) + segovia-antioquia.gov.co → PASS', () => {
    assertOwnershipPass('Alcaldía Municipal de Segovia', 'segovia-antioquia.gov.co');
  });

  it('Alcaldía de Puerto Berrío + puertoberrio-antioquia.gov.co → PASS (topónimo compuesto)', () => {
    assertOwnershipPass('Alcaldía de Puerto Berrío', 'puertoberrio-antioquia.gov.co');
  });

  it('Gobernación de Antioquia + antioquia.gov.co → PASS', () => {
    assertOwnershipPass('Gobernación de Antioquia', 'antioquia.gov.co');
  });

  it('Municipio de Sabaneta + sabaneta-antioquia.gov.co → PASS', () => {
    assertOwnershipPass('Municipio de Sabaneta', 'sabaneta-antioquia.gov.co');
  });
});

// ─── B. Entidades nacionales (abreviatura institucional) ──────────────────────

describe('P0 § B — entidades nacionales: abreviatura del sustantivo institucional', () => {
  it('2. Ministerio de Ambiente + minambiente.gov.co → PASS', () => {
    assertOwnershipPass('Ministerio de Ambiente', 'minambiente.gov.co');
  });

  it('6. Ministerio de Educación + mineducacion.gov.co → PASS', () => {
    assertOwnershipPass('Ministerio de Educación', 'mineducacion.gov.co');
  });

  it('7. Ministerio de Salud + minsalud.gov.co → PASS', () => {
    assertOwnershipPass('Ministerio de Salud', 'minsalud.gov.co');
  });

  it('Ministerio de Minas y Energía + minenergia.gov.co → PASS (token no inicial)', () => {
    assertOwnershipPass('Ministerio de Minas y Energía', 'minenergia.gov.co');
  });

  it('Ministerio de Tecnologías de la Información y las Comunicaciones + mintic.gov.co → PASS (siglas del resto)', () => {
    assertOwnershipPass(
      'Ministerio de Tecnologías de la Información y las Comunicaciones',
      'mintic.gov.co',
    );
  });

  it('Superintendencia de Servicios Públicos Domiciliarios + superservicios.gov.co → PASS', () => {
    assertOwnershipPass(
      'Superintendencia de Servicios Públicos Domiciliarios',
      'superservicios.gov.co',
    );
  });
});

// ─── C. Siglas oficiales ──────────────────────────────────────────────────────

describe('P0 § C — siglas oficiales derivadas del nombre', () => {
  it('4. DIAN + dian.gov.co → PASS', () => {
    assertOwnershipPass('DIAN', 'dian.gov.co');
  });

  it('5. ICBF + icbf.gov.co → PASS', () => {
    assertOwnershipPass('ICBF', 'icbf.gov.co');
  });

  it('Dirección de Impuestos y Aduanas Nacionales + dian.gov.co → PASS (sigla derivada)', () => {
    assertOwnershipPass('Dirección de Impuestos y Aduanas Nacionales', 'dian.gov.co');
  });

  it('Instituto Colombiano de Bienestar Familiar + icbf.gov.co → PASS (sigla derivada)', () => {
    assertOwnershipPass('Instituto Colombiano de Bienestar Familiar', 'icbf.gov.co');
  });

  it('Servicio Geológico Colombiano + sgc.gov.co → PASS (sigla derivada)', () => {
    assertOwnershipPass('Servicio Geológico Colombiano', 'sgc.gov.co');
  });
});

// ─── C bis. SENA: ownership pasa, el duplicado posterior sigue decidiendo ─────

describe('P0 § C bis — SENA: ownership sólo decide ownership', () => {
  it('3a. SENA + sena.edu.co → ownership PASS', () => {
    assertOwnershipPass('SENA', 'sena.edu.co');
  });

  it('3b. SENA + sena.edu.co: con un candidato activo homónimo, el duplicate guard posterior SIGUE rechazando', () => {
    const candidate = makeCandidate({
      name: 'SENA',
      domain: 'sena.edu.co',
      website: 'https://www.sena.edu.co',
    });

    const admission = evaluateCandidatePreWriterAdmission({
      candidateKey: 'apollo:sena',
      candidate,
      context: { targetCountryCode: 'CO', subindustries: [] },
      dbContext: {
        coveredDomains: new Set(['sena.edu.co']),
        noveltyIndex: new Map() as NoveltyIndex,
        recentIdentityKeys: new Set<string>(),
        activeCandidates: [
          {
            id: 'existing-sena',
            name: 'SENA',
            domain: 'sena.edu.co',
            inferredCompanyName: 'SENA',
            normalizedName: 'sena',
            status: 'needs_review',
          },
        ],
        degraded: false,
      },
      batchContext: null,
    });

    assert.ok(
      admission.failedChecks.includes('active_duplicate_guard'),
      `el duplicate guard debe seguir fallando. failed=${admission.failedChecks.join(',')}`,
    );
    // Y el pase de ownership no lo rescata: sigue habiendo un check en 'failed'.
    assert.equal(
      isBlockedByCompanyOwnership(ownership('SENA', 'sena.edu.co')),
      false,
      'ownership pasa — el rechazo lo pone el duplicado, no el ownership',
    );
  });
});

// ─── D. Falsos positivos ──────────────────────────────────────────────────────

describe('P0 § D — .gov.co NO es un pase: sin correspondencia sigue siendo reject', () => {
  it('8. Nombre privado claramente incompatible + .gov.co → REJECT', () => {
    assertOwnershipReject('Ferretería El Tornillo', 'minambiente.gov.co');
  });

  it('9. Empresa privada + dominio .gov.co de otra entidad → REJECT', () => {
    assertOwnershipReject('Constructora Andina SAS', 'dian.gov.co');
  });

  it('Entidad pública real + dominio .gov.co de OTRA entidad pública → REJECT', () => {
    assertOwnershipReject('Ministerio de Ambiente', 'mineducacion.gov.co');
  });

  it('Alcaldía de OTRO municipio + segovia-antioquia.gov.co → REJECT', () => {
    assertOwnershipReject('Alcaldía de Medellín', 'segovia-antioquia.gov.co');
  });

  it('Alcaldía + dominio .gov.co sin correspondencia razonable → REJECT', () => {
    assertOwnershipReject('Alcaldía de Segovia', 'colombiacompra.gov.co');
  });

  it('Empresa privada con nombre institucional-adyacente + .gov.co ajeno → REJECT', () => {
    assertOwnershipReject('Instituto de Idiomas Bogotá', 'icbf.gov.co');
  });

  it('la sigla no puede ser de dos letras: nombre de 2 tokens + dominio de 2 letras → REJECT', () => {
    assertOwnershipReject('Ministerio Público', 'mp.gov.co');
  });
});

// ─── E. Casos sin dominio (P2 — semántica INTACTA) ────────────────────────────

describe('P0 § E — «sin dominio» conserva su semántica actual, separada de ownership_mismatch', () => {
  it('10. Sin dominio → sigue siendo el caso «no domain», no un mismatch de nombre', () => {
    const result = evaluateCompanyOwnership('Alcaldía de Segovia', null, null);
    assert.equal(result.allowed, false);
    assert.equal(result.confidence, 'reject');
    assert.deepEqual(result.missingSignals, ['domain']);
    assert.equal(result.reason, 'No domain available to evaluate ownership');
    assert.equal(result.domainIdentityKey, '');
  });

  it('sin dominio: el motivo NUNCA menciona una comparación nombre↔dominio', () => {
    const result = evaluateCompanyOwnership('Ministerio de Ambiente', null, null);
    assert.ok(
      !result.reason.includes('does not match'),
      'el reason de «sin dominio» no debe confundirse con el de mismatch',
    );
  });
});

// ─── F. No hay regresión en los casos privados que ya pasaban ─────────────────

describe('P0 § F — sin regresión en el comportamiento previo', () => {
  it('Nexen + nexen.com.co → PASS (igual que antes)', () => {
    assertOwnershipPass('Nexen', 'nexen.com.co');
  });

  it('Entelgy Colombia + entelgy.com → PASS (igual que antes)', () => {
    assertOwnershipPass('Entelgy Colombia', 'entelgy.com');
  });

  it('dominio genérico sin marca → sigue bloqueado', () => {
    assertOwnershipReject('Alpha Beta Gamma', 'software.com');
  });
});
