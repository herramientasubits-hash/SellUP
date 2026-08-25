/**
 * Tests — AGENT2A-WATERFALL-NO-SILENT-DOWNGRADE-1
 *
 * EVIDENCIA DE PRODUCCIÓN que origina este archivo: un candidato real cuya UI
 * mostró la autorización del waterfall (Apollo hasta 8 · búsqueda Lusha 1 ·
 * reveal Lusha 5 · máximo 14) acabó, tras el clic, con `phone_reveal_status =
 * revealed` por Apollo… y CERO filas en `phone_reveal_waterfall_runs`, CERO
 * reservas y un usage-log del START sin `phone_reveal_waterfall_id`. La operación
 * se DEGRADÓ en silencio a Apollo-only después de que la UI hubiera autorizado un
 * waterfall.
 *
 * CONTRATO QUE SE FIJA AQUÍ:
 *
 *   `no_waterfall` significa UNA sola cosa — el flag maestro
 *   `ENABLE_PHONE_REVEAL_WATERFALL` estaba APAGADO — y es el único estado que deja
 *   continuar el reveal Apollo legacy.
 *
 * Con el flag ENCENDIDO, la corrida es PRECONDICIÓN del gasto: ningún motivo de
 * NO-arranque puede convertir la operación en un Apollo suelto. Los seis motivos
 * que antes se colapsaban en `no_waterfall` (`feature_disabled`,
 * `role_not_allowed`, `invalid_candidate`, `candidate_not_found`,
 * `active_run_exists`, `create_conflict`) BLOQUEAN: 0 Apollo, 0 Lusha, 0 reservas,
 * 0 usage-logs, 0 créditos.
 *
 * QUÉ SE MOCKEA Y POR QUÉ: se sustituye ÚNICAMENTE `startPhoneRevealWaterfall`
 * —para poder inyectar cada motivo del core, incluida la divergencia de flag que
 * en producción no se puede provocar a mano— y se deja REAL todo lo demás: el
 * server action, su cableado de deps, el core del reveal Apollo y su llamada al
 * proveedor. Por eso «0 llamadas a Apollo» se mide sobre el camino real de gasto y
 * no sobre una simulación de él.
 *
 * Offline por construcción: sin red, sin Supabase real, sin Apollo, sin Lusha,
 * 0 créditos. Requiere --experimental-test-module-mocks (mock.module).
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import * as realWaterfallCore from '../phone-reveal-waterfall-core';
import {
  classifyPhoneRevealWaterfallStartFailure,
  WATERFALL_FLAG_INVARIANT_ERROR_CODE,
  WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
} from '../phone-reveal-waterfall-start-gate';

type StartResult = realWaterfallCore.StartPhoneRevealWaterfallResult;
type StartFailureReason = Extract<StartResult, { started: false }>['reason'];

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

function providerHttpRequests(): string[] {
  return httpRequests.filter((url) =>
    PROVIDER_HOST_FRAGMENTS.some((host) => url.includes(host)),
  );
}

// ═══════════════════════════════════════════════════════════════
// Espías
// ═══════════════════════════════════════════════════════════════

interface Spies {
  apolloCalls: number;
  lushaCalls: number;
  usageLogs: number;
  /** Metadata de cada fila de usage-log, en orden. */
  usageLogMetadata: Record<string, unknown>[];
  /** Invocaciones de la reserva atómica (crea reserva + corrida en una sola SQL). */
  creditReservationCalls: number;
  /** Escrituras REALES sobre la tabla de corridas. */
  waterfallWrites: number;
  /** Veces que se invocó el arranque del waterfall. */
  startCalls: number;
}

const spies: Spies = {
  apolloCalls: 0,
  lushaCalls: 0,
  usageLogs: 0,
  usageLogMetadata: [],
  creditReservationCalls: 0,
  waterfallWrites: 0,
  startCalls: 0,
};

/** Líneas capturadas de `console.info` / `console.error` / `console.warn`. */
let consoleLines: string[] = [];
const realConsole = {
  info: console.info,
  error: console.error,
  warn: console.warn,
};

function captureConsole(): void {
  const capture =
    (original: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      consoleLines.push(args.map((a) => String(a)).join(' '));
      void original;
    };
  console.info = capture(realConsole.info) as typeof console.info;
  console.error = capture(realConsole.error) as typeof console.error;
  console.warn = capture(realConsole.warn) as typeof console.warn;
}

after(() => {
  globalThis.fetch = originalFetch;
  console.info = realConsole.info;
  console.error = realConsole.error;
  console.warn = realConsole.warn;
});

function resetSpies(): void {
  spies.apolloCalls = 0;
  spies.lushaCalls = 0;
  spies.usageLogs = 0;
  spies.usageLogMetadata = [];
  spies.creditReservationCalls = 0;
  spies.waterfallWrites = 0;
  spies.startCalls = 0;
  httpRequests = [];
  consoleLines = [];
}

// ═══════════════════════════════════════════════════════════════
// Fixture: el candidato de la QA real (datos sintéticos)
// ═══════════════════════════════════════════════════════════════

const CANDIDATE_ID = 'cand-no-silent-downgrade';
const CANDIDATE_ACCOUNT_ID = 'acct-no-silent-downgrade';
const CANDIDATE_APOLLO_PERSON_ID = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const RUN_ID = 'run-no-silent-downgrade';

/**
 * Identidad sintética con la MISMA forma que la de la QA real: correo y LinkedIn
 * presentes, sin teléfono. Sirve además de sujeto para la prueba PII-free: ninguno
 * de estos valores puede aparecer en el evento de observabilidad.
 */
const PII_VALUES = {
  firstName: 'Nombre',
  lastName: 'Apellido',
  email: 'contacto@ejemplo.test',
  linkedinUrl: 'https://www.linkedin.com/in/perfil-sintetico',
} as const;

const REVEAL_CANDIDATE_ROW = {
  id: CANDIDATE_ID,
  source: 'apollo',
  source_contact_id: '0123456789abcdef01234567',
  email: PII_VALUES.email,
  linkedin_url: PII_VALUES.linkedinUrl,
  first_name: PII_VALUES.firstName,
  last_name: PII_VALUES.lastName,
  phone: null,
  enrichment_metadata: {},
  phone_reveal_status: null,
  phone_reveal_attempt_count: 0,
  apollo_person_id: CANDIDATE_APOLLO_PERSON_ID,
  country: null,
  run: {
    account_id: CANDIDATE_ACCOUNT_ID,
    company_name: 'Empresa De Prueba',
    company_country_code: null,
    company_domain: 'ejemplo.test',
  },
};

type DbError = { code: string; message: string };

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

// ── Driver Supabase simulado ──────────────────────────────────────

mock.module('@/lib/supabase/admin', {
  namedExports: {
    createSupabaseAdminClient: () => ({
      from: (table: string) => {
        if (table === 'contact_enrichment_candidates') {
          return chain({ data: REVEAL_CANDIDATE_ROW, error: null });
        }
        if (table === 'phone_reveal_waterfall_runs') {
          const base = chain({ data: null, error: null });
          return {
            ...base,
            insert: () => {
              spies.waterfallWrites += 1;
              return chain({ data: { id: RUN_ID }, error: null });
            },
            update: () => {
              spies.waterfallWrites += 1;
              return chain({ data: [{ id: RUN_ID }], error: null });
            },
          };
        }
        return chain({ data: [], error: null });
      },
      rpc: (fn: string) => {
        if (fn === 'reserve_and_create_phone_reveal_run') {
          spies.creditReservationCalls += 1;
        }
        return chain({ data: null, error: null });
      },
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
          return chain({ data: REVEAL_CANDIDATE_ROW, error: null });
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
      throw new Error('BUG: Lusha fue llamado sin corrida autorizada');
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

// ── El ÚNICO seam: el arranque del waterfall ──────────────────────
//
// Se inyecta el resultado del core para recorrer cada motivo, incluido
// `feature_disabled` con el flag exterior ENCENDIDO, que es una invariante rota y
// por definición no se puede provocar con env vars. Todo lo demás del camino de
// gasto (action → core del reveal → cliente Apollo) es el real.

let cannedStartResult: StartResult = { started: false, reason: 'feature_disabled' };

mock.module('../phone-reveal-waterfall-core', {
  namedExports: {
    ...realWaterfallCore,
    startPhoneRevealWaterfall: async (): Promise<StartResult> => {
      spies.startCalls += 1;
      return cannedStartResult;
    },
  },
});

// ── Módulo bajo prueba: el cableado REAL ──────────────────────────

type RevealActions = typeof import('../phone-reveal-actions');
let actions: RevealActions;

before(async () => {
  actions = await import('../phone-reveal-actions');
});

const WATERFALL_FLAG = 'ENABLE_PHONE_REVEAL_WATERFALL';
const APOLLO_REVEAL_FLAG = 'ENABLE_APOLLO_PHONE_REVEAL';

function setWaterfallFlag(on: boolean): void {
  if (on) process.env[WATERFALL_FLAG] = 'true';
  else delete process.env[WATERFALL_FLAG];
}

function revealInput(expectedMaxCredits: number) {
  return {
    candidateId: CANDIDATE_ID,
    confirmCost: true,
    expectedMaxCredits,
    phoneProcessingBasis: 'legitimate_interest_b2b' as const,
    phoneProcessingBasisNote: undefined,
  };
}

/**
 * Entrada de un cliente que NO manda techo. Es la forma que exige el contrato del techo
 * duro: la clave se OMITE, no se manda `undefined` disfrazado, para que lo que se prueba
 * sea la normalización y no un default de TypeScript.
 */
function revealInputWithoutCeiling() {
  return {
    candidateId: CANDIDATE_ID,
    confirmCost: true,
    phoneProcessingBasis: 'legitimate_interest_b2b' as const,
    phoneProcessingBasisNote: undefined,
  };
}

/** Arranque EXITOSO del core con el techo requerido que se le indique. */
function startedRun(requiredMaxCredits: number): StartResult {
  return {
    started: true,
    runId: RUN_ID,
    maxCreditsAuthorized: requiredMaxCredits,
    lushaEligible: requiredMaxCredits > 8,
    requiresIdentitySearch: requiredMaxCredits >= 14,
  };
}

/** Ninguna llamada de proveedor, ningún log de gasto, ninguna corrida escrita. */
function assertNoSpendAtAll(): void {
  assert.equal(spies.apolloCalls, 0, 'Apollo NO puede ser llamado');
  assert.equal(spies.lushaCalls, 0, 'Lusha NO puede ser llamado');
  assert.equal(spies.usageLogs, 0, 'no se registra gasto de proveedor');
  assert.equal(spies.waterfallWrites, 0, 'no queda ninguna corrida escrita');
  assert.equal(spies.creditReservationCalls, 0, 'no se reserva exposición');
  assert.deepEqual(providerHttpRequests(), [], 'ninguna petición HTTP a proveedores');
}

/** El evento estructurado del arranque, ya parseado. */
function startEvents(): Record<string, unknown>[] {
  return consoleLines
    .filter((line) => line.includes('[phone-reveal-waterfall] start outcome:'))
    .map((line) => {
      const json = line.slice(line.indexOf('{'));
      return JSON.parse(json) as Record<string, unknown>;
    });
}

beforeEach(() => {
  resetSpies();
  captureConsole();
  sessionRoleKey = 'admin';
  setWaterfallFlag(false);
  cannedStartResult = { started: false, reason: 'feature_disabled' };
  process.env[APOLLO_REVEAL_FLAG] = 'true';
  process.env.APOLLO_PHONE_REVEAL_WEBHOOK_URL = 'https://sellup.test/api/apollo/webhook';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-test';
  delete process.env.ENABLE_APOLLO_PHONE_CACHE;
});

// ═══════════════════════════════════════════════════════════════
// A. Flag EXTERIOR apagado — el comportamiento histórico se conserva
// ═══════════════════════════════════════════════════════════════

describe('A — flag maestro APAGADO: Apollo-only legacy intacto', () => {
  it('no se orquesta waterfall y Apollo corre exactamente como antes', async () => {
    setWaterfallFlag(false);

    const result = await actions.revealCandidatePhoneAction(revealInput(8));

    assert.equal(result.status, 'requested');
    assert.equal(result.requestAccepted, true);
    assert.equal(spies.startCalls, 0, 'ni se entra al arranque del waterfall');
    assert.equal(spies.apolloCalls, 1, 'el reveal legacy sigue llamando a Apollo');
  });

  it('el usage-log del START NO lleva correlación de corrida (no la hay)', async () => {
    setWaterfallFlag(false);

    await actions.revealCandidatePhoneAction(revealInput(8));

    assert.equal(spies.usageLogs, 1);
    assert.equal(
      spies.usageLogMetadata[0].phone_reveal_waterfall_id,
      undefined,
      'sin waterfall no hay id que correlacionar',
    );
  });

  it('el flag apagado es la ÚNICA fuente de `no_waterfall`', () => {
    // Propiedad estructural: NINGÚN motivo del core puede producirlo. Es la regla
    // entera de este hito, expresada sobre el vocabulario completo.
    const ALL_REASONS: StartFailureReason[] = [
      'feature_disabled',
      'role_not_allowed',
      'invalid_candidate',
      'candidate_not_found',
      'active_run_exists',
      'insufficient_credits',
      'budget_not_configured',
      'credit_balance_unavailable',
      'run_creation_unavailable',
      'create_conflict',
      'authorization_ceiling_mismatch',
    ];
    for (const reason of ALL_REASONS) {
      const gate = classifyPhoneRevealWaterfallStartFailure({ started: false, reason });
      assert.notEqual(
        gate.kind,
        'no_waterfall',
        `${reason} NO puede degradar a Apollo-only`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// B. Flag ON + arranque correcto — la corrida correlaciona el gasto
// ═══════════════════════════════════════════════════════════════

describe('B — flag ON + corrida creada: Apollo recibe el id de la corrida', () => {
  it('Apollo corre UNA vez y su usage-log del START lleva phone_reveal_waterfall_id', async () => {
    setWaterfallFlag(true);
    cannedStartResult = {
      started: true,
      runId: RUN_ID,
      maxCreditsAuthorized: 14,
      lushaEligible: true,
      requiresIdentitySearch: true,
    };

    const result = await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(result.status, 'requested');
    assert.equal(spies.apolloCalls, 1);
    assert.equal(spies.usageLogs, 1);
    assert.equal(
      spies.usageLogMetadata[0].phone_reveal_waterfall_id,
      RUN_ID,
      'el gasto queda correlacionado con la autorización',
    );
  });

  it('el evento de observabilidad declara la corrida creada', async () => {
    setWaterfallFlag(true);
    cannedStartResult = {
      started: true,
      runId: RUN_ID,
      maxCreditsAuthorized: 14,
      lushaEligible: true,
      requiresIdentitySearch: true,
    };

    await actions.revealCandidatePhoneAction(revealInput(14));

    const [event] = startEvents();
    assert.equal(event.outer_flag_enabled, true);
    assert.equal(event.core_started, true);
    assert.equal(event.run_created, true);
    assert.equal(event.reason, null);
    assert.equal(event.role_authorized, true);
    assert.equal(event.invariant_violation, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// C-H. Flag ON + cada motivo de NO-arranque ⇒ BLOQUEO, nunca Apollo
// ═══════════════════════════════════════════════════════════════

/**
 * Los SEIS motivos que antes se colapsaban en `no_waterfall`, con el estado que
 * el operador debe leer. Ninguno puede terminar en una llamada a proveedor.
 */
const BLOCKING_MATRIX: {
  reason: StartFailureReason;
  status: string;
  errorCode: string | null;
}[] = [
  {
    reason: 'feature_disabled',
    status: 'waterfall_infrastructure_unavailable',
    errorCode: WATERFALL_FLAG_INVARIANT_ERROR_CODE,
  },
  { reason: 'role_not_allowed', status: 'unauthorized_role', errorCode: null },
  { reason: 'invalid_candidate', status: 'invalid_candidate', errorCode: null },
  { reason: 'candidate_not_found', status: 'candidate_not_found', errorCode: null },
  { reason: 'active_run_exists', status: 'already_pending', errorCode: null },
  // AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1 — los dos conflictos SIN corrida
  // viva dejan de decir «ya hay una en proceso». Sólo llegan aquí cuando la re-lectura
  // posterior NO encontró ninguna corrida, así que afirmar una sería inventarla. Lo que
  // este hito vigila —que ningún motivo degrade a Apollo-only— se mantiene idéntico: los
  // dos siguen bloqueando con 0 proveedores, 0 reservas y 0 corridas.
  {
    reason: 'create_conflict',
    status: 'waterfall_infrastructure_unavailable',
    errorCode: WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
  },
  {
    reason: 'reservation_conflict',
    status: 'waterfall_infrastructure_unavailable',
    errorCode: WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
  },
];

describe('C-H — flag ON: ningún motivo del core degrada a Apollo-only', () => {
  for (const testCase of BLOCKING_MATRIX) {
    it(`${testCase.reason} ⇒ ${testCase.status}, 0 proveedores, 0 reservas, 0 corridas`, async () => {
      setWaterfallFlag(true);
      cannedStartResult = { started: false, reason: testCase.reason };

      const result = await actions.revealCandidatePhoneAction(revealInput(14));

      assert.equal(result.status, testCase.status);
      assert.equal(result.ok, false);
      assert.equal(result.requestAccepted, false);
      assert.equal(result.errorCode, testCase.errorCode);
      assertNoSpendAtAll();
    });
  }

  it('G/H — una autorización viva NO abre una segunda llamada a proveedor', async () => {
    // Los TRES comparten la verdad ECONÓMICA —no se reintenta, no se crea otra corrida y
    // no se llama a ningún proveedor— y por eso siguen juntos aquí.
    //
    // Lo que ya NO comparten (AGENT2A-LEGACY-LUSHA-FALSE-ACTIVE-RUN-CONFLICT-1) es lo que
    // AFIRMAN. Sólo `active_run_exists` llega habiendo ENCONTRADO la corrida; los otros
    // dos son colisiones que no dejaron ninguna, y decirle al operador que su candidato
    // ya tiene una revelación en curso lo mandaba a buscar algo inexistente. Misma
    // garantía de gasto, distinta afirmación: es justo la distinción que este hito abre.
    const CONFLICTS = [
      { reason: 'active_run_exists', status: 'already_pending' },
      { reason: 'create_conflict', status: 'waterfall_infrastructure_unavailable' },
      { reason: 'reservation_conflict', status: 'waterfall_infrastructure_unavailable' },
    ] as const;

    for (const { reason, status } of CONFLICTS) {
      resetSpies();
      setWaterfallFlag(true);
      cannedStartResult = { started: false, reason };

      const result = await actions.revealCandidatePhoneAction(revealInput(14));

      assert.equal(result.status, status, reason);
      assert.equal(spies.startCalls, 1, `${reason}: un solo intento de arranque`);
      assert.equal(spies.apolloCalls, 0, reason);
      assert.equal(spies.waterfallWrites, 0, `${reason}: ninguna segunda corrida`);
    }
  });

  it('C — el flag exterior encendido + core `feature_disabled` se declara INVARIANTE ROTA', async () => {
    setWaterfallFlag(true);
    cannedStartResult = { started: false, reason: 'feature_disabled' };

    const result = await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(result.status, 'waterfall_infrastructure_unavailable');
    assert.equal(result.errorCode, WATERFALL_FLAG_INVARIANT_ERROR_CODE);
    assert.notEqual(
      result.errorCode,
      WATERFALL_RUN_UNAVAILABLE_ERROR_CODE,
      'no se confunde con una tabla ausente: la causa es distinta',
    );
    assert.ok(
      consoleLines.some((line) => line.includes('invariant violation')),
      'la invariante rota se deja dicha explícitamente en el log',
    );
    const [event] = startEvents();
    assert.equal(event.invariant_violation, true);
    assert.equal(event.outer_flag_enabled, true);
    assertNoSpendAtAll();
  });
});

// ═══════════════════════════════════════════════════════════════
// Gates económicos previos — intactos
// ═══════════════════════════════════════════════════════════════

describe('los bloqueos económicos anteriores conservan su estado propio', () => {
  const ECONOMIC_MATRIX: { reason: StartFailureReason; status: string }[] = [
    { reason: 'insufficient_credits', status: 'insufficient_credits' },
    { reason: 'budget_not_configured', status: 'budget_not_configured' },
    { reason: 'credit_balance_unavailable', status: 'credit_balance_unavailable' },
    {
      reason: 'run_creation_unavailable',
      status: 'waterfall_infrastructure_unavailable',
    },
  ];

  for (const testCase of ECONOMIC_MATRIX) {
    it(`${testCase.reason} ⇒ ${testCase.status} sin tocar proveedores`, async () => {
      setWaterfallFlag(true);
      cannedStartResult = { started: false, reason: testCase.reason };

      const result = await actions.revealCandidatePhoneAction(revealInput(14));

      assert.equal(result.status, testCase.status);
      assertNoSpendAtAll();
    });
  }

  it('K — el techo duro R2 sigue cortando: requerido 14 / aceptado 8 ⇒ 0 gasto', async () => {
    setWaterfallFlag(true);
    cannedStartResult = {
      started: false,
      reason: 'authorization_ceiling_mismatch',
      requiredMaxCredits: 14,
      acceptedMaxCredits: 8,
    };

    const result = await actions.revealCandidatePhoneAction(revealInput(8));

    assert.equal(result.status, 'authorization_ceiling_mismatch');
    assert.equal(result.errorCode, 'authorization_ceiling_mismatch');
    assertNoSpendAtAll();
    // Los dos enteros NO viajan al cliente: la UI recarga su vista previa, que es
    // la autoridad, y así no puede reenviar un tope que le dictó un error.
    assert.equal(
      JSON.stringify(result).includes('14'),
      false,
      'el tope requerido no viaja en el resultado',
    );
  });

  it('el techo requerido y el aceptado SÍ quedan en el evento del servidor', async () => {
    setWaterfallFlag(true);
    cannedStartResult = {
      started: false,
      reason: 'authorization_ceiling_mismatch',
      requiredMaxCredits: 14,
      acceptedMaxCredits: 8,
    };

    await actions.revealCandidatePhoneAction(revealInput(8));

    const [event] = startEvents();
    assert.equal(event.required_max_credits, 14);
    assert.equal(event.accepted_max_credits, 8);
  });
});

// ═══════════════════════════════════════════════════════════════
// R2 — el evento no puede MENTIR sobre el techo humano
// ═══════════════════════════════════════════════════════════════

/**
 * PR338-R2. En el arranque EXITOSO el evento copiaba `maxCreditsAuthorized` en las DOS
 * claves, así que un requerido 13 sobre un aceptado humano de 14 se registraba como
 * 13 / 13. El gasto era correcto —se reserva lo REQUERIDO, nunca lo aceptado— pero la
 * auditoría borraba el margen que la persona había aprobado, que es justo el dato que
 * un revisor necesita para decidir si el permiso cubría lo ejecutado.
 *
 * Aquí se fija que `accepted_max_credits` sale del techo REAL del cliente, normalizado
 * con el MISMO contrato del techo duro, y NUNCA del requerido.
 */
describe('R2 — accepted_max_credits registra el techo humano, no el requerido', () => {
  it('requerido 13 sobre aceptado 14 registra 13 / 14, y reserva sigue siendo 13', async () => {
    setWaterfallFlag(true);
    cannedStartResult = startedRun(13);

    const result = await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(result.status, 'requested');
    const [event] = startEvents();
    assert.equal(event.required_max_credits, 13, 'lo que la modalidad exigía');
    assert.equal(event.accepted_max_credits, 14, 'lo que la persona aprobó');
    assert.notEqual(
      event.accepted_max_credits,
      event.required_max_credits,
      'el aceptado NO puede derivarse del requerido',
    );
    // La reserva es del core y no la toca este hito: sigue siendo el REQUERIDO.
    assert.equal(spies.usageLogMetadata[0].phone_reveal_waterfall_id, RUN_ID);
  });

  it('requerido 14 sobre aceptado 14 registra 14 / 14', async () => {
    setWaterfallFlag(true);
    cannedStartResult = startedRun(14);

    await actions.revealCandidatePhoneAction(revealInput(14));

    const [event] = startEvents();
    assert.equal(event.required_max_credits, 14);
    assert.equal(event.accepted_max_credits, 14);
  });

  it('requerido 8 sobre aceptado 8 registra 8 / 8', async () => {
    setWaterfallFlag(true);
    cannedStartResult = startedRun(8);

    await actions.revealCandidatePhoneAction(revealInput(8));

    const [event] = startEvents();
    assert.equal(event.required_max_credits, 8);
    assert.equal(event.accepted_max_credits, 8);
  });

  it('techo OMITIDO por el cliente ⇒ suelo conservador 8, nunca el requerido', async () => {
    setWaterfallFlag(true);
    cannedStartResult = startedRun(8);

    await actions.revealCandidatePhoneAction(revealInputWithoutCeiling());

    const [event] = startEvents();
    assert.equal(event.required_max_credits, 8);
    assert.equal(
      event.accepted_max_credits,
      8,
      'misma normalización que el techo duro: ausente / no finito ⇒ 8',
    );
  });

  it('un techo omitido NO se rellena con el requerido cuando el requerido es mayor', async () => {
    setWaterfallFlag(true);
    // Escenario imposible en el core real (14 > 8 habría cortado por techo), pero es
    // exactamente el que delata la derivación: si el evento copiara el requerido,
    // registraría un permiso humano de 14 que nadie dio.
    cannedStartResult = startedRun(14);

    await actions.revealCandidatePhoneAction(revealInputWithoutCeiling());

    const [event] = startEvents();
    assert.equal(event.required_max_credits, 14);
    assert.equal(event.accepted_max_credits, 8);
  });

  it('el desajuste requerido 14 / aceptado 8 se conserva 14 / 8 y no gasta nada', async () => {
    setWaterfallFlag(true);
    cannedStartResult = {
      started: false,
      reason: 'authorization_ceiling_mismatch',
      requiredMaxCredits: 14,
      acceptedMaxCredits: 8,
    };

    const result = await actions.revealCandidatePhoneAction(revealInput(8));

    assert.equal(result.status, 'authorization_ceiling_mismatch');
    const [event] = startEvents();
    assert.equal(event.required_max_credits, 14);
    assert.equal(event.accepted_max_credits, 8);
    assert.equal(event.core_started, false);
    assert.equal(event.run_created, false);
    assertNoSpendAtAll();
  });

  it('los motivos que cortan ANTES del techo dejan las dos claves en null', async () => {
    setWaterfallFlag(true);
    cannedStartResult = { started: false, reason: 'role_not_allowed' };

    await actions.revealCandidatePhoneAction(revealInput(14));

    const [event] = startEvents();
    // `null` = «el contrato del techo no se evaluó». Rellenarlo con el crudo del
    // cliente afirmaría que se comparó un techo que nadie comparó.
    assert.equal(event.required_max_credits, null);
    assert.equal(event.accepted_max_credits, null);
    assertNoSpendAtAll();
  });

  it('el arranque EXITOSO con techos distintos sigue siendo PII-free y cerrado', async () => {
    setWaterfallFlag(true);
    cannedStartResult = startedRun(13);

    await actions.revealCandidatePhoneAction(revealInput(14));

    const [event] = startEvents();
    assert.deepEqual(Object.keys(event).sort(), [
      'accepted_max_credits',
      'core_started',
      'event',
      'invariant_violation',
      'outer_flag_enabled',
      'reason',
      'required_max_credits',
      'role_authorized',
      'run_created',
    ]);
    // Solo enteros: el techo humano entra como número, nunca como texto del cliente.
    assert.equal(typeof event.required_max_credits, 'number');
    assert.equal(typeof event.accepted_max_credits, 'number');

    const allLogs = consoleLines.join('\n');
    for (const [label, value] of Object.entries(PII_VALUES)) {
      assert.equal(allLogs.includes(value), false, `PII filtrada: ${label}`);
    }
    assert.equal(allLogs.includes(CANDIDATE_APOLLO_PERSON_ID), false);
    assert.equal(allLogs.includes(CANDIDATE_ID), false);
    assert.equal(allLogs.includes(WATERFALL_FLAG), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Observabilidad — estructurada y SIN PII
// ═══════════════════════════════════════════════════════════════

describe('observabilidad del arranque: estructurada, cerrada y sin PII', () => {
  it('emite exactamente un evento por arranque, con las claves del contrato', async () => {
    setWaterfallFlag(true);
    cannedStartResult = { started: false, reason: 'candidate_not_found' };

    await actions.revealCandidatePhoneAction(revealInput(14));

    const events = startEvents();
    assert.equal(events.length, 1, 'un arranque, un evento');
    assert.deepEqual(Object.keys(events[0]).sort(), [
      'accepted_max_credits',
      'core_started',
      'event',
      'invariant_violation',
      'outer_flag_enabled',
      'reason',
      'required_max_credits',
      'role_authorized',
      'run_created',
    ]);
    assert.equal(events[0].reason, 'candidate_not_found');
    assert.equal(events[0].core_started, false);
    assert.equal(events[0].run_created, false);
  });

  it('ningún dato personal del candidato aparece en NINGUNA línea de log', async () => {
    setWaterfallFlag(true);
    cannedStartResult = { started: false, reason: 'role_not_allowed' };

    await actions.revealCandidatePhoneAction(revealInput(14));

    const allLogs = consoleLines.join('\n');
    for (const [label, value] of Object.entries(PII_VALUES)) {
      assert.equal(allLogs.includes(value), false, `PII filtrada: ${label}`);
    }
    // Ni el id nativo de proveedor ni el id del candidato: el motivo ya dice todo
    // lo que hay que saber, y un id por persona convierte el log en un rastro.
    assert.equal(allLogs.includes(CANDIDATE_APOLLO_PERSON_ID), false);
    assert.equal(allLogs.includes(CANDIDATE_ID), false);
  });

  it('el valor crudo del env del flag nunca se registra', async () => {
    setWaterfallFlag(true);
    cannedStartResult = { started: false, reason: 'invalid_candidate' };

    await actions.revealCandidatePhoneAction(revealInput(14));

    const allLogs = consoleLines.join('\n');
    assert.equal(
      allLogs.includes(WATERFALL_FLAG),
      false,
      'se publica el booleano resuelto, no el nombre ni el valor del env',
    );
  });

  it('un rol NO autorizado queda registrado como tal, sin decir cuál era', async () => {
    setWaterfallFlag(true);
    sessionRoleKey = 'sales_rep';
    cannedStartResult = { started: false, reason: 'role_not_allowed' };

    const result = await actions.revealCandidatePhoneAction(revealInput(14));

    assert.equal(result.status, 'unauthorized_role');
    const [event] = startEvents();
    assert.equal(event.role_authorized, false);
    assert.equal(consoleLines.join('\n').includes('sales_rep'), false);
    assertNoSpendAtAll();
  });
});
