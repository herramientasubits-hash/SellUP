/**
 * AGENT1-OWNERSHIP-DOMAIN-TO-NAME-X6.9
 *
 * Los tres cortes que la auditoría X6.8 recomendó sobre el lote `71a6f75b`
 * (CO × Gobierno, 98 organizaciones únicas):
 *
 *   1. `invalid_domain` deja de contarse como decisión de ownership. De las 31
 *      filas `ownership_domain_rejected`, 10 eran empresas que Apollo devolvió
 *      SIN dominio: el gate nunca corrió sobre ellas.
 *   2. Regla dominio→nombre. Seis de los siete falsos positivos demostrables
 *      fallaban por la DIRECCIÓN de la pregunta.
 *   3. La regla de sigla deja de depender del léxico institucional. «Hospital
 *      Universitario de Santander» ↔ `hus.gov.co` tiene iniciales IDÉNTICAS a
 *      la etiqueta del dominio y la regla nunca llegaba a evaluarse.
 *
 * 🔴 El objetivo NO es maximizar aceptaciones. La mitad de este fichero son
 * aserciones de que el gate SIGUE rechazando: los cinco falsos positivos
 * conocidos (marca comercial ≠ razón social), los nombres sin contenido
 * distintivo, y `rtvc`. Una regla que sólo se prueba por lo que acepta no está
 * probada.
 *
 * Dos cosas que X6.9 probó y DESCARTÓ, ambas con su trinquete aquí:
 *
 *   · la variante «sigla + sufijo territorial» — sintácticamente funcionaba y
 *     no acreditaba nada: igualaba 49 organizaciones distintas (§ 4);
 *   · `rtvc` ↔ `senalcolombia.tv` — su evidencia no es textual, así que queda
 *     para X6.10 (§ 3c).
 *
 * Sin red, sin proveedor, sin base, sin reloj. Determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
} from '../company-ownership-gate';
import { evaluateDomainExplainedByCompanyName } from '../domain-name-coverage';
import { evaluateInstitutionalNameDomainCorrespondence } from '../institutional-domain-ownership';
import {
  ADMINISTRATIVE_QUALIFIER_WORDS,
  COLOMBIAN_DEPARTMENT_WORDS,
} from '../public-entity-lexicon';
import {
  evaluateApolloCandidateFinalDispositions,
  toCandidateFinalDispositionsMetadata,
} from '../apollo-two-round/candidate-final-disposition';
import { mapApolloFinalDispositionToCode } from '@/modules/prospect-discards/mapping';
import type { ApolloTwoRoundRunResult } from '../apollo-two-round/orchestrator';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Se invoca igual que en producción: `evaluateApolloPreWriterCompanyOwnershipWithInputs`
 * pasa el dominio efectivo como tercer argumento, que es el que manda.
 */
function ownership(name: string, domain: string) {
  return evaluateCompanyOwnership(name, `https://www.${domain}`, domain);
}

function assertAccepted(name: string, domain: string, expectedSignal?: string) {
  const result = ownership(name, domain);
  assert.equal(
    isBlockedByCompanyOwnership(result),
    false,
    `"${name}" + ${domain} debe ACEPTARSE. confidence=${result.confidence} reason=${result.reason}`,
  );
  if (expectedSignal !== undefined) {
    assert.ok(
      result.matchedSignals.includes(expectedSignal),
      `"${name}" + ${domain} debe acreditarse por "${expectedSignal}", no por ${JSON.stringify(result.matchedSignals)}`,
    );
  }
}

function assertRejected(name: string, domain: string) {
  const result = ownership(name, domain);
  assert.equal(
    isBlockedByCompanyOwnership(result),
    true,
    `"${name}" + ${domain} debe SEGUIR RECHAZADO. confidence=${result.confidence} signals=${JSON.stringify(result.matchedSignals)} reason=${result.reason}`,
  );
}

// ─── § 1 · `invalid_domain` deja de ser ownership ─────────────────────────────

/** Corrida mínima con UNA candidata rechazada definitivamente por `reason`. */
function runResultWithDefinitiveRejection(reason: string): ApolloTwoRoundRunResult {
  return {
    persisted: [],
    reviewOnly: [],
    notPersisted: [],
    enrichmentSkips: [],
    evaluatedCandidates: [
      {
        candidateKey: 'apollo:sin-dominio',
        roundNumber: 1,
        definitivelyRejected: true,
        definitiveRejectionReason: reason,
      },
    ],
  } as unknown as ApolloTwoRoundRunResult;
}

describe('X6.9 § 1 — una empresa sin dominio no es una decisión de ownership', () => {
  it('`invalid_domain` produce `missing_domain_final`, no `ownership_rejected_final`', () => {
    const [entry] = evaluateApolloCandidateFinalDispositions(
      runResultWithDefinitiveRejection('invalid_domain'),
    );

    assert.equal(entry?.finalDisposition, 'missing_domain_final');
    // 🔴 El motivo REAL se conserva intacto: se reclasifica el desenlace, no la causa.
    assert.equal(entry?.finalReason, 'invalid_domain');
    assert.equal(entry?.terminalStage, 'orchestrator_final');
  });

  it('`ownership_mismatch` SIGUE produciendo `ownership_rejected_final`', () => {
    const [entry] = evaluateApolloCandidateFinalDispositions(
      runResultWithDefinitiveRejection('ownership_mismatch'),
    );
    assert.equal(entry?.finalDisposition, 'ownership_rejected_final');
  });

  it('`external_platform_domain` SIGUE siendo ownership — sólo salió `invalid_domain`', () => {
    const [entry] = evaluateApolloCandidateFinalDispositions(
      runResultWithDefinitiveRejection('external_platform_domain'),
    );
    assert.equal(entry?.finalDisposition, 'ownership_rejected_final');
  });

  it('la empresa sin dominio SIGUE descartándose: nunca es `unclassified_final`', () => {
    const entries = evaluateApolloCandidateFinalDispositions(
      runResultWithDefinitiveRejection('invalid_domain'),
    );
    const metadata = toCandidateFinalDispositionsMetadata(entries);

    // El comportamiento del rechazo no cambia: sigue contada, sigue terminal,
    // y el invariante de «ningún candidato fantasma» se mantiene.
    assert.equal(metadata.unclassified_count, 0);
    assert.equal(metadata.total_unique_results, 1);
    assert.deepEqual(metadata.breakdown, { missing_domain_final: 1 });
  });

  it('persiste una fila de descarte real, fuera del cubo de ownership', () => {
    // `'other'` es vocabulario ya existente en el CHECK de la migración 138:
    // esta reclasificación NO necesita esquema nuevo.
    assert.equal(mapApolloFinalDispositionToCode('missing_domain_final'), 'other');
    assert.equal(mapApolloFinalDispositionToCode('ownership_rejected_final'), 'ownership_domain_rejected');
  });
});

// ─── § 2 · falsos positivos demostrables que se recuperan ─────────────────────

describe('X6.9 § 2 — los falsos positivos demostrables del lote 71a6f75b', () => {
  it('recupera los seis casos que se explican con el propio nombre', () => {
    // Cada uno con el defecto que lo mataba en X6.7:
    //   conectores pegados, sustantivo institucional omitido por el dominio,
    //   o etiqueta de dominio sin segmentar.
    assertAccepted(
      'Agencia de Renovación del Territorio',
      'renovacionterritorio.gov.co',
      'domain_explained_by_company_name',
    );
    assertAccepted(
      'Alcaldia de Bogotá Secretaría Distrital de Ambiente',
      'secretariadeambiente.gov.co',
      'domain_explained_by_company_name',
    );
    assertAccepted('Alcaldía Santa Rosa de Cabal', 'santarosadecabal-risaralda.gov.co');
    assertAccepted(
      'Caja de la Vivienda Popular',
      'cajaviviendapopular.gov.co',
      'domain_explained_by_company_name',
    );
    assertAccepted(
      'Concejo Municipal de Bello',
      'concejodebello.gov.co',
      'domain_explained_by_company_name',
    );
    assertAccepted(
      'Secretaría Distrital del Hábitat',
      'habitatbogota.gov.co',
      'domain_explained_by_company_name',
    );
  });

  it('«Hospital Universitario de Santander» ↔ hus.gov.co — sigla, sin puerta léxica', () => {
    // El caso que prueba el defecto del § 3: iniciales IDÉNTICAS a la etiqueta,
    // y la regla no corría porque «hospital» no está en el léxico institucional.
    assertAccepted(
      'Hospital Universitario de Santander',
      'hus.gov.co',
      'institutional_acronym_domain_match',
    );
  });

  it('la aceptación NO depende del TLD: el mismo par bajo .com se acepta igual', () => {
    // Si alguien introdujera un pase por `.gov.co`, este test lo caza.
    assertAccepted('Caja de la Vivienda Popular', 'cajaviviendapopular.com');
    assertAccepted('Concejo Municipal de Bello', 'concejodebello.com');
  });
});

// ─── § 3 · lo que NO debe empezar a aceptarse ────────────────────────────────

describe('X6.9 § 3 — los cinco falsos positivos conocidos siguen rechazados', () => {
  it('marca comercial ≠ razón social: ninguno se acepta', () => {
    // Necesitan un mapa marca↔propietario que la corrida no tiene. X6.9 no lo
    // inventa: prefiere el rechazo conservador.
    assertRejected('EPM', 'une.com.co');
    assertRejected('RCN TV', 'canalrcn.com');
    assertRejected('Caracol Televisión', 'caracoltv.com');
    assertRejected('Universidad de Nariño', 'udenar.edu.co');
    assertRejected('D1 S.A.S', 'tiendasd1.com');
  });

  it('«Caracol Televisión» ↔ caracoltv queda sin explicar', () => {
    // `caracol` SÍ es token del nombre, pero `tv` no es prefijo de «televisión»
    // (que empieza por «te»), así que el dominio no se descompone.
    const coverage = evaluateDomainExplainedByCompanyName(
      'Caracol Televisión',
      'caracoltv',
      new Set<string>(),
    );
    assert.equal(coverage.matched, false);
  });

  it('un prefijo CORTO del nombre no explica un trozo de dominio', () => {
    // 🔴 El test que pin(ch)a `MIN_NAME_STEM_LENGTH`. Sin un mínimo alto, `ba`
    // —dos letras de «Banco»— explicaría `baagrario`, y dos letras no son
    // evidencia de identidad: casi cualquier dominio encontraría una excusa.
    assert.equal(
      evaluateDomainExplainedByCompanyName('Banco Agrario', 'baagrario', new Set<string>()).matched,
      false,
    );
    assert.equal(
      evaluateDomainExplainedByCompanyName('Fondo Nacional Ahorro', 'foahorro', new Set<string>())
        .matched,
      false,
    );
    // El prefijo LARGO sí explica: «vivienda» abreviada a `vivien` son 6.
    assert.equal(
      evaluateDomainExplainedByCompanyName('Caja Vivienda Popular', 'cajavivienpopular', new Set<string>())
        .matched,
      true,
    );
  });
});

describe('X6.9 § 3c — `rtvc` queda FUERA de alcance, y se declara', () => {
  it('«rtvc» ↔ senalcolombia.tv sigue rechazado — pendiente de X6.10', () => {
    // 🔴 Es el único falso positivo demostrable de la auditoría X6.8 que X6.9
    // NO recupera, y la razón es de fondo, no de afinación: entre `rtvc` y
    // `senalcolombia` no hay coincidencia textual de ninguna clase — ni token,
    // ni prefijo, ni sigla (que además exige dos tokens, y «rtvc» es uno).
    //
    // Su evidencia es de otra naturaleza: el `linkedin_url` de su propia fila
    // en Producción, `linkedin.com/company/rtvc---senialcolombia`, que nombra
    // las dos marcas en una sola página de empresa. Admitirla obligaría a meter
    // una señal EXTERNA en `evaluateCompanyOwnership` y a recablear el
    // pre-writer, el orquestador y el writer — la función que hoy es
    // literalmente la misma en las tres capas.
    //
    // X6.9 no lo hace a propósito. X6.10 estudiará la evidencia no textual
    // (LinkedIn, relaciones marca↔propietario). Este test fija el estado
    // ACTUAL para que el cambio de X6.10 sea visible y deliberado, no un
    // efecto colateral.
    assertRejected('rtvc', 'senalcolombia.tv');
  });
});

describe('X6.9 § 3b — nombres sin contenido distintivo no se evalúan', () => {
  it('«Alcaldía» y «Alcaldía Municipal» siguen rechazados', () => {
    assertRejected('Alcaldía', 'gachancipa-cundinamarca.gov.co');
    assertRejected('Alcaldia Municipal', 'agustincodazzi-cesar.gov.co');
  });

  it('un nombre que es puro vocabulario institucional no acredita NINGÚN dominio', () => {
    // La condición 1 de la regla: sin token distintivo no hay identidad que
    // comparar, así que ni siquiera se intenta segmentar.
    for (const name of ['Alcaldía', 'Alcaldia Municipal', 'Secretaría Distrital']) {
      assert.equal(
        evaluateDomainExplainedByCompanyName(name, 'alcaldia', new Set<string>()).matched,
        false,
        `"${name}" no debe explicar ningún dominio`,
      );
    }
  });

  it('un dominio que sólo repite vocabulario territorial NO acredita a nadie', () => {
    // La condición 3: «Alcaldía de Segovia» tiene token distintivo («segovia»),
    // pero `antioquia` es sólo un departamento — no identifica a esta entidad.
    const coverage = evaluateDomainExplainedByCompanyName(
      'Alcaldía de Segovia',
      'antioquia',
      new Set<string>(),
    );
    assert.equal(coverage.matched, false);
    assertRejected('Alcaldía de Segovia', 'antioquia.gov.co');
  });

  it('un dominio ajeno sigue rechazado aunque el nombre sea rico', () => {
    assertRejected('Acme Manufacturing', 'microsoft.com');
    assertRejected('Alcaldía de Segovia', 'medellin.gov.co');
    assertRejected('Constructora Andina SAS', 'dian.gov.co');
  });
});

// ─── § 4 · la regla de sigla, desacoplada pero no relajada ───────────────────

describe('X6.9 § 4 — regla de sigla fuera del léxico institucional', () => {
  it('acepta por igualdad exacta aunque el nombre no sea institucional', () => {
    const result = evaluateInstitutionalNameDomainCorrespondence(
      'Hospital Universitario de Santander',
      'hus',
    );
    assert.equal(result.matched, true);
    assert.equal(result.signal, 'institutional_acronym_domain_match');
  });

  it('🔴 NO acepta sigla + sufijo territorial: igualaría 49 organizaciones distintas', () => {
    // X6.9 implementó esta variante y la RETIRÓ. «Secretaría de Educación
    // Departamental» no contiene ningún topónimo, así que su sigla `sed` valía
    // para un dominio por cada departamento del léxico. Este test es la prueba
    // que la condenó, convertida en trinquete para que no vuelva.
    const name = 'Secretaría de Educación Departamental';
    const accepted = [...COLOMBIAN_DEPARTMENT_WORDS, ...ADMINISTRATIVE_QUALIFIER_WORDS].filter(
      (suffix) => evaluateInstitutionalNameDomainCorrespondence(name, `sed${suffix}`).matched,
    );
    assert.deepEqual(
      accepted,
      [],
      `"${name}" no debe acreditar ningún dominio "sed<territorio>"; acreditaba ${accepted.length}`,
    );
    assert.equal(evaluateInstitutionalNameDomainCorrespondence(name, 'sedguaviare').matched, false);
    assertRejected(name, 'sedguaviare.gov.co');
  });

  it('la sigla exige la etiqueta ENTERA: un prefijo no basta', () => {
    // Lo que sobra del dominio nombraría algo que el nombre no dice. Es la
    // misma política que aplica `domain-name-coverage.ts` al rechazar
    // `secretariadeeducacion-yopal`, y las dos reglas no pueden discrepar.
    assert.equal(
      evaluateInstitutionalNameDomainCorrespondence('Hospital Universitario de Santander', 'husbucaramanga')
        .matched,
      false,
    );
  });

  it('acepta descartando un token final de país', () => {
    // «Instituto de Seguros Sociales, Colombia» → `issc` ≠ `iss`, pero sin el
    // calificativo final la sigla es exacta.
    const result = evaluateInstitutionalNameDomainCorrespondence(
      'Instituto de Seguros Sociales, Colombia',
      'iss',
    );
    assert.equal(result.matched, true);
  });

  it('NO acepta sigla + sufijo libre: haría falta un catálogo de municipios', () => {
    // `iesb` + `garzon` y `sem` + `cartago` son municipios, no vocabulario
    // cerrado. Reconocerlos exigiría el catálogo que este módulo prohíbe.
    assert.equal(
      evaluateInstitutionalNameDomainCorrespondence(
        'Institución Educativa Simón Bolívar',
        'iesbgarzon',
      ).matched,
      false,
    );
    assert.equal(
      evaluateInstitutionalNameDomainCorrespondence(
        'Secretaría de Educación Municipal',
        'semcartago',
      ).matched,
      false,
    );
  });

  it('una sigla de menos de tres letras sigue siendo ruido, no identidad', () => {
    // Es lo que mantiene fuera a «RCN TV» (rt), «Caracol Televisión» (ct) y
    // «Universidad de Nariño» (un).
    for (const [name, label] of [
      ['RCN TV', 'rt'],
      ['Caracol Televisión', 'ct'],
      ['Universidad de Nariño', 'un'],
    ] as const) {
      assert.equal(
        evaluateInstitutionalNameDomainCorrespondence(name, label).matched,
        false,
        `"${name}" no debe acreditarse con una sigla de dos letras`,
      );
    }
  });

  it('un nombre de un solo token no produce sigla', () => {
    assert.equal(evaluateInstitutionalNameDomainCorrespondence('EPM', 'epm').matched, false);
  });
});

// ─── § 5 · las reglas anteriores no se movieron ──────────────────────────────

describe('X6.9 § 5 — regresión: las reglas 1-5 conservan su contrato', () => {
  it('los casos del P0 de Gobierno siguen aceptándose por su regla original', () => {
    assertAccepted(
      'Alcaldía de Segovia',
      'segovia-antioquia.gov.co',
      'institutional_territorial_domain_match',
    );
    assertAccepted(
      'Ministerio de Ambiente',
      'minambiente.gov.co',
      'institutional_abbreviation_domain_match',
    );
  });

  it('la coincidencia exacta sigue siendo `high`, no `medium`', () => {
    const result = ownership('Bancolombia', 'bancolombia.com');
    assert.equal(result.confidence, 'high');
    assert.ok(result.matchedSignals.includes('exact_domain_name_match'));
  });

  it('sin dominio el gate sigue rechazando con `missing_signals: [domain]`', () => {
    const result = evaluateCompanyOwnership('Cualquier Empresa', null, null);
    assert.equal(result.allowed, false);
    assert.equal(result.confidence, 'reject');
    assert.deepEqual(result.missingSignals, ['domain']);
  });
});
