// Agente 1 — SUPERFICIE ADMINISTRATIVA DEL PRESUPUESTO DEL WIZARD
// (AGENT1-WIZARD-BUDGET-ADMIN-F1B) · comportamiento de las dos acciones
//
// ═══════════════════════════════════════════════════════════════════
// QUÉ DEFIENDE ESTA SUITE
// ═══════════════════════════════════════════════════════════════════
//
// Antes de este hito, cambiar el presupuesto del Wizard exigía un UPDATE manual
// sobre `wizard_monthly_budget_periods`. La superficie que lo sustituye sólo es
// mejor que el SQL manual si tres cosas son ciertas, y ninguna se ve leyendo el
// componente:
//
//   1. que un no-admin no pueda escribir NADA — y que la comprobación de rol
//      ocurra ANTES de resolver la llave service_role, que ignora RLS;
//   2. que el PERÍODO lo derive el servidor con la misma función y la misma zona
//      horaria que usa la reserva, y que ningún parámetro del cliente pueda
//      elegirlo (un mes distinto al que la reserva mira se configuraría «bien» y
//      el wizard seguiría bloqueado);
//   3. que la acción no pueda tocar `credits_consumed` ni `credits_reserved`,
//      que son el registro de lo ya gastado y propiedad de las RPC.
//
// Todo se ejecuta contra las acciones REALES. Sólo se simula la frontera de I/O
// (sesión, cliente Supabase, revalidación de ruta). No hay llamadas a Apollo,
// Tavily, Lusha ni HubSpot; no se toca Producción; no se gasta un crédito.

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// ═══════════════════════════════════════════════════════════════
// El mundo
// ═══════════════════════════════════════════════════════════════

type RpcCall = { fn: string; params: Record<string, unknown> };
type TableWrite = { table: string; op: string; payload: unknown };

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';

const world = {
  isAdmin: true,
  currentUserId: ADMIN_USER_ID as string | null,
  rpcCalls: [] as RpcCall[],
  tableWrites: [] as TableWrite[],
  revalidated: [] as string[],
  redirects: [] as string[],
  /** Respuesta de la RPC, por nombre de función. */
  rpcResult: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  /** Zonas horarias con las que se pidió el período. */
  periodTimezones: [] as string[],
  periodStart: '2026-09-01',
  adminClientResolvedAt: -1,
  adminCheckedAt: -1,
  clock: 0,
};

function resetWorld() {
  world.isAdmin = true;
  world.currentUserId = ADMIN_USER_ID;
  world.rpcCalls = [];
  world.tableWrites = [];
  world.revalidated = [];
  world.redirects = [];
  world.rpcResult = {};
  world.periodTimezones = [];
  world.periodStart = '2026-09-01';
  world.adminClientResolvedAt = -1;
  world.adminCheckedAt = -1;
  world.clock = 0;
}

class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super(`NEXT_REDIRECT:${target}`);
  }
}

/**
 * Doble del cliente service_role. Registra TODA escritura de tabla además de las
 * RPC: si alguna vez la acción dejara de pasar por la función administrativa y
 * escribiera la tabla directamente, `tableWrites` lo delataría.
 */
function fakeAdminClient() {
  return {
    rpc(fn: string, params: Record<string, unknown>) {
      world.rpcCalls.push({ fn, params });
      const scripted = world.rpcResult[fn];
      return Promise.resolve(scripted ?? { data: null, error: null });
    },
    from(table: string) {
      const record = (op: string) => (payload: unknown) => {
        world.tableWrites.push({ table, op, payload });
        return {
          eq: () => Promise.resolve({ data: null, error: null }),
          then: (r: (v: unknown) => unknown) => r({ data: null, error: null }),
        };
      };
      return {
        update: record('update'),
        insert: record('insert'),
        upsert: record('upsert'),
        delete: record('delete'),
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Fronteras simuladas
// ═══════════════════════════════════════════════════════════════

mock.module('../../access/actions', {
  namedExports: {
    isCurrentUserAdmin: async () => {
      world.adminCheckedAt = world.clock++;
      return world.isAdmin;
    },
    getCurrentUser: async () =>
      world.currentUserId === null ? null : { id: world.currentUserId },
  },
});

mock.module('../queries', {
  namedExports: {
    getAdminClient: () => {
      world.adminClientResolvedAt = world.clock++;
      return fakeAdminClient();
    },
  },
});

mock.module('next/navigation', {
  namedExports: {
    redirect: (target: string) => {
      world.redirects.push(target);
      throw new RedirectSignal(target);
    },
  },
});

mock.module('next/cache', {
  namedExports: {
    revalidatePath: (path: string) => {
      world.revalidated.push(path);
    },
  },
});

/**
 * Se simula la MISMA función que la reserva usa, no una copia: lo que interesa
 * medir es con qué zona horaria se la llama y que su resultado sea el que viaja
 * a la RPC. Un `new Date()` en la acción no pasaría por aquí y se vería.
 */
mock.module('../../prospect-batches/chat-wizard-execution/wizard-budget-reconciliation', {
  namedExports: {
    getPilotBudgetPeriodStart: (timezone: string) => {
      world.periodTimezones.push(timezone);
      return world.periodStart;
    },
  },
});

// Import DIFERIDO: estos archivos se transpilan a CJS, donde un `await` de nivel
// superior no compila. Los mocks de arriba ya están instalados cuando `before`
// corre, así que el módulo real se carga contra las fronteras simuladas.
type BudgetAction = (credits: number, closed: boolean) => Promise<{
  success: boolean;
  outcome?: string;
  error?: string;
}>;
type MaxCreditsAction = (max: number) => Promise<{
  success: boolean;
  outcome?: string;
  error?: string;
}>;

let updateWizardBudgetPeriod: BudgetAction;
let updateWizardMaxCreditsPerExecution: MaxCreditsAction;

before(async () => {
  const mod = await import('../wizard-budget-period-actions');
  updateWizardBudgetPeriod = mod.updateWizardBudgetPeriod as unknown as BudgetAction;
  updateWizardMaxCreditsPerExecution =
    mod.updateWizardMaxCreditsPerExecution as unknown as MaxCreditsAction;
});

const budgetRpcCalls = () =>
  world.rpcCalls.filter((c) => c.fn === 'admin_set_wizard_budget_period');
const maxRpcCalls = () =>
  world.rpcCalls.filter((c) => c.fn === 'admin_set_wizard_max_credits_per_execution');

beforeEach(() => {
  resetWorld();
});

// ═══════════════════════════════════════════════════════════════
// § 1 — Un admin administra el presupuesto
// ═══════════════════════════════════════════════════════════════

describe('§ 1 — el admin puede administrar el presupuesto', () => {
  it('cambia budget_credits del período vigente', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };

    const result = await updateWizardBudgetPeriod(53, false);

    assert.equal(result.success, true);
    assert.equal(result.outcome, 'updated');
    assert.equal(budgetRpcCalls().length, 1);
    assert.equal(budgetRpcCalls()[0]!.params.p_budget_credits, 53);
  });

  it('crea el período cuando el mes vigente todavía no tiene fila', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'created', error: null };

    const result = await updateWizardBudgetPeriod(60, false);

    assert.equal(result.success, true);
    assert.equal(result.outcome, 'created');
  });

  it('cierra el período con is_closed, no con un presupuesto de 0', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };

    const result = await updateWizardBudgetPeriod(53, true);

    assert.equal(result.success, true);
    assert.equal(budgetRpcCalls()[0]!.params.p_is_closed, true);
  });

  it('cambia max_credits_per_execution', async () => {
    world.rpcResult['admin_set_wizard_max_credits_per_execution'] = {
      data: 'updated',
      error: null,
    };

    const result = await updateWizardMaxCreditsPerExecution(20);

    assert.equal(result.success, true);
    assert.equal(maxRpcCalls().length, 1);
    assert.equal(maxRpcCalls()[0]!.params.p_max_credits, 20);
  });

  it('registra quién hizo el cambio con el id del usuario de la sesión', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };

    await updateWizardBudgetPeriod(53, false);

    assert.equal(budgetRpcCalls()[0]!.params.p_changed_by, ADMIN_USER_ID);
  });

  it('un cambio que no cambia nada se reporta como tal, no como error', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'no_change', error: null };

    const result = await updateWizardBudgetPeriod(53, false);

    assert.equal(result.success, true);
    assert.equal(result.outcome, 'no_change');
  });

  it('revalida la ruta administrativa tras un guardado exitoso', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };

    await updateWizardBudgetPeriod(53, false);

    assert.deepEqual(world.revalidated, ['/settings/providers']);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 2 — Un no-admin no puede modificar NADA
// ═══════════════════════════════════════════════════════════════

describe('§ 2 — el no-admin queda fuera', () => {
  it('no puede modificar el presupuesto: redirige y no llega a ninguna RPC', async () => {
    world.isAdmin = false;

    await assert.rejects(() => updateWizardBudgetPeriod(999, false), RedirectSignal);

    assert.deepEqual(world.redirects, ['/settings']);
    assert.equal(world.rpcCalls.length, 0, 'ninguna RPC debe ejecutarse');
    assert.equal(world.tableWrites.length, 0, 'ninguna escritura de tabla');
  });

  it('no puede modificar max_credits_per_execution', async () => {
    world.isAdmin = false;

    await assert.rejects(() => updateWizardMaxCreditsPerExecution(9999), RedirectSignal);

    assert.equal(world.rpcCalls.length, 0);
  });

  it('no llega ni a resolver el cliente service_role', async () => {
    world.isAdmin = false;

    await assert.rejects(() => updateWizardBudgetPeriod(10, false), RedirectSignal);

    assert.equal(
      world.adminClientResolvedAt,
      -1,
      'la llave que ignora RLS no debe resolverse para un no-admin',
    );
  });

  it('para un admin, el rol se comprueba ANTES de resolver la llave service_role', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };

    await updateWizardBudgetPeriod(53, false);

    assert.ok(world.adminCheckedAt >= 0 && world.adminClientResolvedAt >= 0);
    assert.ok(
      world.adminCheckedAt < world.adminClientResolvedAt,
      'isCurrentUserAdmin() debe ocurrir antes que getAdminClient()',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// § 3 — El período lo decide el servidor
// ═══════════════════════════════════════════════════════════════

describe('§ 3 — período derivado, nunca recibido', () => {
  it('se deriva con getPilotBudgetPeriodStart y la zona horaria del wizard', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };

    await updateWizardBudgetPeriod(53, false);

    assert.deepEqual(world.periodTimezones, ['America/Bogota']);
    assert.equal(budgetRpcCalls()[0]!.params.p_period_start, '2026-09-01');
  });

  it('la acción de max_credits usa la MISMA derivación', async () => {
    world.rpcResult['admin_set_wizard_max_credits_per_execution'] = {
      data: 'updated',
      error: null,
    };

    await updateWizardMaxCreditsPerExecution(20);

    assert.deepEqual(world.periodTimezones, ['America/Bogota']);
    assert.equal(maxRpcCalls()[0]!.params.p_period_start, '2026-09-01');
  });

  it('un período enviado por el cliente se ignora: la firma no lo admite', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };
    world.periodStart = '2026-09-01';

    // Se invoca con un tercer argumento hostil, como lo haría un cliente
    // manipulado. TypeScript ya lo rechaza; esto comprueba el RUNTIME.
    await (updateWizardBudgetPeriod as unknown as (
      c: number,
      k: boolean,
      hostile: string,
    ) => Promise<unknown>)(53, false, '2020-01-01');

    assert.equal(
      budgetRpcCalls()[0]!.params.p_period_start,
      '2026-09-01',
      'el período debe seguir siendo el derivado por el servidor',
    );
  });

  it('cuando el reloj avanza de mes, el período cambia con él', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };
    world.periodStart = '2026-10-01';

    await updateWizardBudgetPeriod(53, false);

    assert.equal(budgetRpcCalls()[0]!.params.p_period_start, '2026-10-01');
  });
});

// ═══════════════════════════════════════════════════════════════
// § 4 — Validación
// ═══════════════════════════════════════════════════════════════

describe('§ 4 — validación de rango', () => {
  for (const invalid of [0, -1, 1.5, Number.NaN]) {
    it(`rechaza budget_credits = ${invalid} sin llamar a la RPC`, async () => {
      const result = await updateWizardBudgetPeriod(invalid, false);

      assert.equal(result.success, false);
      assert.match(result.error ?? '', /mayor que 0/);
      assert.equal(world.rpcCalls.length, 0);
    });
  }

  it('el mensaje de 0 apunta a cerrar el período, no a guardar 0', async () => {
    const result = await updateWizardBudgetPeriod(0, false);
    assert.match(result.error ?? '', /cierra el período/i);
  });

  for (const invalid of [0, -5, 2.5]) {
    it(`rechaza max_credits_per_execution = ${invalid} sin llamar a la RPC`, async () => {
      const result = await updateWizardMaxCreditsPerExecution(invalid);

      assert.equal(result.success, false);
      assert.equal(world.rpcCalls.length, 0);
    });
  }

  it('traduce invalid_budget_credits de la RPC a un error legible', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = {
      data: 'invalid_budget_credits',
      error: null,
    };

    const result = await updateWizardBudgetPeriod(53, false);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /mayor que 0/);
  });

  it('traduce settings_not_found a un error legible', async () => {
    world.rpcResult['admin_set_wizard_max_credits_per_execution'] = {
      data: 'settings_not_found',
      error: null,
    };

    const result = await updateWizardMaxCreditsPerExecution(20);

    assert.equal(result.success, false);
    assert.match(result.error ?? '', /wizard_pilot_settings/);
  });

  it('un error de la base no se reporta como éxito', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = {
      data: null,
      error: { message: 'boom' },
    };

    const result = await updateWizardBudgetPeriod(53, false);

    assert.equal(result.success, false);
    assert.equal(world.revalidated.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// § 5 — Los contadores de gasto no son configurables
// ═══════════════════════════════════════════════════════════════

describe('§ 5 — credits_consumed / credits_reserved siguen siendo de las RPC', () => {
  it('ninguna acción escribe una tabla directamente', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };
    world.rpcResult['admin_set_wizard_max_credits_per_execution'] = {
      data: 'updated',
      error: null,
    };

    await updateWizardBudgetPeriod(53, true);
    await updateWizardMaxCreditsPerExecution(20);

    assert.deepEqual(world.tableWrites, []);
  });

  it('ningún parámetro enviado a la RPC nombra los contadores', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };

    await updateWizardBudgetPeriod(53, false);

    const keys = Object.keys(budgetRpcCalls()[0]!.params);
    assert.ok(!keys.some((k) => k.includes('consumed')), keys.join(','));
    assert.ok(!keys.some((k) => k.includes('reserved')), keys.join(','));
  });

  it('sólo se invocan las dos RPC administrativas nuevas — ninguna de reserva', async () => {
    world.rpcResult['admin_set_wizard_budget_period'] = { data: 'updated', error: null };
    world.rpcResult['admin_set_wizard_max_credits_per_execution'] = {
      data: 'updated',
      error: null,
    };

    await updateWizardBudgetPeriod(53, false);
    await updateWizardMaxCreditsPerExecution(20);

    assert.deepEqual(
      world.rpcCalls.map((c) => c.fn).sort(),
      ['admin_set_wizard_budget_period', 'admin_set_wizard_max_credits_per_execution'],
    );
  });
});
