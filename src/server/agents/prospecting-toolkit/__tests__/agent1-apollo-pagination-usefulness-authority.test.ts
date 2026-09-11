/**
 * AGENT1-APOLLO-PAGINATION-USEFULNESS-AUTHORITY-1
 *
 * EL DEFECTO QUE CIERRA ESTA SUITE
 * ─────────────────────────────────
 * La paginación real de Apollo dentro de UNA invocación se activa cuando el
 * provider recibe `netNewTarget` + `evaluateCandidateAcceptance` (los DOS). El
 * motor (`apollo-organizations-paginated-search.ts`) llama al evaluador una vez
 * por organización nueva y acumula `acceptedForTargetCount`; cuando ese contador
 * alcanza `netNewTarget`, deja de comprar páginas
 * (`stopReason: 'candidate_target_reached'`).
 *
 * Hasta este corte los DOS cableados vivos —`apollo-two-round/
 * production-runner.server.ts` e `incremental-search.ts`— alimentaban ese
 * contador con NOVEDAD HISTÓRICA a secas, y además abrían con:
 *
 *     if (normalizedDomain === null) return true;
 *
 * Consecuencia: una organización SIN dominio —y una con dominio que después
 * moriría por ownership, país o identidad— consumía el objetivo de paginación.
 * Apollo dejaba de comprar páginas aunque el rendimiento ÚTIL fuera 0. Es la
 * explicación directa del «Apollo = 0 útiles» observado: cinco novedades
 * inservibles cerraban la paginación en la página 1.
 *
 * Lo que esta suite fija:
 *   1. 5 organizaciones NOVEDOSAS pero 0 ÚTILES ⇒ la paginación CONTINÚA.
 *   2. 5 organizaciones ÚTILES ⇒ la paginación SE DETIENE
 *      (`candidate_target_reached`).
 *   3. Una organización SIN dominio NO consume el objetivo…
 *   4. …y NO se la descarta del pipeline: las filas ya pagadas siguen llegando
 *      completas al llamador (esto NO es un filtro de resultados).
 *   5. `raw_result_cap_reached` no vuelve al vocabulario vivo.
 *   6. La ronda 2 sigue decidiendo su hueco con `projectedTargetGap`.
 *   7. Guarda estática: UNA sola autoridad, usada por los dos cableados, y
 *      «contar novedad en vez de utilidad» deja de ser expresable.
 *
 * Offline y determinista: transporte, reloj, jitter y lectura histórica
 * INYECTADOS. 0 llamadas reales a Apollo, 0 Supabase, 0 créditos, 0 escrituras.
 *
 * 🔴 Inyección de dependencias a propósito, nunca `mock.module`
 * (`{ namedExports }` funciona en Node 20 y NO en Node 24: el módulo real sale a
 * la red y la suite cae con `fetch failed`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  runApolloOrganizationsPaginatedSearch,
  type ApolloPageFetchResult,
} from '../apollo-organizations-paginated-search';
import { createApolloPaginationBudget } from '../apollo-organizations-pagination-budget';
import type { NormalizedApolloOrganization } from '../apollo-organizations-response-normalizer';
import {
  createApolloPaginationAcceptanceEvaluator,
  evaluateApolloPaginationUsefulness,
  type ApolloPaginationHistoricalRowsLoader,
} from '../apollo-pagination-usefulness-authority';

// ─── Harness ──────────────────────────────────────────────────────────────────

const TOOLKIT_DIR = join(process.cwd(), 'src/server/agents/prospecting-toolkit');

function readSource(relativePath: string): string {
  return readFileSync(join(TOOLKIT_DIR, relativePath), 'utf8');
}

/** Quita comentarios: una guarda estática no puede confundir NOMBRAR con CITAR. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

type OrgSeed = {
  id: string;
  name: string | null;
  primary_domain: string | null;
  website_url?: string | null;
};

function pagePayload(page: number, orgs: readonly OrgSeed[]): ApolloPageFetchResult {
  return {
    ok: true,
    status: 200,
    requestSent: true,
    malformedBody: false,
    timedOut: false,
    payload: {
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        primary_domain: o.primary_domain,
        website_url: o.website_url ?? (o.primary_domain ? `https://${o.primary_domain}` : null),
      })),
      pagination: { page, per_page: 100, total_entries: 5_000, total_pages: 500 },
    },
    headers: null,
  };
}

function harness(pages: readonly ApolloPageFetchResult[]) {
  let clock = 0;
  let call = 0;
  return {
    get pagesFetched(): number {
      return call;
    },
    fetchPage: async (): Promise<ApolloPageFetchResult> => {
      clock += 10;
      return pages[Math.min(call++, pages.length - 1)]!;
    },
    now: () => clock,
    random: () => 0.5,
    sleep: async () => {},
  };
}

const baseInput = {
  filters: { locations: ['Colombia'], keywordTags: ['lms'] },
  wizardRunId: 'run_pagination_usefulness_authority',
  agentRunId: null,
};

/** Lector histórico que nunca conoce a nadie: toda organización es net-new. */
const neverKnown: ApolloPaginationHistoricalRowsLoader = async () => ({
  rows: [],
  degraded: false,
});

function organization(seed: Partial<NormalizedApolloOrganization>): NormalizedApolloOrganization {
  return {
    providerReference: {
      provider: 'apollo_organizations',
      providerOrganizationId: 'org_sintetico',
    },
    name: 'Empresa Sintetica SAS',
    primaryDomain: 'empresa-sintetica.com.co',
    normalizedDomains: ['empresa-sintetica.com.co'],
    websiteUrl: 'https://empresa-sintetica.com.co',
    linkedinUrl: null,
    phone: null,
    foundedYear: null,
    country: 'Colombia',
    city: null,
    industry: null,
    industries: [],
    keywords: [],
    organizationKeywords: [],
    estimatedNumEmployees: null,
    shortDescription: null,
    seoDescription: null,
    description: null,
    technologies: [],
    filledFromAccountFields: [],
    ...seed,
  } as NormalizedApolloOrganization;
}

// ═══ 1 — cinco NOVEDADES sin utilidad NO cierran la paginación ════════════════

describe('§1 — novedad sin utilidad no consume el objetivo de paginación', () => {
  it('5 organizaciones novedosas pero 0 útiles (ownership ajeno) ⇒ la paginación CONTINÚA', async () => {
    // Cinco organizaciones cuyo nombre no tiene NADA que ver con su dominio:
    // `evaluateCompanyOwnership` las rechaza (`reject`), así que el writer nunca
    // las contaría hacia el objetivo. Antes del corte contaban igual, porque
    // eran "net-new".
    const page1 = pagePayload(1, [
      { id: 'o1', name: 'Alfa Manufactura Andina SAS', primary_domain: 'zeta-holdings-xyz.com' },
      { id: 'o2', name: 'Beta Logistica Nacional SAS', primary_domain: 'omega-ventures-qq.com' },
      { id: 'o3', name: 'Gamma Servicios Integrales SAS', primary_domain: 'kappa-group-ww.com' },
      { id: 'o4', name: 'Delta Consultoria Empresarial SAS', primary_domain: 'lambda-partners-rr.com' },
      { id: 'o5', name: 'Epsilon Distribuciones SAS', primary_domain: 'sigma-capital-tt.com' },
    ]);
    const page2 = pagePayload(2, [
      { id: 'o6', name: 'Empresa Util Uno SAS', primary_domain: 'empresautiluno.com.co' },
    ]);
    const h = harness([page1, page2]);

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget(), netNewTarget: 5 },
      {
        ...h,
        evaluateAcceptance: createApolloPaginationAcceptanceEvaluator({
          targetCountryCode: 'CO',
          loadHistoricalRowsForDomain: neverKnown,
        }),
      },
    );

    // Las CINCO de la página 1 son novedad histórica pura y ninguna consume el
    // objetivo (ownership ajeno). El único punto que se apunta es el de la
    // página 2 —la empresa que de verdad puede ser útil—, que es precisamente la
    // que el defecto impedía llegar a comprar.
    assert.equal(
      result.acceptedForTargetCount,
      1,
      'sólo la organización de la página 2 es útil; las cinco novedades inservibles no cuentan',
    );
    assert.notEqual(
      result.stopReason,
      'candidate_target_reached',
      'la paginación NO puede declarar objetivo alcanzado con 0 organizaciones útiles',
    );
    assert.ok(
      result.pagesProcessed > 1,
      `la paginación debía seguir comprando páginas; compró ${result.pagesProcessed}`,
    );
  });

  it('el gate de PAÍS bloquea por sí solo: TLD extranjero con ownership impecable no consume objetivo', () => {
    // Las tres pasan identidad canónica, dominio de directorio, página de
    // contenido Y ownership (el nombre coincide con su dominio). Lo ÚNICO que
    // las bloquea es el país: sin ese gate volverían a consumir el objetivo.
    for (const [name, domain] of [
      ['Nortena Digital', 'nortenadigital.com.mx'],
      ['Austral Sistemas', 'australsistemas.com.cl'],
      ['Pampa Software', 'pampasoftware.com.ar'],
    ] as const) {
      const verdict = evaluateApolloPaginationUsefulness({
        organization: organization({
          name,
          primaryDomain: domain,
          normalizedDomains: [domain],
          websiteUrl: `https://${domain}`,
        }),
        targetCountryCode: 'CO',
      });
      assert.equal(
        verdict.consumesPaginationTarget,
        false,
        `${domain} es incompatible con CO y no puede consumir el objetivo`,
      );
      assert.equal(verdict.reason, 'country_incompatible');
    }
  });

  it('cinco TLD extranjeros novedosos NO cierran la paginación', async () => {
    const page1 = pagePayload(1, [
      { id: 'x1', name: 'Nortena Digital', primary_domain: 'nortenadigital.com.mx' },
      { id: 'x2', name: 'Austral Sistemas', primary_domain: 'australsistemas.com.cl' },
      { id: 'x3', name: 'Pampa Software', primary_domain: 'pampasoftware.com.ar' },
      { id: 'x4', name: 'Andina Peru Data', primary_domain: 'andinaperudata.com.pe' },
      { id: 'x5', name: 'Oriental Brasil Tech', primary_domain: 'orientalbrasiltech.com.br' },
    ]);
    const h = harness([page1, pagePayload(2, [])]);

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget(), netNewTarget: 5 },
      {
        ...h,
        evaluateAcceptance: createApolloPaginationAcceptanceEvaluator({
          targetCountryCode: 'CO',
          loadHistoricalRowsForDomain: neverKnown,
        }),
      },
    );

    assert.equal(
      result.acceptedForTargetCount,
      0,
      'ninguna empresa de otro país puede consumir el objetivo de una corrida CO',
    );
    assert.notEqual(result.stopReason, 'candidate_target_reached');
  });

  it('sin código de país declarado nadie consume el objetivo (lectura conservadora del writer)', () => {
    const verdict = evaluateApolloPaginationUsefulness({
      organization: organization({}),
      targetCountryCode: null,
    });
    assert.equal(verdict.consumesPaginationTarget, false);
    assert.equal(verdict.reason, 'country_code_absent');
  });
});

// ═══ 2 — cinco ÚTILES sí cierran la paginación ═══════════════════════════════

describe('§2 — cinco organizaciones útiles detienen la paginación', () => {
  it('5 útiles en la página 1 ⇒ stopReason candidate_target_reached, 1 sola página', async () => {
    const page1 = pagePayload(1, [
      { id: 'u1', name: 'Aurora Tech', primary_domain: 'auroratech.com.co' },
      { id: 'u2', name: 'Boreal Systems', primary_domain: 'borealsystems.com.co' },
      { id: 'u3', name: 'Cumbre Digital', primary_domain: 'cumbredigital.com.co' },
      { id: 'u4', name: 'Delta Nube', primary_domain: 'deltanube.com.co' },
      { id: 'u5', name: 'Estelar Data', primary_domain: 'estelardata.com.co' },
    ]);
    const h = harness([page1, pagePayload(2, [])]);

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget(), netNewTarget: 5 },
      {
        ...h,
        evaluateAcceptance: createApolloPaginationAcceptanceEvaluator({
          targetCountryCode: 'CO',
          loadHistoricalRowsForDomain: neverKnown,
        }),
      },
    );

    assert.equal(result.acceptedForTargetCount, 5, 'las cinco son útiles y deben contar');
    assert.equal(result.stopReason, 'candidate_target_reached');
    assert.equal(result.pagesProcessed, 1, 'no debe comprar una página que ya no necesita');
  });

  it('el duplicado histórico sigue sin contar: la autoridad conserva el eje que ya existía', async () => {
    const page1 = pagePayload(1, [
      { id: 'd1', name: 'Aurora Tech', primary_domain: 'auroratech.com.co' },
      { id: 'd2', name: 'Boreal Systems', primary_domain: 'borealsystems.com.co' },
    ]);
    const h = harness([page1, pagePayload(2, [])]);

    // `auroratech.com.co` ya vive en el histórico ⇒ no es novedad ⇒ no cuenta.
    const loadHistoricalRowsForDomain: ApolloPaginationHistoricalRowsLoader = async (domain) => ({
      rows:
        domain === 'auroratech.com.co'
          ? [
              {
                id: 'hist_1',
                batch_id: 'batch_hist_1',
                name: 'Aurora Tech',
                domain: 'auroratech.com.co',
                // Ocupa el lote y es una entrega productiva real: exactamente
                // la evidencia que `evaluatePrepaidHistoricalDuplicate` exige
                // para un bloqueo DURO pre-pago.
                status: 'approved',
                duplicate_status: null,
                country_code: 'CO',
                source_primary: 'apollo',
                review_notes: null,
                metadata: null,
              },
            ]
          : [],
      degraded: false,
    });

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget(), netNewTarget: 5 },
      {
        ...h,
        evaluateAcceptance: createApolloPaginationAcceptanceEvaluator({
          targetCountryCode: 'CO',
          loadHistoricalRowsForDomain,
        }),
      },
    );

    assert.equal(
      result.acceptedForTargetCount,
      1,
      'sólo la organización genuinamente nueva puede consumir el objetivo',
    );
  });
});

// ═══ 3 — sin dominio NO consume el objetivo ══════════════════════════════════

describe('§3 — una organización sin dominio no consume el objetivo', () => {
  it('la autoridad pura la marca `domain_absent` y NO consume objetivo', () => {
    const verdict = evaluateApolloPaginationUsefulness({
      organization: organization({
        primaryDomain: null,
        normalizedDomains: [],
        websiteUrl: null,
      }),
      targetCountryCode: 'CO',
    });
    assert.equal(verdict.consumesPaginationTarget, false);
    assert.equal(verdict.reason, 'domain_absent');
  });

  it('cinco organizaciones SIN dominio no alcanzan el objetivo y la paginación sigue', async () => {
    const page1 = pagePayload(1, [
      { id: 'n1', name: 'Sin Dominio Uno SAS', primary_domain: null, website_url: null },
      { id: 'n2', name: 'Sin Dominio Dos SAS', primary_domain: null, website_url: null },
      { id: 'n3', name: 'Sin Dominio Tres SAS', primary_domain: null, website_url: null },
      { id: 'n4', name: 'Sin Dominio Cuatro SAS', primary_domain: null, website_url: null },
      { id: 'n5', name: 'Sin Dominio Cinco SAS', primary_domain: null, website_url: null },
    ]);
    const h = harness([page1, pagePayload(2, [])]);

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget(), netNewTarget: 5 },
      {
        ...h,
        evaluateAcceptance: createApolloPaginationAcceptanceEvaluator({
          targetCountryCode: 'CO',
          loadHistoricalRowsForDomain: neverKnown,
        }),
      },
    );

    assert.equal(result.acceptedForTargetCount, 0);
    assert.notEqual(result.stopReason, 'candidate_target_reached');
  });

  it('sin dominio NO se lee el histórico: no hay eje fuerte que consultar', async () => {
    let reads = 0;
    const evaluate = createApolloPaginationAcceptanceEvaluator({
      targetCountryCode: 'CO',
      loadHistoricalRowsForDomain: async (domain) => {
        reads++;
        return neverKnown(domain);
      },
    });
    await evaluate(organization({ primaryDomain: null, normalizedDomains: [], websiteUrl: null }));
    assert.equal(reads, 0, 'no puede añadir lecturas por candidato que antes no existían');
  });
});

// ═══ 4 — NO es un filtro: las filas ya pagadas llegan completas ═══════════════

describe('§4 — la autoridad NO recorta las filas de una página ya pagada', () => {
  it('100 organizaciones inútiles siguen llegando completas al llamador', async () => {
    // Las 100 fallan ownership: ninguna consume el objetivo, y aun así las 100
    // tienen que llegar al pipeline. Esto decide COMPRAR, no DESCARTAR.
    const orgs: OrgSeed[] = Array.from({ length: 100 }, (_unused, i) => ({
      id: `raw_${i}`,
      name: `Razon Social Ajena Numero ${i} SAS`,
      primary_domain: `dominio-sin-relacion-${i}.com`,
    }));
    const h = harness([pagePayload(1, orgs), pagePayload(2, [])]);

    const result = await runApolloOrganizationsPaginatedSearch(
      { ...baseInput, budget: createApolloPaginationBudget(), netNewTarget: 5 },
      {
        ...h,
        evaluateAcceptance: createApolloPaginationAcceptanceEvaluator({
          targetCountryCode: 'CO',
          loadHistoricalRowsForDomain: neverKnown,
        }),
      },
    );

    assert.equal(
      result.organizations.length >= 100,
      true,
      `las 100 filas pagadas deben llegar completas; llegaron ${result.organizations.length}`,
    );
    assert.equal(result.acceptedForTargetCount, 0);
  });

  it('la autoridad no exporta ningún recorte de resultados (take/slice/limit)', () => {
    const live = stripComments(readSource('apollo-pagination-usefulness-authority.ts'));
    for (const forbidden of ['.slice(', '.splice(', 'maxCandidates', 'rawCap', 'raw_result_cap']) {
      assert.ok(
        !live.includes(forbidden),
        `la autoridad no puede recortar resultados; apareció \`${forbidden}\``,
      );
    }
  });
});

// ═══ 5 — `raw_result_cap_reached` no vuelve ══════════════════════════════════

describe('§5 — el tope crudo no se reintroduce', () => {
  it('`raw_result_cap_reached` sigue fuera del vocabulario vivo de paginación', () => {
    for (const file of [
      'apollo-pagination-usefulness-authority.ts',
      'apollo-organizations-pagination-budget.ts',
      'apollo-organizations-paginated-search.ts',
    ]) {
      assert.ok(
        !/raw_result_cap_reached/.test(stripComments(readSource(file))),
        `\`raw_result_cap_reached\` reapareció en ${file}`,
      );
    }
  });
});

// ═══ 6 — la ronda 2 conserva su autoridad ════════════════════════════════════

describe('§6 — la ronda 2 sigue decidiendo su hueco con projectedTargetGap', () => {
  it('el orquestador sigue resolviendo el hueco de R2 con `projectedTargetGap`', () => {
    const live = stripComments(readSource('apollo-two-round/orchestrator.ts'));
    assert.ok(
      /roundNumber === 1 \? targetEligibleCompanies : await projectedTargetGap\(\)/.test(live),
      'este corte no puede haber movido la autoridad del segundo round',
    );
  });
});

// ═══ 7 — UNA sola autoridad ══════════════════════════════════════════════════

describe('§7 — una sola autoridad de utilidad de paginación', () => {
  const RUNNER = 'apollo-two-round/production-runner.server.ts';
  const INCREMENTAL = 'incremental-search.ts';

  it('los DOS cableados vivos construyen el evaluador con la autoridad compartida', () => {
    for (const file of [RUNNER, INCREMENTAL]) {
      const live = stripComments(readSource(file));
      assert.ok(
        live.includes('createApolloPaginationAcceptanceEvaluator'),
        `${file} debe construir su evaluador con la autoridad compartida`,
      );
    }
  });

  it('ningún cableado puede volver a contar NOVEDAD en vez de UTILIDAD', () => {
    for (const file of [RUNNER, INCREMENTAL]) {
      const live = stripComments(readSource(file));
      assert.ok(
        !/return\s+!verdict\.alreadyKnown/.test(live),
        `${file} volvió a decidir la aceptación de paginación con novedad histórica a secas`,
      );
      assert.ok(
        !/normalizedDomain === null\)?\s*return true/.test(live),
        `${file} volvió a consumir el objetivo con una organización sin dominio`,
      );
    }
  });

  it('la autoridad es el único módulo que construye el evaluador de aceptación', () => {
    // Si mañana aparece un segundo constructor, este corte pierde su punto:
    // que exista UN solo sitio donde se decide qué consume el objetivo.
    const authority = readSource('apollo-pagination-usefulness-authority.ts');
    assert.ok(
      /export function createApolloPaginationAcceptanceEvaluator/.test(authority),
      'la autoridad debe exportar el constructor del evaluador',
    );
    assert.ok(
      /export function evaluateApolloPaginationUsefulness/.test(authority),
      'la autoridad debe exportar la decisión pura, auditable por sí sola',
    );
  });

  it('el ownership gate real participa en la decisión (no una reimplementación)', () => {
    const live = stripComments(readSource('apollo-pagination-usefulness-authority.ts'));
    assert.ok(live.includes('isBlockedByCompanyOwnership'), 'debe usar el gate real de ownership');
    assert.ok(live.includes('evaluateCountryCompatibility'), 'debe usar el gate real de país');
  });
});

// ═══ 8 — clasificación de gates: lo que NO entra ═════════════════════════════

describe('§8 — los gates que no son evaluables aquí quedan fuera, explícitamente', () => {
  it('el tamaño ICP NO entra: Apollo no devuelve empleados en organizations search', () => {
    const live = stripComments(readSource('apollo-pagination-usefulness-authority.ts'));
    assert.ok(
      !live.includes('evaluateIcpSizeGate'),
      'no se puede afirmar un incumplimiento de tamaño con un dato que la búsqueda no trae',
    );
    assert.ok(
      !live.includes('estimatedNumEmployees'),
      'el corte decidió fail-open sobre tamaño: no se lee el campo para juzgar',
    );
  });

  it('los gates que dependen de snippet/título del candidato NO entran', () => {
    const live = stripComments(readSource('apollo-pagination-usefulness-authority.ts'));
    for (const posterior of ['sourceSnippet', 'sourceTitle', 'evaluateBusinessFit', 'duplicateCheck']) {
      assert.ok(
        !live.includes(posterior),
        `\`${posterior}\` sólo existe después de construir el candidato; no puede decidir una compra de página`,
      );
    }
  });

  it('la autoridad no hace I/O propio: recibe el lector histórico inyectado', () => {
    const live = stripComments(readSource('apollo-pagination-usefulness-authority.ts'));
    for (const io of ['createClient', 'supabase', 'fetch(', 'buildNoveltyIndex']) {
      assert.ok(!live.includes(io), `la autoridad no puede abrir I/O propio; apareció \`${io}\``);
    }
  });
});
