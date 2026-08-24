/**
 * Regresión de la QA REAL — AGENT2A-WATERFALL-NO-SILENT-DOWNGRADE-1
 *
 * Reproduce la forma exacta del candidato de producción que destapó el defecto:
 * origen Apollo, correo y LinkedIn presentes, SIN teléfono, SIN identidad de Lusha
 * persistida, admin, flag del waterfall encendido, vista previa = 14 y aceptado =
 * 14. En producción ese clic acabó en `phone_reveal_status = revealed` por Apollo
 * con CERO corridas, CERO reservas y un usage-log del START sin
 * `phone_reveal_waterfall_id`.
 *
 * LO QUE ESTE ARCHIVO HACE IMPOSIBLE: corridas = 0 y llamadas a Apollo = 1.
 *
 * A diferencia del archivo de la matriz de motivos, aquí NO se mockea el arranque
 * del waterfall: corre el core REAL contra el driver simulado, así que el 14 se
 * RESUELVE de los hechos del candidato en vez de inyectarse. Lo único simulado es
 * el driver de Supabase, el presupuesto y los clientes de proveedor.
 *
 * Offline por construcción: sin red, sin Supabase real, sin Apollo, sin Lusha,
 * 0 créditos. Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════
// Red cortada de raíz
// ═══════════════════════════════════════════════════════════════

const originalFetch = globalThis.fetch;
let httpRequests: string[] = [];

globalThis.fetch = (async (input: unknown): Promise<Response> => {
  const url =
    typeof input === 'string'
      ? input
      : ((input as { url?: string })?.url ?? String(input));
  httpRequests.push(url);
  return new Response('[]', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

const PROVIDER_HOST_FRAGMENTS = ['apollo.io', 'lusha.com', 'hubapi.com'];

after(() => {
  globalThis.fetch = originalFetch;
});

// ═══════════════════════════════════════════════════════════════
// Espías
// ═══════════════════════════════════════════════════════════════

interface Spies {
  apolloCalls: number;
  lushaCalls: number;
  usageLogs: number;
  usageLogMetadata: Record<string, unknown>[];
  /** Cargas `p_run` enviadas a la reserva atómica, en orden. */
  runPayloads: Record<string, unknown>[];
  /** Patas (`p_legs`) de cada reserva atómica, en orden. */
  legPayloads: { provider_key: string; credits: number }[][];
  /** Corridas REALMENTE creadas. */
  runsCreated: number;
  /** Parches de UPDATE aplicados a la corrida, en orden. */
  runPatches: Record<string, unknown>[];
}

const spies: Spies = {
  apolloCalls: 0,
  lushaCalls: 0,
  usageLogs: 0,
  usageLogMetadata: [],
  runPayloads: [],
  legPayloads: [],
  runsCreated: 0,
  runPatches: [],
};

function resetSpies(): void {
  spies.apolloCalls = 0;
  spies.lushaCalls = 0;
  spies.usageLogs = 0;
  spies.usageLogMetadata = [];
  spies.runPayloads = [];
  spies.legPayloads = [];
  spies.runsCreated = 0;
  spies.runPatches = [];
  httpRequests = [];
}

// ═══════════════════════════════════════════════════════════════
// Fixture equivalente al candidato de la QA real (datos sintéticos)
// ═══════════════════════════════════════════════════════════════

const CANDIDATE_ID = 'cand-qa-waterfall-regression';
const CANDIDATE_ACCOUNT_ID = 'acct-qa-waterfall-regression';
const CANDIDATE_APOLLO_PERSON_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const RUN_ID = 'run-qa-waterfall-regression';

/**
 * Fila única que sirven TODAS las proyecciones del candidato sobre el cliente
 * admin (la del gate de privacidad y la de la búsqueda de identidad): origen
 * Apollo, sin teléfono, con correo y LinkedIn, y una empresa con dominio. Es
 * exactamente la combinación que resuelve modalidad = 14.
 */
const CANDIDATE_ROW = {
  id: CANDIDATE_ID,
  source: 'apollo',
  source_contact_id: '0123456789abcdef01234567',
  phone: null,
  email: 'contacto@ejemplo.test',
  linkedin_url: 'https://www.linkedin.com/in/perfil-sintetico',
  first_name: 'Nombre',
  last_name: 'Apellido',
  phone_reveal_status: null,
  phone_reveal_attempt_count: 0,
  apollo_person_id: CANDIDATE_APOLLO_PERSON_ID,
  country: null,
  enrichment_metadata: {},
  run: {
    account_id: CANDIDATE_ACCOUNT_ID,
    company_name: 'Empresa De Prueba',
    company_domain: 'ejemplo.test',
    company_country_code: null,
  },
};

type DbError = { code: string; message: string };

/** Fila de corrida devuelta por el SELECT (null = no hay corrida activa). */
let waterfallSelectRow: unknown = null;
/** `null` ⇒ el candidato NO existe para el waterfall (candidate_not_found). */
let adminCandidateRow: unknown = CANDIDATE_ROW;

function chain(result: {
  data: unknown;
  error: DbError | null;
}): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'in',
    'gt',
    'is',
    'order',
    'limit',
    'maybeSingle',
    'single',
    'insert',
    'update',
    'upsert',
  ]) {
    self[method] = () => self;
  }
  self.then = (
    resolve: (v: { data: unknown; error: DbError | null }) => unknown,
  ): unknown => resolve(result);
  return self;
}

/** Corrida completa tal y como la devuelve la tabla 102 tras el arranque. */
function activeRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    candidate_id: CANDIDATE_ID,
    status: 'apollo_in_flight',
    run_mode: 'full_waterfall',
    authorized_at: new Date().toISOString(),
    authorized_by: 'user-admin',
    authorized_by_role: 'admin',
    max_credits_authorized: 14,
    credit_reservation_group_id: 'reservation-group-1',
    apollo_attempted_at: new Date().toISOString(),
    apollo_outcome: null,
    apollo_cost_credits: null,
    apollo_cost_source: null,
    lusha_eligible: true,
    lusha_skipped_reason: null,
    lusha_attempted_at: null,
    lusha_outcome: null,
    lusha_cost_credits: null,
    lusha_cost_source: null,
    final_provider: null,
    completed_at: null,
    error_code: null,
    ...overrides,
  };
}

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        if (table === 'contact_enrichment_candidates') {
          return chain({ data: adminCandidateRow, error: null });
        }
        if (table === 'contact_provider_identities') {
          // Ninguna identidad de Lusha persistida: la búsqueda de identidad es
          // necesaria, y por eso el tope es 14 y no 13.
          return chain({ data: [], error: null });
        }
        if (table === 'phone_reveal_waterfall_runs') {
          const base = chain({ data: waterfallSelectRow, error: null });
          return {
            ...base,
            select: () => base,
            update: (patch: Record<string, unknown>) => {
              spies.runPatches.push(patch);
              return chain({ data: [{ id: RUN_ID }], error: null });
            },
          };
        }
        return chain({ data: [], error: null });
      },
      rpc: (fn: string, params: Record<string, unknown>) => {
        if (fn === 'reserve_and_create_phone_reveal_run') {
          const run = (params.p_run ?? {}) as Record<string, unknown>;
          const legs =
            (params.p_legs as { provider_key: string; credits: number }[]) ?? [];
          spies.runPayloads.push(run);
          spies.legPayloads.push(legs);
          spies.runsCreated += 1;
          return chain({
            data: {
              status: 'created',
              run_id: RUN_ID,
              reservation_group_id: params.p_reservation_group_id,
              reservations: legs.map((leg, index) => ({
                id: `reservation-${index}-${leg.provider_key}`,
                provider_key: leg.provider_key,
                credits_reserved: leg.credits,
              })),
            },
            error: null,
          });
        }
        return chain({ data: null, error: null });
      },
    }),
  },
});

mock.module('@/modules/budgets/budget-resolution', {
  namedExports: {
    checkBudget: async (providerKey: string) => ({
      allowed: true,
      reason: null,
      providerKey,
      userId: 'user-admin',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-31T23:59:59.999Z',
      scopeApplied: 'global',
      matchedRule: {
        id: 'rule-1',
        providerKey,
        scopeType: 'global',
        scopeId: null,
        limitCredits: 1_000,
        limitUsd: null,
        periodType: 'monthly',
        onExceed: 'block',
      },
      consumedCredits: 0,
      consumedUsd: 0,
      reservedCredits: 0,
      consumptionBreakdown: {
        usageLogCredits: 0,
        confirmedReservationCredits: 0,
        excludedUsageLogCredits: 0,
        excludedUsageLogCount: 0,
        hasAssumedCapCredits: false,
        malformedConfirmedReservationCount: 0,
      },
      projectedCredits: 0,
      projectedUsd: 0,
      remainingCredits: 1_000,
      remainingUsd: null,
      usdCostTruth: 'complete',
    }),
  },
});

let sessionRoleKey: string | null = 'admin';

mock.module('@/lib/supabase/server', {
  namedExports: {
    createClient: async () => ({
      auth: {
        getUser: async () => ({
          data: { user: { id: 'auth-user-1' } },
          error: null,
        }),
      },
      from: (table: string) => {
        if (table === 'internal_users') {
          return chain({ data: { id: 'user-admin', role_id: 'role-1' }, error: null });
        }
        if (table === 'roles') return chain({ data: { key: sessionRoleKey }, error: null });
        if (table === 'contact_enrichment_candidates') {
          return chain({ data: CANDIDATE_ROW, error: null });
        }
        return chain({ data: [], error: null });
      },
    }),
  },
});

mock.module('next/navigation', {
  namedExports: {
    redirect: (to: string) => {
      throw new Error(`BUG: redirect inesperado a ${to}`);
    },
  },
});

mock.module('@/server/integrations/apollo-client', {
  namedExports: {
    startApolloPhoneReveal: async () => {
      spies.apolloCalls += 1;
      return {
        success: true,
        requestId: 'apollo-request-id-test',
        noAsyncJobCode: null,
        trace: { apollo_http_request_id: 'apollo-http-request-id-test' },
      };
    },
  },
});

mock.module('@/server/integrations/lusha-phone-fallback-client', {
  namedExports: {
    enrichLushaContactPhonesForFallback: async () => {
      spies.lushaCalls += 1;
      return { ok: true, phones: [], candidateStatus: 'not_found' };
    },
  },
});

mock.module('@/server/services/lusha-connection', {
  namedExports: { getLushaApiKey: async () => 'test-key-never-used' },
});

mock.module('@/modules/usage-tracking/logging', {
  namedExports: {
    logProviderUsage: async (entry: { metadata?: Record<string, unknown> }) => {
      spies.usageLogs += 1;
      spies.usageLogMetadata.push(entry?.metadata ?? {});
      return true;
    },
  },
});

// ── Módulos bajo prueba: el cableado REAL, sin seam de arranque ───

type RevealActions = typeof import('../phone-reveal-actions');
type WaterfallCore = typeof import('../phone-reveal-waterfall-core');

let actions: RevealActions;
let core: WaterfallCore;

before(async () => {
  actions = await import('../phone-reveal-actions');
  core = await import('../phone-reveal-waterfall-core');
});

const WATERFALL_FLAG = 'ENABLE_PHONE_REVEAL_WATERFALL';
const APOLLO_REVEAL_FLAG = 'ENABLE_APOLLO_PHONE_REVEAL';

function revealInput(expectedMaxCredits: number) {
  return {
    candidateId: CANDIDATE_ID,
    confirmCost: true,
    expectedMaxCredits,
    phoneProcessingBasis: 'legitimate_interest_b2b' as const,
    phoneProcessingBasisNote: undefined,
  };
}

beforeEach(() => {
  resetSpies();
  sessionRoleKey = 'admin';
  waterfallSelectRow = null;
  adminCandidateRow = CANDIDATE_ROW;
  process.env[WATERFALL_FLAG] = 'true';
  process.env[APOLLO_REVEAL_FLAG] = 'true';
  process.env.APOLLO_PHONE_REVEAL_WEBHOOK_URL = 'https://sellup.test/api/apollo/webhook';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-test';
  delete process.env.ENABLE_APOLLO_PHONE_CACHE;
});

// ═══════════════════════════════════════════════════════════════
// La vista previa y el arranque resuelven el MISMO 14
// ═══════════════════════════════════════════════════════════════

describe('QA real — la modalidad se resuelve en 14 por los hechos del candidato', () => {
  it('vista previa: Lusha alcanzable con búsqueda de identidad ⇒ 14', () => {
    const preview = core.buildPhoneRevealWaterfallAuthorizationPreview({
      source: 'apollo',
      sourceContactId: CANDIDATE_ROW.source_contact_id,
      providerIdentities: [],
      identitySearchFacts: {
        firstName: CANDIDATE_ROW.first_name,
        lastName: CANDIDATE_ROW.last_name,
        linkedinUrl: CANDIDATE_ROW.linkedin_url,
        email: CANDIDATE_ROW.email,
        companyName: CANDIDATE_ROW.run.company_name,
        companyDomain: CANDIDATE_ROW.run.company_domain,
      },
    });

    assert.equal(preview.maxCredits, 14);
    assert.equal(preview.lushaEligible, true);
    assert.equal(preview.requiresIdentitySearch, true);
  });

  it('el contrato económico se conserva: 8 Apollo · 1 búsqueda · 5 reveal · 14 total', () => {
    assert.equal(core.PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS, 8);
    assert.equal(core.PHONE_REVEAL_WATERFALL_LUSHA_IDENTITY_SEARCH_MAX_CREDITS, 1);
    assert.equal(core.PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS, 5);
    assert.equal(core.PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_IDENTITY_SEARCH, 14);
  });
});

// ═══════════════════════════════════════════════════════════════
// El clic real: corrida = 1, correlacionada, y Apollo detrás de ella
// ═══════════════════════════════════════════════════════════════

describe('QA real — el clic crea UNA corrida y correlaciona el gasto', () => {
  it('preview 14 + aceptado 14 ⇒ 1 corrida con max_credits_authorized = 14', async () => {
    const result = await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(result.status, 'requested');
    assert.equal(spies.runsCreated, 1, 'exactamente una corrida');
    assert.equal(spies.runPayloads.length, 1);
    assert.equal(spies.runPayloads[0].max_credits_authorized, 14);
    assert.equal(spies.runPayloads[0].run_mode, 'full_waterfall');
  });

  it('la reserva cubre la pata de Apollo dentro de la MISMA transacción', async () => {
    await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(spies.legPayloads.length, 1, 'una sola reserva atómica');
    const legs = spies.legPayloads[0];
    const apolloLeg = legs.find((leg) => leg.provider_key === 'apollo');
    assert.ok(apolloLeg, 'la pata de Apollo tiene reserva propia');
    assert.equal(apolloLeg.credits, 8);
    // La suma de las patas es el tope autorizado: ni más caro ni «gratis».
    assert.equal(
      legs.reduce((total, leg) => total + leg.credits, 0),
      14,
    );
  });

  it('el usage-log del START de Apollo lleva phone_reveal_waterfall_id', async () => {
    await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(spies.apolloCalls, 1);
    assert.equal(spies.usageLogs, 1);
    assert.equal(spies.usageLogMetadata[0].phone_reveal_waterfall_id, RUN_ID);
  });

  it('Lusha NO se llama en el arranque: la 2ª pata depende del desenlace de Apollo', async () => {
    await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(spies.lushaCalls, 0);
    assert.deepEqual(
      httpRequests.filter((url) =>
        PROVIDER_HOST_FRAGMENTS.some((host) => url.includes(host)),
      ),
      [],
    );
  });

  it('IMPOSIBLE: corrida = 0 con llamada a Apollo = 1', async () => {
    // El defecto exacto de la QA de producción, expresado como invariante. Se
    // comprueba en el camino feliz Y en cada motivo de bloqueo que antes degradaba.
    const scenarios: { label: string; arrange: () => void }[] = [
      { label: 'camino feliz', arrange: () => {} },
      {
        label: 'candidato ausente para el waterfall',
        arrange: () => {
          adminCandidateRow = null;
        },
      },
      {
        label: 'ya existe una autorización viva',
        arrange: () => {
          waterfallSelectRow = activeRunRow();
        },
      },
      {
        label: 'rol no autorizado',
        arrange: () => {
          sessionRoleKey = 'sales_rep';
        },
      },
    ];

    for (const scenario of scenarios) {
      resetSpies();
      waterfallSelectRow = null;
      adminCandidateRow = CANDIDATE_ROW;
      sessionRoleKey = 'admin';
      scenario.arrange();

      await actions.revealCandidatePhoneAction(revealInput(14));

      const degraded = spies.runsCreated === 0 && spies.apolloCalls > 0;
      assert.equal(degraded, false, `degradación silenciosa en: ${scenario.label}`);
    }
  });

  it('candidato ausente para el waterfall ⇒ bloqueo, aunque el reveal SÍ lo vea', async () => {
    // El cliente de sesión sigue devolviendo el candidato, así que el reveal Apollo
    // legacy habría corrido perfectamente. Es el caso que más claramente distingue
    // «bloquear» de «no había waterfall».
    adminCandidateRow = null;

    const result = await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(result.status, 'candidate_not_found');
    assert.equal(spies.apolloCalls, 0);
    assert.equal(spies.runsCreated, 0);
    assert.equal(spies.usageLogs, 0);
  });

  it('una autorización viva ⇒ already_pending, sin segunda corrida ni segundo Apollo', async () => {
    waterfallSelectRow = activeRunRow();

    const result = await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(result.status, 'already_pending');
    assert.equal(spies.runsCreated, 0, 'la corrida existente ES la autorización');
    assert.equal(spies.apolloCalls, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Desenlace: Apollo resuelve ⇒ Lusha no corre, y la corrida cierra en apollo
// ═══════════════════════════════════════════════════════════════

describe('QA real — desenlace de la MISMA corrida', () => {
  it('I — Apollo encuentra teléfono ⇒ 0 llamadas a Lusha y final_provider = apollo', async () => {
    const deps = await import('../phone-reveal-waterfall-deps');
    waterfallSelectRow = activeRunRow();

    const result = await deps.continuePhoneRevealWaterfallForCandidate({
      candidateId: CANDIDATE_ID,
      apolloOutcome: 'revealed',
      apolloCostCredits: 8,
    });

    assert.equal(result.lushaCalled, false);
    assert.equal(spies.lushaCalls, 0, 'Apollo ya resolvió: la 2ª pata no se compra');
    const closing = spies.runPatches.at(-1) ?? {};
    assert.equal(closing.final_provider, 'apollo');
  });

  it('J — Apollo sin teléfono ⇒ la MISMA corrida continúa, sin nueva autorización', async () => {
    const deps = await import('../phone-reveal-waterfall-deps');
    waterfallSelectRow = activeRunRow();

    const result = await deps.continuePhoneRevealWaterfallForCandidate({
      candidateId: CANDIDATE_ID,
      apolloOutcome: 'no_phone_found',
      apolloCostCredits: 8,
    });

    // La continuación trabaja sobre la corrida que YA existe: no se crea ninguna
    // otra y no se reserva exposición nueva.
    assert.equal(spies.runsCreated, 0, 'ninguna autorización nueva');
    assert.notEqual(result.outcome, 'noop');
  });
});

// ═══════════════════════════════════════════════════════════════
// R2 — el techo humano sigue siendo un LÍMITE SUPERIOR DURO
// ═══════════════════════════════════════════════════════════════

describe('R2 — techo aceptado 8 contra modalidad 14: 0 gasto, 0 corrida', () => {
  it('el servidor NO reserva nada y vuelve a pedir la autorización', async () => {
    const result = await actions.revealCandidatePhoneAction(revealInput(8));

    assert.equal(result.status, 'authorization_ceiling_mismatch');
    assert.equal(spies.runsCreated, 0);
    assert.equal(spies.runPayloads.length, 0, 'ni siquiera se emite la reserva');
    assert.equal(spies.apolloCalls, 0);
    assert.equal(spies.lushaCalls, 0);
    assert.equal(spies.usageLogs, 0);
  });

  it('y NO degrada al Apollo-only de 8 que tampoco se autorizó bajo esa lectura', async () => {
    await actions.revealCandidatePhoneAction(revealInput(8));

    assert.equal(
      spies.runsCreated === 0 && spies.apolloCalls > 0,
      false,
      'un tope obsoleto no compra un reveal más barato',
    );
  });
});
