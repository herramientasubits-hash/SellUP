/**
 * AGENT1-STRUCTURAL-OWNERSHIP-TRANSPORT-X6.10-B
 *
 * El transporte de `all_domains` desde la respuesta de Apollo hasta el punto
 * donde la capa estructural de X6.10-A puede evaluarlo — y NADA MÁS.
 *
 * ── Las dos mitades, separadas a propósito ───────────────────────────────────
 *
 *   A) transportar y observar la evidencia   ← ESTE corte
 *   B) darle poder para recuperar candidatas ← otro corte, otra autorización
 *
 * 🔴 Por eso la aserción más importante de este fichero no es que el dato
 * llegue, sino que su llegada NO cambia el desenlace de ninguna candidata
 * (§ 5). Un transporte que mueve el comportamiento no es un transporte.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `toApolloOrganizationShape` ya entregaba `all_domains` desde
 * `NormalizedApolloOrganization.normalizedDomains`. `normalizeApolloOrg` lo
 * tiraba —el tipo `ApolloOrganizationInput` no tenía el campo— cuarenta líneas
 * antes del mapper. La afirmación más fuerte que el proveedor hace sobre la
 * propiedad de un dominio («estos dominios son de la misma organización») moría
 * sin que nadie la viera.
 *
 * Sin red, sin proveedor, sin base, sin reloj. Determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  MAX_TRANSPORTED_DOMAIN_ALIASES,
  buildApolloRawResultSample,
  mapApolloOrganizationToSearchResult,
  normalizeApolloOrg,
} from '../web-search-providers/apollo-organizations-search-provider';
import type { ApolloOrganization } from '@/server/integrations/apollo-client';
import { readApolloCandidateDomainAliases } from '../apollo-candidate-identity-readers';
import {
  MAX_TRUSTED_DOMAIN_ALIASES,
  evaluateStructuralDomainOwnership,
} from '../structural-domain-ownership';
import {
  buildApolloStructuralOwnershipEvidence,
  evaluateApolloPreWriterCompanyOwnershipWithInputs,
  toStructuralOwnershipSnapshot,
} from '../apollo-pre-writer-target-conditions';
import {
  fromCandidateEvidenceSnapshot,
  toCandidateEvidenceSnapshot,
  measureCheckpointSerializedBytes,
  APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
  type ApolloTwoRoundCheckpointV1,
  type ApolloTwoRoundCandidateSnapshot,
} from '../apollo-two-round/checkpoint';
import { toStructuralOwnershipEvidence } from '@/modules/prospect-discards/mapping';
import type { ProspectingPipelineCandidate, WebSearchResult } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function apolloOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: '5ed1353bb929700001c97b45',
    name: 'rtvc',
    website_url: 'https://www.senalcolombia.tv',
    primary_domain: 'senalcolombia.tv',
    all_domains: ['senalcolombia.tv', 'rtvc.gov.co'],
    linkedin_url: 'https://www.linkedin.com/company/rtvc---senialcolombia',
    ...overrides,
  };
}

function candidateFrom(
  name: string,
  domain: string | null,
  aliases: readonly string[] | null | undefined,
  linkedIn: string | null = null,
): ProspectingPipelineCandidate {
  return {
    name,
    website: domain === null ? null : `https://www.${domain}`,
    domain,
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Gobierno',
    sourceUrl: domain === null ? null : `https://www.${domain}`,
    sourceTitle: name,
    sourceSnippet: null,
    websiteVerification: null,
    duplicateCheck: null,
    scoring: { qualityLabel: 'needs_review' } as ProspectingPipelineCandidate['scoring'],
    ...(aliases === undefined ? {} : { providerDomainAliases: aliases }),
    ...(linkedIn === null ? {} : { companyLinkedInUrl: linkedIn }),
  } as ProspectingPipelineCandidate;
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// ─── § 1 · el transporte, tramo a tramo ───────────────────────────────────────

describe('X6.10-B § 1 — de la respuesta de Apollo al candidato', () => {
  it('1.1 · el mapper estampa los alias en `apollo_profile.all_domains`', () => {
    const result = mapApolloOrganizationToSearchResult(apolloOrg(), 1);
    const profile = (result.metadata as Record<string, unknown>)['apollo_profile'] as Record<
      string,
      unknown
    >;
    assert.deepEqual(profile['all_domains'], ['senalcolombia.tv', 'rtvc.gov.co']);
  });

  it('1.2 · el dominio PRIMARIO va primero, aunque el proveedor no lo repita', () => {
    // 🔴 Si un recorte por el tope dejara fuera al dominio que el candidato
    // lleva en `domain`, el conjunto dejaría de contenerlo y la regla E1 nunca
    // podría acreditarlo. Va primero por eso, no por estética.
    const result = mapApolloOrganizationToSearchResult(
      apolloOrg({ all_domains: ['rtvc.gov.co'] }),
      1,
    );
    const aliases = readApolloCandidateDomainAliases(result);
    assert.equal(aliases[0], 'senalcolombia.tv');
    assert.deepEqual(aliases, ['senalcolombia.tv', 'rtvc.gov.co']);
  });

  it('1.3 · sin `all_domains` el conjunto es el primario solo — y eso NO acredita', () => {
    const result = mapApolloOrganizationToSearchResult(apolloOrg({ all_domains: null }), 1);
    const aliases = readApolloCandidateDomainAliases(result);
    assert.deepEqual(aliases, ['senalcolombia.tv']);

    // Y la capa estructural lo trata como lo que es: un dominio no se prueba a
    // sí mismo. Transportar el campo no fabrica evidencia.
    const structural = evaluateStructuralDomainOwnership(
      buildApolloStructuralOwnershipEvidence(
        candidateFrom('rtvc', 'senalcolombia.tv', aliases),
        'rtvc',
        'senalcolombia.tv',
      ),
    );
    assert.equal(structural.outcome, 'insufficient_evidence');
  });

  it('1.4 · el lector normaliza, deduplica y acota', () => {
    const result = mapApolloOrganizationToSearchResult(
      apolloOrg({
        all_domains: [
          'RTVC.GOV.CO',
          'www.rtvc.gov.co',
          '  senalcolombia.tv  ',
          'no-es-un-dominio',
          null,
          42,
        ],
      }),
      1,
    );
    assert.deepEqual(readApolloCandidateDomainAliases(result), [
      'senalcolombia.tv',
      'rtvc.gov.co',
    ]);
  });

  it('1.5 · nunca más de `MAX_TRANSPORTED_DOMAIN_ALIASES`', () => {
    const many = Array.from({ length: 30 }, (_v, i) => `alias-${i}.com`);
    const result = mapApolloOrganizationToSearchResult(apolloOrg({ all_domains: many }), 1);
    assert.equal(
      readApolloCandidateDomainAliases(result).length,
      MAX_TRANSPORTED_DOMAIN_ALIASES,
    );
  });

  it('1.6 · `raw_fields_present` declara la presencia del campo', () => {
    const withAliases = mapApolloOrganizationToSearchResult(apolloOrg(), 1);
    const profile = (withAliases.metadata as Record<string, unknown>)[
      'apollo_profile'
    ] as Record<string, unknown>;
    assert.ok((profile['raw_fields_present'] as string[]).includes('all_domains'));

    const without = mapApolloOrganizationToSearchResult(apolloOrg({ all_domains: null }), 1);
    const profileWithout = (without.metadata as Record<string, unknown>)[
      'apollo_profile'
    ] as Record<string, unknown>;
    assert.equal(
      (profileWithout['raw_fields_present'] as string[]).includes('all_domains'),
      false,
    );
  });

  it('1.0 · 🔴 `normalizeApolloOrg` conserva el campo — LA línea del corte', () => {
    // El mutation testing lo exigió: volver a poner `normalizeApolloOrg` como
    // estaba —sin `all_domains`— dejaba los treinta tests en verde, porque
    // todos entraban por el mapper y se saltaban justo el sitio donde el dato
    // moría. Aquí se ejercita el tramo real.
    const shape = {
      id: '5ed1353bb929700001c97b45',
      name: 'rtvc',
      website_url: 'https://www.senalcolombia.tv',
      primary_domain: 'senalcolombia.tv',
      all_domains: ['senalcolombia.tv', 'rtvc.gov.co'],
      linkedin_url: null,
      industry: null,
      industry_tag_ids: [],
      employee_count: null,
      estimated_num_employees: null,
      city: null,
      country: null,
      phone: null,
      annual_revenue: null,
      technologies: [],
      short_description: null,
      keywords: [],
    } as unknown as ApolloOrganization;

    const normalized = normalizeApolloOrg(shape);
    assert.deepEqual(normalized?.all_domains, ['senalcolombia.tv', 'rtvc.gov.co']);

    // Y el tramo completo, desde la forma del proveedor hasta el lector.
    assert.deepEqual(
      readApolloCandidateDomainAliases(
        mapApolloOrganizationToSearchResult(normalized!, 1),
      ),
      ['senalcolombia.tv', 'rtvc.gov.co'],
    );
  });

  it('1.4b · el LECTOR normaliza por su cuenta, no sólo el mapper', () => {
    // Otro hueco del mutation testing: 1.4 entra por el mapper, que ya limpia.
    // Un perfil malformado —legacy, o de otra ruta— llega crudo al lector, y su
    // propia defensa tiene que verse.
    const hostile = {
      title: 'x',
      url: 'https://senalcolombia.tv',
      snippet: null,
      source: 'apollo_organizations',
      rank: 1,
      provider: 'apollo_organizations',
      metadata: {
        apollo_profile: {
          all_domains: ['rtvc.gov.co', 'rtvc.gov.co', '   ', null, 7, 'senalcolombia.tv'],
        },
      },
    } as unknown as WebSearchResult;
    assert.deepEqual(readApolloCandidateDomainAliases(hostile), [
      'rtvc.gov.co',
      'senalcolombia.tv',
    ]);

    // Y una forma que ni siquiera es un array no rompe: `[]`, que es «no lo
    // aportó», nunca una excepción.
    const notArray = {
      ...hostile,
      metadata: { apollo_profile: { all_domains: 'rtvc.gov.co' } },
    } as unknown as WebSearchResult;
    assert.deepEqual(readApolloCandidateDomainAliases(notArray), []);
  });

  it('1.6b · 🔴 el diagnóstico deja de estar CIEGO a `all_domains`', () => {
    // `apollo_raw_result_samples_sanitized` lleva 228 muestras en Producción y
    // `all_domains` aparece en CERO — porque `buildApolloRawResultSample` nunca
    // lo comprobó, no porque Apollo no lo devuelva. Sin esta línea, la cobertura
    // real del campo sólo se puede medir pagando una corrida.
    const withAliases = buildApolloRawResultSample({
      id: 'x',
      name: 'rtvc',
      website_url: 'https://www.senalcolombia.tv',
      primary_domain: 'senalcolombia.tv',
      all_domains: ['senalcolombia.tv', 'rtvc.gov.co'],
    } as unknown as ApolloOrganization);
    assert.ok(withAliases.raw_keys_present.includes('all_domains'));

    // Y un conjunto vacío NO se declara presente: la ausencia sigue siendo
    // legible como ausencia.
    const without = buildApolloRawResultSample({
      id: 'x',
      name: 'rtvc',
      website_url: 'https://www.senalcolombia.tv',
      primary_domain: 'senalcolombia.tv',
      all_domains: [],
    } as unknown as ApolloOrganization);
    assert.equal(without.raw_keys_present.includes('all_domains'), false);
  });

  it('1.7 · RTVC, extremo a extremo: el par que X6.9 no podía resolver', () => {
    const result = mapApolloOrganizationToSearchResult(apolloOrg(), 1);
    const candidate = candidateFrom(
      'rtvc',
      'senalcolombia.tv',
      readApolloCandidateDomainAliases(result),
      'https://www.linkedin.com/company/rtvc---senialcolombia',
    );
    const structural = evaluateStructuralDomainOwnership(
      buildApolloStructuralOwnershipEvidence(candidate, 'rtvc', 'senalcolombia.tv'),
    );
    assert.equal(structural.outcome, 'confirmed');
    assert.equal(structural.decidingSource, 'provider_domain_alias_set');
    // Y LinkedIn sigue sin decidir, con el mismo slug real que no acredita.
    assert.equal(structural.linkedInCorroboration, 'inconclusive');
  });
});

// ─── § 2 · paridad de topes ───────────────────────────────────────────────────

describe('X6.10-B § 2 — los dos topes son el MISMO número', () => {
  it('2.1 · el provider no importa la constante del contrato, así que se comprueba', () => {
    // El provider no debe depender de la capa que consume su salida, y por eso
    // el número está replicado. Dos copias sin trinquete divergen: ésta es la
    // guarda que impide que una suba y la otra no.
    assert.equal(MAX_TRANSPORTED_DOMAIN_ALIASES, MAX_TRUSTED_DOMAIN_ALIASES);
  });

  it('2.2 · transportar más de los que la capa acepta sería puro coste', () => {
    const many = Array.from({ length: MAX_TRUSTED_DOMAIN_ALIASES + 4 }, (_v, i) => `a${i}.com`);
    const result = mapApolloOrganizationToSearchResult(apolloOrg({ all_domains: many }), 1);
    assert.ok(readApolloCandidateDomainAliases(result).length <= MAX_TRUSTED_DOMAIN_ALIASES);
  });
});

// ─── § 3 · el checkpoint (la lección de X6.1, no repetida) ───────────────────

describe('X6.10-B § 3 — los alias sobreviven al checkpoint', () => {
  it('3.1 · ida y vuelta: el lector devuelve lo mismo antes y después', () => {
    // 🔴 X6.1: el runner reconstruye el resultado desde el snapshot TAMBIÉN en
    // la primera pasada. Un campo fuera de la lista blanca llega al constructor
    // como ausente, y la evidencia existiría en la respuesta y no en el
    // candidato. Es el mismo defecto que costó 25 de 25 rechazos.
    const original = mapApolloOrganizationToSearchResult(apolloOrg(), 1);
    const restored = fromCandidateEvidenceSnapshot(toCandidateEvidenceSnapshot(original));
    assert.deepEqual(
      readApolloCandidateDomainAliases(restored),
      readApolloCandidateDomainAliases(original),
    );
  });

  it('3.2 · el snapshot acota a ocho y a 63 caracteres por etiqueta', () => {
    const many = Array.from({ length: 20 }, (_v, i) => `alias-${i}.com`);
    const longOne = `${'x'.repeat(200)}.com`;
    const result = mapApolloOrganizationToSearchResult(
      apolloOrg({ all_domains: [longOne, ...many] }),
      1,
    );
    const snapshot = toCandidateEvidenceSnapshot(result);
    const aliases = snapshot.domain_aliases ?? [];
    assert.ok(aliases.length <= MAX_TRUSTED_DOMAIN_ALIASES);
    for (const alias of aliases) assert.ok(alias.length <= 63, `"${alias}" excede 63`);
  });

  it('3.2b · el snapshot acota POR SU CUENTA, no porque el mapper ya acotara', () => {
    // El mutation testing lo reclamó: 3.2 entra por el mapper, que ya recorta a
    // ocho, así que el tope del snapshot nunca veía un conjunto mayor. Un perfil
    // que llegue por otra ruta —o un checkpoint de otra versión— sí puede.
    const oversized = {
      title: 'x',
      url: 'https://ejemplo.com',
      snippet: null,
      source: 'apollo_organizations',
      rank: 1,
      provider: 'apollo_organizations',
      metadata: {
        apollo_profile: {
          all_domains: Array.from({ length: 25 }, (_v, i) => `alias-${i}.com`),
        },
      },
    } as unknown as WebSearchResult;
    const aliases = toCandidateEvidenceSnapshot(oversized).domain_aliases ?? [];
    assert.equal(aliases.length, MAX_TRUSTED_DOMAIN_ALIASES);
  });

  it('3.3 · un checkpoint LEGACY sin la clave se sigue leyendo', () => {
    const original = mapApolloOrganizationToSearchResult(apolloOrg(), 1);
    const snapshot = toCandidateEvidenceSnapshot(original);
    const legacy = { ...snapshot };
    delete (legacy as Record<string, unknown>)['domain_aliases'];
    const restored = fromCandidateEvidenceSnapshot(legacy);
    // Sin la clave, el conjunto es vacío — que es «el proveedor no lo aportó»,
    // no «no coincide». Y un conjunto vacío no acredita a nadie.
    assert.deepEqual(readApolloCandidateDomainAliases(restored), []);
  });
});

// ─── § 4 · un solo helper, y la paridad de CUT-1 intacta ─────────────────────

describe('X6.10-B § 4 — nada de duplicar la lógica entre pre-writer y writer', () => {
  const PRE_WRITER = 'src/server/agents/prospecting-toolkit/apollo-pre-writer-target-conditions.ts';
  const WRITER = 'src/server/agents/prospecting-toolkit/candidate-writer.ts';
  const RUNNER = 'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts';

  it('4.1 · el writer construye la evidencia con el helper COMPARTIDO', () => {
    const writer = readSource(WRITER);
    assert.match(writer, /buildApolloStructuralOwnershipEvidence\s*\(/);
    // Una copia local de la construcción es cómo las dos capas se separan.
    assert.equal(
      /providerDomainAliases:\s*candidate\.providerDomainAliases/.test(writer),
      false,
      'el writer no puede derivar la evidencia por su cuenta',
    );
  });

  it('4.2 · la construcción de la evidencia vive en UN solo sitio', () => {
    const preWriter = readSource(PRE_WRITER);
    const definitions =
      preWriter.match(/export function buildApolloStructuralOwnershipEvidence\s*\(/g) ?? [];
    assert.equal(definitions.length, 1);
  });

  it('4.3 · el trinquete de CUT-1 sigue contando DOS llamadas en el orquestador', () => {
    // La misma guarda que `agent1-hardening-cut1-ownership-recall-parity.test.ts`
    // defiende, replicada aquí porque este corte toca justo ese tramo.
    const runner = readSource(RUNNER)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const calls = runner.match(/evaluateApolloPreWriterCompanyOwnership(WithInputs)?\s*\(/g) ?? [];
    assert.equal(calls.length, 2);
    assert.equal(
      /\bevaluateCompanyOwnership\s*\(/.test(runner),
      false,
      'el orquestador sigue sin llamar al gate directamente',
    );
    // Y tampoco evalúa la capa estructural por su cuenta: la recibe.
    assert.equal(
      /evaluateStructuralDomainOwnership\s*\(/.test(runner),
      false,
      'el orquestador consume el veredicto estructural, no lo calcula',
    );
  });

  it('4.4 · la evidencia usa el MISMO nombre y el MISMO dominio que el gate', () => {
    const candidate = candidateFrom('rtvc', 'senalcolombia.tv', ['senalcolombia.tv', 'rtvc.gov.co']);
    const evaluation = evaluateApolloPreWriterCompanyOwnershipWithInputs(candidate);
    const evidence = buildApolloStructuralOwnershipEvidence(
      candidate,
      evaluation.evaluationName,
      evaluation.effectiveDomain,
    );
    assert.equal(evidence.companyName, evaluation.evaluationName);
    assert.equal(evidence.domain, evaluation.effectiveDomain);
    assert.deepEqual(evaluation.structural, evaluateStructuralDomainOwnership(evidence));
  });

  it('4.5 · la evidencia usa el nombre RECUPERADO, no el crudo del proveedor', () => {
    // 🔴 Otro hueco del mutation testing: en los fixtures anteriores el nombre
    // crudo y el de evaluación coincidían, así que cambiar uno por otro no se
    // notaba. Con una frase SEO como título, los dos DIFIEREN — y el gate juzga
    // el recuperado, así que la evidencia estructural tiene que juzgar el mismo.
    const candidate = candidateFrom(
      'Consultoría ERP, CRM y HCM para empresas',
      'dinamicacd.com',
      ['dinamicacd.com', 'dinamicacd.com.co'],
    );
    const evaluation = evaluateApolloPreWriterCompanyOwnershipWithInputs(candidate);
    assert.equal(evaluation.recoveredFromDomain, true);
    assert.notEqual(evaluation.evaluationName, candidate.name);

    const evidence = buildApolloStructuralOwnershipEvidence(
      candidate,
      evaluation.evaluationName,
      evaluation.effectiveDomain,
    );
    assert.equal(evidence.companyName, evaluation.evaluationName);
    assert.notEqual(evidence.companyName, candidate.name);
  });

  it('4.6 · el constructor del candidato copia el dato (ancla sobre el fuente)', () => {
    // 🔴 `buildProspectingPipelineCandidate` hace I/O real —`verifyWebsite` sale
    // a la red y `checkCompanyDuplicate` consulta Supabase—, así que no se puede
    // ejecutar en una suite offline. X6.1 resolvió el mismo problema anclando el
    // fuente, y se usa aquí la MISMA costura, con su misma limitación declarada:
    // esto defiende el NOMBRE de la línea, no su comportamiento.
    const pipeline = readSource('src/server/agents/prospecting-toolkit/prospecting-pipeline.ts');
    const builderStart = pipeline.indexOf(
      'export async function buildProspectingPipelineCandidate',
    );
    assert.ok(builderStart > 0, 'no se encontró el constructor canónico');
    const body = pipeline.slice(builderStart);
    assert.match(
      body,
      /providerDomainAliases:\s*readApolloCandidateDomainAliases\(result\)/,
      'el constructor dejó de copiar los alias al candidato',
    );
  });
});

// ─── § 5 · 🔴 el transporte NO cambia el comportamiento productivo ────────────

describe('X6.10-B § 5 — la mitad A: observar, no decidir', () => {
  const CASES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['rtvc', 'senalcolombia.tv', ['senalcolombia.tv', 'rtvc.gov.co']],
    ['Caracol Televisión', 'caracoltv.com', ['caracoltv.com', 'caracoltelevision.com']],
    ['EPM', 'une.com.co', ['une.com.co', 'epm.com.co']],
    ['Caja de la Vivienda Popular', 'cajaviviendapopular.gov.co', ['cajaviviendapopular.gov.co']],
    ['Rodríguez y Asociados', 'ryalaw.co', ['ryalaw.co', 'rodriguezyasociados.com']],
  ];

  for (const [name, domain, aliases] of CASES) {
    it(`5.1 · «${name}» — el veredicto del gate es IDÉNTICO con y sin alias`, () => {
      const without = evaluateApolloPreWriterCompanyOwnershipWithInputs(
        candidateFrom(name, domain, undefined),
      );
      const with_ = evaluateApolloPreWriterCompanyOwnershipWithInputs(
        candidateFrom(name, domain, aliases),
      );
      // 🔴 El corazón del corte. Si esta aserción se cae, el transporte se ha
      // convertido en la mitad B sin autorización.
      assert.deepEqual(with_.verdict, without.verdict);
      assert.equal(with_.evaluationName, without.evaluationName);
      assert.equal(with_.effectiveDomain, without.effectiveDomain);
      assert.equal(with_.recoveredFromDomain, without.recoveredFromDomain);
    });
  }

  it('5.2 · y la evidencia estructural SÍ cambia — por eso vale la pena medirla', () => {
    // La otra cara: si el transporte no moviera NADA observable, no habría nada
    // que transportar. Lo que cambia es el campo nuevo, no el veredicto.
    const without = evaluateApolloPreWriterCompanyOwnershipWithInputs(
      candidateFrom('rtvc', 'senalcolombia.tv', undefined),
    );
    const with_ = evaluateApolloPreWriterCompanyOwnershipWithInputs(
      candidateFrom('rtvc', 'senalcolombia.tv', ['senalcolombia.tv', 'rtvc.gov.co']),
    );
    assert.equal(without.structural.outcome, 'insufficient_evidence');
    assert.equal(with_.structural.outcome, 'confirmed');
    // Y las dos candidatas siguen BLOQUEADAS por el gate textual.
    assert.equal(with_.verdict.allowed, false);
    assert.equal(without.verdict.allowed, false);
  });

  it('5.3 · el writer sigue CONTANDO la evidencia — y desde X6.10-C también la aplica', () => {
    // 🔴 DEROGADO EN PARTE POR X6.10-C, a propósito y a la vista.
    //
    // Este test afirmaba que el writer contaba la evidencia y NO la aplicaba,
    // que era la invariante de X6.10-B. X6.10-C es el corte que le da poder, y
    // mantener la aserción original habría obligado a elegir entre romperla en
    // silencio o no activar nada. Lo que se conserva es lo que sigue siendo
    // cierto: el writer sigue midiendo, y sigue sin inventarse reglas propias.
    //
    // Lo que X6.10-C añade —que la decisión salga de la costura COMPARTIDA y de
    // ninguna otra parte— lo prueban sus § 7.1 y § 7.2.
    const writer = readSource(
      'src/server/agents/prospecting-toolkit/candidate-writer.ts',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // El contador dejó de proyectar («would_») y pasó a contar hechos.
    assert.match(writer, /structuralOwnershipObservability\.recovered_count\+\+/);
    assert.equal(
      /would_recover_count/.test(writer),
      false,
      'un contador que ya no proyecta no puede seguir llamándose `would_`',
    );
    // 🔴 Y el writer sigue sin reinterpretar el veredicto estructural por su
    // cuenta: lo único que consulta para decidir es la admisión compartida.
    for (const forbidden of [
      'structuralOwnership.outcome === \'confirmed\' && !isBlocked',
      'if (structuralOwnership.outcome === \'confirmed\') continue',
      'structuralOwnership.allowed',
    ]) {
      assert.equal(writer.includes(forbidden), false, `el writer no puede hacer "${forbidden}"`);
    }
    assert.match(writer, /resolveCompanyOwnershipAdmission\(/);
  });

  it('5.4 · la proyección a `prospect-discards` es una COPIA, no una regla', () => {
    const candidate = candidateFrom(
      'rtvc',
      'senalcolombia.tv',
      ['senalcolombia.tv', 'rtvc.gov.co'],
      'https://www.linkedin.com/company/rtvc---senialcolombia',
    );
    const evaluation = evaluateApolloPreWriterCompanyOwnershipWithInputs(candidate);
    const snapshot = toStructuralOwnershipSnapshot(evaluation);
    assert.equal(snapshot.outcome, evaluation.structural.outcome);
    assert.equal(snapshot.decidingSource, evaluation.structural.decidingSource);
    assert.equal(snapshot.linkedInCorroboration, evaluation.structural.linkedInCorroboration);

    const row = toStructuralOwnershipEvidence(snapshot);
    assert.equal(row?.outcome, 'confirmed');
    assert.equal(row?.deciding_source, 'provider_domain_alias_set');
    assert.equal(row?.linkedin_corroboration, 'inconclusive');

    // Sin evaluación no se deduce nada: `null`, nunca un veredicto fabricado.
    assert.equal(toStructuralOwnershipEvidence(null), null);
  });
});

// ─── § 6 · tamaño del checkpoint (X6.7) ───────────────────────────────────────

/**
 * Mide un checkpoint de `size` organizaciones con y sin alias.
 *
 * Reproduce la forma del fixture de X6.7 —la misma organización de retail que su
 * suite usa— para que los números sean comparables con los que aquel corte
 * midió sobre el lote real `71a6f75b`.
 */
function measureCheckpoint(size: number, aliasCount: number): number {
  const snapshots: ApolloTwoRoundCandidateSnapshot[] = Array.from(
    { length: size },
    (_v, index) => {
      const result = {
        title: `Supermercado Regional ${index + 1} S.A.S.`,
        url: `https://supermercadoregional${index + 1}.com.co`,
        snippet:
          'Cadena de supermercados y autoservicio con tiendas de abarrotes en varias ciudades del país.',
        source: 'apollo_organizations',
        rank: index + 1,
        provider: 'apollo_organizations',
        metadata: {
          apollo_organization_id: `6612aa0f9b1c4d00018a${String(index + 1).padStart(4, '0')}`,
          domain: `supermercadoregional${index + 1}.com.co`,
          industry: 'retail',
          country_code: 'CO',
          country: 'Colombia',
          city: 'Bogotá',
          employee_count: 900,
          estimated_num_employees: 900,
          short_description:
            'Operador de supermercados y tiendas de abarrotes con red de puntos de venta y distribución propia.',
          seo_description:
            'Supermercados, autoservicio y abarrotes. Compra en línea y domicilios en las principales ciudades.',
          keywords: ['supermercado', 'abarrotes', 'autoservicio', 'retail', 'alimentos', 'domicilios'],
          organization_keywords: ['supermercado', 'retail'],
          industries: ['retail', 'grocery'],
          apollo_profile: {
            industry: 'retail',
            industries: ['retail', 'grocery'],
            primary_domain: `supermercadoregional${index + 1}.com.co`,
            ...(aliasCount > 0
              ? {
                  all_domains: [
                    `supermercadoregional${index + 1}.com.co`,
                    ...Array.from(
                      { length: aliasCount - 1 },
                      (_x, alias) => `supermercadoregional${index + 1}-${alias}.co`,
                    ),
                  ],
                }
              : {}),
          },
        },
      } as unknown as WebSearchResult;
      return {
        candidate_key: `apollo:6612aa0f9b1c4d00018a${String(index + 1).padStart(4, '0')}`,
        eligible: true,
        finally_rejected_or_duplicated: false,
        enrichment_executed: false,
        evidence: toCandidateEvidenceSnapshot(result),
      } as unknown as ApolloTwoRoundCandidateSnapshot;
    },
  );

  const checkpoint = {
    contract_version: 1,
    checkpoint_version: 1,
    run_identity: { wizard_run_id: 'x610b', reserved_batch_id: 'x610b' },
    candidate_snapshots: snapshots,
    pending_organizations: [],
    completed_operation_keys: [],
    indeterminate_operation_keys: [],
    checkpoint_write_failures: [],
    recorded_operation_credits: [],
    compacted: false,
    manual_reconciliation_required: false,
  } as unknown as ApolloTwoRoundCheckpointV1;

  return measureCheckpointSerializedBytes(checkpoint);
}

describe('X6.10-B § 6 — impacto medido en el checkpoint de X6.7', () => {
  for (const size of [98, 100, 150, 1000]) {
    it(`6.1 · ${size} organizaciones: el crecimiento por los alias es acotado`, () => {
      const before = measureCheckpoint(size, 0);
      // Dos alias es lo que una organización real de Apollo suele declarar; ocho
      // es el TOPE, y es el número contra el que hay que dimensionar.
      const after = measureCheckpoint(size, 2);
      const worst = measureCheckpoint(size, MAX_TRUSTED_DOMAIN_ALIASES);
      const deltaPerOrg = (after - before) / size;
      const worstPerOrg = (worst - before) / size;

      // Los alias son etiquetas cortas y acotadas a ocho: su coste por
      // organización no puede acercarse al presupuesto de 1.024 B/org.
      assert.ok(
        deltaPerOrg < 120,
        `${size} orgs: +${deltaPerOrg.toFixed(1)} B/org, esperado < 120`,
      );
      assert.ok(after > before, 'los alias tienen que llegar al documento');
      // 🔴 Incluso en el peor caso el coste por organización queda muy por
      // debajo del presupuesto de 1.024 B/org que el techo de X6.7 asigna.
      assert.ok(
        worstPerOrg < 400,
        `${size} orgs, peor caso: +${worstPerOrg.toFixed(1)} B/org, esperado < 400`,
      );
      console.log(
        `    [X6.10-B] ${String(size).padStart(4)} orgs · antes ${before} B · después ${after} B ` +
          `· Δ ${after - before} B (+${(((after - before) / before) * 100).toFixed(1)}%) ` +
          `· ${((after / APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES) * 100).toFixed(1)}% del techo ` +
          `· peor caso (${MAX_TRUSTED_DOMAIN_ALIASES}) ${worst} B ` +
          `(+${worstPerOrg.toFixed(1)} B/org, ${((worst / APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES) * 100).toFixed(1)}% del techo)`,
      );
    });
  }

  it('6.2 · el techo de X6.7 NO se toca', () => {
    // 1.000 organizaciones × 1.024 B. Si este corte lo hubiera movido, el
    // «impacto medido» de arriba sería una comparación contra otra vara.
    assert.equal(APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES, 1_024_000);
  });

  it('6.3 · a la escala de la corrida real de X6.7 (98) se sigue cabiendo', () => {
    assert.ok(
      measureCheckpoint(98, MAX_TRUSTED_DOMAIN_ALIASES) <
        APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
    );
    assert.ok(
      measureCheckpoint(150, MAX_TRUSTED_DOMAIN_ALIASES) <
        APOLLO_TWO_ROUND_CHECKPOINT_MAX_SERIALIZED_BYTES,
    );
  });
});
