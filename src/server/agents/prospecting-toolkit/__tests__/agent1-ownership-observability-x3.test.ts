/**
 * agent1-ownership-observability-x3.test.ts
 *
 * AGENT1-OWNERSHIP-OBSERVABILITY-X3 — persistir la evidencia con la que el gate
 * de ownership decidió, sin cambiar ni una de sus decisiones.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * La certificación `wizard_run 5bfb5ff8ab52723e2dac881a41237c3b`, lote
 * `c7c28980-772b-425a-b548-581cfecb32f7` (CO × retail × target 5) dejó siete
 * `ownership_mismatch` que NO se pueden auditar. No por falta de datos del gate:
 * porque nadie los guardaba. `evaluateApolloPreWriterCompanyOwnership` calculaba
 * el nombre de evaluación y el dominio efectivo, se los pasaba a
 * `evaluateCompanyOwnership`, y los tiraba. Sobrevivía un booleano.
 *
 * Y el nombre no se reconstruye después: lo persistido es
 * `identity.canonicalName`, que ordena los tokens alfabéticamente. «Hotel
 * InterContinental Cartagena de Indias» acabó como «cartagena hotel indias
 * intercontinental». Es una clave de dedupe, y es irreversible.
 *
 * ── El trinquete ────────────────────────────────────────────────────────────
 *
 * X3 es OBSERVABILIDAD. El corpus de paridad de abajo fija el veredicto del gate
 * caso por caso: si alguien cambia una regla, la suite cae. Los tres defectos ya
 * identificados —D1 regla 4 muerta, D2 sin regla por tokens para privadas, D3 el
 * LinkedIn fuera del gate— quedan FUERA de este corte a propósito, y el corpus
 * los deja congelados tal como están hoy.
 *
 * Offline: sin red, sin Apollo, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
  type CompanyOwnershipResult,
} from '../company-ownership-gate';
import {
  evaluateApolloPreWriterCompanyOwnership,
  evaluateApolloPreWriterCompanyOwnershipWithInputs,
} from '../apollo-pre-writer-target-conditions';
import {
  summarizeApolloPreWriterOwnershipGate,
  readApolloPreWriterOwnershipGateSummary,
  APOLLO_PRE_WRITER_OWNERSHIP_GATE_KEY,
} from '../apollo-two-round/observability';
import {
  toOwnershipGateEvidence,
  resolveOwnershipGateEvidenceSource,
} from '@/modules/prospect-discards/mapping';

// ─── Corpus de paridad ────────────────────────────────────────────────────────

type OwnershipCorpusCase = {
  /** Etiqueta legible; no participa de la evaluación. */
  label: string;
  name: string;
  domain: string | null;
  expected: {
    allowed: boolean;
    confidence: CompanyOwnershipResult['confidence'];
    blocked: boolean;
    matchedSignals: string[];
    missingSignals: string[];
  };
};

/**
 * GRUPO A — el contrato del gate, caso por caso.
 *
 * Cubre lo que el corte exige explícitamente: `allowed`, `ownership_mismatch`,
 * ausencia de dominio, y —en el grupo B— casos con LinkedIn. Cada literal se
 * obtuvo EJECUTANDO el gate de `main`, no escribiéndolo a mano: es una foto del
 * comportamiento actual, que es justo lo que un trinquete de paridad debe fijar.
 */
const CONTRACT_CORPUS: readonly OwnershipCorpusCase[] = [
  {
    label: 'allowed · coincidencia exacta nombre↔dominio',
    name: 'Vaquita Express',
    domain: 'vaquitaexpress.com.co',
    expected: {
      allowed: true,
      confidence: 'high',
      blocked: false,
      matchedSignals: ['exact_domain_name_match'],
      missingSignals: [],
    },
  },
  {
    label: 'allowed · el dominio CONTIENE el nombre',
    name: 'Primavera',
    domain: 'tiendaprimavera.com',
    expected: {
      allowed: true,
      confidence: 'high',
      blocked: false,
      matchedSignals: ['domain_contains_company_name'],
      missingSignals: [],
    },
  },
  {
    label: 'allowed · correspondencia institucional territorial',
    name: 'Alcaldía de Segovia',
    domain: 'segovia-antioquia.gov.co',
    expected: {
      allowed: true,
      confidence: 'medium',
      blocked: false,
      matchedSignals: ['institutional_territorial_domain_match'],
      missingSignals: [],
    },
  },
  {
    label: 'allowed · abreviatura institucional',
    name: 'Ministerio de Ambiente',
    domain: 'minambiente.gov.co',
    expected: {
      allowed: true,
      confidence: 'medium',
      blocked: false,
      matchedSignals: ['institutional_abbreviation_domain_match'],
      missingSignals: [],
    },
  },
  {
    label: 'ownership_mismatch · empresa ajena a su dominio',
    name: 'Acme Manufacturing',
    domain: 'microsoft.com',
    expected: {
      allowed: false,
      confidence: 'reject',
      blocked: true,
      matchedSignals: [],
      missingSignals: ['domain_name_match'],
    },
  },
  {
    label: 'ownership_mismatch · D2 congelado — mismos tokens, otro orden',
    name: 'Supermercados Caribe',
    domain: 'caribesupermercados.co',
    expected: {
      allowed: false,
      confidence: 'reject',
      blocked: true,
      matchedSignals: [],
      missingSignals: ['domain_name_match'],
    },
  },
  {
    label: 'bloqueado low · raíz de dominio genérica',
    name: 'Dinámica CD',
    domain: 'software.com',
    expected: {
      allowed: false,
      confidence: 'low',
      blocked: true,
      matchedSignals: ['generic_domain_word'],
      missingSignals: ['specific_company_name_in_domain'],
    },
  },
  {
    label: 'sin dominio · el gate no tiene qué comparar',
    name: 'Postobón',
    domain: null,
    expected: {
      allowed: false,
      confidence: 'reject',
      blocked: true,
      matchedSignals: [],
      missingSignals: ['domain'],
    },
  },
];

/**
 * GRUPO B — los siete `ownership_mismatch` de la certificación.
 *
 * 🔴 LIMITACIÓN DECLARADA, no disimulada.
 *
 * Estos NO son los inputs que el gate juzgó en la corrida. El nombre crudo de
 * Apollo no se persistió en ninguna parte —ése es exactamente el agujero que X3
 * tapa hacia adelante— y reconstruirlo es imposible: `identity.canonicalName`
 * ordena los tokens alfabéticamente. Lo que viaja aquí es **lo único que
 * Producción conservó**: ese nombre canónico y el dominio real.
 *
 * Y el resultado lo prueba. Dos de los siete —`caribe supermercados` y
 * `primavera`— SALEN PERMITIDOS con el nombre que Producción guardó, cuando en
 * la corrida fueron rechazados. Eso no dice que el gate se equivocara: dice que
 * juzgó OTRO nombre, y que ese nombre era decisivo. Es la demostración empírica
 * de por qué hacía falta este corte, y por qué no se puede dictaminar sobre los
 * siete sin una corrida nueva que ya persista la evidencia.
 */
const CERTIFICATION_CORPUS: readonly OwnershipCorpusCase[] = [
  {
    label: 'cert · vaquita — canónico + dominio real',
    name: 'supermercados vaquita',
    domain: 'vaquitaexpress.com.co',
    expected: {
      allowed: false,
      confidence: 'reject',
      blocked: true,
      matchedSignals: [],
      missingSignals: ['domain_name_match'],
    },
  },
  {
    label: '🔴 cert · caribe — PERMITIDO con el nombre que Prod guardó',
    name: 'caribe supermercados',
    domain: 'caribesupermercados.co',
    expected: {
      allowed: true,
      confidence: 'high',
      blocked: false,
      matchedSignals: ['exact_domain_name_match'],
      missingSignals: [],
    },
  },
  {
    label: 'cert · comestibles ricos — marca ≠ razón social',
    name: 'comestibles oficial ricos',
    domain: 'superricas.com',
    expected: {
      allowed: false,
      confidence: 'reject',
      blocked: true,
      matchedSignals: [],
      missingSignals: ['domain_name_match'],
    },
  },
  {
    label: 'cert · copadpharma — sólo prefijo común',
    name: 'copadpharma',
    domain: 'copadeg.com',
    expected: {
      allowed: false,
      confidence: 'reject',
      blocked: true,
      matchedSignals: [],
      missingSignals: ['domain_name_match'],
    },
  },
  {
    label: 'cert · delgado — D2 congelado, la sigla privada no tiene regla',
    name: 'delgado distribuciones julio pastor',
    domain: 'dpjd.com',
    expected: {
      allowed: false,
      confidence: 'reject',
      blocked: true,
      matchedSignals: [],
      missingSignals: ['domain_name_match'],
    },
  },
  {
    label: '🔴 cert · primavera — PERMITIDO con el nombre que Prod guardó',
    name: 'primavera',
    domain: 'tiendaprimavera.com',
    expected: {
      allowed: true,
      confidence: 'high',
      blocked: false,
      matchedSignals: ['domain_contains_company_name'],
      missingSignals: [],
    },
  },
  {
    label: 'cert · intercontinental cartagena — abreviatura + topónimo',
    name: 'cartagena hotel indias intercontinental',
    domain: 'intercartagena.com',
    expected: {
      allowed: false,
      confidence: 'reject',
      blocked: true,
      matchedSignals: [],
      missingSignals: ['domain_name_match'],
    },
  },
];

const FULL_CORPUS = [...CONTRACT_CORPUS, ...CERTIFICATION_CORPUS];

function runGate(entry: OwnershipCorpusCase): CompanyOwnershipResult {
  return evaluateCompanyOwnership(
    entry.name,
    entry.domain ? `https://${entry.domain}` : null,
    entry.domain,
  );
}

describe('§ 1 · paridad — X3 no mueve ningún veredicto del gate', () => {
  for (const entry of FULL_CORPUS) {
    test(entry.label, () => {
      const verdict = runGate(entry);
      assert.equal(verdict.allowed, entry.expected.allowed);
      assert.equal(verdict.confidence, entry.expected.confidence);
      assert.equal(isBlockedByCompanyOwnership(verdict), entry.expected.blocked);
      assert.deepEqual(verdict.matchedSignals, entry.expected.matchedSignals);
      assert.deepEqual(verdict.missingSignals, entry.expected.missingSignals);
    });
  }

  test('el corpus cubre las categorías que el corte exige', () => {
    assert.ok(
      FULL_CORPUS.some((entry) => entry.expected.allowed),
      'allowed',
    );
    assert.ok(
      FULL_CORPUS.some((entry) => entry.expected.blocked && entry.domain !== null),
      'ownership_mismatch con dominio',
    );
    assert.ok(
      FULL_CORPUS.some((entry) => entry.domain === null),
      'caso sin dominio',
    );
    assert.equal(CERTIFICATION_CORPUS.length, 7, 'los siete de la certificación');
  });

  /**
   * 🔴 La limitación, escrita como aserción para que no se pueda olvidar.
   *
   * Si algún día alguien «arregla» el corpus poniendo nombres crudos inventados,
   * este test cae y obliga a justificar de dónde salieron.
   */
  test('dos de los siete salen PERMITIDOS con el nombre que Prod conservó', () => {
    const allowedInCorpus = CERTIFICATION_CORPUS.filter((entry) => entry.expected.allowed);
    assert.deepEqual(
      allowedInCorpus.map((entry) => entry.name).sort(),
      ['caribe supermercados', 'primavera'],
      'el nombre persistido NO es el que el gate juzgó: ésa es la razón de ser de X3',
    );
  });
});

// ─── Propagación: mismo veredicto, ahora con sus entradas ────────────────────

type PipelineCandidateLike = Parameters<typeof evaluateApolloPreWriterCompanyOwnership>[0];

function candidateOf(name: string, domain: string | null): PipelineCandidateLike {
  return {
    name,
    domain,
    website: domain ? `https://${domain}` : null,
  } as unknown as PipelineCandidateLike;
}

describe('§ 2 · propagación — se conserva el veredicto, no se recalcula', () => {
  for (const entry of FULL_CORPUS) {
    test(`${entry.label} — verdict idéntico al del evaluador de siempre`, () => {
      const candidate = candidateOf(entry.name, entry.domain);
      const legacy = evaluateApolloPreWriterCompanyOwnership(candidate);
      const withInputs = evaluateApolloPreWriterCompanyOwnershipWithInputs(candidate);

      // 🔴 M5 — si X3 volviera a evaluar en vez de propagar, aquí es donde se ve.
      assert.deepEqual(withInputs.verdict, legacy);
      assert.equal(isBlockedByCompanyOwnership(withInputs.verdict), entry.expected.blocked);
    });
  }

  test('las ENTRADAS del gate viajan: nombre de evaluación y dominio efectivo', () => {
    const candidate = candidateOf('Supermercados Caribe', 'caribesupermercados.co');
    const withInputs = evaluateApolloPreWriterCompanyOwnershipWithInputs(candidate);

    assert.equal(withInputs.evaluationName, 'Supermercados Caribe');
    assert.equal(withInputs.originalName, 'Supermercados Caribe');
    assert.equal(withInputs.recoveredFromDomain, false);
    assert.equal(withInputs.effectiveDomain, 'caribesupermercados.co');
  });

  test('sin dominio, el dominio efectivo es null y el gate lo dice', () => {
    const withInputs = evaluateApolloPreWriterCompanyOwnershipWithInputs(
      candidateOf('Postobón', null),
    );
    assert.equal(withInputs.effectiveDomain, null);
    assert.deepEqual(withInputs.verdict.missingSignals, ['domain']);
  });
});

// ─── Evidencia persistible ───────────────────────────────────────────────────

describe('§ 3 · toOwnershipGateEvidence copia, nunca deriva', () => {
  const verdict = {
    allowed: false,
    confidence: 'reject',
    reason: 'Domain "copadeg.com" does not match company name "Copadpharma"',
    matchedSignals: [] as string[],
    missingSignals: ['domain_name_match'],
    evaluationName: 'Copadpharma',
    recoveredFromDomain: false,
    effectiveDomain: 'copadeg.com',
  };

  test('cada campo del contrato aterriza con su nombre', () => {
    assert.deepEqual(toOwnershipGateEvidence(verdict), {
      allowed: false,
      confidence: 'reject',
      reason: 'Domain "copadeg.com" does not match company name "Copadpharma"',
      matched_signals: [],
      missing_signals: ['domain_name_match'],
      evaluation_name: 'Copadpharma',
      recovered_from_domain: false,
      effective_domain: 'copadeg.com',
    });
  });

  test('sin veredicto ⇒ null, jamás un veredicto fabricado', () => {
    assert.equal(toOwnershipGateEvidence(null), null);
    assert.equal(toOwnershipGateEvidence(undefined), null);
  });

  test('la ausencia se NOMBRA: not_evaluated ≠ rechazado', () => {
    assert.equal(resolveOwnershipGateEvidenceSource(verdict), 'pre_writer_final_gate');
    assert.equal(resolveOwnershipGateEvidenceSource(null), 'not_evaluated');
  });
});

// ─── El contador que publicaba 0 ─────────────────────────────────────────────

describe('§ 4 · el gate del orquestador tiene por fin su propio contador', () => {
  test('la forma de la certificación: 7 bloqueadas de 9 evaluadas', () => {
    // Los 9 que llegaron al gate final: 7 rechazados + 2 que pasaron ownership y
    // murieron por otra causa (sector contradictorio / cupo).
    const evaluations = [
      ...Array.from({ length: 7 }, () => ({ blocked: true, confidence: 'reject' })),
      { blocked: false, confidence: 'high' },
      { blocked: false, confidence: 'medium' },
    ];

    assert.deepEqual(summarizeApolloPreWriterOwnershipGate(evaluations), {
      evaluated_count: 9,
      blocked_count: 7,
      allowed_count: 2,
      blocked_by_confidence: { reject: 7 },
    });
  });

  /**
   * 🔴 La cifra NO son los quince. Los otros ocho murieron sin dominio en el
   * gate BARATO de elegibilidad: `evaluateCompanyOwnership` nunca corrió sobre
   * ellos, y atribuírselos sería inventar ocho decisiones que no tomó.
   */
  test('sólo cuenta a quien evaluó: los sin dominio no entran', () => {
    const summary = summarizeApolloPreWriterOwnershipGate([
      { blocked: true, confidence: 'reject' },
      { blocked: true, confidence: 'low' },
    ]);
    assert.equal(summary.evaluated_count, 2);
    assert.equal(summary.blocked_count, 2);
    assert.deepEqual(summary.blocked_by_confidence, { reject: 1, low: 1 });
  });

  test('cero evaluaciones se distingue de «no se midió»', () => {
    assert.deepEqual(summarizeApolloPreWriterOwnershipGate([]), {
      evaluated_count: 0,
      blocked_count: 0,
      allowed_count: 0,
      blocked_by_confidence: {},
    });
    // Leer una metadata que no declara el bloque devuelve null, no ceros.
    assert.equal(readApolloPreWriterOwnershipGateSummary({}), null);
    assert.equal(readApolloPreWriterOwnershipGateSummary(null), null);
    assert.equal(readApolloPreWriterOwnershipGateSummary('nope'), null);
  });

  test('el lector es fail-closed ante una forma corrupta', () => {
    assert.equal(
      readApolloPreWriterOwnershipGateSummary({
        [APOLLO_PRE_WRITER_OWNERSHIP_GATE_KEY]: { blocked_count: 'siete' },
      }),
      null,
    );
    assert.deepEqual(
      readApolloPreWriterOwnershipGateSummary({
        [APOLLO_PRE_WRITER_OWNERSHIP_GATE_KEY]: {
          evaluated_count: 9,
          blocked_count: 7,
          allowed_count: 2,
          blocked_by_confidence: { reject: 7 },
        },
      }),
      { evaluated_count: 9, blocked_count: 7, allowed_count: 2, blocked_by_confidence: { reject: 7 } },
    );
  });
});
