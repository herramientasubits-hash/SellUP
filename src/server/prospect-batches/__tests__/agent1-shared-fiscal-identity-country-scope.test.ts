/**
 * AGENT1-SHARED-FISCAL-IDENTITY-COUNTRY-SCOPE-CORRECTION — suite dedicada.
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * Los dos checkers de duplicados emitían su señal fiscal FUERTE —`sellup 92` y
 * `hubspot 95`, ambas FUERTES para el lector compartido de CUT-L7— a partir de un
 * identificador fiscal DESNUDO, sin ámbito de país y sin la canonicalización
 * autoritativa de CUT-3B1:
 *
 *   · falso POSITIVO transfronterizo: un `123456789` colombiano y un `123456789`
 *     mexicano eran la MISMA empresa. En el pre-pago gratuito eso marcaba
 *     `sellup_known` y en Lusha post-pago `exact_duplicate`: una empresa distinta
 *     se descartaba EN SILENCIO;
 *   · falso NEGATIVO colombiano: el normalizador legacy en línea BORRABA el
 *     guion (`900123456-7` → `9001234567`) en vez de recortar el DV derivado, así
 *     que el MISMO NIT almacenado sin DV no igualaba.
 *
 * ── Qué prueba ────────────────────────────────────────────────────────────────
 *
 * Que la identidad fiscal fuerte exige PAÍS + CANÓNICO probados en ambos lados;
 * que la evidencia que no lo prueba se DEGRADA a bandas débiles REALES de
 * producción en vez de descartarse; y que el lector compartido de CUT-L7 sigue
 * leyendo `92`/`95` como fuertes sin haber sido modificado —el defecto era del
 * PRODUCTOR—.
 *
 * 🔴 Sobre el `123` de la especificación: `MIN_CANONICAL_FISCAL_LENGTH` de CUT-3B1
 * es 5, así que `123` NUNCA produce canónico y las matrices escritas con él
 * pasarían VACÍAS (ningún lado alcanzaría identidad, ni la correcta). Las
 * matrices se instrumentan con identificadores de longitud utilizable
 * (`123456789`, `900123456`) para que los casos POSITIVOS sean reales, y el
 * umbral se pinea aparte de forma explícita.
 *
 * 🔴 Lo que esta suite NO afirma: que Lusha sea seguro de activar; que se haya
 * resuelto la canonicalización global de nombres de país (`CO` vs `COL` vs
 * `Colombia` siguen siendo ámbitos distintos, deuda registrada); ni que ninguna
 * migración se haya aplicado. Este corte no añade migración: el techo sigue en 136.
 *
 * Pura y offline: dobles locales. Sin red, sin Supabase, sin HubSpot, sin Lusha,
 * sin Apollo. 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyFiscalDuplicateIdentity,
  classifyHubSpotFiscalResult,
  HUBSPOT_FISCAL_PROPERTIES,
} from '../../agents/prospecting-toolkit/fiscal-duplicate-classification';
import {
  buildFiscalIdentityKey,
  canonicalizeFiscalIdentifier,
  MIN_CANONICAL_FISCAL_LENGTH,
} from '../../agents/prospecting-toolkit/fiscal-identity';
import {
  classifyDuplicateIdentityEvidence,
  hasStrongIdentityDuplicateMatch,
} from '../../agents/prospecting-toolkit/strong-identity-duplicate-match';
import type { DuplicateMatch } from '../../agents/prospecting-toolkit/types';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * 🔴 Toda guarda estática lee el CÓDIGO, no la prosa: un comentario que NOMBRA lo
 * prohibido no puede reprobar la guarda por CITARLO. Nombrar no es hacer.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const readCode = (rel: string) => stripComments(read(rel));

const SELLUP_SRC = 'src/server/agents/prospecting-toolkit/sellup-duplicate-checker.ts';
const HUBSPOT_SRC = 'src/server/agents/prospecting-toolkit/hubspot-duplicate-checker.ts';
const READER_SRC = 'src/server/agents/prospecting-toolkit/strong-identity-duplicate-match.ts';
const CLASSIFIER_SRC =
  'src/server/agents/prospecting-toolkit/fiscal-duplicate-classification.ts';

// ─── Modelos de PRODUCTOR ─────────────────────────────────────────────────────
//
// Reproducen la ÚNICA decisión que cada checker toma sobre el eje fiscal, usando
// la MISMA autoridad compartida que el checker importa. Las confianzas son las
// REALES de producción: `sellup 92`, `hubspot 95` fuertes; `hubspot 85` débil.
// Las guardas estáticas del final prueban que los checkers de verdad delegan aquí.

/** Confianza fiscal que `sellup-duplicate-checker` emite para una fila leída. */
function sellUpFiscalMatch(params: {
  candidateCountryCode: string | null;
  candidateTaxId: string | null;
  rowCountryCode: string | null;
  rowTaxIdentifier: string | null;
}): DuplicateMatch | null {
  const verdict = classifyFiscalDuplicateIdentity({
    candidateCountryCode: params.candidateCountryCode,
    candidateTaxId: params.candidateTaxId,
    matchedCountryCode: params.rowCountryCode,
    matchedTaxId: params.rowTaxIdentifier,
  });
  if (!verdict.proven) return null;
  return {
    source: 'sellup',
    status: 'existing_in_sellup',
    confidence: 92,
    matchedTaxIdentifier: params.rowTaxIdentifier,
    reason: `Identificador fiscal exacto coincide (${verdict.namespace})`,
  };
}

/** Coincidencia que `hubspot-duplicate-checker` emite para un resultado fiscal. */
function hubSpotFiscalMatch(params: {
  candidateCountryCode: string | null;
  candidateTaxId: string | null;
  isOfficialTaxId?: boolean;
  properties: Record<string, unknown>;
}): DuplicateMatch {
  const verdict = classifyHubSpotFiscalResult({
    candidateCountryCode: params.candidateCountryCode,
    candidateTaxId: params.candidateTaxId,
    properties: params.properties,
  });
  const isOfficialTaxId = params.isOfficialTaxId ?? true;
  if (isOfficialTaxId && verdict.proven) {
    return {
      source: 'hubspot',
      status: 'existing_in_hubspot',
      confidence: 95,
      reason: 'Identificador fiscal exacto coincide en HubSpot',
    };
  }
  return {
    source: 'hubspot',
    status: 'possible_duplicate',
    confidence: 85,
    reason: 'Coincidencia fiscal en HubSpot SIN identidad probada',
  };
}

// ══════════════════════════════════════════════════════════════════════════════
describe('§ 2 · invariante central — la identidad fiscal exige PAÍS + CANÓNICO', () => {
  it('prueba identidad sólo cuando las SEIS condiciones están establecidas', () => {
    const verdict = classifyFiscalDuplicateIdentity({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456',
      matchedCountryCode: 'CO',
      matchedTaxId: '900123456',
    });
    assert.equal(verdict.proven, true);
    assert.equal(verdict.proven && verdict.canonical, '900123456');
    assert.equal(verdict.proven && verdict.namespace, 'CO');
  });

  it('§ 3 · MISMO número / PAÍS DISTINTO no es identidad', () => {
    const verdict = classifyFiscalDuplicateIdentity({
      candidateCountryCode: 'CO',
      candidateTaxId: '123456789',
      matchedCountryCode: 'MX',
      matchedTaxId: '123456789',
    });
    assert.equal(verdict.proven, false);
    assert.equal(verdict.proven === false && verdict.rejection, 'country_scope_mismatch');
  });

  it('§ 4 · MISMO número / país DESCONOCIDO no es identidad, en AMBAS direcciones', () => {
    const matchedMissing = classifyFiscalDuplicateIdentity({
      candidateCountryCode: 'CO',
      candidateTaxId: '123456789',
      matchedCountryCode: null,
      matchedTaxId: '123456789',
    });
    assert.equal(matchedMissing.proven, false);
    assert.equal(
      matchedMissing.proven === false && matchedMissing.rejection,
      'matched_country_unresolved',
    );

    const candidateMissing = classifyFiscalDuplicateIdentity({
      candidateCountryCode: null,
      candidateTaxId: '123456789',
      matchedCountryCode: 'CO',
      matchedTaxId: '123456789',
    });
    assert.equal(candidateMissing.proven, false);
    assert.equal(
      candidateMissing.proven === false && candidateMissing.rejection,
      'candidate_country_unresolved',
    );
  });

  it('un país en blanco o sólo espacios NO resuelve ámbito (fail-closed)', () => {
    for (const blank of ['', '   ', undefined]) {
      const verdict = classifyFiscalDuplicateIdentity({
        candidateCountryCode: blank,
        candidateTaxId: '900123456',
        matchedCountryCode: 'CO',
        matchedTaxId: '900123456',
      });
      assert.equal(verdict.proven, false);
    }
  });

  it('la caja del país NO parte la identidad: `co` == `CO`', () => {
    const verdict = classifyFiscalDuplicateIdentity({
      candidateCountryCode: 'co',
      candidateTaxId: '900123456',
      matchedCountryCode: 'CO',
      matchedTaxId: '900123456',
    });
    assert.equal(verdict.proven, true);
    assert.equal(verdict.proven && verdict.namespace, 'CO');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('§ 32 · matriz SellUp — el `92` se gana, no se regala', () => {
  const candidate = { candidateCountryCode: 'CO', candidateTaxId: '123456789' };

  it('S-A · CO:123456789 vs CO:123456789 → 92', () => {
    const match = sellUpFiscalMatch({
      ...candidate,
      rowCountryCode: 'CO',
      rowTaxIdentifier: '123456789',
    });
    assert.equal(match?.confidence, 92);
    assert.equal(match?.status, 'existing_in_sellup');
  });

  it('S-B · CO:123456789 vs MX:123456789 → NO 92', () => {
    assert.equal(
      sellUpFiscalMatch({ ...candidate, rowCountryCode: 'MX', rowTaxIdentifier: '123456789' }),
      null,
    );
  });

  it('S-C · CO:123456789 vs null:123456789 → NO 92', () => {
    assert.equal(
      sellUpFiscalMatch({ ...candidate, rowCountryCode: null, rowTaxIdentifier: '123456789' }),
      null,
    );
  });

  it('S-D · null:123456789 vs CO:123456789 → NO 92', () => {
    assert.equal(
      sellUpFiscalMatch({
        candidateCountryCode: null,
        candidateTaxId: '123456789',
        rowCountryCode: 'CO',
        rowTaxIdentifier: '123456789',
      }),
      null,
    );
  });

  it('S-E · CO:900123456 vs CO almacenado 900123456-7 → 92 (DV derivado)', () => {
    const match = sellUpFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456',
      rowCountryCode: 'CO',
      rowTaxIdentifier: '900123456-7',
    });
    assert.equal(match?.confidence, 92);
  });

  it('S-F · CO:900123456-7 vs CO almacenado 900123456 → 92 (formato inverso)', () => {
    const match = sellUpFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456-7',
      rowCountryCode: 'CO',
      rowTaxIdentifier: '900123456',
    });
    assert.equal(match?.confidence, 92);
  });

  it('S-G · CO:123456789 vs CO:99123456789 → NO 92 (canónicos distintos)', () => {
    assert.equal(
      sellUpFiscalMatch({ ...candidate, rowCountryCode: 'CO', rowTaxIdentifier: '99123456789' }),
      null,
    );
  });

  it('§ 10 · FISCAL-S3 · `NIT 900.123.456` == `900123456` bajo CO', () => {
    const match = sellUpFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: 'NIT 900.123.456',
      rowCountryCode: 'CO',
      rowTaxIdentifier: '900123456',
    });
    assert.equal(match?.confidence, 92);
  });

  it('un identificador por debajo del mínimo canónico NUNCA es identidad', () => {
    assert.equal(canonicalizeFiscalIdentifier('123', 'CO'), null);
    assert.ok(MIN_CANONICAL_FISCAL_LENGTH > 3);
    assert.equal(
      sellUpFiscalMatch({
        candidateCountryCode: 'CO',
        candidateTaxId: '123',
        rowCountryCode: 'CO',
        rowTaxIdentifier: '123',
      }),
      null,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('§ 33 · matriz HubSpot — el `95` se gana, no se regala', () => {
  it('H-A · candidato CO:123456789, HubSpot country CO nit 123456789 → 95', () => {
    const match = hubSpotFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '123456789',
      properties: { country: 'CO', nit: '123456789' },
    });
    assert.equal(match.confidence, 95);
    assert.equal(match.status, 'existing_in_hubspot');
  });

  it('H-B · HubSpot country MX mismo número → NO 95, débil 85 possible_duplicate', () => {
    const match = hubSpotFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '123456789',
      properties: { country: 'MX', nit: '123456789' },
    });
    assert.equal(match.confidence, 85);
    assert.equal(match.status, 'possible_duplicate');
  });

  it('H-C · HubSpot country null → NO 95', () => {
    const match = hubSpotFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '123456789',
      properties: { country: null, nit: '123456789' },
    });
    assert.equal(match.confidence, 85);
  });

  it('H-D · candidato sin país, HubSpot CO → NO 95', () => {
    const match = hubSpotFiscalMatch({
      candidateCountryCode: null,
      candidateTaxId: '123456789',
      properties: { country: 'CO', nit: '123456789' },
    });
    assert.equal(match.confidence, 85);
  });

  it('H-E · variantes de formato soportadas resuelven al MISMO canónico → 95', () => {
    for (const stored of ['900123456', '900123456-7', '900.123.456', 'NIT 900123456']) {
      const match = hubSpotFiscalMatch({
        candidateCountryCode: 'CO',
        candidateTaxId: '900.123.456',
        properties: { country: 'CO', nit: stored },
      });
      assert.equal(match.confidence, 95, `almacenado ${stored} debería probar identidad`);
    }
  });

  it('H-F · canónicos fiscales DISTINTOS → NO 95', () => {
    const match = hubSpotFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456',
      properties: { country: 'CO', nit: '900999999' },
    });
    assert.equal(match.confidence, 85);
  });

  it('§ 16 · `Colombia` en texto libre NO se declara equivalente a `CO` — degrada', () => {
    const match = hubSpotFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456',
      properties: { country: 'Colombia', nit: '900123456' },
    });
    assert.equal(match.confidence, 85, 'recall menor, pero jamás identidad global falsa');
    assert.equal(match.status, 'possible_duplicate');
  });

  it('acepta la identidad si CUALQUIERA de las propiedades fiscales iguala canónicamente', () => {
    const match = hubSpotFiscalMatch({
      candidateCountryCode: 'MX',
      candidateTaxId: 'ABC-010203-XY9',
      properties: { country: 'MX', nit: null, rfc: 'ABC010203XY9' },
    });
    assert.equal(match.confidence, 95);
  });

  it('sin NINGUNA propiedad fiscal en la respuesta no se puede probar → NO 95', () => {
    const match = hubSpotFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456',
      properties: { country: 'CO' },
    });
    assert.equal(match.confidence, 85);
  });

  it('§ 14 · un identificador CANDIDATO sigue sin ser identidad fuerte aunque pruebe', () => {
    const match = hubSpotFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456',
      isOfficialTaxId: false,
      properties: { country: 'CO', nit: '900123456' },
    });
    assert.equal(match.confidence, 85);
    assert.equal(match.status, 'possible_duplicate');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('§§ 11-13, 34 · normalización — se DELEGA en CUT-3B1, no se reinventa', () => {
  it('§ 11 · el DV colombiano sólo se recorta si va SEPARADO POR GUION', () => {
    assert.equal(canonicalizeFiscalIdentifier('900123456-7', 'CO'), '900123456');
    // Sin guion NO se adivina que el último dígito sea un DV.
    assert.equal(canonicalizeFiscalIdentifier('9001234567', 'CO'), '9001234567');
    assert.equal(
      sellUpFiscalMatch({
        candidateCountryCode: 'CO',
        candidateTaxId: '9001234567',
        rowCountryCode: 'CO',
        rowTaxIdentifier: '900123456',
      }),
      null,
      'adivinar el DV inventaría identidad',
    );
  });

  it('§§ 12, 34 · un identificador ALFANUMÉRICO conserva sus letras', () => {
    assert.equal(canonicalizeFiscalIdentifier('ABC-010203-XY9', 'MX'), 'abc010203xy9');
    const match = sellUpFiscalMatch({
      candidateCountryCode: 'MX',
      candidateTaxId: 'ABC-010203-XY9',
      rowCountryCode: 'MX',
      rowTaxIdentifier: 'abc010203xy9',
    });
    assert.equal(match?.confidence, 92);
  });

  it('§ 13 · los ceros a la izquierda se PRESERVAN (sin parseo numérico)', () => {
    assert.equal(canonicalizeFiscalIdentifier('000900123', 'CO'), '000900123');
    assert.notEqual(canonicalizeFiscalIdentifier('000900123', 'CO'), '900123');
    assert.equal(
      sellUpFiscalMatch({
        candidateCountryCode: 'CO',
        candidateTaxId: '000900123',
        rowCountryCode: 'CO',
        rowTaxIdentifier: '900123456',
      }),
      null,
    );
  });

  it('§ 42 · el clasificador NO añade reglas fiscales ni de país propias', () => {
    const classifier = readCode(CLASSIFIER_SRC);
    // Ninguna aritmética de dígito de verificación, ningún mapeo nombre→ISO.
    assert.doesNotMatch(classifier, /checkDigit|check_digit|parseInt|Number\(/);
    assert.doesNotMatch(classifier, /'Colombia'|"Colombia"|'COL'|Mexico|Brasil/);
    // Toda la semántica sale de la autoridad de CUT-3B1.
    assert.match(classifier, /from '\.\/fiscal-identity'/);
    assert.match(classifier, /canonicalizeFiscalIdentifier/);
    assert.match(classifier, /resolveFiscalCountryScope/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('§ 35 · regresión de NAMESPACE de país en los PRODUCTORES', () => {
  it('CO:123456789 != MX:123456789 a través de la clasificación de AMBOS checkers', () => {
    // No basta con `buildFiscalIdentityKey`: se prueba que los productores honran
    // la política.
    assert.notEqual(
      buildFiscalIdentityKey({ canonical: '123456789', countryCode: 'CO' }),
      buildFiscalIdentityKey({ canonical: '123456789', countryCode: 'MX' }),
    );

    assert.equal(
      sellUpFiscalMatch({
        candidateCountryCode: 'CO',
        candidateTaxId: '123456789',
        rowCountryCode: 'MX',
        rowTaxIdentifier: '123456789',
      }),
      null,
    );

    assert.notEqual(
      hubSpotFiscalMatch({
        candidateCountryCode: 'CO',
        candidateTaxId: '123456789',
        properties: { country: 'MX', nit: '123456789' },
      }).confidence,
      95,
    );
  });

  it('§ 28 · el registro de identidad de lote sigue coincidiendo con esta política', () => {
    // CO:123456789 vs CO:123456789 → duro; CO vs MX → conflicto fuerte distinto.
    assert.equal(
      buildFiscalIdentityKey({ canonical: '123456789', countryCode: 'CO' }),
      'CO:123456789',
    );
    assert.equal(
      buildFiscalIdentityKey({ canonical: '123456789', countryCode: null }),
      null,
      'sin país no hay clave: el identificador desnudo no es identidad global',
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('§§ 36, 37 · integración con el lector COMPARTIDO de CUT-L7', () => {
  it('§ 36 · `sellup 92` y `hubspot 95` siguen siendo FUERTES para el lector', () => {
    const sellup = sellUpFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456',
      rowCountryCode: 'CO',
      rowTaxIdentifier: '900123456',
    });
    assert.ok(sellup);
    assert.equal(classifyDuplicateIdentityEvidence(sellup).strength, 'strong');
    assert.equal(
      classifyDuplicateIdentityEvidence(sellup).axis,
      'exact_fiscal_identity',
    );

    const hubspot = hubSpotFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456',
      properties: { country: 'CO', nit: '900123456' },
    });
    assert.equal(hubspot.confidence, 95);
    assert.equal(classifyDuplicateIdentityEvidence(hubspot).strength, 'strong');
  });

  it('§ 36 · MISMO fiscal desnudo entre PAÍSES distintos → débil, y el lector dice NO', () => {
    const sellup = sellUpFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '123456789',
      rowCountryCode: 'MX',
      rowTaxIdentifier: '123456789',
    });
    assert.equal(sellup, null, 'el productor no emite señal fiscal alguna');

    const hubspot = hubSpotFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '123456789',
      properties: { country: 'MX', nit: '123456789' },
    });
    const evidence = classifyDuplicateIdentityEvidence(hubspot);
    assert.equal(evidence.strength, 'weak');
    assert.equal(evidence.axis, 'candidate_fiscal_identity');
    assert.equal(hasStrongIdentityDuplicateMatch([hubspot], 'hubspot'), false);
  });

  it('§ 37 · MISMA empresa CO con formatos distintos → fuerte a través del lector', () => {
    const sellup = sellUpFiscalMatch({
      candidateCountryCode: 'CO',
      candidateTaxId: '900123456-7',
      rowCountryCode: 'CO',
      rowTaxIdentifier: '900.123.456',
    });
    assert.ok(sellup, 'la corrección de normalización cerró el falso negativo');
    assert.equal(hasStrongIdentityDuplicateMatch([sellup], 'sellup'), true);
  });

  it('§ 23 · el lector compartido NO fue modificado por este corte', () => {
    const reader = readCode(READER_SRC);
    // No adquiere dependencia del clasificador ni del helper fiscal: sigue
    // respondiendo únicamente «¿el productor estableció el eje fuerte?».
    assert.doesNotMatch(reader, /fiscal-duplicate-classification/);
    assert.doesNotMatch(reader, /canonicalizeFiscalIdentifier|resolveFiscalCountryScope/);
    assert.doesNotMatch(reader, /country_code/);
    // Y su tabla de ejes sigue intacta en los dos ejes fiscales fuertes.
    assert.match(reader, /95: \{ axis: 'exact_domain', strong: true \}/);
    assert.match(reader, /92: \{ axis: 'exact_fiscal_identity', strong: true \}/);
    assert.match(reader, /95: \{ axis: 'exact_fiscal_identity', strong: true \}/);
    assert.match(reader, /85: \{ axis: 'candidate_fiscal_identity', strong: false \}/);
  });

  it('§ 39 · la política de NOMBRE de CUT-L7 no cambia: el nombre sigue DÉBIL', () => {
    const reader = readCode(READER_SRC);
    assert.match(reader, /88: \{ axis: 'normalized_name', strong: false \}/);
    assert.match(reader, /82: \{ axis: 'normalized_name', strong: false \}/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('§§ 24-27 · flujos — ninguno se bloquea por identidad fiscal falsa', () => {
  it('§ 24 · pre-pago: candidato CO no queda `sellup_known` por colisión con MX', () => {
    const matches = [
      sellUpFiscalMatch({
        candidateCountryCode: 'CO',
        candidateTaxId: '123456789',
        rowCountryCode: 'MX',
        rowTaxIdentifier: '123456789',
      }),
    ].filter((m): m is DuplicateMatch => m !== null);
    assert.equal(matches.length, 0);
    assert.equal(hasStrongIdentityDuplicateMatch(matches, 'sellup'), false);
  });

  it('§ 25 · Lusha: un fiscal oficial MX no produce `exact_duplicate` contra CO', () => {
    const hubspot = hubSpotFiscalMatch({
      candidateCountryCode: 'MX',
      candidateTaxId: '123456789',
      properties: { country: 'CO', nit: '123456789' },
    });
    assert.equal(hubspot.status, 'possible_duplicate');
    assert.equal(hasStrongIdentityDuplicateMatch([hubspot], 'hubspot'), false);
    // El candidato NO se descarta en silencio: sigue en evidencia revisable.
    assert.equal(classifyDuplicateIdentityEvidence(hubspot).strength, 'weak');
  });

  it('§ 26 · Apollo post-enriquecimiento: CO:123456789 vs MX:123456789 no bloquea', () => {
    assert.equal(
      sellUpFiscalMatch({
        candidateCountryCode: 'CO',
        candidateTaxId: '123456789',
        rowCountryCode: 'MX',
        rowTaxIdentifier: '123456789',
      }),
      null,
    );
  });

  it('§ 27 · el eje de DOMINIO no se debilita: `sellup 95` sigue fuerte', () => {
    const domainMatch: DuplicateMatch = {
      source: 'sellup',
      status: 'existing_in_sellup',
      confidence: 95,
      matchedDomain: 'ejemplo.com',
      reason: 'Dominio exacto coincide: ejemplo.com',
    };
    const evidence = classifyDuplicateIdentityEvidence(domainMatch);
    assert.equal(evidence.strength, 'strong');
    assert.equal(evidence.axis, 'exact_domain');
    // Y en el checker el dominio sigue evaluándose ANTES del eje fiscal.
    const sellup = readCode(SELLUP_SRC);
    assert.ok(
      sellup.indexOf(".eq('domain', domain)") <
        sellup.indexOf('classifyFiscalDuplicateIdentity({'),
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('§§ 6-9 · SellUp — el prefiltro recupera, la comparación decide', () => {
  it('el checker consume la autoridad compartida y ya NO el normalizador legacy', () => {
    const sellup = readCode(SELLUP_SRC);
    assert.match(sellup, /classifyFiscalDuplicateIdentity/);
    assert.match(sellup, /from '\.\/fiscal-duplicate-classification'/);
    // El normalizador legacy en línea desapareció como autoridad de igualdad.
    assert.doesNotMatch(sellup, /replace\(\/\[\\s\.\\-_\]\/g/);
    assert.doesNotMatch(sellup, /normalizeTaxIdentifier/);
    assert.doesNotMatch(sellup, /rowNormalized/);
    assert.doesNotMatch(sellup, /normalizedTaxId/);
  });

  it('§§ 7-8 · el bloque fiscal exige país Y canónico antes de emitir 92', () => {
    const sellup = readCode(SELLUP_SRC);
    const taxBlock = sellup.slice(
      sellup.indexOf('const candidateFiscalScope'),
      sellup.indexOf("// ── 3. normalized_name"),
    );
    assert.ok(taxBlock.length > 0);
    assert.match(taxBlock, /resolveFiscalCountryScope/);
    assert.match(taxBlock, /country_code/);
    assert.match(taxBlock, /matchedCountryCode: row\.country_code/);
    // El `92` vive DESPUÉS de la guarda del veredicto, no antes.
    const guard = taxBlock.indexOf('if (!verdict.proven) continue;');
    const strong = taxBlock.indexOf('confidence: 92');
    assert.ok(guard > 0 && strong > guard, 'el 92 debe estar detrás de la guarda');
  });

  it('§ 9 · el prefiltro sigue siendo substring y usa las agujas de CUT-3B1', () => {
    const sellup = readCode(SELLUP_SRC);
    assert.match(sellup, /buildFiscalLookupNeedles/);
    assert.match(sellup, /ilike\('tax_identifier'/);
    // Pero la recuperación NUNCA es la autoridad de identidad.
    const ilikeAt = sellup.indexOf("ilike('tax_identifier'");
    const verdictAt = sellup.indexOf('classifyFiscalDuplicateIdentity({');
    assert.ok(ilikeAt < verdictAt);
  });

  it('§ 9 · sin ámbito de país el eje fiscal no gasta ni una lectura', () => {
    const sellup = readCode(SELLUP_SRC);
    assert.match(sellup, /if \(candidateFiscalScope && fiscalNeedles\.canonical\.length > 0\)/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('§§ 14-21 · HubSpot — el `95` detrás de la validación canónica', () => {
  it('el checker consume la autoridad compartida', () => {
    const hubspot = readCode(HUBSPOT_SRC);
    assert.match(hubspot, /classifyHubSpotFiscalResult/);
    assert.match(hubspot, /from '\.\/fiscal-duplicate-classification'/);
    assert.match(hubspot, /isStrongFiscalIdentity/);
    const guard = hubspot.indexOf('const isStrongFiscalIdentity');
    const strong = hubspot.indexOf('confidence: 95');
    assert.ok(guard > 0 && strong > guard, 'el 95 debe estar detrás de la guarda');
  });

  it('§ 17 · la banda débil es la REAL de producción (85), no un número nuevo', () => {
    const hubspot = readCode(HUBSPOT_SRC);
    assert.match(hubspot, /confidence: 85/);
    // Ninguna confianza fiscal inventada.
    assert.doesNotMatch(hubspot, /confidence: (86|87|89|90|91|93|94|96)/);
  });

  it('§ 15 · el país NO se convierte en filtro de CONSULTA', () => {
    const hubspot = readCode(HUBSPOT_SRC);
    const searchFn = hubspot.slice(
      hubspot.indexOf('function buildFiscalSearchBody'),
      hubspot.indexOf('function classifyHubSpotResult'),
    );
    assert.ok(searchFn.length > 0);
    assert.doesNotMatch(searchFn, /propertyName: 'country'/);
    assert.doesNotMatch(searchFn, /propertyName: 'pais'/);
  });

  it('§ 16 · el país de la fila se usa como POST-filtro dentro del clasificador', () => {
    const classifier = readCode(CLASSIFIER_SRC);
    assert.match(classifier, /'country', 'pais'/);
    assert.match(classifier, /HUBSPOT_FISCAL_PROPERTIES/);
    assert.equal(HUBSPOT_FISCAL_PROPERTIES.length, 7);
  });

  it('§§ 19-20 · las agujas viajan en UN filtro `IN` acotado, no en más grupos', () => {
    const hubspot = readCode(HUBSPOT_SRC);
    assert.match(hubspot, /buildFiscalLookupNeedles/);
    assert.match(hubspot, /MAX_FISCAL_LOOKUP_NEEDLES/);
    assert.match(hubspot, /operator: 'IN'/);
    // Un `filterGroup` por propiedad: el número de grupos NO se multiplica.
    assert.match(hubspot, /filterGroups: properties\.map/);
    assert.doesNotMatch(hubspot, /needles\.flatMap|properties\.flatMap/);
  });

  it('§ 20 · el tope de agujas es determinístico y no recorta el canónico', () => {
    const hubspot = readCode(HUBSPOT_SRC);
    assert.match(hubspot, /const MAX_FISCAL_LOOKUP_NEEDLES = \d+/);
    // El canónico va PRIMERO en el orden, así que el `slice` nunca lo descarta.
    const fn = hubspot.slice(
      hubspot.indexOf('function buildBoundedFiscalNeedles'),
      hubspot.indexOf('function buildFiscalSearchBody'),
    );
    assert.ok(fn.indexOf('needles.canonical') < fn.indexOf('needles.lookupValues'));
    assert.match(fn, /new Set/);
    assert.match(fn, /\.slice\(/);
  });

  it('§ 21 · primario y fallback 400 comparten cuerpo, propiedades y agujas', () => {
    const hubspot = readCode(HUBSPOT_SRC);
    const fn = hubspot.slice(
      hubspot.indexOf('async function searchByTaxIdentifier'),
      hubspot.indexOf('function classifyHubSpotResult'),
    );
    // Un ÚNICO constructor de cuerpo para ambos caminos: la identidad no puede
    // depender de un HTTP 400.
    assert.equal((fn.match(/buildFiscalSearchBody\(/g) ?? []).length, 2);
    assert.match(fn, /res\.status === 400/);
    // Y ninguno vuelve al `EQ` sobre el valor crudo.
    assert.doesNotMatch(fn, /operator: 'EQ'/);
  });

  it('§ 14 · la respuesta fiscal PIDE las propiedades fiscales (sin ellas no hay prueba)', () => {
    const hubspot = readCode(HUBSPOT_SRC);
    assert.match(hubspot, /properties: \[\.\.\.new Set\(\[\.\.\.HS_PROPERTIES, \.\.\.HUBSPOT_FISCAL_PROPERTIES\]\)\]/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('§§ 22, 38, 42 · contrato, migración y alcance', () => {
  it('§ 22 · el contrato de salida `DuplicateMatch` no cambia', () => {
    const types = readCode('src/server/agents/prospecting-toolkit/types.ts');
    assert.match(types, /source: "sellup" \| "hubspot"/);
    assert.match(types, /confidence: number/);
    // Sin persistencia nueva ni campos nuevos en el tipo compartido.
    assert.doesNotMatch(types, /fiscalIdentityKey|fiscal_identity_key/);
  });

  it('§ 38 · el corte NO añade migración', () => {
    const classifier = readCode(CLASSIFIER_SRC);
    assert.doesNotMatch(classifier, /supabase|from\('/i);
    for (const src of [SELLUP_SRC, HUBSPOT_SRC]) {
      const code = readCode(src);
      assert.doesNotMatch(code, /alter table|create index|migration/i);
    }
  });

  it('§ 42 · el clasificador es PURO: sin red, sin Supabase, sin env, sin reloj', () => {
    const classifier = readCode(CLASSIFIER_SRC);
    assert.doesNotMatch(classifier, /\bfetch\s*\(/);
    assert.doesNotMatch(classifier, /process\.env/);
    assert.doesNotMatch(classifier, /Date\.now|new Date/);
    assert.doesNotMatch(classifier, /createClient/);
  });

  it('§ 29 · la deuda de canonicalización de país queda REGISTRADA', () => {
    // `CO`, `COL` y `Colombia` siguen siendo ámbitos distintos: se pinea el hecho
    // para que el corte siguiente no lo descubra por accidente.
    const co = buildFiscalIdentityKey({ canonical: '900123456', countryCode: 'CO' });
    const col = buildFiscalIdentityKey({ canonical: '900123456', countryCode: 'COL' });
    const colombia = buildFiscalIdentityKey({ canonical: '900123456', countryCode: 'Colombia' });
    assert.notEqual(co, col);
    assert.notEqual(co, colombia);
    assert.match(readCode(CLASSIFIER_SRC), /namespace !== matchedScope\.namespace/);
  });
});
