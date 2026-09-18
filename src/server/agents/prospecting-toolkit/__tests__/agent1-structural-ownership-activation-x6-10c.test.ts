/**
 * AGENT1-STRUCTURAL-OWNERSHIP-ACTIVATION-X6.10-C
 *
 * El corte que le da PODER a la evidencia estructural, y sólo en una dirección:
 * recuperar candidatas que el gate TEXTUAL rechaza.
 *
 * ── Lo que esta suite tiene que demostrar ────────────────────────────────────
 *
 *   1. que la recuperación ocurre, y sólo con evidencia E1 (§ 2);
 *   2. que NADA más recupera —ni LinkedIn, ni `insufficient_evidence`, ni un
 *      conjunto de alias que no acredita (§ 3);
 *   3. que los cinco falsos positivos conocidos de X6.9 siguen rechazados aunque
 *      ahora exista una vía nueva de admisión (§ 4);
 *   4. que una candidata que el gate ya admitía se admite EXACTAMENTE igual, y
 *      que `rejected` estructural no degrada a nadie (§ 5);
 *   5. que la procedencia de cada admisión queda trazada (§ 6);
 *   6. que la costura es UNA (§ 7).
 *
 * 🔴 Los siete casos del encargo tienen test individual en § 1, INCLUIDOS los
 * cinco que NO se recuperan. Un corte que sólo se prueba por lo que acepta no
 * está probado, y en este el reparto —dos de siete— es el resultado, no un
 * efecto colateral.
 *
 * Sin red, sin proveedor, sin base, sin reloj. Determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
} from '../company-ownership-gate';
import {
  evaluateStructuralDomainOwnership,
  type StructuralOwnershipResult,
} from '../structural-domain-ownership';
import {
  ADMITTING_STRUCTURAL_SOURCE,
  resolveCompanyOwnershipAdmission,
} from '../company-ownership-admission';
import {
  evaluateApolloPreWriterCompanyOwnershipWithInputs,
  toOwnershipAdmissionSnapshot,
} from '../apollo-pre-writer-target-conditions';
import { toOwnershipAdmissionEvidence } from '@/modules/prospect-discards/mapping';
import type { ProspectingPipelineCandidate } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function candidate(
  name: string,
  domain: string | null,
  aliases?: readonly string[],
  linkedIn?: string,
): ProspectingPipelineCandidate {
  return {
    name,
    website: domain === null ? null : `https://www.${domain}`,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'x',
    sourceUrl: domain === null ? null : `https://www.${domain}`,
    sourceTitle: name,
    sourceSnippet: null,
    websiteVerification: null,
    duplicateCheck: null,
    scoring: { qualityLabel: 'needs_review' } as ProspectingPipelineCandidate['scoring'],
    ...(aliases === undefined ? {} : { providerDomainAliases: aliases }),
    ...(linkedIn === undefined ? {} : { companyLinkedInUrl: linkedIn }),
  } as ProspectingPipelineCandidate;
}

/** La decisión REAL, por la misma entrada compartida que usa Producción. */
function admissionFor(
  name: string,
  domain: string | null,
  aliases?: readonly string[],
  linkedIn?: string,
) {
  return evaluateApolloPreWriterCompanyOwnershipWithInputs(
    candidate(name, domain, aliases, linkedIn),
  );
}

/** El veredicto TEXTUAL a secas, para afirmar qué habría pasado sin X6.10-C. */
function textualBlocks(name: string, domain: string): boolean {
  return isBlockedByCompanyOwnership(
    evaluateCompanyOwnership(name, `https://www.${domain}`, domain),
  );
}

function structuralOnly(
  name: string,
  domain: string,
  aliases: readonly string[],
  linkedIn: string | null = null,
): StructuralOwnershipResult {
  return evaluateStructuralDomainOwnership({
    companyName: name,
    domain,
    providerDomainAliases: aliases,
    providerLinkedInCompanyUrl: linkedIn,
    provenance: { provider: null, operation: null, observedAt: null },
  });
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// ─── § 1 · los SIETE casos del encargo, uno a uno ─────────────────────────────

describe('X6.10-C § 1 — los siete casos, con su desenlace real', () => {
  it('1.1 · RTVC ↔ senalcolombia.tv — RECUPERADA por el conjunto de alias', () => {
    // El caso que motivó X6.10 entero. Entre «rtvc» y `senalcolombia` no hay
    // relación textual de ninguna clase; la hay entre `rtvc.gov.co` y el nombre,
    // y el proveedor declara los dos dominios como de la misma organización.
    assert.equal(textualBlocks('rtvc', 'senalcolombia.tv'), true);

    const e = admissionFor('rtvc', 'senalcolombia.tv', ['senalcolombia.tv', 'rtvc.gov.co']);
    assert.equal(e.admission.blocked, false);
    assert.equal(e.admission.admittedBy, 'structural_alias_evidence');
    assert.equal(e.admission.recoveredByStructuralEvidence, true);
    // 🔴 El veredicto TEXTUAL no se reescribe: sigue diciendo lo que dijo.
    assert.equal(e.verdict.allowed, false);
    assert.equal(e.admission.textualConfidence, 'reject');
  });

  it('1.2 · RTVC SIN alias sigue rechazada — el LinkedIn real no la salva', () => {
    // 🔴 X6.10-C no introduce LinkedIn. Con el slug real de Producción
    // —`rtvc---senialcolombia`, que además difiere del dominio en una letra— la
    // candidata muere exactamente igual que antes del corte.
    const e = admissionFor(
      'rtvc',
      'senalcolombia.tv',
      undefined,
      'https://www.linkedin.com/company/rtvc---senialcolombia',
    );
    assert.equal(e.admission.blocked, true);
    assert.equal(e.admission.admittedBy, null);
  });

  it('1.3 · 🔴 EPM ↔ une.com.co — NO se recupera. Regresión negativa permanente', () => {
    // Que exista una relación societaria o de marca histórica no demuestra que
    // el dominio actual sea de la candidata. Apollo no agrupa `une.com.co` con
    // ningún dominio de EPM, así que no hay evidencia que evaluar — y ninguna
    // regla de este corte la fabrica.
    for (const aliases of [
      undefined,
      [] as string[],
      ['une.com.co'],
      ['une.com.co', 'tigo.com.co'],
    ]) {
      const e = admissionFor('EPM', 'une.com.co', aliases);
      assert.equal(e.admission.blocked, true, `EPM no puede admitirse (${JSON.stringify(aliases)})`);
      assert.equal(e.admission.recoveredByStructuralEvidence, false);
    }
  });

  it('1.4 · Caracol Televisión ↔ caracoltv.com — RECUPERADA por el conjunto de alias', () => {
    // X6.9 no puede resolverlo: `tv` no es prefijo de «televisión». El alias
    // `caracoltelevision.com` sí lo explica, y el proveedor los agrupa.
    assert.equal(textualBlocks('Caracol Televisión', 'caracoltv.com'), true);

    const e = admissionFor('Caracol Televisión', 'caracoltv.com', [
      'caracoltv.com',
      'caracoltelevision.com',
    ]);
    assert.equal(e.admission.blocked, false);
    assert.equal(e.admission.admittedBy, 'structural_alias_evidence');
  });

  it('1.5 · Universidad de Nariño ↔ udenar.edu.co — FUERA de alcance, sigue rechazada', () => {
    // `udenar` es una abreviatura institucional: su recuperación sería una
    // afinación de la regla de siglas de X6.9, no evidencia estructural. Este
    // corte no la toca, y con o sin alias que no acrediten sigue bloqueada.
    for (const aliases of [undefined, ['udenar.edu.co'], ['udenar.edu.co', 'cdn-x1.net']]) {
      const e = admissionFor('Universidad de Nariño', 'udenar.edu.co', aliases);
      assert.equal(e.admission.blocked, true);
    }
  });

  it('1.6 · D1 S.A.S ↔ tiendasd1.com — su rechazo real NO lo decide ownership', () => {
    // Su fila en Producción murió por `sellup_duplicate / same_active_domain`.
    // X6.10-C no puede cambiar eso, y sobre ownership tampoco tiene evidencia.
    const e = admissionFor('D1 S.A.S', 'tiendasd1.com');
    assert.equal(e.admission.blocked, true);
    assert.equal(e.admission.structuralOutcome, 'insufficient_evidence');
  });

  it('1.7 · Caja de la Vivienda Popular — YA la admitía X6.9: nada que recuperar', () => {
    // 🔴 El caso que demuestra que este corte no se atribuye trabajo ajeno: la
    // admite la regla 6 de X6.9, y la procedencia lo declara.
    assert.equal(textualBlocks('Caja de la Vivienda Popular', 'cajaviviendapopular.gov.co'), false);

    const e = admissionFor('Caja de la Vivienda Popular', 'cajaviviendapopular.gov.co');
    assert.equal(e.admission.blocked, false);
    assert.equal(e.admission.admittedBy, 'textual_gate');
    assert.equal(e.admission.recoveredByStructuralEvidence, false);
  });

  it('1.8 · Rodríguez y Asociados ↔ ryalaw.co — sin evidencia estructural, sigue rechazada', () => {
    // Su único puente sería el slug de LinkedIn, que este corte no usa.
    const e = admissionFor(
      'Rodríguez y Asociados',
      'ryalaw.co',
      undefined,
      'https://www.linkedin.com/company/rodríguez-y-asociados',
    );
    assert.equal(e.admission.blocked, true);
    assert.equal(e.admission.admittedBy, null);
  });
});

// ─── § 2 · qué evidencia ES suficiente ────────────────────────────────────────

describe('X6.10-C § 2 — la única evidencia que admite', () => {
  it('2.1 · E1 confirmada por el conjunto de alias admite', () => {
    const verdict = evaluateCompanyOwnership('rtvc', null, 'senalcolombia.tv');
    const structural = structuralOnly('rtvc', 'senalcolombia.tv', [
      'senalcolombia.tv',
      'rtvc.gov.co',
    ]);
    const d = resolveCompanyOwnershipAdmission(verdict, structural);
    assert.equal(d.blocked, false);
    assert.equal(d.admittedBy, 'structural_alias_evidence');
    assert.equal(d.structuralSignal, 'alias_domain_accredited_by_company_name');
  });

  it('2.2 · la fuente autorizada es UNA y está nombrada', () => {
    assert.equal(ADMITTING_STRUCTURAL_SOURCE, 'provider_domain_alias_set');
  });
});

// ─── § 3 · qué evidencia NO es suficiente ─────────────────────────────────────

describe('X6.10-C § 3 — lo que NO admite', () => {
  it('3.1 · `insufficient_evidence` deja el veredicto textual intacto', () => {
    const verdict = evaluateCompanyOwnership('rtvc', null, 'senalcolombia.tv');
    const d = resolveCompanyOwnershipAdmission(
      verdict,
      structuralOnly('rtvc', 'senalcolombia.tv', []),
    );
    assert.equal(d.blocked, true);
    assert.equal(d.blocked, isBlockedByCompanyOwnership(verdict));
  });

  it('3.2 · 🔴 LinkedIn NO admite, por fuerte que sea su apoyo', () => {
    // Seis pares medidos en Producción con `linkedInCorroboration: supports`.
    // Ninguno puede admitir: E2 no es fuente decisoria en X6.10-A, y este
    // consumidor además exige explícitamente la fuente de alias.
    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      ['La Vaquita Supermercados', 'vaquitaexpress.com.co', 'linkedin.com/company/inversiones-vaquita-express'],
      ['Sinmente. CO.', 'sinmente.co', 'linkedin.com/company/sinmente'],
      ['CityDent® Clínicas Dentales De Colombia', 'citydent.com.co', 'linkedin.com/company/citydentcolombia'],
      ['PRIMARIO', '1primario.com', 'linkedin.com/company/1primario'],
      ['Mister Pollo MRP', 'misterpollo.co', 'linkedin.com/company/mister-pollo-colombia'],
      ['DISTRIBUCIONES PASTOR JULIO DELGADO', 'dpjd.com', 'linkedin.com/company/dpjd'],
    ];
    for (const [name, domain, linkedIn] of pairs) {
      const structural = structuralOnly(name, domain, [], linkedIn);
      const verdict = evaluateCompanyOwnership(name, null, domain);
      const d = resolveCompanyOwnershipAdmission(verdict, structural);
      // La admisión, si la hay, tiene que venir del gate textual — jamás de
      // LinkedIn.
      assert.notEqual(d.admittedBy, 'structural_alias_evidence');
      assert.equal(d.recoveredByStructuralEvidence, false);
    }
  });

  it('3.3 · una fuente estructural que NO sea el conjunto de alias no admite', () => {
    // 🔴 El segundo cerrojo: aunque alguien fabricara un `confirmed` con
    // procedencia de LinkedIn —que X6.10-A impide—, este consumidor lo rechaza.
    const verdict = evaluateCompanyOwnership('rtvc', null, 'senalcolombia.tv');
    const forged: StructuralOwnershipResult = {
      outcome: 'confirmed',
      decidingSource: 'provider_linkedin_company_slug',
      signal: 'linkedin_slug_bridge',
      detail: 'fabricado para el test',
      linkedInCorroboration: 'supports',
      evaluatedSources: ['provider_linkedin_company_slug'],
      absentSources: ['provider_domain_alias_set'],
    };
    const d = resolveCompanyOwnershipAdmission(verdict, forged);
    assert.equal(d.blocked, true);
    assert.equal(d.admittedBy, null);
  });

  it('3.3b · 🔴 el desenlace tiene que ser `confirmed`, no «no rechazado»', () => {
    // El mutation testing lo pidió: cambiar `outcome === 'confirmed'` por
    // `outcome !== 'rejected'` NO cambiaba nada, porque hoy X6.10-A sólo pone
    // `decidingSource` cuando el desenlace es confirmed o rejected. Esa
    // equivalencia depende de un invariante de OTRO módulo, así que aquí se
    // fija en el consumidor: una evidencia insuficiente con procedencia de
    // alias —que A no produce, pero este módulo no puede dar por hecho— no
    // admite a nadie.
    const verdict = evaluateCompanyOwnership('rtvc', null, 'senalcolombia.tv');
    const insufficientButSourced: StructuralOwnershipResult = {
      outcome: 'insufficient_evidence',
      decidingSource: 'provider_domain_alias_set',
      signal: null,
      detail: 'insuficiente, pero con procedencia declarada',
      linkedInCorroboration: 'absent',
      evaluatedSources: ['provider_domain_alias_set'],
      absentSources: ['provider_linkedin_company_slug'],
    };
    const d = resolveCompanyOwnershipAdmission(verdict, insufficientButSourced);
    assert.equal(d.blocked, true);
    assert.equal(d.admittedBy, null);
  });

  it('3.4 · un conjunto de un solo elemento no admite (lo descarta X6.10-A)', () => {
    const e = admissionFor('rtvc', 'senalcolombia.tv', ['senalcolombia.tv']);
    assert.equal(e.admission.blocked, true);
  });

  it('3.5 · un conjunto de puro ruido no admite', () => {
    const e = admissionFor('rtvc', 'senalcolombia.tv', ['senalcolombia.tv', 'cdn-x9.net']);
    assert.equal(e.admission.blocked, true);
  });
});

// ─── § 4 · los cinco FP de X6.9 siguen rechazados ─────────────────────────────

describe('X6.10-C § 4 — la vía nueva no valida los falsos positivos de X6.9', () => {
  /**
   * Los cinco pares que X6.9 fijó como marca comercial ≠ razón social. La vía
   * de admisión es nueva; el rechazo tiene que seguir siendo el mismo.
   *
   * 🔴 Se prueban SIN alias y con alias que NO acreditan. Con un conjunto que
   * el proveedor agrupara de verdad, E1 los admitiría — y eso es la frontera de
   * confianza declarada de X6.10-A, no un defecto de este corte.
   */
  const KNOWN_FALSE_POSITIVES: ReadonlyArray<readonly [string, string]> = [
    ['EPM', 'une.com.co'],
    ['RCN TV', 'canalrcn.com'],
    ['Caracol Televisión', 'caracoltv.com'],
    ['Universidad de Nariño', 'udenar.edu.co'],
    ['D1 S.A.S', 'tiendasd1.com'],
  ];

  for (const [name, domain] of KNOWN_FALSE_POSITIVES) {
    it(`4.1 · «${name}» ↔ ${domain} sigue rechazado sin evidencia de alias`, () => {
      for (const aliases of [undefined, [] as string[], [domain], [domain, 'ruido-xyz.net']]) {
        const e = admissionFor(name, domain, aliases);
        assert.equal(
          e.admission.blocked,
          true,
          `${name} + ${domain} con ${JSON.stringify(aliases)} debe seguir bloqueado`,
        );
      }
    });
  }

  it('4.2 · 🔴 un nombre GENÉRICO no se acredita con su dominio homónimo', () => {
    // El hueco que esta suite destapó y X6.10-C cerró en E1: las reglas 1-4 del
    // gate son de subcadena y no tienen la guarda de contenido distintivo de la
    // regla 6. «Alcaldía» contra `alcaldia.gov.co` es coincidencia EXACTA
    // (`confidence: high`), así que un nombre que no identifica a nadie se
    // acreditaba a sí mismo y arrastraba por E1 a cualquier otro dominio que el
    // proveedor agrupara — sin que nadie supiera de qué alcaldía se hablaba.
    const e = admissionFor('Alcaldía', 'gachancipa-cundinamarca.gov.co', [
      'gachancipa-cundinamarca.gov.co',
      'alcaldia.gov.co',
    ]);
    assert.equal(e.admission.blocked, true);

    // El alias probatorio SÍ lo acredita el gate: la guarda no está ahí, está en
    // la puerta de entrada de E1. Sin esta aserción el test no diría por qué.
    assert.equal(
      isBlockedByCompanyOwnership(evaluateCompanyOwnership('Alcaldía', null, 'alcaldia.gov.co')),
      false,
    );

    // Y la guarda es del NOMBRE, no del caso: los mismos alias con un nombre que
    // sí identifica siguen admitiendo.
    const identified = admissionFor('Alcaldía de Gachancipá', 'gachancipa-cundinamarca.gov.co', [
      'gachancipa-cundinamarca.gov.co',
      'gachancipa.gov.co',
    ]);
    assert.equal(identified.admission.blocked, false);
  });

  it('4.2b · 🔴 un token de DOS letras no identifica a nadie', () => {
    // Pin del umbral `MIN_IDENTIFYING_TOKEN_LENGTH`. Sin él, bajarlo a 1 dejaba
    // la suite en verde y «Alcaldía de XY» pasaría a acreditarse: dos letras de
    // ruido no son identidad. Tres sí, porque una sigla corta puede ser una
    // razón social legítima —y por eso el umbral no sube más—.
    const noise = admissionFor('Alcaldía de XY', 'gachancipa-cundinamarca.gov.co', [
      'gachancipa-cundinamarca.gov.co',
      'xy.gov.co',
    ]);
    assert.equal(noise.admission.blocked, true);

    // Y con TRES letras el mismo nombre sí identifica: el umbral es el que es.
    const acronym = admissionFor('Alcaldía de XYZ', 'gachancipa-cundinamarca.gov.co', [
      'gachancipa-cundinamarca.gov.co',
      'xyz.gov.co',
    ]);
    assert.equal(acronym.admission.blocked, false);
  });

  it('4.3 · otros nombres sin contenido propio tampoco se acreditan', () => {
    for (const [name, domain, alias] of [
      ['Alcaldía Municipal', 'agustincodazzi-cesar.gov.co', 'alcaldiamunicipal.gov.co'],
      ['Secretaría Departamental', 'sedguaviare.gov.co', 'secretariadepartamental.gov.co'],
    ] as const) {
      const e = admissionFor(name, domain, [domain, alias]);
      assert.equal(e.admission.blocked, true, `«${name}» no identifica a nadie`);
    }
  });
});

// ─── § 5 · no eleva y no degrada ──────────────────────────────────────────────

describe('X6.10-C § 5 — sólo recupera: ni eleva ni degrada', () => {
  it('5.1 · una candidata que el gate ya admitía se admite IGUAL', () => {
    const accepted: ReadonlyArray<readonly [string, string]> = [
      ['Caja de la Vivienda Popular', 'cajaviviendapopular.gov.co'],
      ['Concejo Municipal de Bello', 'concejodebello.gov.co'],
      ['Hospital Universitario de Santander', 'hus.gov.co'],
      ['Sinmente. CO.', 'sinmente.co'],
    ];
    for (const [name, domain] of accepted) {
      assert.equal(textualBlocks(name, domain), false, `${name} debería pasar el gate textual`);
      const e = admissionFor(name, domain);
      assert.equal(e.admission.blocked, false);
      assert.equal(e.admission.admittedBy, 'textual_gate');
      assert.equal(e.admission.recoveredByStructuralEvidence, false);
    }
  });

  it('5.2 · 🔴 `rejected` estructural NO degrada a quien el gate admite', () => {
    // E1 sabe detectar una contradicción —el proveedor enumera los dominios de
    // la organización y éste no está—. En X6.10-C esa contradicción se registra
    // y NO bloquea: quitar candidatas que hoy pasan es un corte de signo
    // contrario, con su propia autorización.
    const verdict = evaluateCompanyOwnership(
      'Caja de la Vivienda Popular',
      null,
      'cajaviviendapopular.gov.co',
    );
    assert.equal(isBlockedByCompanyOwnership(verdict), false);

    const contradicting: StructuralOwnershipResult = {
      outcome: 'rejected',
      decidingSource: 'provider_domain_alias_set',
      signal: 'domain_absent_from_accredited_alias_set',
      detail: 'el conjunto no contiene el dominio juzgado',
      linkedInCorroboration: 'absent',
      evaluatedSources: ['provider_domain_alias_set'],
      absentSources: ['provider_linkedin_company_slug'],
    };
    const d = resolveCompanyOwnershipAdmission(verdict, contradicting);
    assert.equal(d.blocked, false);
    assert.equal(d.admittedBy, 'textual_gate');
    assert.equal(d.structuralOutcome, 'rejected');
  });

  it('5.3 · `rejected` tampoco convierte en admitida a una bloqueada', () => {
    const verdict = evaluateCompanyOwnership('rtvc', null, 'senalcolombia.tv');
    const contradicting: StructuralOwnershipResult = {
      outcome: 'rejected',
      decidingSource: 'provider_domain_alias_set',
      signal: 'domain_absent_from_accredited_alias_set',
      detail: 'x',
      linkedInCorroboration: 'absent',
      evaluatedSources: ['provider_domain_alias_set'],
      absentSources: ['provider_linkedin_company_slug'],
    };
    assert.equal(resolveCompanyOwnershipAdmission(verdict, contradicting).blocked, true);
  });
});

// ─── § 6 · trazabilidad ───────────────────────────────────────────────────────

describe('X6.10-C § 6 — se puede saber QUIÉN admitió a cada candidata', () => {
  it('6.1 · la recuperación viaja hasta la fila de descartes', () => {
    const e = admissionFor('rtvc', 'senalcolombia.tv', ['senalcolombia.tv', 'rtvc.gov.co']);
    const snapshot = toOwnershipAdmissionSnapshot(e);
    assert.equal(snapshot.blocked, false);
    assert.equal(snapshot.admittedBy, 'structural_alias_evidence');
    assert.equal(snapshot.recoveredByStructuralEvidence, true);
    // 🔴 La combinación que sin este campo sería ilegible: el gate textual dice
    // `reject` y la candidata sobrevivió.
    assert.equal(snapshot.textualConfidence, 'reject');

    const row = toOwnershipAdmissionEvidence(snapshot);
    assert.equal(row?.admitted_by, 'structural_alias_evidence');
    assert.equal(row?.recovered_by_structural_evidence, true);
    assert.equal(row?.textual_confidence, 'reject');
  });

  it('6.2 · una admisión textual se distingue de una recuperación', () => {
    const textual = toOwnershipAdmissionSnapshot(
      admissionFor('Caja de la Vivienda Popular', 'cajaviviendapopular.gov.co'),
    );
    const recovered = toOwnershipAdmissionSnapshot(
      admissionFor('Caracol Televisión', 'caracoltv.com', [
        'caracoltv.com',
        'caracoltelevision.com',
      ]),
    );
    assert.equal(textual.admittedBy, 'textual_gate');
    assert.equal(recovered.admittedBy, 'structural_alias_evidence');
    assert.notEqual(textual.admittedBy, recovered.admittedBy);
  });

  it('6.3 · sin decisión no se deduce nada', () => {
    assert.equal(toOwnershipAdmissionEvidence(null), null);
    assert.equal(toOwnershipAdmissionEvidence(undefined), null);
  });
});

// ─── § 7 · la costura es UNA ──────────────────────────────────────────────────

describe('X6.10-C § 7 — trinquetes de la costura', () => {
  const WRITER = 'src/server/agents/prospecting-toolkit/candidate-writer.ts';
  const RUNNER = 'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts';
  const PRE_WRITER = 'src/server/agents/prospecting-toolkit/apollo-pre-writer-target-conditions.ts';

  function withoutComments(relativePath: string): string {
    return readSource(relativePath)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  }

  it('7.1 · 🔴 ni el writer ni el orquestador deciden con el veredicto TEXTUAL', () => {
    // Es el corazón del corte: si alguno volviera a preguntar
    // `isBlockedByCompanyOwnership` para decidir, habría dos semánticas de
    // admisión — que es el defecto que CUT-1 y X3 persiguieron.
    for (const file of [WRITER, RUNNER]) {
      assert.equal(
        /\bisBlockedByCompanyOwnership\s*\(/.test(withoutComments(file)),
        false,
        `${file} no puede decidir con el veredicto textual`,
      );
    }
  });

  it('7.1b · 🔴 nadie decide con `textualBlocked`', () => {
    // El otro hueco del mutation testing: cambiar `ownershipAdmission.blocked`
    // por `ownershipAdmission.textualBlocked` en el writer dejaba la suite en
    // verde —el bucle del writer hace I/O real y no se puede ejecutar aquí—.
    //
    // `textualBlocked` existe para PERSISTIR qué habría pasado sin X6.10-C, no
    // para decidir. Que no aparezca en ninguna de las dos capas es lo que lo
    // mantiene así, y es comprobable sobre el fuente.
    for (const file of [WRITER, RUNNER]) {
      assert.equal(
        /\.textualBlocked/.test(withoutComments(file)),
        false,
        `${file} no puede leer \`textualBlocked\`: la decisión es \`blocked\``,
      );
    }
    // Y el punto de descarte del writer es exactamente la admisión. Ancla sobre
    // el fuente, con la misma costura que X6.1 documentó y su misma limitación
    // declarada: defiende el nombre de la condición, no su comportamiento.
    assert.match(withoutComments(WRITER), /if \(ownershipAdmission\.blocked\) \{/);
  });

  it('7.2 · la combinación de los dos veredictos vive en UN solo sitio', () => {
    const definitions = readSource(
      'src/server/agents/prospecting-toolkit/company-ownership-admission.ts',
    ).match(/export function resolveCompanyOwnershipAdmission\s*\(/g) ?? [];
    assert.equal(definitions.length, 1);

    // Y los dos consumidores llaman a ESA, una vez cada uno.
    assert.equal(
      (withoutComments(WRITER).match(/resolveCompanyOwnershipAdmission\s*\(/g) ?? []).length,
      1,
    );
    assert.equal(
      (withoutComments(PRE_WRITER).match(/resolveCompanyOwnershipAdmission\s*\(/g) ?? []).length,
      1,
    );
  });

  it('7.3 · el trinquete de CUT-1 sigue contando DOS llamadas en el orquestador', () => {
    const runner = withoutComments(RUNNER);
    const calls = runner.match(/evaluateApolloPreWriterCompanyOwnership(WithInputs)?\s*\(/g) ?? [];
    assert.equal(calls.length, 2);
    assert.equal(/\bevaluateCompanyOwnership\s*\(/.test(runner), false);
  });

  it('7.4 · el módulo de admisión es puro y no reimplementa reglas', () => {
    const source = readSource(
      'src/server/agents/prospecting-toolkit/company-ownership-admission.ts',
    );
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['fetch(', 'Date.now', 'supabase', 'process.env', 'await ']) {
      assert.equal(body.includes(forbidden), false, `no puede contener "${forbidden}"`);
    }
    // 🔴 No PRODUCE veredictos: los recibe. Si volviera a evaluar el nombre o el
    // dominio por su cuenta, habría una tercera semántica de ownership.
    for (const forbidden of [
      'evaluateCompanyOwnership(',
      'evaluateStructuralDomainOwnership(',
      'normalizeForDomain',
      'stripTLD',
    ]) {
      assert.equal(body.includes(forbidden), false, `no puede producir veredictos: "${forbidden}"`);
    }
  });

  it('7.4b · DIVERGENCIA DECLARADA: la autoridad de paginación sigue con el gate textual', () => {
    // 🔴 No es un descuido. `apollo-pagination-usefulness-authority` decide si
    // una página «consume» objetivo, y eso es territorio de `accepted_for_target`
    // y de paginación — las dos áreas que este corte tiene prohibido tocar.
    //
    // Consecuencia, declarada en vez de escondida: una candidata recuperada por
    // evidencia estructural sigue contando como `ownership_mismatch` para la
    // utilidad de la página. El efecto HOY es nulo, porque ninguna corrida ha
    // observado nunca un `all_domains`; el día que se observe, la utilidad
    // quedará INFRA-contada y el orquestador podrá pedir una página de más.
    //
    // Este test existe para que ese día el defecto tenga nombre y fecha en vez
    // de aparecer como una anomalía. Cerrarlo es X6.10-D.
    const authority = withoutComments(
      'src/server/agents/prospecting-toolkit/apollo-pagination-usefulness-authority.ts',
    );
    assert.match(authority, /isBlockedByCompanyOwnership\(ownership\)/);
    assert.equal(
      /resolveCompanyOwnershipAdmission/.test(authority),
      false,
      'si alguien la cablea, este test debe caer y la divergencia dejar de declararse aquí',
    );
  });

  it('7.5 · X6.9 y X6.10-A siguen intactos en su comportamiento', () => {
    // El gate textual sigue respondiendo lo mismo para los dos casos que este
    // corte recupera: la recuperación NO es una reescritura del veredicto.
    assert.equal(textualBlocks('rtvc', 'senalcolombia.tv'), true);
    assert.equal(textualBlocks('Caracol Televisión', 'caracoltv.com'), true);
  });
});
