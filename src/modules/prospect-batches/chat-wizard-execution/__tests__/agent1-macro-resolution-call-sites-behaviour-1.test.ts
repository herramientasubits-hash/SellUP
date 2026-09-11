/**
 * ══ AGENT1-MACRO-RESOLUTION-SINGLE-AUTHORITY-1 · COBERTURA DE CALL-SITES ═════
 *
 * ── El hueco que cierra esta suite ──────────────────────────────────────────
 *
 * El corte unificó la resolución macro en `resolveMacroIndustryIdentity`, y la
 * suite del catálogo lo defendía con DOS trinquetes estáticos sobre
 * `wizard-execution-actions.ts`:
 *
 *   1. que el fichero ya NO llame a `getMacroIndustryBySlug` ni a
 *      `resolveMacroIndustryByDisplayName`;
 *   2. que SÍ llame a la autoridad.
 *
 * Los dos defienden el NOMBRE de la llamada. Ninguno defiende su ARGUMENTO. Con
 * ellos puestos, truncar el call-site a
 *
 *     resolveMacroIndustryKey({ slug: catalogResolution.industry.slug })
 *
 * reintroduce el DEFECTO ORIGINAL ENTERO —la punta vuelve a resolver sólo por
 * slug, sale `null` cuando el slug publicado no casa, y la pierna Lusha se salta
 * con `macro_industry_unmapped` mientras Apollo sí resuelve por nombre visible—
 * y la suite seguía VERDE. Es exactamente la trampa que el repo ya documenta:
 * un trinquete que fija el nombre y no el comportamiento.
 *
 * Los tres call-sites de `wizard-execution-actions.ts` no tenían NINGUNA
 * cobertura de comportamiento:
 *
 *   · ~1191  metadata durable      → `deps.reserveSlot`
 *             (`initialBatchPayload.discoveryTaxonomy.macro_industry_key`)
 *   · ~1214  capa gratuita         → `deps.runPrePaidNoveltyDiscovery`
 *             (`input.macroIndustryKey`)
 *   · ~2040  pierna Lusha          → `deps.runLushaWaterfallLeg`
 *             (`input.macroIndustryKey`)
 *
 * Los tres son DEPENDENCIAS INYECTABLES de `executeProspectWizardGeneration`,
 * así que esta suite ejercita la función REAL y lee la clave macro que cada
 * punta recibe DE VERDAD. No hay guarda por nombre aquí: si la clave no llega,
 * la prueba se pone roja diga lo que diga el código.
 *
 * ── El escenario ────────────────────────────────────────────────────────────
 *
 * El del defecto, no uno cómodo: una fila de catálogo cuyo `industry.slug` NO es
 * un slug macro y cuyo `industry.name` SÍ es el nombre visible canónico de una de
 * las 12 macros. Es el caso en el que la cadena truncada a `slug` devuelve `null`
 * y la cadena completa devuelve la macro. La macro de referencia se toma de
 * `MACRO_INDUSTRIES`, no se escribe a mano.
 *
 * 🔴 0 proveedores · 0 créditos · 0 red · 0 Supabase · 0 Producción · 0
 * escrituras · 0 migraciones. Todo sale de dobles inyectados, y sin
 * `mock.module({ namedExports })` —funciona en Node 20 y NO en Node 24, que es
 * el runner de CI—.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeProspectWizardGeneration } from '../wizard-execution-actions';
import type { WizardExecutionDeps } from '../wizard-execution-actions';
import type { CatalogResolutionOutput } from '../wizard-catalog-resolver';
import type { LushaWaterfallLegOutcome } from '../wizard-lusha-waterfall.server';
import {
  WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
  WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES,
} from '../wizard-apollo-executor';
import {
  runPrePaidNoveltyDiscovery,
  type PrePaidNoveltyDiscoveryDeps,
} from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server';
import { buildPrePaidNoveltyContext } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import { planProviderExclusions } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import { EMPTY_PROVIDER_SEEN_MEMORY } from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import { PROVIDER_SEEN_LOAD_EMPTY } from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { PrePaidNoveltyGateResult } from '@/server/prospect-batches/country-source-discovery/run-prepaid-novelty-gate';
import type { IncrementalSearchOutput } from '@/server/agents/prospecting-toolkit/incremental-search-types';
import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import { resolveMacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industry-resolution';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TARGET = WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES;

const USER_ID = '123e4567-e89b-12d3-a456-426614174031';
const INDUSTRY_ID = '223e4567-e89b-12d3-a456-426614174032';
const CLIENT_REQUEST_ID = '423e4567-e89b-12d3-a456-426614174033';
const CANONICAL_BATCH_ID = '523e4567-e89b-12d3-a456-426614174034';

const CLIENT = {} as unknown as SupabaseClient;

/**
 * La macro de referencia sale del catálogo. Si el catálogo cambiara de slugs o
 * de nombres visibles, el escenario del defecto sigue siendo real sin tocar esta
 * suite — y una macro que desapareciera la pondría roja.
 */
const REFERENCE = MACRO_INDUSTRIES[0]!;

/** Un slug que con seguridad NO pertenece a la taxonomía macro. */
const UNKNOWN_SLUG = 'slug-publicado-que-no-existe-en-el-catalogo-macro';

/** Un nombre visible que con seguridad NO resuelve por nombre. */
const UNKNOWN_DISPLAY_NAME = 'Industria que no existe en la taxonomia macro';

const REQUEST = {
  clientRequestId: CLIENT_REQUEST_ID,
  countryCode: 'CO',
  industryId: INDUSTRY_ID,
  subindustryIds: [],
  catalogVersion: 'v2024-01',
  additionalCriteriaRaw: null,
};

function catalogWith(industry: { slug: string; name: string }): CatalogResolutionOutput {
  return {
    catalog: { version: 'v2024-01' },
    country: { code: 'CO', name: 'Colombia' },
    industry: { id: INDUSTRY_ID, slug: industry.slug, name: industry.name },
    subindustries: [],
  };
}

/** Capa gratuita que no aporta nada: aísla la clave macro del reparto. */
function emptyFreeLayer(macroIndustryKey: string | null): PrePaidNoveltyDiscoveryDeps {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'CO',
    macroIndustryKey,
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: 0,
      macroConfirmed: 0,
      ambiguous: 0,
      rejected: 0,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: 0,
      failed: false,
      failureCode: null,
    },
  });
  const gateResult: PrePaidNoveltyGateResult = {
    context,
    exclusionPlan: { available: 0, availableValues: [], sent: [], omittedDueToCap: 0 },
    providerExclusionPlan: planProviderExclusions('apollo', {}),
    providerSeen: PROVIDER_SEEN_LOAD_EMPTY,
    providerSeenMemory: EMPTY_PROVIDER_SEEN_MEMORY,
    acceptedCompanies: [],
    telemetry: {},
  };
  return {
    runGate: async () => gateResult,
    persist: async () => ({ batchId: null, writtenCount: 0, skippedCount: 0, failed: true }),
  };
}

/** Lo que cada uno de los TRES call-sites recibió de verdad. */
type ObservedMacroKeys = {
  /** ~1191 — metadata durable del lote canónico. */
  metadata: Array<string | null>;
  /** ~1214 — capa gratuita (pre-pago). */
  freeLayer: Array<string | null>;
  /** ~2040 — pierna Lusha del waterfall. */
  lushaLeg: Array<string | null>;
};

function wiring(industry: { slug: string; name: string }): {
  deps: WizardExecutionDeps;
  observed: ObservedMacroKeys;
} {
  const observed: ObservedMacroKeys = { metadata: [], freeLayer: [], lushaLeg: [] };
  const catalog = catalogWith(industry);

  const deps: WizardExecutionDeps = {
    getActiveUserId: async () => USER_ID,
    resolveCatalog: async () => catalog,
    checkTavilyAvailability: async () => true,
    checkPersistenceReadiness: async () => ({ status: 'available' as const }),
    checkApolloAvailability: async () => ({ available: true } as const),
    resolveProvider: () => 'apollo_organizations',

    // ── CALL-SITE ~1191 · metadata durable ────────────────────────────────
    //
    // El payload del lote viaja entero hasta `reserveSlot`, así que la clave
    // macro que el wizard PUBLICA se lee aquí, no en un comentario.
    reserveSlot: async (input) => {
      const taxonomy = input.initialBatchPayload?.discoveryTaxonomy as
        | Record<string, unknown>
        | undefined;
      observed.metadata.push((taxonomy?.macro_industry_key as string | null) ?? null);
      return { status: 'reserved', batchId: CANONICAL_BATCH_ID };
    },

    // ── CALL-SITE ~1214 · capa gratuita ───────────────────────────────────
    //
    // Se captura el argumento y se delega en la función REAL con una fuente
    // gratuita que no aporta: un doble que cortocircuitara aquí describiría una
    // ruta que no existe.
    runPrePaidNoveltyDiscovery: (input) => {
      observed.freeLayer.push(input.macroIndustryKey);
      return runPrePaidNoveltyDiscovery(
        CLIENT,
        {
          provider: 'apollo',
          countryCode: input.countryCode,
          countryName: input.countryName,
          macroIndustryKey: input.macroIndustryKey,
          requestedTarget: input.requestedTarget,
          requestedByUserId: input.requestedByUserId,
          resolveBatchId: input.resolveBatchId,
          partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED,
        },
        emptyFreeLayer(input.macroIndustryKey),
      );
    },

    reserveBudget: async () => ({
      status: 'reserved' as const,
      reservationId: 'res-1',
      creditsReserved: 3,
    }),
    checkApolloProviderQuota: async () => ({
      status: 'available' as const,
      providerCreditsAvailable: 999,
    }),
    confirmBudget: async () => ({ status: 'confirmed' as const }),
    releaseBudget: async () => ({ status: 'released' as const }),
    readConsumedCredits: async () => 0,
    sealFreeOnlyBatchStatus: async () => undefined,
    runTavilyPipeline: async ({ reservedBatchId }) =>
      ({ batchId: reservedBatchId, candidatesCreated: 0 } as unknown as IncrementalSearchOutput),
    runApolloPipeline: async (input) =>
      ({
        batchId: input.reservedBatchId,
        candidatesCreated: 0,
        targetPersistibleCandidates: TARGET,
        targetReached: false,
        persistenceOutcome: {
          eligibleBeforePersistence: 0,
          persistedCandidates: 0,
          persistenceFailureCount: 0,
          persistenceFailed: false,
          persistenceErrorCode: null,
          persistenceErrorStage: null,
          persistenceStatus: 'success',
          persistenceAttemptedCount: 0,
          persistenceSucceededCount: 0,
          persistenceFailedCount: 0,
          persistenceGap: 0,
          completeValidCandidates: 0,
          reviewOnlyCandidates: 0,
        },
      }) as unknown as IncrementalSearchOutput,
    markBatchFailed: async () => undefined,

    // ── CALL-SITE ~2040 · pierna Lusha ────────────────────────────────────
    //
    // 🔴 Éste es el síntoma del defecto original: con la clave en `null` la
    // pierna se salta con `macro_industry_unmapped`. La pierna NO se ejecuta de
    // verdad —el doble no llama a Lusha—, pero recibe el mismo argumento que
    // recibiría en producción.
    runLushaWaterfallLeg: async (input) => {
      observed.lushaLeg.push(input.macroIndustryKey);
      return { executed: false, reason: 'target_reached' } as LushaWaterfallLegOutcome;
    },
  };

  return { deps, observed };
}

async function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = {
    execution: process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION,
    apollo: process.env.ENABLE_APOLLO_COMPANY_SEARCH,
  };
  process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = 'true';
  process.env.ENABLE_APOLLO_COMPANY_SEARCH = 'true';
  try {
    return await fn();
  } finally {
    if (saved.execution === undefined) delete process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION;
    else process.env.ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION = saved.execution;
    if (saved.apollo === undefined) delete process.env.ENABLE_APOLLO_COMPANY_SEARCH;
    else process.env.ENABLE_APOLLO_COMPANY_SEARCH = saved.apollo;
  }
}

/** Corre la función REAL y devuelve lo que cada call-site recibió. */
async function runWizard(industry: {
  slug: string;
  name: string;
}): Promise<ObservedMacroKeys> {
  return withEnv(async () => {
    const wired = wiring(industry);
    const result = await executeProspectWizardGeneration(REQUEST, wired.deps);
    assert.equal(
      result.ok,
      true,
      'el arnés tiene que llegar hasta el final: un fallo antes de tiempo no ejercita los tres call-sites',
    );
    return wired.observed;
  });
}

function assertEveryCallSiteSaw(observed: ObservedMacroKeys, expected: string | null): void {
  assert.deepEqual(
    observed.metadata,
    [expected],
    `call-site ~1191 (metadata durable) publicó ${JSON.stringify(observed.metadata)} en vez de ${JSON.stringify([expected])}`,
  );
  assert.deepEqual(
    observed.freeLayer,
    [expected],
    `call-site ~1214 (capa gratuita) recibió ${JSON.stringify(observed.freeLayer)} en vez de ${JSON.stringify([expected])}`,
  );
  assert.deepEqual(
    observed.lushaLeg,
    [expected],
    `call-site ~2040 (pierna Lusha) recibió ${JSON.stringify(observed.lushaLeg)} en vez de ${JSON.stringify([expected])}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('MACRO-RESOLUTION CALL-SITES — el ESCENARIO DEL DEFECTO sobre la función real', () => {
  /**
   * Slug publicado que NO casa + nombre visible canónico que SÍ casa. Con la
   * cadena truncada a `slug` los tres call-sites reciben `null`; con la cadena
   * completa reciben la macro.
   */
  const DEFECT_INDUSTRY = { slug: UNKNOWN_SLUG, name: REFERENCE.displayName };

  test('el escenario es el del defecto: por slug NO resuelve, por nombre SÍ', () => {
    // Sin esto, la suite podría pasar sobre un escenario cómodo en el que el
    // slug ya resolvía y la truncación no cambiaba nada.
    assert.equal(
      resolveMacroIndustryKey({ slug: DEFECT_INDUSTRY.slug }),
      null,
      'el slug del escenario no puede resolver por sí solo, o la prueba no prueba nada',
    );
    assert.equal(
      resolveMacroIndustryKey({ displayName: DEFECT_INDUSTRY.name }),
      REFERENCE.key,
      'el nombre visible del escenario tiene que ser el canónico de la macro de referencia',
    );
  });

  test('los TRES call-sites reciben la macro, no `null`', async () => {
    const observed = await runWizard(DEFECT_INDUSTRY);
    assertEveryCallSiteSaw(observed, REFERENCE.key);
  });

  test('la pierna Lusha ya no puede saltarse por `macro_industry_unmapped`', async () => {
    // El síntoma literal que el corte cierra: la pierna recibía `null` y se
    // saltaba, mientras Apollo —que resuelve por nombre visible— sí encontraba
    // la macro en la MISMA corrida.
    const observed = await runWizard(DEFECT_INDUSTRY);
    assert.notEqual(
      observed.lushaLeg[0],
      null,
      'la pierna Lusha volvió a recibir `null`: el defecto original está reintroducido',
    );
    assert.equal(observed.lushaLeg[0], REFERENCE.key);
  });

  test('las tres puntas de la MISMA corrida no pueden discrepar', async () => {
    const observed = await runWizard(DEFECT_INDUSTRY);
    assert.deepEqual(
      new Set([observed.metadata[0], observed.freeLayer[0], observed.lushaLeg[0]]),
      new Set([REFERENCE.key]),
      'dos puntas de la misma corrida publican macros distintas',
    );
  });

  test('y vale para las 12 macros, no sólo para la de referencia', async () => {
    for (const macro of MACRO_INDUSTRIES) {
      const observed = await runWizard({ slug: UNKNOWN_SLUG, name: macro.displayName });
      assertEveryCallSiteSaw(observed, macro.key);
    }
  });
});

describe('MACRO-RESOLUTION CALL-SITES — el slug publicado sigue mandando', () => {
  test('con slug macro válido los tres call-sites resuelven por slug', async () => {
    // Precedencia: el slug gana aunque el nombre visible sea otro.
    const observed = await runWizard({ slug: REFERENCE.slug, name: UNKNOWN_DISPLAY_NAME });
    assertEveryCallSiteSaw(observed, REFERENCE.key);
  });

  test('slug de una macro y nombre visible de OTRA ⇒ gana el slug, en las tres', async () => {
    const other = MACRO_INDUSTRIES.find((m) => m.key !== REFERENCE.key)!;
    const observed = await runWizard({ slug: REFERENCE.slug, name: other.displayName });
    assertEveryCallSiteSaw(observed, REFERENCE.key);
  });
});

describe('MACRO-RESOLUTION CALL-SITES — fail-closed en las tres', () => {
  test('ni slug ni nombre en el catálogo ⇒ `null` EXPLÍCITO, nunca una macro adivinada', async () => {
    const observed = await runWizard({ slug: UNKNOWN_SLUG, name: UNKNOWN_DISPLAY_NAME });
    assertEveryCallSiteSaw(observed, null);
  });

  test('no se cae a la primera macro del catálogo', async () => {
    const observed = await runWizard({ slug: UNKNOWN_SLUG, name: UNKNOWN_DISPLAY_NAME });
    assert.notEqual(observed.lushaLeg[0], MACRO_INDUSTRIES[0]!.key);
    assert.notEqual(observed.metadata[0], MACRO_INDUSTRIES[0]!.key);
    assert.notEqual(observed.freeLayer[0], MACRO_INDUSTRIES[0]!.key);
  });
});

// ── Guarda estática COMPLEMENTARIA (nunca sustitutiva) ──────────────────────
//
// Las pruebas de arriba son la cobertura de verdad: ejercitan la función real y
// leen lo que cada punta recibe. Esta guarda existe SÓLO para que la truncación
// del argumento —la mutación que sobrevivía— muera también por el camino
// barato, y para cubrir los call-sites de los ficheros hermanos que este arnés
// no ejecuta.

const ROOT = path.join(process.cwd(), 'src');

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Los comentarios NOMBRAN cosas; el código las HACE. Sólo el código cuenta. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

/**
 * Call-sites que disponen de los DOS campos (slug y nombre visible) y por tanto
 * tienen que pasar los dos.
 *
 * Apollo (`apollo-macro-industry-request.ts`) queda FUERA a propósito: sólo
 * recibe el nombre canónico de la industria y no tiene slug a mano, así que
 * exigirle `slug:` inventaría un dato que esa punta no posee.
 */
const CALL_SITES_WITH_BOTH_FIELDS = [
  'modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
  'modules/prospect-batches/chat-wizard-execution/wizard-pipeline-adapter.ts',
  'modules/prospect-batches/wizard-lusha-criteria.ts',
] as const;

/** Cada invocación literal a la autoridad, con su objeto argumento. */
function authorityCallArguments(code: string): string[] {
  const calls: string[] = [];
  const pattern = /resolveMacroIndustry(?:Key|Identity)\s*\(\s*\{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    // Recorre desde la llave de apertura del objeto hasta su cierre, contando
    // profundidad: así un objeto con anidamiento no corta el argumento a medias.
    let depth = 0;
    let end = -1;
    for (let i = match.index + match[0].length - 1; i < code.length; i += 1) {
      const char = code[i];
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    calls.push(code.slice(match.index, end + 1));
  }

  return calls;
}

describe('MACRO-RESOLUTION CALL-SITES — guarda estática del ARGUMENTO', () => {
  test('toda llamada a la autoridad pasa `slug:` Y `displayName:`', () => {
    for (const rel of CALL_SITES_WITH_BOTH_FIELDS) {
      const code = stripComments(read(rel));
      const calls = authorityCallArguments(code);

      assert.ok(
        calls.length > 0,
        `${rel} no llama a la autoridad con un objeto literal: la guarda dejó de mirar nada`,
      );

      for (const call of calls) {
        assert.ok(
          call.includes('slug:'),
          `${rel} llama a la autoridad sin \`slug:\`:\n${call}`,
        );
        assert.ok(
          call.includes('displayName:'),
          `${rel} llama a la autoridad sin \`displayName:\`: la cadena vuelve a estar TRUNCADA y reaparece el defecto original:\n${call}`,
        );
      }
    }
  });

  test('`wizard-execution-actions.ts` conserva sus TRES call-sites', () => {
    // Borrar uno —o fusionarlos— cambiaría qué puntas comparten resolución sin
    // que ninguna otra prueba lo notara.
    const code = stripComments(
      read('modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts'),
    );
    assert.equal(
      authorityCallArguments(code).length,
      3,
      'metadata durable, capa gratuita y pierna Lusha: ni uno más, ni uno menos',
    );
  });
});
