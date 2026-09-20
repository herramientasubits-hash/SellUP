/**
 * AGENT1-BUSINESS-FIT-OBSERVATION-ONLY — el ICP heredado deja de decidir.
 *
 * ── 🔴 La decisión de producto que estas pruebas fijan ──────────────────────
 *
 * Los criterios SELECCIONADOS gobiernan el perfil comercial del Agente 1. El
 * evaluador heredado `business_fit` —escrito para un ICP de B2B tech
 * (Hito 16AB.43.29: «SaaS / ERP / CRM / LMS / HR Tech»)— no excluye empresas por
 * `low` ni por `reject`:
 *
 *   · no bloquea admisión;
 *   · no decide aceptación;
 *   · no autoriza gasto;
 *   · no modifica ranking ni selección para enriquecimiento.
 *
 * Su resultado y su motivo SE CONSERVAN como observación.
 *
 * ── 🔴 Lo que estas pruebas NO permiten ─────────────────────────────────────
 *
 * · Que país, sector/subindustria, tamaño, identidad, ownership, plataforma
 *   externa o duplicados dejen de rechazar.
 * · Que `business_fit` reemplace a ninguno de ellos.
 * · Que una candidata se vuelva COMPLETA por neutralizar el encaje.
 * · Que la evidencia de país DÉBIL se confunda con la AUSENTE.
 * · Que el objetivo vuelva a ser un techo o que se relaje un tope de consumo.
 *
 * Puro: sin red, sin base, sin proveedor, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  evaluateBusinessFit,
  isBlockedByBusinessFit,
  type BusinessFitLevel,
} from '../business-fit-gate';
import { computeEvidencePersistencePolicy } from '../evidence-persistence-policy';
import { compareWriterEligibleRank } from '../candidate-writer-pure-gates';
import { evaluateApolloPreWriterQualityGate } from '../apollo-pre-writer-target-conditions';
import { evaluateCandidateTargetEligibility } from '../candidate-completeness-contract';
import { evaluateCountryCompatibility } from '../country-compatibility';
import { evaluateExternalPlatformGate } from '../external-platform-blocklist';

const ROOT = path.resolve(__dirname, '../../../../..');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

// ─── Fixtures: cuatro empresas que sólo se diferencian en su NIVEL de encaje ──

/**
 * 🔴 Todo lo demás es idéntico a propósito: mismo país, mismo dominio `.com.co`,
 * mismo tamaño, misma evidencia. Lo ÚNICO que cambia entre ellas es el nivel que
 * `evaluateBusinessFit` les asigna.
 */
const POR_NIVEL: ReadonlyArray<{
  nivel: BusinessFitLevel;
  name: string;
  domain: string;
  snippet: string | null;
}> = [
  {
    nivel: 'high',
    name: 'Nexen Software Solutions SAS',
    domain: 'nexensoftware.com.co',
    snippet: 'Plataforma SaaS de ERP y CRM para empresas en Colombia.',
  },
  {
    nivel: 'medium',
    name: 'Supermercados Vaquita',
    domain: 'vaquitaexpress.com.co',
    snippet: 'Cadena de supermercados en Bogotá, Colombia.',
  },
  {
    nivel: 'low',
    name: 'Distribuidora La Rebaja',
    domain: 'larebaja.com.co',
    snippet: 'Distribuidora de productos de consumo masivo en Colombia.',
  },
  {
    nivel: 'reject',
    name: 'Agencia de Marketing Digital Bogota',
    domain: 'agenciabogota.com.co',
    snippet: 'Somos una agencia de marketing digital en Colombia.',
  },
];

function fitDe(entry: (typeof POR_NIVEL)[number]) {
  return evaluateBusinessFit({
    name: entry.name,
    website: `https://${entry.domain}`,
    domain: entry.domain,
    sourceSnippet: entry.snippet,
    sourceTitle: null,
    subindustries: [],
    additionalCriteria: null,
  });
}

/** Candidato mínimo con tamaño por encima del umbral del ICP. */
function candidatoPipeline(entry: (typeof POR_NIVEL)[number]): unknown {
  return {
    name: entry.name,
    website: `https://${entry.domain}`,
    domain: entry.domain,
    sourceSnippet: entry.snippet,
    sourceTitle: null,
    companySize: '500-1000',
    scoring: { confidenceScore: 70 },
    duplicateCheck: { status: 'new', matches: [] },
  };
}

function gateDe(entry: (typeof POR_NIVEL)[number]) {
  return evaluateApolloPreWriterQualityGate({
    name: entry.name,
    website: `https://${entry.domain}`,
    domain: entry.domain,
    sourceSnippet: entry.snippet,
    sourceTitle: null,
    queryText: 'empresas en Colombia',
    targetCountryCode: 'CO',
    subindustries: [],
    additionalCriteria: null,
    candidate: candidatoPipeline(entry),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// § 1 — CAMBIAR SÓLO EL ENCAJE NO CAMBIA NADA QUE DECIDA
// ═════════════════════════════════════════════════════════════════════════════

describe('BF-OBS § 1 · el nivel de encaje no altera admisión, aceptación, gasto ni ranking', () => {
  it('🔴 los cuatro fixtures producen de verdad los cuatro niveles', () => {
    // Sin esto la sección siguiente podría quedarse verde por comparar cuatro
    // candidatas que resultaron tener el MISMO nivel.
    const niveles = POR_NIVEL.map((entry) => fitDe(entry).fit);
    assert.deepEqual(niveles, ['high', 'medium', 'low', 'reject']);
    assert.deepEqual(
      POR_NIVEL.map((entry) => isBlockedByBusinessFit(fitDe(entry))),
      [false, false, true, true],
      '🔴 dos de ellas eran RECHAZADAS por el criterio heredado',
    );
  });

  it('🔴 ACEPTACIÓN: el veredicto de calidad es el mismo para los cuatro', () => {
    const veredictos = POR_NIVEL.map((entry) => gateDe(entry).verdict);
    assert.deepEqual(
      veredictos,
      ['pass', 'pass', 'pass', 'pass'],
      '🔴 ni `low` ni `reject` fallan ya el `quality_gate`',
    );
    for (const entry of POR_NIVEL) {
      assert.equal(gateDe(entry).blockingReason, null, entry.name);
    }
  });

  it('🔴 GASTO y ACEPTACIÓN: la política de evidencia ya no puede leer el encaje', () => {
    // El trinquete más fuerte es el TIPO: `EvidencePersistencePolicyInput` ya no
    // tiene `businessFit`, así que pasarlo no compila. Aquí se comprueba el otro
    // lado: con la MISMA evidencia, el desenlace es único.
    for (const evidenceLevel of ['strong', 'query_only', 'weak'] as const) {
      const policy = computeEvidencePersistencePolicy({
        countryEvidence: { evidenceLevel, evidenceSources: [], warning: null },
      });
      assert.equal(
        policy.targetAcceptanceAuthorized,
        evidenceLevel !== 'weak',
        `aceptación/${evidenceLevel}`,
      );
      assert.equal(
        policy.paidCompletionAuthorized,
        evidenceLevel !== 'weak',
        `gasto/${evidenceLevel}`,
      );
    }
  });

  it('🔴 RANKING: el comparador ya no tiene término de encaje', () => {
    // Dos candidatas con idénticas señales de URL y país empatan en el
    // compuesto, sea cual sea su encaje: el bono ya no existe.
    const señales = {
      sourceUrlRankingBonus: 10,
      countryCompatWeight: 1,
      confidenceScore: 70,
      website: 'https://a.com.co',
    };
    assert.equal(
      compareWriterEligibleRank(señales, { ...señales, website: 'https://b.com.co' }),
      0,
      '🔴 empatan: nada las separa salvo lo que los criterios justifican',
    );
    // Y lo que SÍ ordena sigue ordenando.
    assert.ok(
      compareWriterEligibleRank({ ...señales, sourceUrlRankingBonus: 30 }, señales) < 0,
      'mejor calidad de URL sigue ganando',
    );
    assert.ok(
      compareWriterEligibleRank({ ...señales, countryCompatWeight: 0 }, señales) > 0,
      'peor compatibilidad de país sigue perdiendo',
    );
  });

  it('🔴 TRINQUETE ESTÁTICO: ningún consumidor de producción bloquea con el encaje', () => {
    const produccion = [
      'src/server/agents/prospecting-toolkit/candidate-writer.ts',
      'src/server/agents/prospecting-toolkit/apollo-pre-writer-target-conditions.ts',
      'src/server/agents/prospecting-toolkit/evidence-persistence-policy.ts',
      'src/server/agents/prospecting-toolkit/candidate-writer-pure-gates.ts',
    ];
    for (const rel of produccion) {
      const code = stripTsComments(read(rel));
      assert.ok(
        !code.includes('isBlockedByBusinessFit('),
        `🔴 ${rel} vuelve a bloquear por encaje`,
      );
      assert.ok(
        !code.includes('businessFitRankingBonus'),
        `🔴 ${rel} vuelve a ordenar por encaje`,
      );
    }
  });

  it('🔴 EN NEGATIVO: el trinquete sabe encontrar el bloqueo si vuelve', () => {
    const mutado = stripTsComments(
      read('src/server/agents/prospecting-toolkit/candidate-writer.ts'),
    ).replace('const businessFitResult = evaluateBusinessFit(', 'isBlockedByBusinessFit(x); const businessFitResult = evaluateBusinessFit(');
    assert.ok(mutado.includes('isBlockedByBusinessFit('), 'la copia mutada sí lo trae');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § 2 — PAÍS DÉBIL: R2 PARA TODOS, Y EL MOTIVO DISTINGUE
// ═════════════════════════════════════════════════════════════════════════════

describe('BF-OBS § 2 · evidencia de país débil no cuenta ni autoriza gasto', () => {
  it('🔴 `weak` sin señales ⇒ incompleta por AUSENCIA', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: { evidenceLevel: 'weak', evidenceSources: [], warning: null },
    });
    assert.equal(policy.targetAcceptanceAuthorized, false);
    assert.equal(policy.paidCompletionAuthorized, false);
    assert.equal(policy.incompletenessReason, 'country_evidence_absent');
    assert.equal(policy.primaryReason, 'country_evidence_absent_survives_incomplete');
    assert.equal(policy.decision, 'needs_review', 'sobrevive y va a revisión');
  });

  it('🔴 `weak` CON señales insuficientes ⇒ mismo desenlace, motivo DISTINTO', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: {
        evidenceLevel: 'weak',
        evidenceSources: ['snippet', 'title'],
        warning: null,
      },
    });
    assert.equal(policy.targetAcceptanceAuthorized, false);
    assert.equal(policy.paidCompletionAuthorized, false);
    assert.equal(
      policy.incompletenessReason,
      'country_evidence_weak',
      '🔴 evidencia DÉBIL no es evidencia AUSENTE',
    );
    assert.equal(policy.primaryReason, 'country_evidence_weak_survives_incomplete');
    assert.ok(
      policy.warnings.some((w) => w.includes('DÉBIL')),
      'y el warning lo dice con palabras',
    );
  });

  it('el tratamiento de revisión existente se conserva', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: { evidenceLevel: 'weak', evidenceSources: [], warning: null },
    });
    assert.equal(policy.forceReviewManually, true);
    assert.equal(policy.confidenceCap, 40);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § 3 — PAÍS FUERTE NO ES APROBACIÓN
// ═════════════════════════════════════════════════════════════════════════════

describe('BF-OBS § 3 · `strong` sigue dependiendo de todo lo demás', () => {
  it('🔴 `strong` autoriza, pero NO promociona a `ok` ni a completa', () => {
    const policy = computeEvidencePersistencePolicy({
      countryEvidence: { evidenceLevel: 'strong', evidenceSources: ['tld'], warning: null },
    });
    assert.equal(policy.decision, 'needs_review', '🔴 nadie se promociona por país');
    assert.equal(policy.targetAcceptanceAuthorized, true);
    assert.equal(policy.incompletenessReason, null);
  });

  it('🔴 con país FUERTE y calidad en `pass`, un solo criterio pendiente deja fuera', () => {
    const base = {
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    } as const;
    assert.equal(evaluateCandidateTargetEligibility(base).countsTowardTarget, true);

    for (const [campo, valor] of [
      ['subindustryMatch', 'not_confirmed'],
      ['employeeCountStatus', 'not_returned'],
      ['linkedinStatus', 'not_returned'],
      ['duplicateStatus', 'exact_duplicate'],
      ['ownershipGate', 'fail'],
    ] as const) {
      const eligibility = evaluateCandidateTargetEligibility({ ...base, [campo]: valor });
      assert.equal(
        eligibility.countsTowardTarget,
        false,
        `🔴 ${campo} sigue siendo obligatorio`,
      );
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § 4 — LOS FILTROS INDEPENDIENTES SIGUEN RECHAZANDO
// ═════════════════════════════════════════════════════════════════════════════

describe('BF-OBS § 4 · país, sector, ownership, duplicados y plataforma intactos', () => {
  it('país incompatible sigue rechazando, y no por encaje', () => {
    const compat = evaluateCountryCompatibility('https://www.maestro.com.pe', 'CO');
    assert.equal(compat.compatible, false);
  });

  it('plataforma externa sigue rechazando en la ruta de Apollo', () => {
    const gate = evaluateExternalPlatformGate('https://capterra.co/x', 'Capterra');
    assert.equal(gate.allowed, false);
  });

  it('🔴 una empresa incompatible con el SECTOR sigue sin aprobar ese criterio', () => {
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'not_confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(eligibility.countsTowardTarget, false);
    assert.ok(eligibility.failedConditions.includes('subindustry_match'));
  });

  it('🔴 el tamaño por debajo del umbral sigue rechazando en el gate PRE-writer', () => {
    const pequeña = {
      ...POR_NIVEL[0]!,
      name: 'Nexen Software Solutions SAS',
    };
    const gate = evaluateApolloPreWriterQualityGate({
      name: pequeña.name,
      website: `https://${pequeña.domain}`,
      domain: pequeña.domain,
      sourceSnippet: pequeña.snippet,
      sourceTitle: null,
      queryText: 'empresas en Colombia',
      targetCountryCode: 'CO',
      subindustries: [],
      additionalCriteria: null,
      candidate: {
        ...(candidatoPipeline(pequeña) as Record<string, unknown>),
        companySize: '1-10',
      },
    });
    assert.equal(gate.verdict, 'fail', '🔴 el ICP de TAMAÑO no es el ICP de encaje');
    assert.ok((gate.blockingReason ?? '').length > 0);
    assert.ok(
      !(gate.blockingReason ?? '').startsWith('business_fit'),
      'y su motivo no es el encaje',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § 5 — NADIE SE VUELVE COMPLETA POR ESTO
// ═════════════════════════════════════════════════════════════════════════════

describe('BF-OBS § 5 · neutralizar el encaje no completa a nadie', () => {
  it('🔴 la que el encaje rechazaba sigue necesitando TODAS las condiciones', () => {
    const rechazadaAntes = POR_NIVEL[3]!; // `reject`
    assert.equal(isBlockedByBusinessFit(fitDe(rechazadaAntes)), true, 'antes la mataba');
    assert.equal(gateDe(rechazadaAntes).verdict, 'pass', 'ahora pasa el gate de calidad');

    // Pero eso NO la vuelve completa: le faltan las demás condiciones.
    const eligibility = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'not_confirmed',
      employeeCountStatus: 'not_returned',
      linkedinStatus: 'not_returned',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });
    assert.equal(
      eligibility.countsTowardTarget,
      false,
      '🔴 pasar el gate de calidad NO es contar hacia el objetivo',
    );
  });

  it('el encaje se CONSERVA como observación, con su motivo', () => {
    const fit = fitDe(POR_NIVEL[3]!);
    assert.equal(fit.fit, 'reject');
    assert.ok(fit.reasons.length > 0, '🔴 el motivo no se pierde');
    const code = stripTsComments(read('src/server/agents/prospecting-toolkit/candidate-writer.ts'));
    assert.ok(code.includes('businessFitGateData'), 'los contadores siguen');
    assert.ok(code.includes('blocks_admission: false'), 'y la fila declara que ya no decide');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § 6 — EL MÍNIMO DE 5 Y LOS TOPES DE CONSUMO
// ═════════════════════════════════════════════════════════════════════════════

describe('BF-OBS § 6 · objetivo mínimo y topes de consumo, intactos', () => {
  it('🔴 ninguna parada del orquestador se deriva del objetivo (X6.13 sigue en pie)', () => {
    const code = stripTsComments(
      read('src/server/agents/prospecting-toolkit/apollo-two-round/orchestrator.ts'),
    );
    const stops = code.match(/stableFinalizableCandidateCount\(\)\) >= [A-Za-z.]+/g) ?? [];
    assert.deepEqual(stops, [], '🔴 el objetivo sigue siendo un mínimo, no un techo');
  });

  it('🔴 el writer no reintrodujo el tope por objetivo', () => {
    const code = stripTsComments(
      read('src/server/agents/prospecting-toolkit/candidate-writer.ts'),
    );
    // El anclaje POSITIVO primero: si el enunciado desapareciera, la guarda de
    // abajo se quedaría verde sin haber comprobado nada.
    assert.ok(code.includes('const toPersist = capOrdered'), 'el enunciado sigue existiendo');
    assert.ok(
      /const toPersist = capOrdered;/.test(code),
      '🔴 se persiste la lista ENTERA: ningún `.slice(` por objetivo',
    );
  });

  it('🔴 las paradas de GASTO de la paginación siguen todas en su sitio', () => {
    const code = stripTsComments(
      read('src/server/agents/prospecting-toolkit/apollo-organizations-pagination-budget.ts'),
    );
    for (const stop of [
      'max_credits_reached',
      'max_pages_reached',
      'time_budget_exhausted',
      'candidate_target_reached',
      'contract_page_ceiling',
      'last_page_reached',
    ]) {
      assert.ok(code.includes(stop), `🔴 falta la parada ${stop}`);
    }
  });
});
