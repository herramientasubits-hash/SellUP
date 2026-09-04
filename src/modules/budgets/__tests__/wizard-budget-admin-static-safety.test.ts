// Agente 1 — VALLAS ESTÁTICAS DE LA SUPERFICIE ADMINISTRATIVA DEL PRESUPUESTO
// (AGENT1-WIZARD-BUDGET-ADMIN-F1B)
//
// ═══════════════════════════════════════════════════════════════════
// QUÉ DEFIENDE ESTA SUITE Y POR QUÉ NO BASTA LA DE COMPORTAMIENTO
// ═══════════════════════════════════════════════════════════════════
//
// Las pruebas de comportamiento demuestran lo que el código HACE hoy. Estas
// defienden lo que el código NO DEBE PODER HACER nunca, aunque alguien lo
// escriba sin querer:
//
//   * derivar el presupuesto del Wizard de la cuota contratada de un proveedor
//     (500 créditos de Apollo NO son 500 créditos del Wizard);
//   * escribir `credits_consumed` / `credits_reserved`, que son el registro del
//     gasto ya ocurrido y propiedad de las RPC de reserva;
//   * aceptar `period_start` del cliente;
//   * saltarse `isCurrentUserAdmin()` o invertir su orden respecto de
//     `getAdminClient()`;
//   * y tocar la semántica de la reserva atómica desde la migración 137.
//
// ── COMENTARIOS FUERA ANTES DE GREPEAR ──────────────────────────
//
// Los archivos de este hito NOMBRAN a propósito lo que no hacen («no lee
// tool_catalog», «no escribe credits_consumed»). Grepear el texto crudo
// confundiría «nombrarlo» con «hacerlo» y dejaría la valla en rojo por su propia
// documentación — o, peor, invitaría a borrar la documentación para pasarla. Por
// eso todo lo que se inspecciona aquí pasa antes por un despojado de comentarios.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MODULE_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const APP_PROVIDERS_DIR = path.join(REPO_ROOT, 'src', 'app', '(sellup)', 'settings', 'providers');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const WIZARD_EXEC_DIR = path.join(
  REPO_ROOT,
  'src',
  'modules',
  'prospect-batches',
  'chat-wizard-execution',
);

const read = (p: string) => readFileSync(p, 'utf8');

/** Quita comentarios de TypeScript para inspeccionar sólo el CÓDIGO ejecutable. */
function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Quita comentarios de SQL (`-- …` y `/* … *​/`). */
function stripSqlComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

const ACTIONS_SRC = read(path.join(MODULE_DIR, 'wizard-budget-period-actions.ts'));
const QUERIES_SRC = read(path.join(MODULE_DIR, 'wizard-budget-period-queries.ts'));
const CARD_SRC = read(path.join(APP_PROVIDERS_DIR, 'wizard-budget-card.tsx'));
const PAGE_SRC = read(path.join(APP_PROVIDERS_DIR, 'page.tsx'));

const ACTIONS_CODE = stripTsComments(ACTIONS_SRC);
const QUERIES_CODE = stripTsComments(QUERIES_SRC);
const CARD_CODE = stripTsComments(CARD_SRC);
const PAGE_CODE = stripTsComments(PAGE_SRC);

const MIGRATION_137 = '137_wizard_budget_period_admin_audit.sql';
const MIGRATION_SRC = read(path.join(MIGRATIONS_DIR, MIGRATION_137));
const MIGRATION_CODE = stripSqlComments(MIGRATION_SRC);

// ═══════════════════════════════════════════════════════════════
// § A — La barrera de admin existe y va PRIMERO
// ═══════════════════════════════════════════════════════════════

describe('§ A — isCurrentUserAdmin() antes de getAdminClient()', () => {
  it('las dos acciones exportadas comprueban el rol', () => {
    const adminChecks = [...ACTIONS_CODE.matchAll(/await isCurrentUserAdmin\(\)/g)].length;
    assert.equal(
      adminChecks,
      2,
      'cada acción exportada debe comprobar el rol por su cuenta, no confiar en la página',
    );
  });

  it('un no-admin es redirigido, no simplemente ignorado', () => {
    const redirects = [...ACTIONS_CODE.matchAll(/if \(!isAdmin\) redirect\('\/settings'\)/g)].length;
    assert.equal(redirects, 2);
  });

  it('la primera comprobación de rol precede a la primera llave service_role', () => {
    const firstAdminCheck = ACTIONS_CODE.indexOf('isCurrentUserAdmin()');
    const firstAdminClient = ACTIONS_CODE.indexOf('getAdminClient()');
    assert.ok(firstAdminCheck >= 0, 'debe existir la comprobación de rol');
    assert.ok(firstAdminClient >= 0, 'debe existir la resolución del cliente admin');
    assert.ok(
      firstAdminCheck < firstAdminClient,
      'getAdminClient() ignora RLS: resolverlo antes de comprobar el rol deja el presupuesto a un orden de líneas de distancia',
    );
  });

  it('en CADA acción, el rol se comprueba antes de su propio getAdminClient()', () => {
    const bodies = ACTIONS_CODE.split(/export async function /).slice(1);
    assert.equal(bodies.length, 2, 'este hito exporta exactamente dos acciones');
    for (const body of bodies) {
      const check = body.indexOf('isCurrentUserAdmin()');
      const client = body.indexOf('getAdminClient()');
      assert.ok(check >= 0 && client >= 0);
      assert.ok(check < client, `orden invertido en: ${body.slice(0, 60)}`);
    }
  });

  it('la acción no acepta ninguna autorización enviada por el cliente', () => {
    for (const forbidden of ['isAdmin:', 'role:', 'roleKey', 'actorId', 'userId:']) {
      assert.ok(
        !ACTIONS_CODE.includes(forbidden),
        `la firma no debe transportar autorización del cliente (${forbidden})`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § B — El período lo deriva el servidor
// ═══════════════════════════════════════════════════════════════

describe('§ B — period_start jamás viene del cliente', () => {
  it('se deriva con getPilotBudgetPeriodStart(WIZARD_BUDGET_TIMEZONE)', () => {
    const derivations = [
      ...ACTIONS_CODE.matchAll(/getPilotBudgetPeriodStart\(WIZARD_BUDGET_TIMEZONE\)/g),
    ].length;
    assert.equal(derivations, 2, 'cada acción deriva su propio período');
  });

  it('la lectura administrativa usa la MISMA derivación', () => {
    assert.match(QUERIES_CODE, /getPilotBudgetPeriodStart\(WIZARD_BUDGET_TIMEZONE\)/);
  });

  it('no hay un segundo reloj: ni new Date() ni UTC a mano', () => {
    for (const src of [ACTIONS_CODE, QUERIES_CODE]) {
      assert.ok(!/new Date\(/.test(src), 'un reloj propio resolvería otro período');
      assert.ok(!/Date\.UTC\(/.test(src));
      assert.ok(!/toISOString\(\)/.test(src));
    }
  });

  it('ninguna acción declara un parámetro de período', () => {
    const signatures = [...ACTIONS_CODE.matchAll(/export async function \w+\(([^)]*)\)/g)].map(
      (m) => m[1] ?? '',
    );
    assert.equal(signatures.length, 2);
    for (const sig of signatures) {
      assert.ok(!/period/i.test(sig), `la firma no puede recibir el período: ${sig}`);
      assert.ok(!/date/i.test(sig), `la firma no puede recibir una fecha: ${sig}`);
    }
  });

  it('la tarjeta de UI no envía ningún período al servidor', () => {
    assert.ok(
      !/updateWizardBudgetPeriod\([^)]*period/i.test(CARD_CODE),
      'la llamada del cliente no puede transportar el período',
    );
    // Las dos llamadas del cliente, con sus argumentos exactos: presupuesto y
    // cierre en una, techo por ejecución en la otra. Ningún período.
    assert.match(CARD_CODE, /await updateWizardBudgetPeriod\(parsedBudget, closedInput\)/);
    assert.match(CARD_CODE, /await updateWizardMaxCreditsPerExecution\(parsedMax\)/);
  });
});

// ═══════════════════════════════════════════════════════════════
// § C — Validación del techo por ejecución
// ═══════════════════════════════════════════════════════════════

describe('§ C — max_credits_per_execution se valida', () => {
  it('la acción valida el rango antes de tocar la base', () => {
    assert.match(ACTIONS_CODE, /isPositiveInteger\(maxCreditsPerExecution\)/);
    const validationAt = ACTIONS_CODE.indexOf('isPositiveInteger(maxCreditsPerExecution)');
    const rpcAt = ACTIONS_CODE.indexOf('admin_set_wizard_max_credits_per_execution');
    assert.ok(validationAt > 0 && rpcAt > 0 && validationAt < rpcAt);
  });

  it('la validación exige entero y positivo, no sólo "no vacío"', () => {
    assert.match(ACTIONS_CODE, /Number\.isInteger\(value\)\s*&&\s*value\s*>\s*0/);
  });

  it('la RPC vuelve a validarlo: la valla no depende sólo del servidor de Next', () => {
    assert.match(MIGRATION_CODE, /p_max_credits IS NULL OR p_max_credits <= 0/);
    assert.match(MIGRATION_CODE, /RETURN 'invalid_max_credits'/);
  });

  it('el presupuesto en 0 se rechaza en los dos lados', () => {
    assert.match(ACTIONS_CODE, /isPositiveInteger\(budgetCredits\)/);
    assert.match(MIGRATION_CODE, /p_budget_credits IS NULL OR p_budget_credits <= 0/);
    assert.match(MIGRATION_CODE, /RETURN 'invalid_budget_credits'/);
  });
});

// ═══════════════════════════════════════════════════════════════
// § D — Los contadores de gasto no son escribibles desde aquí
// ═══════════════════════════════════════════════════════════════

describe('§ D — credits_consumed / credits_reserved son de las RPC', () => {
  for (const [name, code] of [
    ['acciones', ACTIONS_CODE],
    ['tarjeta de UI', CARD_CODE],
    ['página', PAGE_CODE],
  ] as const) {
    it(`el código de ${name} no nombra los contadores de gasto`, () => {
      assert.ok(!code.includes('credits_consumed'), `${name} no puede escribir credits_consumed`);
      assert.ok(!code.includes('credits_reserved'), `${name} no puede escribir credits_reserved`);
    });
  }

  it('la lectura los nombra sólo para LEERLOS del snapshot compartido', () => {
    // La lectura sí los muestra. Lo que no puede es escribirlos: no hay update,
    // insert ni upsert en todo el archivo de consultas.
    for (const write of ['.update(', '.insert(', '.upsert(', '.delete(', '.rpc(']) {
      assert.ok(!QUERIES_CODE.includes(write), `la lectura no puede ${write}`);
    }
  });

  it('la migración no escribe los contadores en ninguna lista de columnas', () => {
    const writeStatements = MIGRATION_CODE.match(
      /(INSERT INTO public\.wizard_monthly_budget_periods[\s\S]*?;|UPDATE public\.wizard_monthly_budget_periods[\s\S]*?;)/g,
    );
    assert.ok(writeStatements && writeStatements.length > 0, 'la migración escribe el período');
    for (const stmt of writeStatements) {
      assert.ok(!stmt.includes('credits_consumed'), stmt);
      assert.ok(!stmt.includes('credits_reserved'), stmt);
    }
  });

  it('la bitácora tampoco tiene columnas para los contadores', () => {
    const createTable = MIGRATION_CODE.match(
      /CREATE TABLE IF NOT EXISTS public\.wizard_budget_period_changes[\s\S]*?\n\);/,
    );
    assert.ok(createTable, 'la migración crea la bitácora');
    assert.ok(!createTable[0].includes('credits_consumed'));
    assert.ok(!createTable[0].includes('credits_reserved'));
  });
});

// ═══════════════════════════════════════════════════════════════
// § E — La cuota del proveedor NO deriva el presupuesto del Wizard
// ═══════════════════════════════════════════════════════════════

describe('§ E — cuota contratada ≠ presupuesto del Wizard', () => {
  const QUOTA_TOKENS = [
    'monthly_credits_allowance',
    'monthly_usd_allowance',
    'tool_catalog',
    'updateProviderAllowance',
    'syncProviderQuota',
  ];

  for (const [name, code] of [
    ['acciones', ACTIONS_CODE],
    ['lectura', QUERIES_CODE],
  ] as const) {
    it(`el módulo de ${name} no conoce la cuota contratada`, () => {
      for (const token of QUOTA_TOKENS) {
        assert.ok(
          !code.includes(token),
          `${name} no puede leer ni derivar ${token}: 500 créditos de Apollo no son 500 del Wizard`,
        );
      }
    });
  }

  it('la migración 137 no toca tool_catalog', () => {
    for (const token of QUOTA_TOKENS) {
      assert.ok(!MIGRATION_CODE.includes(token), token);
    }
  });

  it('la tarjeta muestra la cuota como texto, nunca la mezcla con el presupuesto', () => {
    // La cuota entra por un prop dedicado y se consume en un componente aparte.
    assert.match(CARD_CODE, /function ProviderQuotaAside\(\{ quota \}/);
    // Ninguna línea de código pone la cuota y un campo de presupuesto juntos.
    const budgetFields = /budgetCredits|budgetInput|maxCreditsInput|parsedBudget|parsedMax/;
    for (const line of CARD_CODE.split('\n')) {
      if (/providerQuotaContext|monthlyCreditsAllowance|creditsAvailable/.test(line)) {
        assert.ok(
          !budgetFields.test(line),
          `la cuota no puede aparecer en la misma expresión que el presupuesto: ${line.trim()}`,
        );
      }
    }
  });

  it('el estado del formulario se inicializa desde el presupuesto, no desde una cuota', () => {
    assert.match(CARD_CODE, /useState\(\s*period \? String\(period\.budgetCredits\) : ''/);
    assert.match(
      CARD_CODE,
      /useState\(\s*snapshot\.maxCreditsPerExecution !== null \? String\(snapshot\.maxCreditsPerExecution\) : ''/,
    );
  });

  it('la página pasa la cuota por un prop separado y de sólo lectura', () => {
    assert.match(PAGE_CODE, /providerQuotaContext=\{apolloQuotaContext\}/);
    assert.match(PAGE_CODE, /const apolloQuotaContext: ProviderQuotaContext \| null/);
  });
});

// ═══════════════════════════════════════════════════════════════
// § F — La reserva atómica queda intacta
// ═══════════════════════════════════════════════════════════════

describe('§ F — la migración 137 no toca la semántica de la reserva', () => {
  const RESERVATION_RPCS = [
    'try_reserve_wizard_credits',
    'confirm_wizard_credits',
    'release_wizard_credits',
  ];

  for (const fn of RESERVATION_RPCS) {
    it(`no hace CREATE OR REPLACE de ${fn}`, () => {
      const declares = new RegExp(
        `(CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION|DROP\\s+FUNCTION|ALTER\\s+FUNCTION)[\\s\\S]{0,80}${fn}`,
        'i',
      );
      assert.ok(!declares.test(MIGRATION_CODE), `137 no puede redefinir ${fn}`);
    });
  }

  it('no borra ni renombra nada del presupuesto existente', () => {
    assert.ok(!/DROP\s+TABLE/i.test(MIGRATION_CODE));
    assert.ok(!/DROP\s+COLUMN/i.test(MIGRATION_CODE));
    assert.ok(!/DROP\s+CONSTRAINT/i.test(MIGRATION_CODE));
    assert.ok(!/ALTER\s+COLUMN/i.test(MIGRATION_CODE));
    assert.ok(!/RENAME/i.test(MIGRATION_CODE));
    assert.ok(!/TRUNCATE\s+TABLE/i.test(MIGRATION_CODE));
  });

  it('sólo agrega columnas con IF NOT EXISTS', () => {
    const alters = MIGRATION_CODE.match(/ALTER TABLE[\s\S]*?;/g) ?? [];
    for (const alter of alters) {
      if (!/ENABLE ROW LEVEL SECURITY/i.test(alter)) {
        assert.match(alter, /ADD COLUMN IF NOT EXISTS/i, alter);
      }
    }
  });

  it('las dos funciones nuevas quedan fuera del alcance de anon y authenticated', () => {
    for (const fn of ['admin_set_wizard_budget_period', 'admin_set_wizard_max_credits_per_execution']) {
      const revoke = new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]{0,120}FROM PUBLIC, anon, authenticated`,
      );
      assert.match(MIGRATION_CODE, revoke, fn);
      const grant = new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]{0,120}TO postgres, service_role`,
      );
      assert.match(MIGRATION_CODE, grant, fn);
    }
  });

  it('la bitácora es append-only: UPDATE y DELETE revocados incluso a service_role', () => {
    assert.match(
      MIGRATION_CODE,
      /REVOKE UPDATE, DELETE, TRUNCATE ON public\.wizard_budget_period_changes[\s\S]{0,120}service_role/,
    );
  });

  it('ninguna policy nueva permite a authenticated escribir tablas del wizard', () => {
    const policies = MIGRATION_CODE.match(/CREATE POLICY[\s\S]*?;/g) ?? [];
    assert.ok(policies.length > 0);
    for (const policy of policies) {
      assert.ok(!/TO authenticated/i.test(policy), policy);
      assert.ok(!/TO anon/i.test(policy), policy);
      assert.match(policy, /TO service_role/i, policy);
    }
  });

  it('la superficie nueva no se filtra a los archivos de reserva', () => {
    const untouched = [
      'wizard-budget-reservations.ts',
      'wizard-budget-preflight.ts',
      'wizard-budget-preflight.server.ts',
      'wizard-budget-estimate.ts',
      'wizard-execution-actions.ts',
    ];
    for (const file of untouched) {
      const src = read(path.join(WIZARD_EXEC_DIR, file));
      assert.ok(
        !src.includes('wizard-budget-period-actions'),
        `${file} no debe importar la superficie administrativa`,
      );
      assert.ok(!src.includes('wizard-budget-period-queries'), file);
      assert.ok(!src.includes('admin_set_wizard_'), file);
    }
  });

  it('las tres RPC de reserva siguen siendo las que el wrapper invoca', () => {
    const src = read(path.join(WIZARD_EXEC_DIR, 'wizard-budget-reservations.ts'));
    for (const fn of RESERVATION_RPCS) {
      assert.ok(src.includes(`db.rpc('${fn}'`), fn);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § G — Numeración e integridad de la cadena de migraciones
// ═══════════════════════════════════════════════════════════════

describe('§ G — la migración ocupa el techo real, sin colisiones', () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

  it('137 es el siguiente número libre y no hay dos archivos con él', () => {
    const numbered = files
      .map((f) => /^(\d{3})_/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]));
    const with137 = files.filter((f) => f.startsWith('137_'));
    assert.equal(with137.length, 1, `un solo archivo 137: ${with137.join(', ')}`);
    assert.equal(Math.max(...numbered), 137, 'la 137 debe ser el techo de la cadena');
  });

  it('la migración es la única de este hito: no se añadieron otras', () => {
    const above136 = files.filter((f) => {
      const m = /^(\d{3})_/.exec(f);
      return m !== null && Number(m[1]) > 136;
    });
    assert.deepEqual(above136, [MIGRATION_137]);
  });
});

// ═══════════════════════════════════════════════════════════════
// § H — Aislamiento respecto a otras superficies
// ═══════════════════════════════════════════════════════════════

describe('§ H — nada de este hito alcanza a Lusha, Tavily, Apollo ni al Agente 2A', () => {
  it('el hito no llama a ningún proveedor', () => {
    for (const code of [ACTIONS_CODE, QUERIES_CODE, CARD_CODE]) {
      assert.ok(!/fetch\(/.test(code), 'ninguna llamada HTTP');
      assert.ok(!/apollo-organizations-provider|lusha-client|tavily-client/.test(code));
    }
  });

  it('no toca las superficies de teléfono del Agente 2A', () => {
    for (const code of [ACTIONS_CODE, QUERIES_CODE, CARD_CODE, MIGRATION_CODE]) {
      for (const token of [
        'phone_reveal',
        'phone-reveal',
        'contact_enrichment',
        'hubspot',
        'official_contact',
      ]) {
        assert.ok(!code.includes(token), token);
      }
    }
  });

  it('los techos por proveedor salen de las funciones de estimación, no de constantes copiadas', () => {
    assert.match(QUERIES_CODE, /estimateCreditsForProvider\('apollo_organizations'\)/);
    assert.match(QUERIES_CODE, /estimateCreditsForProvider\('tavily'\)/);
    assert.match(QUERIES_CODE, /estimateLushaRunCredits\(\)/);
    // Ni un 12, ni un 20, ni un 6 escritos a mano como si fueran el techo.
    assert.ok(
      !/apollo:\s*\d+/.test(QUERIES_CODE) && !/tavily:\s*\d+/.test(QUERIES_CODE),
      'los techos no pueden estar hardcodeados',
    );
  });

  it('la fórmula de disponible se reutiliza, no se reescribe', () => {
    assert.match(QUERIES_CODE, /readWizardBudgetPeriodSnapshot\(/);
    assert.ok(
      !/budgetCredits\s*-\s*creditsConsumed\s*-\s*creditsReserved/.test(QUERIES_CODE),
      'no puede existir una segunda fórmula de disponible',
    );
  });
});
