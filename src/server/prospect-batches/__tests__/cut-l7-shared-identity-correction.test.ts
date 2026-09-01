/**
 * AGENT1-LUSHA-CUT-L7-SHARED-IDENTITY-CORRECTION — el NOMBRE es evidencia
 * DÉBIL de identidad de empresa, en TODOS los consumidores a la vez.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `sellup-duplicate-checker` y `hubspot-duplicate-checker` ponen la MISMA
 * etiqueta —`existing_in_sellup` / `existing_in_hubspot`— a dos cosas que no se
 * parecen: un dominio o un identificador fiscal exactos, y un NOMBRE
 * normalizado. Todos sus consumidores leían `status` a secas, así que un
 * homónimo —«Servicios Integrales S.A.S.» existe decenas de veces en Colombia
 * con NITs y dominios distintos— descartaba EN SILENCIO una empresa
 * potencialmente distinta:
 *
 *   · pre-pago gratuito: la marcaba `sellup_known`, no entraba al lote, el hueco
 *     residual NO bajaba y el proveedor de PAGO recibía un objetivo más grande.
 *     El falso positivo no ahorraba dinero: lo GASTABA;
 *   · Lusha post-pago: la marcaba `exact_duplicate`, la sacaba de revisión —ya
 *     pagada— y el objetivo no se reducía, así que podía comprarse otra página;
 *   · guarda de candidatos activos: `same_inferred_identity` (igualdad de nombre
 *     inferido normalizado) saltaba DURO, sin dejar rastro para el revisor.
 *
 * ── Lo que esta suite defiende, dicho como defecto ───────────────────────────
 *
 *   * que `sellup 88` (nombre + país) vuelva a ser identidad fuerte (M1);
 *   * que `hubspot 82` (nombre normalizado, SIN país) vuelva a serlo (M2);
 *   * que dos dominios presentes y DISTINTOS se fusionen por nombre (M3);
 *   * que un nombre sin dominio se declare `exact_duplicate` (M4);
 *   * que el pre-pago vuelva a marcar `sellup_known` por nombre (M5);
 *   * que Lusha vuelva a marcar `exact_duplicate` por nombre (M6);
 *   * que `same_inferred_identity` vuelva a ser un salto duro (M7);
 *   * que la semántica de nombre de Apollo cambie (M8);
 *   * que el MISMO dominio deje de ser duplicado duro (M9);
 *   * que la identidad FISCAL fuerte deje de ser duplicado duro (M10);
 *   * que el id de proveedor se promueva a identidad global fuerte (M11);
 *   * que la supresión por dominio conocido de CUT-L1 se debilite (M12);
 *   * que reaparezca la confianza INVENTADA 90 de HubSpot en el fixture de
 *     paridad —producción emite 92, nunca 90 (M13);
 *   * que la suite salga del check obligatorio (M14).
 *
 * 🔴 Lo que esta suite NO afirma: que Lusha sea seguro de activar; que el
 * preview pagado se haya reactivado —sigue incapacitado—; ni que ninguna
 * migración se haya aplicado. CUT-L7 no añade migración: el techo sigue en 136.
 *
 * 🔴 Deuda REGISTRADA y NO tocada aquí: la búsqueda de identificador fiscal
 * desnudo de `sellup-duplicate-checker` NO está acotada por país
 * (`ilike('tax_identifier', …)` sin `country_code`). Es un corte aparte
 * —AGENT1-SHARED-FISCAL-IDENTITY-COUNTRY-SCOPE—; mezclarlo con la corrección de
 * identidad por nombre habría cambiado dos ejes a la vez.
 *
 * Pura y offline: dobles locales, sin red, sin Supabase, sin Lusha, sin Apollo.
 * 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyDuplicateIdentityEvidence,
  hasStrongIdentityDuplicateMatch,
  findStrongIdentityDuplicateMatch,
  findWeakIdentityDuplicateMatch,
  hasContradictoryDomains,
  normalizeIdentityDomain,
  isStrongActiveGuardReason,
  isWeakActiveGuardReason,
  STRONG_ACTIVE_GUARD_REASONS,
  WEAK_ACTIVE_GUARD_REASONS,
} from '@/server/agents/prospecting-toolkit/strong-identity-duplicate-match';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
  DuplicateMatch,
} from '@/server/agents/prospecting-toolkit/types';
import {
  checkActiveCandidateDuplicate,
  type ActiveCandidateRecord,
} from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import {
  resolveLushaCandidateDuplicateState,
  isUsefulLushaResolution,
  isStrongActiveGuardMatch,
} from '../lusha-pending-review';
import { runCountrySourcePrePaidDiscovery } from '../country-source-discovery/run-country-source-prepaid-discovery';
import type {
  CountrySourceAdapter,
  CountrySourceCompany,
} from '../country-source-discovery/country-source-types';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { readDuplicateVerdict } from '@/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server';
import {
  evaluateCandidateIdentity,
  createBatchIdentityRegistry,
  acceptIdentity,
} from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import type { CompanyIdentityEvidence } from '@/server/agents/prospecting-toolkit/company-identity-evidence';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

/**
 * 🔴 Toda guarda estática de esta suite lee el CÓDIGO, no la prosa. Sin esto, un
 * comentario que NOMBRA lo prohibido —«sin Supabase», «ya no emitimos
 * `confidence: 100`»— reprobaría la guarda por CITARLO. Nombrar no es hacer.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
const readCode = (rel: string) => stripComments(read(rel));

// ─── Fábricas con confianzas REALES de producción ─────────────────────────────
//
// 🔴 Ningún valor inventado. Cada número de aquí abajo se contrasta contra el
// código de los checkers en la prueba «las confianzas son las de PRODUCCIÓN».

function match(over: Partial<DuplicateMatch> & Pick<DuplicateMatch, 'source' | 'confidence'>): DuplicateMatch {
  return {
    status: 'existing_in_sellup',
    reason: 'synthetic',
    ...over,
  } as DuplicateMatch;
}

/** sellup 95 — dominio exacto. FUERTE. */
const sellupDomain = (domain = 'acme.com') =>
  match({ source: 'sellup', status: 'existing_in_sellup', confidence: 95, matchedId: 'a1', matchedDomain: domain, matchedName: 'Acme', reason: `Dominio exacto coincide: ${domain}` });

/** sellup 92 — identificador fiscal exacto. FUERTE. */
const sellupTax = () =>
  match({ source: 'sellup', status: 'existing_in_sellup', confidence: 92, matchedId: 'a2', matchedName: 'Otra Razon Social', matchedDomain: 'otro-dominio.com', reason: 'Identificador fiscal exacto coincide' });

/** sellup 88 — normalized_name + país. DÉBIL. */
const sellupNameCountry = (matchedDomain: string | null = null) =>
  match({ source: 'sellup', status: 'existing_in_sellup', confidence: 88, matchedId: 'a3', matchedDomain, matchedName: 'Servicios Integrales S.A.S.', reason: 'Nombre normalizado exacto coincide + país CO' });

/** sellup 65 — contenido de nombre. DÉBIL. */
const sellupNameContains = () =>
  match({ source: 'sellup', status: 'possible_duplicate', confidence: 65, matchedId: 'a4', matchedName: 'Servicios Integrales', reason: 'Nombre similar por contenido' });

/** hubspot 95 — identificador fiscal OFICIAL exacto. FUERTE. */
const hubspotTax = () =>
  match({ source: 'hubspot', status: 'existing_in_hubspot', confidence: 95, matchedId: 'h1', matchedName: 'Otra Razon Social', reason: 'Identificador fiscal exacto coincide en HubSpot' });

/** hubspot 92 — dominio exacto. FUERTE. */
const hubspotDomain = (domain = 'acme.com') =>
  match({ source: 'hubspot', status: 'existing_in_hubspot', confidence: 92, matchedId: 'h2', matchedDomain: domain, matchedName: 'Acme', reason: `Dominio exacto coincide en HubSpot: ${domain}` });

/** hubspot 85 — NIT CANDIDATO (requires_human_review). DÉBIL. */
const hubspotTaxCandidate = () =>
  match({ source: 'hubspot', status: 'possible_duplicate', confidence: 85, matchedId: 'h3', matchedName: 'Quiza La Misma', reason: 'Coincidencia por NIT candidato en HubSpot' });

/** hubspot 82 — nombre normalizado, SIN comparar país. DÉBIL. */
const hubspotName = (matchedDomain: string | null = null) =>
  match({ source: 'hubspot', status: 'existing_in_hubspot', confidence: 82, matchedId: 'h4', matchedDomain, matchedName: 'Servicios Integrales SAS', reason: 'Nombre normalizado exacto coincide en HubSpot' });

/** hubspot 65 / 50 — contenido de nombre / hit débil. DÉBIL. */
const hubspotNameContains = () =>
  match({ source: 'hubspot', status: 'possible_duplicate', confidence: 65, matchedId: 'h5', matchedName: 'Servicios', reason: 'Nombre similar por contenido en HubSpot' });
const hubspotWeakHit = () =>
  match({ source: 'hubspot', status: 'possible_duplicate', confidence: 50, matchedId: 'h6', matchedName: 'Algo', reason: 'similitud baja' });

function result(matches: DuplicateMatch[], input: Partial<DuplicateCheckInput> = {}): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 0,
    input: { name: 'Servicios Integrales S.A.S.', countryCode: 'CO', ...input } as DuplicateCheckInput,
    matches,
    summary: 'synthetic',
    checkedSources: ['sellup', 'hubspot'],
  };
}

const NO_GUARD = {
  matched: false as const,
  reason: null,
  matchedCandidateId: null,
  matchedDomain: null,
  matchedName: null,
};

// ══════════════════════════════════════════════════════════════════════════════
describe('CUT-L7 § 30 — matriz del lector COMPARTIDO', () => {
  it('ID-1 · sellup 95 (dominio exacto) es FUERTE', () => {
    const e = classifyDuplicateIdentityEvidence(sellupDomain());
    assert.equal(e.strength, 'strong');
    assert.equal(e.axis, 'exact_domain');
  });

  it('ID-2 · sellup 92 (identificador fiscal exacto) es FUERTE', () => {
    const e = classifyDuplicateIdentityEvidence(sellupTax());
    assert.equal(e.strength, 'strong');
    assert.equal(e.axis, 'exact_fiscal_identity');
  });

  it('M1 · ID-3 · sellup 88 (nombre + país) NO es fuerte', () => {
    const e = classifyDuplicateIdentityEvidence(sellupNameCountry());
    assert.equal(e.strength, 'weak');
    assert.equal(e.axis, 'normalized_name');
    assert.equal(hasStrongIdentityDuplicateMatch([sellupNameCountry()], 'sellup'), false);
  });

  it('ID-4 · hubspot 92 (dominio exacto) y hubspot 95 (fiscal oficial) son FUERTES', () => {
    assert.equal(classifyDuplicateIdentityEvidence(hubspotDomain()).strength, 'strong');
    assert.equal(classifyDuplicateIdentityEvidence(hubspotDomain()).axis, 'exact_domain');
    // 🔴 95 NO estaba en la lista del lector de Apollo, que sólo admitía [92]. Es
    // el MISMO eje que `sellup 92` y la política lo nombra fuerte.
    assert.equal(classifyDuplicateIdentityEvidence(hubspotTax()).strength, 'strong');
    assert.equal(classifyDuplicateIdentityEvidence(hubspotTax()).axis, 'exact_fiscal_identity');
  });

  it('M2 · ID-5 · hubspot 82 (nombre normalizado, sin país) NO es fuerte', () => {
    const e = classifyDuplicateIdentityEvidence(hubspotName());
    assert.equal(e.strength, 'weak');
    assert.equal(e.axis, 'normalized_name');
    assert.equal(hasStrongIdentityDuplicateMatch([hubspotName()], 'hubspot'), false);
  });

  it('ID-6 · hubspot 65 y 50 NO son fuertes; hubspot 85 (NIT CANDIDATO) tampoco', () => {
    assert.equal(classifyDuplicateIdentityEvidence(hubspotNameContains()).strength, 'weak');
    assert.equal(classifyDuplicateIdentityEvidence(hubspotWeakHit()).strength, 'weak');
    // El NIT candidato es una INFERENCIA que el propio checker marca
    // `requires_human_review`. Tratarlo como identidad fuerte convertiría una
    // suposición en una supresión.
    const e = classifyDuplicateIdentityEvidence(hubspotTaxCandidate());
    assert.equal(e.strength, 'weak');
    assert.equal(e.axis, 'candidate_fiscal_identity');
    assert.equal(e.softReason, 'candidate_fiscal_only');
  });

  it('sellup 65 (contenido de nombre) NO es fuerte', () => {
    assert.equal(classifyDuplicateIdentityEvidence(sellupNameContains()).strength, 'weak');
  });

  it('los buscadores devuelven la COINCIDENCIA, no un booleano: la evidencia no se pierde', () => {
    // Mezcla real: un eje fuerte y uno débil de la misma fuente.
    const matches = [sellupNameCountry('vieja.com'), sellupDomain('acme.com')];
    const strong = findStrongIdentityDuplicateMatch(matches, 'sellup', { candidateDomain: 'acme.com' });
    assert.equal(strong?.confidence, 95);
    assert.equal(strong?.matchedId, 'a1');
    const weak = findWeakIdentityDuplicateMatch(matches, 'sellup', { candidateDomain: 'acme.com' });
    assert.equal(weak?.confidence, 88);
    assert.equal(weak?.matchedName, 'Servicios Integrales S.A.S.');
    // Sin eje fuerte, el buscador fuerte devuelve null y el débil sigue trayendo evidencia.
    assert.equal(findStrongIdentityDuplicateMatch([sellupNameCountry()], 'sellup'), null);
    assert.equal(findWeakIdentityDuplicateMatch([sellupNameCountry()], 'sellup')?.confidence, 88);
  });

  it('fail-closed hacia la REVISIÓN: una confianza DESCONOCIDA es débil, jamás fuerte', () => {
    const weird = match({ source: 'sellup', status: 'existing_in_sellup', confidence: 100, reason: 'eje inventado' });
    const e = classifyDuplicateIdentityEvidence(weird);
    assert.equal(e.strength, 'weak');
    assert.equal(e.axis, 'unclassified');
    assert.equal(e.softReason, 'unclassified_axis');
  });

  it('los estados que NO son evidencia de identidad no pesan en ninguna dirección', () => {
    for (const status of ['insufficient_data', 'new_candidate', 'unchecked', 'error'] as const) {
      const e = classifyDuplicateIdentityEvidence(match({ source: 'sellup', status, confidence: 0 }));
      assert.equal(e.strength, 'none', status);
      assert.equal(e.axis, 'non_identity', status);
    }
  });

  it('🔴 las confianzas del lector son las de PRODUCCIÓN, contrastadas contra los checkers', () => {
    const sellup = read('src/server/agents/prospecting-toolkit/sellup-duplicate-checker.ts');
    const hubspot = read('src/server/agents/prospecting-toolkit/hubspot-duplicate-checker.ts');
    // Cada confianza que el lector clasifica EXISTE en el checker de su fuente.
    for (const c of [95, 92, 88, 65]) {
      assert.match(sellup, new RegExp(`confidence:\\s*${c}\\b`), `sellup ${c}`);
    }
    for (const c of [95, 92, 85, 82, 65, 50]) {
      assert.match(hubspot, new RegExp(`confidence:\\s*${c}\\b`), `hubspot ${c}`);
    }
    // Y a la inversa: ninguna confianza emitida por un checker se queda sin
    // clasificar en silencio. Si un checker añade un eje, esta prueba lo caza.
    //
    // 🔴 Sólo se leen las confianzas de un `DuplicateMatch` REAL —las que van
    // pegadas a un `source:` + `status:`—. Las de `resolveSellUpStatus` /
    // `resolveHubSpotStatus` (`new_candidate`, 85/80) no son ejes de
    // coincidencia: son el veredicto agregado, y confundirlas obligaría al
    // lector a clasificar un número que ningún match lleva encima.
    const emitted = (src: string) =>
      [...src.matchAll(/source: '(?:sellup|hubspot)',\s*\n\s*status: '[a-z_]+',\s*\n\s*confidence: (\d+)/g)]
        .map((m) => Number(m[1]))
        .filter((n) => n > 0);
    const sellupKnown = new Set([95, 92, 88, 65]);
    const hubspotKnown = new Set([95, 92, 85, 82, 65, 50]);
    for (const c of emitted(sellup)) assert.ok(sellupKnown.has(c), `sellup emite ${c} sin clasificar`);
    for (const c of emitted(hubspot)) assert.ok(hubspotKnown.has(c), `hubspot emite ${c} sin clasificar`);
  });

  it('🔴 el lector es PURO: sin fetch, sin env, sin Supabase', () => {
    const src = readCode('src/server/agents/prospecting-toolkit/strong-identity-duplicate-match.ts');
    assert.doesNotMatch(src, /\bfetch\s*\(/);
    assert.doesNotMatch(src, /process\.env/);
    assert.doesNotMatch(src, /supabase/i);
  });

  it('§ 4 · hay UN solo lector: el helper Apollo-scoped desapareció', () => {
    assert.throws(() =>
      read('src/server/agents/prospecting-toolkit/apollo-two-round/apollo-strong-identity-duplicate-match.ts'),
    );
    const runner = read('src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts');
    assert.match(runner, /from '\.\.\/strong-identity-duplicate-match'/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('CUT-L7 §§ 8, 31 — VETO por dominio contradictorio', () => {
  it('normaliza dominios antes de compararlos', () => {
    assert.equal(normalizeIdentityDomain('HTTPS://WWW.Acme.com/algo?x=1'), 'acme.com');
    assert.equal(normalizeIdentityDomain('   '), null);
    assert.equal(normalizeIdentityDomain(null), null);
  });

  it('la AUSENCIA nunca es contradicción', () => {
    assert.equal(hasContradictoryDomains(null, 'a.com'), false);
    assert.equal(hasContradictoryDomains('a.com', null), false);
    assert.equal(hasContradictoryDomains(null, null), false);
    assert.equal(hasContradictoryDomains('a.com', 'a.com'), false);
    assert.equal(hasContradictoryDomains('a.com', 'b.com'), true);
  });

  it('M3 · ID-7 · mismo nombre + país con dominios DISTINTOS ⇒ débil, con el motivo nombrado', () => {
    const e = classifyDuplicateIdentityEvidence(sellupNameCountry('old-acme.com'), {
      candidateDomain: 'new-acme.com',
    });
    assert.equal(e.strength, 'weak');
    assert.equal(e.softReason, 'domain_contradiction');
    assert.equal(
      hasStrongIdentityDuplicateMatch([sellupNameCountry('old-acme.com')], 'sellup', {
        candidateDomain: 'new-acme.com',
      }),
      false,
    );
  });

  it('M3 · el mismo veto sobre el respaldo por NOMBRE de HubSpot', () => {
    const e = classifyDuplicateIdentityEvidence(hubspotName('old-acme.com'), {
      candidateDomain: 'new-acme.com',
    });
    assert.equal(e.strength, 'weak');
    assert.equal(e.softReason, 'domain_contradiction');
  });

  it('M4 · ID-8 · mismo nombre + país SIN dominio del candidato ⇒ débil por `name_only`', () => {
    const e = classifyDuplicateIdentityEvidence(sellupNameCountry(null), { candidateDomain: null });
    assert.equal(e.strength, 'weak');
    assert.equal(e.softReason, 'name_only');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('CUT-L7 §§ 9, 10, 33 — la identidad FUERTE no se toca', () => {
  it('ID-9 · M9 · mismo dominio con nombre DISTINTO sigue siendo duplicado duro', () => {
    // candidato: ACME Colombia / acme.com — conocida: ACME Holdings / acme.com
    const m = sellupDomain('acme.com');
    m.matchedName = 'ACME Holdings';
    assert.equal(
      hasStrongIdentityDuplicateMatch([m], 'sellup', { candidateDomain: 'acme.com' }),
      true,
    );
    // Y la diferencia de nombre NO debilita el dominio.
    assert.equal(classifyDuplicateIdentityEvidence(m, { candidateDomain: 'acme.com' }).strength, 'strong');
  });

  it('ID-10 · M10 · identidad fiscal válida con nombre y dominio distintos sigue siendo dura', () => {
    assert.equal(
      hasStrongIdentityDuplicateMatch([sellupTax()], 'sellup', { candidateDomain: 'dominio-distinto.com' }),
      true,
    );
    assert.equal(
      hasStrongIdentityDuplicateMatch([hubspotTax()], 'hubspot', { candidateDomain: 'dominio-distinto.com' }),
      true,
    );
  });

  it('🔴 el veto de dominio NO se aplica a los ejes fuertes: sólo a los de NOMBRE', () => {
    // Un identificador fiscal exacto con dominio distinto sigue siendo fuerte:
    // dos dominios no desmienten una identidad legal afirmativa.
    const e = classifyDuplicateIdentityEvidence(sellupTax(), { candidateDomain: 'otro.com' });
    assert.equal(e.strength, 'strong');
    assert.equal(e.softReason, null);
  });

  it('M11 · el id de proveedor NO se promueve a identidad global: sigue con ámbito de LOTE', () => {
    const registry = read('src/server/agents/prospecting-toolkit/batch-identity-registry.ts');
    // TIER 3 compara el id del MISMO proveedor, con el namespace DENTRO de la clave.
    assert.match(registry, /providerEntityKey !== null &&\s*evidence\.providerEntityKey === other\.providerEntityKey/);
    // El lector compartido no sabe nada de ids de proveedor: no puede promoverlos.
    const reader = readCode('src/server/agents/prospecting-toolkit/strong-identity-duplicate-match.ts');
    assert.doesNotMatch(reader, /providerEntityKey/);
    assert.doesNotMatch(reader, /provider_seen/);
  });

  it('§ 24 · el registro de lote —el PRECEDENTE— conserva su semántica', () => {
    const evidence = (over: Partial<CompanyIdentityEvidence>): CompanyIdentityEvidence => ({
      fiscalIdentityKey: null,
      normalizedDomain: null,
      providerEntityKey: null,
      normalizedLinkedInCompany: null,
      canonicalName: null,
      countryNamespace: null,
      ...over,
    });
    // mismo nombre canónico, dominios distintos ⇒ posible duplicado TIER 5.
    let reg = createBatchIdentityRegistry('b1');
    reg = acceptIdentity(reg, evidence({ canonicalName: 'servicios integrales', normalizedDomain: 'alpha.com' }), 'c1');
    const soft = evaluateCandidateIdentity(reg, evidence({ canonicalName: 'servicios integrales', normalizedDomain: 'beta.com' }));
    assert.equal(soft.action, 'possible_duplicate');
    assert.equal(soft.matchedSignal, 'canonical_name');
    assert.equal(soft.matchedTier, 5);
    assert.equal(soft.softReason, 'name_only');
    // mismo dominio ⇒ duplicado duro.
    const hard = evaluateCandidateIdentity(reg, evidence({ canonicalName: 'otra cosa', normalizedDomain: 'alpha.com' }));
    assert.equal(hard.action, 'hard_duplicate');
    assert.equal(hard.matchedSignal, 'normalized_domain');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('CUT-L7 §§ 11-13, 36 — PRE-PAGO gratuito: el falso positivo GASTABA', () => {
  const MACRO = 'health_pharma';

  function company(over: Partial<CountrySourceCompany> & { recordIdentityKey: string }): CountrySourceCompany {
    return {
      legalName: `SERVICIOS INTEGRALES ${over.recordIdentityKey}`,
      normalizedLegalName: `servicios integrales ${over.recordIdentityKey}`,
      taxId: `9000000${over.recordIdentityKey}`,
      taxIdentifierType: 'NIT',
      countryCode: 'CO',
      city: 'BOGOTA',
      region: 'BOGOTA D.C.',
      domain: null,
      declaredIndustry: 'Fabricación de productos farmacéuticos',
      industryCode: '2100',
      coarseSector: 'MANUFACTURA',
      ...over,
    };
  }

  function adapterFor(companies: CountrySourceCompany[]): CountrySourceAdapter {
    return async () => ({ sourceKey: 'co_siis', companies, recordsRead: companies.length });
  }

  async function runFree(
    companies: CountrySourceCompany[],
    checker: (input: DuplicateCheckInput) => DuplicateCheckResult,
    requestedTarget = 2,
  ) {
    let checkerCalls = 0;
    const discovery = await runCountrySourcePrePaidDiscovery(
      { countryCode: 'CO', macroIndustryKey: MACRO, requestedTarget },
      {
        adapter: adapterFor(companies),
        checkCompanyDuplicate: async (input) => {
          checkerCalls++;
          return checker(input);
        },
      },
    );
    const context = buildPrePaidNoveltyContext({
      requestedTarget,
      countryCode: 'CO',
      macroIndustryKey: MACRO,
      freeSource: discovery.outcome,
      knownSellupCount: discovery.outcome.sellupKnown,
      knownHubspotCount: discovery.outcome.hubspotKnown,
    });
    return { discovery, context, checkerCalls };
  }

  it('M5 · § 11 · nombre + país (sellup 88) ya NO es `sellup_known`', async () => {
    const { discovery } = await runFree([company({ recordIdentityKey: '1' })], (input) =>
      result([sellupNameCountry()], input),
    );
    assert.equal(discovery.outcome.sellupKnown, 0);
    assert.equal(discovery.outcome.acceptedNovel, 1);
    assert.equal(discovery.acceptedCompanies.length, 1);
  });

  it('M2 · § 11 · nombre normalizado de HubSpot (82) ya NO es `hubspot_known`', async () => {
    const { discovery } = await runFree([company({ recordIdentityKey: '1' })], (input) =>
      result([hubspotName()], input),
    );
    assert.equal(discovery.outcome.hubspotKnown, 0);
    assert.equal(discovery.outcome.acceptedNovel, 1);
  });

  it('§ 12 · ID-7 · mismo nombre + país con dominio DISTINTO ⇒ novel, y el pago NO se dispara', async () => {
    // conocida: "Acme" CO old-acme.com · libre: "Acme" CO new-acme.com
    const free = company({ recordIdentityKey: '1', domain: 'new-acme.com' });
    const { discovery, context } = await runFree(
      [free],
      (input) => result([sellupNameCountry('old-acme.com')], input),
      1,
    );
    assert.equal(discovery.outcome.sellupKnown, 0);
    assert.equal(discovery.outcome.acceptedNovel, 1);
    // 🔴 El efecto económico: el hueco residual se cierra y el proveedor de PAGO
    // deja de ser necesario. Antes, el homónimo lo dejaba abierto.
    assert.equal(context.acceptedBeforeProvider, 1);
    assert.equal(context.residualGap, 0);
    assert.equal(context.providerRequired, false);
  });

  it('§ 13 · ID-8 · mismo nombre + país SIN dominio ⇒ NO conocida (llega a revisión)', async () => {
    const { discovery } = await runFree(
      [company({ recordIdentityKey: '1', domain: null })],
      (input) => result([sellupNameCountry(null)], input),
      1,
    );
    assert.equal(discovery.outcome.sellupKnown, 0);
    assert.equal(discovery.acceptedCompanies.length, 1);
  });

  it('§ 36 · REGRESIÓN P0 — el falso positivo por nombre GASTABA: dos empresas, cero pago', async () => {
    // Objetivo 2. Las DOS empresas libres son homónimas de cuentas conocidas y
    // ninguna comparte dominio ni NIT. Antes: 2 × `sellup_known` ⇒ hueco 2 ⇒ el
    // proveedor de PAGO recibía el objetivo ENTERO.
    const companies = [
      company({ recordIdentityKey: '1', domain: 'uno.com' }),
      company({ recordIdentityKey: '2', domain: 'dos.com' }),
    ];
    const { discovery, context } = await runFree(
      companies,
      (input) => result([sellupNameCountry('vieja.com'), hubspotName('vieja.com')], input),
      2,
    );
    assert.equal(discovery.outcome.sellupKnown, 0);
    assert.equal(discovery.outcome.hubspotKnown, 0);
    assert.equal(discovery.outcome.acceptedNovel, 2);
    assert.equal(context.residualGap, 0);
    // Ninguna llamada de PAGO se justifica por una colisión de nombre.
    assert.equal(context.providerRequired, false);
  });

  it('M9 · M12 · § 38 · el DOMINIO conocido sigue suprimiendo igual (CUT-L1 intacto)', async () => {
    const { discovery, context } = await runFree(
      [company({ recordIdentityKey: '1', domain: 'acme.com' })],
      (input) => result([sellupDomain('acme.com')], input),
      1,
    );
    assert.equal(discovery.outcome.sellupKnown, 1);
    assert.equal(discovery.outcome.acceptedNovel, 0);
    assert.equal(context.residualGap, 1);
    assert.equal(context.providerRequired, true);
  });

  it('M10 · la identidad FISCAL fuerte sigue suprimiendo, en las dos fuentes', async () => {
    const a = await runFree([company({ recordIdentityKey: '1' })], (input) => result([sellupTax()], input), 1);
    assert.equal(a.discovery.outcome.sellupKnown, 1);
    const b = await runFree([company({ recordIdentityKey: '1' })], (input) => result([hubspotTax()], input), 1);
    assert.equal(b.discovery.outcome.hubspotKnown, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('CUT-L7 §§ 14-16, 37 — LUSHA post-pago: no pagar dos veces por un nombre', () => {
  it('M6 · § 14 · sellup 88 + hubspot 82 ⇒ `possible_duplicate`, NO `exact_duplicate`', () => {
    const r = resolveLushaCandidateDuplicateState(
      result([sellupNameCountry(), hubspotName()]),
      NO_GUARD,
    );
    assert.equal(r.dbDuplicateStatus, 'possible_duplicate');
    // 🔴 El candidato YA PAGADO sigue siendo útil: llega a revisión humana.
    assert.equal(isUsefulLushaResolution(r), true);
  });

  it('§ 14 · la evidencia NO se pierde: id, nombre, dominio y `reason` sobreviven', () => {
    const r = resolveLushaCandidateDuplicateState(
      result([sellupNameCountry('old-acme.com')], { domain: 'new-acme.com' }),
      NO_GUARD,
    );
    assert.equal(r.dbDuplicateStatus, 'possible_duplicate');
    assert.equal(r.matchedAccountId, null, 'a3 no es un UUID de cuenta válido');
    const detail = r.duplicateDetails?.sources.find((s) => s.source === 'sellup');
    assert.ok(detail, 'la fuente sellup sobrevive en el detalle del revisor');
    assert.equal(detail.strength, 'possible');
    assert.equal(detail.confidence, 88);
    assert.equal(detail.matchedName, 'Servicios Integrales S.A.S.');
    assert.equal(detail.matchedDomain, 'old-acme.com');
    assert.match(detail.reason ?? '', /Nombre normalizado exacto/);
    assert.match(r.duplicateDetails?.reviewerMessage ?? '', /Posible duplicado/);
  });

  it('§ 15 · ID-7 · mismo nombre + país con dominio DISTINTO ⇒ persiste, útil, sin top-up', () => {
    const r = resolveLushaCandidateDuplicateState(
      result([sellupNameCountry('old-acme.com')], { domain: 'new-acme.com' }),
      NO_GUARD,
    );
    assert.equal(r.dbDuplicateStatus, 'possible_duplicate');
    assert.equal(isUsefulLushaResolution(r), true);
    assert.equal(r.accountDuplicateCheck, 'performed_possible_duplicate');
  });

  it('M4 · § 16 · ID-8 · mismo nombre + país SIN dominio ⇒ `possible_duplicate`', () => {
    const r = resolveLushaCandidateDuplicateState(
      result([sellupNameCountry(null)], { domain: null }),
      NO_GUARD,
    );
    assert.equal(r.dbDuplicateStatus, 'possible_duplicate');
    assert.equal(isUsefulLushaResolution(r), true);
  });

  it('M9 · el DOMINIO exacto sigue siendo `exact_duplicate` y sigue siendo inútil', () => {
    const r = resolveLushaCandidateDuplicateState(
      result([sellupDomain('acme.com')], { domain: 'acme.com' }),
      NO_GUARD,
    );
    assert.equal(r.dbDuplicateStatus, 'exact_duplicate');
    assert.equal(isUsefulLushaResolution(r), false);
    assert.equal(r.accountDuplicateCheck, 'performed_matched');
  });

  it('M10 · la identidad FISCAL fuerte sigue siendo `exact_duplicate`, en las dos fuentes', () => {
    const a = resolveLushaCandidateDuplicateState(result([sellupTax()]), NO_GUARD);
    assert.equal(a.dbDuplicateStatus, 'exact_duplicate');
    const b = resolveLushaCandidateDuplicateState(result([hubspotTax()]), NO_GUARD);
    assert.equal(b.dbDuplicateStatus, 'exact_duplicate');
  });

  it('sin ninguna coincidencia sigue siendo `no_match` y sin detalle', () => {
    const r = resolveLushaCandidateDuplicateState(result([]), NO_GUARD);
    assert.equal(r.dbDuplicateStatus, 'no_match');
    assert.equal(r.duplicateDetails, null);
    assert.equal(r.accountDuplicateCheck, 'performed_no_match');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('CUT-L7 §§ 17-19, 35 — guarda de candidatos ACTIVOS', () => {
  const active = (over: Partial<ActiveCandidateRecord> = {}): ActiveCandidateRecord[] => [
    {
      id: 'cand-1',
      name: 'Acme',
      domain: 'a.com',
      inferredCompanyName: 'Acme',
      normalizedName: 'acme',
      status: 'needs_review',
      ...over,
    },
  ];

  it('el eje FUERTE de la guarda es el dominio, y sólo el dominio', () => {
    assert.deepEqual([...STRONG_ACTIVE_GUARD_REASONS].sort(), ['same_active_domain']);
    assert.deepEqual([...WEAK_ACTIVE_GUARD_REASONS].sort(), [
      'same_canonical_identity',
      'same_inferred_identity',
    ]);
    assert.equal(isStrongActiveGuardReason('same_active_domain'), true);
    assert.equal(isStrongActiveGuardReason('same_inferred_identity'), false);
    assert.equal(isWeakActiveGuardReason('same_inferred_identity'), true);
    assert.equal(isStrongActiveGuardReason(null), false);
  });

  it('M7 · ID-12 · § 18 · `same_inferred_identity` con dominios DISTINTOS ⇒ sin salto duro', () => {
    const m = checkActiveCandidateDuplicate(
      { name: 'Acme', domain: 'b.com', inferredCompanyName: 'Acme', normalizedName: 'acme' },
      active(),
    );
    assert.equal(m.matched, true);
    assert.equal(m.reason, 'same_inferred_identity');
    // El guard sigue REPORTANDO la coincidencia — la evidencia no se descarta —
    // pero deja de justificar un salto duro.
    assert.equal(isStrongActiveGuardMatch(m), false);
  });

  it('M7 · ID-13 · `same_inferred_identity` SIN dominio ⇒ sin salto duro, con evidencia', () => {
    const m = checkActiveCandidateDuplicate(
      { name: 'Acme', domain: null, inferredCompanyName: 'Acme', normalizedName: 'acme' },
      active({ domain: null }),
    );
    assert.equal(m.reason, 'same_inferred_identity');
    assert.equal(isStrongActiveGuardMatch(m), false);
    // …y en Lusha esa evidencia se convierte en posible duplicado revisable.
    const r = resolveLushaCandidateDuplicateState(result([]), m);
    assert.equal(r.dbDuplicateStatus, 'possible_duplicate');
    assert.equal(isUsefulLushaResolution(r), true);
    assert.equal(r.activeCandidateDuplicateCheck, 'performed_possible_duplicate');
    assert.equal(r.activeGuardReason, 'same_inferred_identity');
    const detail = r.duplicateDetails?.sources.find((s) => s.source === 'active_candidate');
    assert.ok(detail);
    assert.equal(detail.strength, 'possible');
    assert.equal(detail.matchedCandidateId, 'cand-1');
    assert.match(detail.reason ?? '', /nombre inferido/);
  });

  it('ID-14 · M9 · § 19 · el MISMO dominio activo sigue saltando DURO', () => {
    const m = checkActiveCandidateDuplicate(
      { name: 'Otro Nombre', domain: 'a.com', inferredCompanyName: 'Otro Nombre', normalizedName: 'otro nombre' },
      active(),
    );
    assert.equal(m.reason, 'same_active_domain');
    assert.equal(isStrongActiveGuardMatch(m), true);
  });

  it('`same_canonical_identity` conserva su comportamiento previo: posible duplicado', () => {
    const m = checkActiveCandidateDuplicate(
      { name: 'X', domain: null, inferredCompanyName: 'Distinto Del Activo', normalizedName: 'acme' },
      active({ inferredCompanyName: 'Nombre Comercial Distinto' }),
    );
    assert.equal(m.reason, 'same_canonical_identity');
    assert.equal(isStrongActiveGuardMatch(m), false);
    const r = resolveLushaCandidateDuplicateState(result([]), m);
    assert.equal(r.dbDuplicateStatus, 'possible_duplicate');
  });

  it('M7 · § 21 · los CUATRO consumidores de la guarda leen el MISMO criterio', () => {
    const writer = readCode('src/server/agents/prospecting-toolkit/candidate-writer.ts');
    const preWriter = readCode('src/server/agents/prospecting-toolkit/apollo-pre-writer-target-conditions.ts');
    const lusha = readCode('src/server/prospect-batches/lusha-pending-review.ts');
    for (const [label, src] of [['writer', writer], ['pre-writer', preWriter], ['lusha', lusha]] as const) {
      assert.match(src, /isStrongActiveGuardReason/, label);
      // 🔴 Ya NO queda ni una comparación cruda contra `same_inferred_identity`
      // que decida un bloqueo: el criterio vive en un solo sitio.
      assert.doesNotMatch(
        src,
        /reason === 'same_active_domain'\s*\|\|[\s\S]{0,80}?'same_inferred_identity'/,
        label,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('CUT-L7 §§ 20-21, 34 — APOLLO: paridad, sin cambio en su eje de NOMBRE', () => {
  const candidateWith = (matches: DuplicateMatch[]) =>
    ({ duplicateCheck: result(matches) }) as never;

  it('M8 · ID-11 · la MISMA entrada débil se clasifica igual en Apollo y en el lector', () => {
    for (const m of [sellupNameCountry(), sellupNameContains()]) {
      assert.equal(readDuplicateVerdict(candidateWith([m])).sellUpDuplicate, false);
      assert.equal(hasStrongIdentityDuplicateMatch([m], 'sellup'), false);
    }
    for (const m of [hubspotName(), hubspotNameContains(), hubspotWeakHit(), hubspotTaxCandidate()]) {
      assert.equal(readDuplicateVerdict(candidateWith([m])).hubSpotDuplicate, false);
      assert.equal(hasStrongIdentityDuplicateMatch([m], 'hubspot'), false);
    }
  });

  it('M8 · los ejes FUERTES siguen bloqueando en Apollo exactamente igual', () => {
    assert.equal(readDuplicateVerdict(candidateWith([sellupDomain()])).sellUpDuplicate, true);
    assert.equal(readDuplicateVerdict(candidateWith([sellupTax()])).sellUpDuplicate, true);
    assert.equal(readDuplicateVerdict(candidateWith([hubspotDomain()])).hubSpotDuplicate, true);
  });

  it('🔴 la ÚNICA diferencia de veredicto en Apollo: hubspot 95 (fiscal OFICIAL) pasa a fuerte', () => {
    // Antes se omitía de la lista `[92]` y una empresa que HubSpot ya tenía con
    // ese identificador fiscal podía comprarse otra vez. El cambio va en la
    // dirección conservadora y no toca ningún eje de NOMBRE.
    assert.equal(readDuplicateVerdict(candidateWith([hubspotTax()])).hubSpotDuplicate, true);
  });

  it('§ 20 · Apollo no gana ni pierde ninguna otra semántica: paginación/facturación intactas', () => {
    const runner = read('src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts');
    // El único punto de lectura sigue siendo `readDuplicateVerdict`.
    const uses = [...runner.matchAll(/hasStrongIdentityDuplicateMatch\(/g)].length;
    assert.equal(uses, 2, 'sólo las dos lecturas de readDuplicateVerdict');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe('CUT-L7 §§ 5, 23, 29, 40, 43 — alcance, fidelidad y cableado', () => {
  it('§ 5 · los checkers CRUDOS no cambian su contrato de salida', () => {
    const sellup = read('src/server/agents/prospecting-toolkit/sellup-duplicate-checker.ts');
    const hubspot = read('src/server/agents/prospecting-toolkit/hubspot-duplicate-checker.ts');
    // Siguen emitiendo la evidencia débil, que sigue siendo útil para revisión.
    assert.match(sellup, /confidence: 88/);
    assert.match(hubspot, /confidence: 82/);
    // Y siguen etiquetándola como `existing_in_*`: lo que se corrigió es la
    // INTERPRETACIÓN, no la evidencia.
    assert.match(sellup, /status: 'existing_in_sellup',\s*\n\s*confidence: 88/);
  });

  it('§ 41 · la deuda de identidad fiscal SIN ámbito de país se REGISTRA, no se corrige', () => {
    const sellup = read('src/server/agents/prospecting-toolkit/sellup-duplicate-checker.ts');
    // Sigue exactamente como estaba: `ilike` sobre tax_identifier sin country_code.
    assert.match(sellup, /\.ilike\('tax_identifier', `%\$\{normalizedTaxId\}%`\)/);
    const taxBlock = sellup.slice(
      sellup.indexOf('// ── 2. Tax identifier exacto'),
      sellup.indexOf('// ── 3. normalized_name'),
    );
    assert.doesNotMatch(taxBlock, /country_code/);
  });

  it('M13 · § 29 · la confianza INVENTADA 90 de HubSpot no vuelve al fixture de paridad', () => {
    const parity = readCode('src/server/prospect-batches/__tests__/lusha-duplicate-parity.test.ts');
    assert.doesNotMatch(parity, /source: 'hubspot'[^}]*confidence: 90/);
    assert.match(parity, /source: 'hubspot'[^}]*confidence: 92/);
    // Y la otra fábrica sintética del pre-pago tampoco vuelve a `100`.
    const prepaid = readCode(
      'src/server/prospect-batches/country-source-discovery/__tests__/country-source-prepaid-discovery.test.ts',
    );
    assert.doesNotMatch(prepaid, /confidence: 100/);
    assert.match(prepaid, /confidence: 92, reason: 'tax_identifier'/);
    assert.match(prepaid, /confidence: 95, reason: 'nit'/);
  });

  it('M13 · § 29 · NINGUNA suite del área vuelve a inventar una confianza', () => {
    // 🔴 Guarda de fidelidad, no de estilo: la fuerza de identidad se lee de la
    // confianza, así que un valor inventado defiende un eje que no existe. Estas
    // cinco suites construían `DuplicateMatch` a mano con 90 o 100.
    const SUITES = [
      'src/server/prospect-batches/__tests__/lusha-duplicate-parity.test.ts',
      'src/server/prospect-batches/__tests__/agent1-prepaid-novelty-zero-page.test.ts',
      'src/server/prospect-batches/__tests__/agent1-provider-seen-executor.test.ts',
      'src/server/prospect-batches/provider-seen/__tests__/provider-seen-activation.test.ts',
      'src/server/prospect-batches/country-source-discovery/__tests__/country-source-prepaid-discovery.test.ts',
    ];
    const PRODUCTION_CONFIDENCES = new Set([0, 50, 65, 80, 82, 85, 88, 92, 95]);
    for (const rel of SUITES) {
      const code = readCode(rel);
      for (const m of code.matchAll(/confidence:\s*(\d+)/g)) {
        assert.ok(
          PRODUCTION_CONFIDENCES.has(Number(m[1])),
          `${rel} usa una confianza que producción NO emite: ${m[1]}`,
        );
      }
    }
  });

  it('§ 23 · `provider_seen` sigue siendo economía, sin evidencia de NOMBRE', () => {
    const seen = readCode('src/modules/prospect-batches/provider-seen/provider-seen-identity.ts');
    assert.doesNotMatch(seen, /normalizedName|canonicalName|normalized_name/);
  });

  it('§ 40 · CUT-L7 no añade ninguna migración: el techo sigue en 136', () => {
    assert.ok(read('supabase/migrations/135_agent1_lusha_prospecting_request_fence.sql').length > 0);
    assert.ok(read('supabase/migrations/136_agent1_lusha_prospecting_safe_retry_attempts.sql').length > 0);
    // Ninguna 137, se llame como se llame.
    const migrations = readdirSync(join(repoRoot, 'supabase/migrations'));
    assert.equal(migrations.filter((f) => /^13[7-9]_|^1[4-9]\d_/.test(f)).length, 0);
  });

  it('M14 · § 43 · la suite está cableada al check OBLIGATORIO', () => {
    const pkg = read('package.json');
    assert.match(pkg, /"test:a1-lusha-cut-l7-shared-identity"/);
    assert.match(pkg, /cut-l7-shared-identity-correction\.test\.ts/);
    const ci = read('.github/workflows/automatic-routing-tests.yml');
    assert.match(ci, /npm run test:a1-lusha-cut-l7-shared-identity/);
  });

  it('§ 39 · CUT-L1..L5 intactos: ni página, ni reintentos, ni facturación, ni exclusión', () => {
    const contract = readCode('src/server/integrations/lusha-prospecting-contract.ts');
    assert.match(contract, /LUSHA_PROSPECTING_BILLING_BLOCK_SIZE\s*=\s*25/);
    assert.match(contract, /LUSHA_PROSPECTING_PAGE_SIZE\s*=\s*LUSHA_PROSPECTING_BILLING_BLOCK_SIZE/);
    const limits = readCode('src/server/prospect-batches/lusha-pending-review-limits.ts');
    assert.match(limits, /LUSHA_PENDING_REVIEW_MAX_PAGES\s*=\s*2/);
    const reader = readCode('src/server/agents/prospecting-toolkit/strong-identity-duplicate-match.ts');
    // El lector de identidad no sabe nada de proveedor, páginas ni créditos.
    assert.doesNotMatch(reader, /credit|page|retry|attempt|fence/i);
  });
});
