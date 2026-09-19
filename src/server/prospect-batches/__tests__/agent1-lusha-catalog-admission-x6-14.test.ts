/**
 * AGENT1-LUSHA-CATALOG-ADMISSION-X6.14 — la admisión ocurre ANTES del catálogo,
 * y `quality_gate` deja de declararse aprobado sin mirarlo.
 *
 * ── Los dos defectos que estas pruebas fijan ────────────────────────────────
 *
 * 1. ORDEN. La consulta de identidad al catálogo oficial (`co_siis`: nombre →
 *    NIT) corría en TERCER lugar, antes de la precisión macro y de la guarda de
 *    candidatas activas. Las empresas que esos dos filtros iban a descartar ya
 *    la habían consultado. En Producción son 11 de 113 descartes de Lusha por
 *    `sector_rejected`, más los de la guarda.
 *
 * 2. CALIDAD. `lusha-run-acceptance-truth.ts` escribía `qualityGate: 'pass'`
 *    fijo. Un intermediario de contenido o una plataforma externa entraban a
 *    revisión y CONTABAN hacia el mínimo de 5.
 *
 * ── 🔴 Lo que estas pruebas NO permiten ─────────────────────────────────────
 *
 * · Que la dedupe FISCAL pierda su insumo: la consulta de identidad sigue antes
 *   del chequeo de duplicados que la usa.
 * · Que una condición NO evaluada se declare aprobada.
 * · Que `not_applicable` se confunda con `passed`.
 * · Que el ICP B2B tech rechace empresas legítimas de retail/consumo.
 * · Que `ownership_unverified` deje de entrar a revisión o pase a contar.
 * · Que algún descarte pierda su fila durable.
 *
 * I/O simulado: sin red, sin base, sin proveedor, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateLushaQualityGate,
  toLushaQualityGateMetadata,
} from '@/server/prospect-batches/lusha-quality-gate';
import {
  buildLushaPendingReviewCandidateRows,
  resolveLushaCandidatesDuplicateState,
  toLushaSurvivorCompletenessInput,
  type ResolvedLushaCandidate,
} from '@/server/prospect-batches/lusha-pending-review';
import { evaluateLushaOwnershipEvidence } from '@/server/prospect-batches/lusha-ownership-evidence';
import {
  evaluateLushaSurvivorCompleteness,
  resolveLushaRunAcceptanceTruth,
} from '@/server/prospect-batches/lusha-run-acceptance-truth';
import { resolveLushaDiscardDisposition } from '@/modules/prospect-discards/lusha-mapping';
import {
  evaluateBusinessFit,
  isBlockedByBusinessFit,
} from '@/server/agents/prospecting-toolkit/business-fit-gate';
import { hasOwnershipUnverifiedFlag } from '@/modules/prospect-batches/ownership-review-flag';
import type { LushaPreviewCompany } from '@/server/prospect-batches/lusha-preview';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function company(
  id: string,
  name: string,
  domain: string,
  overrides: Partial<LushaPreviewCompany> = {},
): LushaPreviewCompany {
  return {
    providerCompanyId: id,
    name,
    domain,
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Retail',
    employeesExact: 700,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: `https://www.linkedin.com/company/${id}-co`,
    score: 100,
    passesGate: true,
    issues: [],
    ...overrides,
  };
}

/** Empresa de retail real, del universo colombiano de las corridas de Producción. */
const RETAIL_OK = company('vaquita', 'Supermercados Vaquita', 'vaquitaexpress.com.co');
/**
 * Consumo masivo, también real — y con el dominio que SÍ acredita su nombre, para
 * poder contrastar una candidata COMPLETA contra una marcada por ownership.
 */
const CONSUMO_OK = company('cuerosvelez', 'Cueros Velez SAS', 'cuerosvelez.com', {
  industry: 'Consumer Goods',
});
/** Blog: el intermediario de contenido que el gate compartido detecta por nombre. */
const INTERMEDIARIO = company('blog', 'CiberBlog Colombia', 'ciberblog.net');
/**
 * 🔴 Dominio que la lista de PLATAFORMAS EXTERNAS marca. En Apollo eso sería la
 * URL donde se ENCONTRÓ al candidato; aquí es su dominio propio, así que la
 * lista se observa y NO decide.
 */
const PLATAFORMA = company('mli', 'MercadoLibre Colombia', 'mercadolibre.com.co');

const LINKEDIN_OK = 'https://www.linkedin.com/company/acme-co';

const INPUT = { countryCode: 'CO' } as never;
const CRITERIA = {
  countryCode: 'CO',
  country: 'Colombia',
  industry: 'Retail',
  subindustries: [],
} as never;

/** Traza de TODO lo que la tubería preguntó al catálogo, en orden. */
type CatalogLog = string[];

function harness(options: { strongIdentityFor?: string | null; activeDomains?: string[] } = {}) {
  const catalogLog: CatalogLog = [];
  const duplicateLog: string[] = [];

  const resolvers = [
    {
      countryCode: 'CO',
      sourceKey: 'co_siis',
      canResolve: () => true,
      resolve: (input: { candidate: { canonicalName?: string | null } }) => {
        const name = input.candidate.canonicalName ?? '';
        catalogLog.push(name);
        const strong = options.strongIdentityFor ?? null;
        if (strong !== null && name === strong) {
          return {
            status: 'matched' as const,
            countryCode: 'CO',
            sourceKey: 'co_siis',
            confidence: 0.99,
            taxIdentifier: '900123456',
            taxIdentifierType: 'NIT',
            legalName: `${name} S.A.S`,
            warnings: [],
            issues: [],
          };
        }
        // 🔴 Sin coincidencia: `not_found`. NO se inventa NIT ni razón social.
        return {
          status: 'not_found' as const,
          countryCode: 'CO',
          sourceKey: 'co_siis',
          warnings: [],
          issues: [],
        };
      },
    },
  ] as never;

  const deps = {
    officialSourceResolvers: resolvers,
    fetchActiveCandidates: async () =>
      (options.activeDomains ?? []).map((domain) => ({
        id: `active-${domain}`,
        name: domain,
        domain,
        normalizedDomain: domain,
        status: 'needs_review',
        countryCode: 'CO',
      })) as never,
    checkCompanyDuplicate: async (dupInput: {
      taxIdentifier?: string | null;
      name?: string;
    }) => {
      duplicateLog.push(`${dupInput.name ?? ''}|nit=${dupInput.taxIdentifier ?? ''}`);
      // 🔴 Con NIT fuerte ⇒ duplicado exacto por IDENTIDAD FISCAL. La forma es la
      // del checker real (`confidence` 95, `matches` con su eje), no una
      // etiqueta inventada: CUT-L7 exige identidad fuerte, no el rótulo.
      if (dupInput.taxIdentifier) {
        return {
          status: 'existing_in_sellup',
          confidence: 95,
          input: dupInput,
          matches: [
            {
              source: 'sellup',
              status: 'existing_in_sellup',
              confidence: 95,
              reason: 'tax_identifier',
              matchedId: '11111111-1111-4111-8111-111111111111',
            },
          ],
          summary: 'NIT ya registrado en SellUp',
          checkedSources: ['sellup', 'hubspot'],
        } as never;
      }
      return {
        status: 'new',
        confidence: 0,
        input: dupInput,
        matches: [],
        summary: 'sin coincidencias',
        checkedSources: ['sellup', 'hubspot'],
      } as never;
    },
  } as never;

  return { deps, catalogLog, duplicateLog };
}

const PRECISION_RETAIL = { macroIndustryKey: 'retail', branch: null, branchIndex: 0 };

// ═════════════════════════════════════════════════════════════════════════════
// § A — LO DESCARTADO NO CONSULTA EL CATÁLOGO
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.14 § A · el catálogo se consulta DESPUÉS de la admisión', () => {
  it('🔴 rechazo por PAÍS ⇒ 0 consultas al catálogo', async () => {
    const { deps, catalogLog } = harness();
    const peruana = company('maestro', 'Maestro Peru', 'www.maestro.com.pe');

    const out = await resolveLushaCandidatesDuplicateState(deps, INPUT, [peruana], CRITERIA, null);

    assert.equal(out.countryExcluded.length, 1, 'la decisión de país sigue siendo la misma');
    assert.deepEqual(catalogLog, [], '🔴 no se preguntó por ella al catálogo');
    assert.equal(out.resolved.length, 0);
  });

  it('🔴 rechazo por PRECISIÓN MACRO ⇒ 0 consultas al catálogo', async () => {
    const { deps, catalogLog } = harness();
    // Industria declarada que no pertenece a la macro pedida.
    const fuera = company('mineria', 'Minera Andina', 'mineraandina.com.co', {
      industry: 'Mining & Metals',
    });

    const out = await resolveLushaCandidatesDuplicateState(
      deps,
      INPUT,
      [fuera],
      CRITERIA,
      PRECISION_RETAIL,
    );

    assert.equal(out.precisionRejected.length, 1, 'la precisión la rechazó');
    assert.deepEqual(catalogLog, [], '🔴 y lo hizo ANTES de consultar el catálogo');
    assert.equal(out.resolved.length, 0);
  });

  it('🔴 salto por GUARDA de candidata ACTIVA ⇒ 0 consultas al catálogo', async () => {
    const { deps, catalogLog } = harness({ activeDomains: ['vaquitaexpress.com.co'] });

    const out = await resolveLushaCandidatesDuplicateState(
      deps,
      INPUT,
      [RETAIL_OK],
      CRITERIA,
      null,
    );

    assert.equal(out.guardSkippedCount, 1, 'la guarda la saltó, como siempre');
    assert.equal(out.guardSkipped.length, 1, 'y conserva su identidad para la fila durable');
    assert.deepEqual(catalogLog, [], '🔴 la guarda no necesita el catálogo, y ya no lo espera');
  });

  it('🔴 rechazo por CALIDAD ⇒ 0 consultas al catálogo', async () => {
    const { deps, catalogLog } = harness();

    const out = await resolveLushaCandidatesDuplicateState(
      deps,
      INPUT,
      [INTERMEDIARIO],
      CRITERIA,
      null,
    );

    assert.equal(out.qualityRejected.length, 1);
    assert.deepEqual(catalogLog, []);
    assert.equal(out.resolved.length, 0, 'no se persiste');
  });

  it('una empresa ADMITIDA sí llega al catálogo, una sola vez', async () => {
    const { deps, catalogLog } = harness();

    const out = await resolveLushaCandidatesDuplicateState(
      deps,
      INPUT,
      [RETAIL_OK],
      CRITERIA,
      PRECISION_RETAIL,
    );

    assert.equal(out.resolved.length, 1);
    assert.equal(catalogLog.length, 1, '🔴 UNA consulta: no hay segunda etapa');
    assert.equal(catalogLog[0], 'Supermercados Vaquita');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § B — LA DEDUPE FISCAL CONSERVA SU INSUMO
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.14 § B · la consulta de identidad sigue alimentando la dedupe', () => {
  it('🔴 duplicado descubierto por NIT: se consulta identidad y NO se persiste', async () => {
    const { deps, catalogLog, duplicateLog } = harness({
      strongIdentityFor: 'Supermercados Vaquita',
    });

    const out = await resolveLushaCandidatesDuplicateState(
      deps,
      INPUT,
      [RETAIL_OK],
      CRITERIA,
      PRECISION_RETAIL,
    );

    assert.equal(catalogLog.length, 1, 'la consulta de identidad está PERMITIDA aquí');
    assert.equal(
      duplicateLog[0],
      'Supermercados Vaquita|nit=900123456',
      '🔴 el NIT llegó al chequeo de duplicados: la dedupe fiscal sigue viva',
    );
    assert.equal(out.resolved[0]!.resolution.dbDuplicateStatus, 'exact_duplicate');

    // Y el duplicado exacto no produce candidata: lo decide la capa de arriba,
    // que ya lo hacía, y aquí se comprueba que la resolución lo declara.
    const rows = buildLushaPendingReviewCandidateRows('batch-1', out.resolved);
    assert.equal(rows[0]!.duplicate_status, 'exact_duplicate');
  });

  it('🔴 catálogo SIN coincidencia: no inventa NIT ni razón social', async () => {
    const { deps } = harness({ strongIdentityFor: null });

    const out = await resolveLushaCandidatesDuplicateState(
      deps,
      INPUT,
      [RETAIL_OK],
      CRITERIA,
      PRECISION_RETAIL,
    );

    const [row] = buildLushaPendingReviewCandidateRows('batch-1', out.resolved);
    assert.equal(row!.tax_identifier, null, '🔴 sin NIT inventado');
    assert.equal(row!.legal_name, null, '🔴 sin razón social inventada');
    assert.equal(out.enrichment.notFoundCount, 1, 'y el desenlace queda contado como lo que fue');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § C — CALIDAD: EVALUADA, NO DECLARADA
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.14 § C · `quality_gate` se sustenta, y sólo donde hay respaldo', () => {
  it('🔴 una empresa válida de RETAIL o CONSUMO no se rechaza por no ser B2B tech', () => {
    for (const target of [RETAIL_OK, CONSUMO_OK]) {
      const quality = evaluateLushaQualityGate({ name: target.name, domain: target.domain });
      assert.equal(quality.verdict, 'pass', `${target.name} es legítima y pasa`);
      assert.equal(quality.blockingCheck, null);
    }
  });

  it('🔴 tampoco una distribuidora: el nivel `low` del ICP no decide aquí', () => {
    const distribuidora = company('dist', 'Distribuidora La Rebaja', 'larebaja.com.co');
    const quality = evaluateLushaQualityGate({
      name: distribuidora.name,
      domain: distribuidora.domain,
    });
    assert.equal(quality.verdict, 'pass');
  });

  it('🔴 ni una AGENCIA, ni un CALL CENTER, ni una empresa de COBRANZA', () => {
    // El nivel `reject` de `business_fit` las excluiría. Son SECTORES, y una
    // empresa de esos sectores es prospecta legítima cuando la macro los pide:
    // ninguna regla de producto autoriza excluirlas universalmente.
    const sectoriales = [
      company('ag', 'Agencia de Marketing Digital Bogota', 'agenciabogota.com'),
      company('cc', 'Call Center del Caribe', 'callcentercaribe.com.co'),
      company('cob', 'Cobranza Nacional', 'cobranzanacional.com.co'),
      company('st', 'Staffing Colombia', 'staffingcolombia.com.co'),
    ];
    for (const target of sectoriales) {
      const quality = evaluateLushaQualityGate({ name: target.name, domain: target.domain });
      assert.equal(
        quality.verdict,
        'pass',
        `🔴 ${target.name} pertenece a un sector, no es una página: no se rechaza`,
      );
      const fit = quality.checks.find((c) => c.check === 'business_fit_gate');
      assert.equal(fit?.state, 'observed', 'su nivel se MIDE');
      assert.equal(fit?.decides, false, '🔴 y no decide');
    }
  });

  it('🔴 la plataforma externa se OBSERVA: su dominio propio no la descalifica', () => {
    const quality = evaluateLushaQualityGate({
      name: PLATAFORMA.name,
      domain: PLATAFORMA.domain,
    });
    assert.equal(quality.verdict, 'pass', '🔴 MercadoLibre es una empresa real');
    const check = quality.checks.find((c) => c.check === 'external_platform_gate');
    assert.equal(check?.state, 'observed');
    assert.equal(check?.decides, false);
  });

  it('🔴 y cuando la lista SÍ coincide, se registra el motivo y sigue sin decidir', () => {
    // `capterra.co` está en la lista compartida. En Apollo eso sería la URL
    // donde se encontró al candidato; aquí es el dominio propio de una empresa
    // que existe, así que la coincidencia se anota y no rechaza.
    const quality = evaluateLushaQualityGate({
      name: 'Capterra Colombia',
      domain: 'capterra.co',
    });
    const check = quality.checks.find((c) => c.check === 'external_platform_gate');
    assert.equal(check?.state, 'observed');
    assert.equal(check?.decides, false);
    assert.match(check?.detail ?? '', /judges_source_url_in_apollo_but_own_domain_here/);
    assert.equal(quality.verdict, 'pass', '🔴 no se descarta: no hay regla que lo autorice');
  });

  it('🔴 intermediario de contenido SÍ decide: no es una empresa, es una página', () => {
    const quality = evaluateLushaQualityGate({
      name: INTERMEDIARIO.name,
      domain: INTERMEDIARIO.domain,
    });
    assert.equal(quality.verdict, 'fail');
    assert.equal(quality.blockingCheck, 'content_intermediary_gate');
    const check = quality.checks.find((c) => c.check === 'content_intermediary_gate');
    assert.equal(check?.decides, true);
  });

  it('un nombre que es un TITULAR de artículo tampoco es una empresa', () => {
    // El patrón lo define `isContentPageName`, compartido con el writer de
    // Apollo: no se inventa ninguno nuevo para esta ruta.
    const quality = evaluateLushaQualityGate({
      name: 'Casos de éxito Línea Datascan',
      domain: 'datascan.com.co',
    });
    assert.equal(quality.verdict, 'fail');
    assert.equal(
      quality.blockingCheck,
      'content_page_name_gate',
      'lo rechaza un check de IDENTIDAD, no uno de perfil comercial',
    );
  });

  it('un nombre que es sólo «Directorio» tampoco lo es', () => {
    const quality = evaluateLushaQualityGate({
      name: 'Directorio Empresarial',
      domain: 'directorioempresarial.co',
    });
    assert.equal(quality.verdict, 'fail');
    assert.equal(quality.blockingCheck, 'content_intermediary_gate');
  });

  it('🔴 REGISTRO ESTRUCTURADO: qué acredita y qué queda sin acreditar', () => {
    // Empresa legítima, con nombre y dominio, SIN `source_title` ni
    // `source_snippet` — que es exactamente lo que Lusha entrega.
    const quality = evaluateLushaQualityGate({
      name: RETAIL_OK.name,
      domain: RETAIL_OK.domain,
    });

    const byCheck = new Map(quality.checks.map((c) => [c.check, c]));

    // ── SUPERA (con respaldo, y decide) ──
    assert.equal(byCheck.get('content_intermediary_gate')?.state, 'passed');
    assert.equal(byCheck.get('content_page_name_gate')?.state, 'passed');
    assert.equal(quality.verdict, 'pass');

    // ── QUEDA SIN ACREDITAR: no aplica ──
    const noAplica = byCheck.get('source_url_quality_gate');
    assert.equal(noAplica?.state, 'not_applicable');
    assert.equal(noAplica?.decides, false, '🔴 no rechaza por su sola ausencia');

    // ── QUEDA SIN ACREDITAR: se observa, no hay regla que lo autorice ──
    for (const check of ['external_platform_gate', 'business_fit_gate'] as const) {
      assert.equal(byCheck.get(check)?.state, 'observed');
      assert.equal(byCheck.get(check)?.decides, false);
    }

    // ── RESPONDIÓ CON MENOS EVIDENCIA (y lo dice) ──
    assert.deepEqual(byCheck.get('content_intermediary_gate')?.evidenceGaps, [
      'source_snippet',
      'source_title',
    ]);
    assert.deepEqual(
      byCheck.get('content_page_name_gate')?.evidenceGaps,
      [],
      'este no usa snippet: no le falta nada',
    );
  });

  it('🔴 «no aplica», «se observa» y «evidencia ausente» son TRES cosas', () => {
    const conNombre = evaluateLushaQualityGate({
      name: RETAIL_OK.name,
      domain: RETAIL_OK.domain,
    });
    assert.equal(
      conNombre.checks.find((c) => c.check === 'source_url_quality_gate')?.state,
      'not_applicable',
    );
    assert.equal(
      conNombre.checks.find((c) => c.check === 'business_fit_gate')?.state,
      'observed',
    );

    // Sin nombre usable la pregunta de identidad aplica y no se puede responder.
    const sinNombre = evaluateLushaQualityGate({ name: null, domain: 'algo.com.co' });
    assert.equal(
      sinNombre.checks.find((c) => c.check === 'content_intermediary_gate')?.state,
      'insufficient_evidence',
    );
    assert.equal(
      sinNombre.verdict,
      'unknown',
      '🔴 ni aprobación ni contradicción: no se pudo responder',
    );
    assert.equal(sinNombre.blockingCheck, null, 'y por tanto NO hay rechazo');
  });

  it('🔴 `unknown` no cuenta hacia el mínimo, y tampoco acusa', () => {
    const survivor = {
      employeeCount: 700,
      duplicateStatus: 'no_match',
      ownershipGate: 'pass' as const,
      linkedinUrl: LINKEDIN_OK,
      macroIndustryConfirmed: true,
      qualityGate: 'unknown' as const,
    };
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor, { requestedSubindustries: [] }),
      'unknown',
      '🔴 el contrato la deja en UNKNOWN: condición no disponible, no fallida',
    );
  });

  it('🔴 sin evaluar NO es aprobado: una candidata sin veredicto sale `fail`', () => {
    const sinEvaluar = toLushaSurvivorCompletenessInput({
      company: RETAIL_OK,
      resolution: { dbDuplicateStatus: 'no_match' },
      macroPrecision: { verdict: 'confirmed' },
      ownership: evaluateLushaOwnershipEvidence({
        name: RETAIL_OK.name,
        domain: RETAIL_OK.domain,
        linkedinUrl: RETAIL_OK.linkedinUrl,
      }),
    } as unknown as ResolvedLushaCandidate);

    assert.equal(sinEvaluar.qualityGate, 'fail', '🔴 fail-closed: la evaluación FALTA');
    assert.equal(
      evaluateLushaSurvivorCompleteness(sinEvaluar, { requestedSubindustries: [] }),
      'incomplete',
      'y eso es INCOMPLETE, distinto del UNKNOWN de arriba',
    );
  });

  it('`parityComplete: false` es documentación: no decide el veredicto', () => {
    const quality = evaluateLushaQualityGate({
      name: RETAIL_OK.name,
      domain: RETAIL_OK.domain,
    });
    assert.equal(quality.parityComplete, false);
    assert.equal(quality.verdict, 'pass', '🔴 la falta de paridad no vuelve fallida a nadie');
    const meta = toLushaQualityGateMetadata(quality);
    assert.equal(meta.parity_with_apollo_quality_gate_complete, false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § D — TRAZABILIDAD DURABLE
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.14 § D · cada exclusión conserva su motivo durable', () => {
  it('el rechazo por calidad tiene disposición EXISTENTE y motivo legible', () => {
    const resolution = resolveLushaDiscardDisposition({
      kind: 'quality_gate_rejected',
      qualityCheck: 'content_intermediary_gate',
      qualityReason: 'blog_content_site',
    });
    assert.equal(resolution?.disposition, 'final_validation_rejected');
    assert.equal(resolution?.reasonCode, 'content_intermediary_gate');
  });

  it('🔴 el rechazo por precisión NO cambió de disposición al subir de sitio', () => {
    const resolution = resolveLushaDiscardDisposition({
      kind: 'macro_precision_rejected',
      precisionReason: 'sub_industry_branch_parent_only',
    });
    assert.equal(resolution?.disposition, 'sector_rejected');
    assert.equal(resolution?.reasonCode, 'sub_industry_branch_parent_only');
  });

  it('la guarda de activas sigue siendo `sellup_duplicate`', () => {
    const resolution = resolveLushaDiscardDisposition({ kind: 'active_candidate_guard' });
    assert.equal(resolution?.disposition, 'sellup_duplicate');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § E — LO QUE X6.12/X6.13 GANARON SIGUE EN PIE
// ═════════════════════════════════════════════════════════════════════════════

describe('X6.14 § E · ownership y conteo, intactos', () => {
  /** El caso real: dueña legítima que el heurístico textual no acredita. */
  const D1 = company('d1', 'D1 S.A.S', 'tiendasd1.com');

  it('🔴 ownership insuficiente: marca visible, entra a revisión, NO suma', async () => {
    const { deps } = harness();

    const out = await resolveLushaCandidatesDuplicateState(deps, INPUT, [D1], CRITERIA, null);

    assert.equal(out.resolved.length, 1, 'no se descarta');
    const [row] = buildLushaPendingReviewCandidateRows('batch-1', out.resolved);
    assert.equal(row!.status, 'needs_review', 'llega a revisión');
    assert.ok(hasOwnershipUnverifiedFlag(row!.review_flags), '🔴 con la marca visible');

    const survivor = toLushaSurvivorCompletenessInput({
      ...out.resolved[0]!,
      macroPrecision: { verdict: 'confirmed' },
    } as ResolvedLushaCandidate);
    assert.equal(survivor.ownershipGate, 'fail');
    assert.equal(survivor.qualityGate, 'pass', 'la calidad sí la pasó: son preguntas distintas');
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor, { requestedSubindustries: [] }),
      'incomplete',
      '🔴 excepción de revisión por evidencia insuficiente: no aporta al mínimo',
    );
  });

  it('🔴 una candidata COMPLETA cuenta UNA sola vez', async () => {
    const { deps } = harness();

    const out = await resolveLushaCandidatesDuplicateState(
      deps,
      INPUT,
      [CONSUMO_OK],
      CRITERIA,
      null,
    );

    const survivor = toLushaSurvivorCompletenessInput({
      ...out.resolved[0]!,
      macroPrecision: { verdict: 'confirmed' },
    } as ResolvedLushaCandidate);

    const truth = resolveLushaRunAcceptanceTruth([survivor], { requestedSubindustries: [] });
    assert.equal(truth.survivors, 1);
    assert.equal(truth.complete, 1);
    assert.equal(truth.acceptedForTarget, 1, '🔴 una empresa, una aceptación');
  });

  it('🔴 el objetivo NO recorta: 8 admitidas producen 8 filas', async () => {
    const { deps } = harness();
    const ocho = Array.from({ length: 8 }, (_, i) =>
      company(`c${i}`, `Comercial Numero ${i}`, `comercial${i}.com.co`),
    );

    const out = await resolveLushaCandidatesDuplicateState(deps, INPUT, ocho, CRITERIA, null);

    assert.equal(out.resolved.length, 8, 'X6.13 sigue en pie: el objetivo no es un techo');
    assert.equal(buildLushaPendingReviewCandidateRows('batch-1', out.resolved).length, 8);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § F — EL CASO DE APOLLO, DOCUMENTADO Y **SIN CAMBIAR**
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 🔴 Estas pruebas NO modifican Apollo. Fijan el comportamiento ACTUAL de
 * `isBlockedByBusinessFit` para que el caso concreto quede medido en CI y la
 * decisión de producto se tome sobre evidencia, no sobre una impresión.
 *
 * Apollo bloquea con `{reject, low}` y aplica el gate en TODAS las macro. El
 * nivel `low` sale de «sin señales B2B tech + una señal de bajo fit», y esas
 * señales —`distribuidora de`, `distribución de productos`, `logística de
 * distribución`, `consultora`— describen a la empresa OBJETIVO en retail,
 * consumo, logística y servicios profesionales.
 */
describe('X6.14 § F · Apollo aplica el ICP B2B tech fuera de contexto (documentado)', () => {
  const casos = [
    {
      macro: 'retail',
      name: 'Distribuidora La Rebaja',
      domain: 'larebaja.com.co',
      snippet: 'Distribuidora de productos de consumo masivo en Colombia.',
    },
    {
      macro: 'consumer_goods',
      name: 'Alimentos del Valle',
      domain: 'alimentosdelvalle.com.co',
      snippet: 'Distribución de productos alimenticios a supermercados.',
    },
    {
      macro: 'logistics',
      name: 'Transportes Andinos',
      domain: 'transportesandinos.com.co',
      snippet: 'Transporte de mercancías y logística de distribución nacional.',
    },
  ];

  for (const caso of casos) {
    it(`🔴 [${caso.macro}] «${caso.name}» sale \`low\` y Apollo la bloquearía`, () => {
      const fit = evaluateBusinessFit({
        name: caso.name,
        website: `https://${caso.domain}`,
        domain: caso.domain,
        sourceSnippet: caso.snippet,
        sourceTitle: null,
        subindustries: [],
        additionalCriteria: null,
      });

      assert.equal(fit.fit, 'low', 'el nivel es `low`, no `reject`');
      assert.equal(
        isBlockedByBusinessFit(fit),
        true,
        '🔴 y con el criterio de Apollo eso BLOQUEA a una empresa legítima del sector pedido',
      );

      // La misma empresa, por la ruta Lusha: NO bloquea.
      const quality = evaluateLushaQualityGate({ name: caso.name, domain: caso.domain });
      assert.equal(quality.verdict, 'pass');
      assert.equal(quality.businessFitLevel, 'medium', 'sin snippet, la señal ni siquiera existe');
    });
  }

  it('🔴 el nivel `reject` TAMPOCO es universal: las dos rutas DIVERGEN, a propósito', () => {
    const agencia = {
      name: 'Agencia de Marketing Digital Bogota',
      domain: 'agenciabogota.com',
    };
    const fit = evaluateBusinessFit({
      name: agencia.name,
      website: `https://${agencia.domain}`,
      domain: agencia.domain,
      sourceSnippet: null,
      sourceTitle: null,
      subindustries: [],
      additionalCriteria: null,
    });
    assert.equal(fit.fit, 'reject');
    assert.equal(isBlockedByBusinessFit(fit), true, 'Apollo la bloquea HOY');

    // 🔴 Lusha NO la bloquea, y es deliberado: «agencia de marketing» es un
    // SECTOR. Con una macro que lo incluya es una prospecta legítima, y ninguna
    // regla de producto autoriza excluirla en todas las macro. La divergencia
    // queda medida aquí hasta que producto decida.
    const quality = evaluateLushaQualityGate(agencia);
    assert.equal(quality.verdict, 'pass');
    const check = quality.checks.find((c) => c.check === 'business_fit_gate');
    assert.equal(check?.state, 'observed');
    assert.match(check?.detail ?? '', /fixed_b2b_tech_icp_not_the_requested_criteria:reject/);
  });
});
