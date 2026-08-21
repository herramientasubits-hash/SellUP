/**
 * Tests — GET /api/debug/agent2a-phone-waterfall-config
 * · bloques del enrutado automático de contactos
 * (Agente 2A · AGENT2A-LOCAL-REUSE-PROD-OBSERVABILITY-1)
 *
 * Por qué este archivo existe: el valor en Producción de
 * `ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING` y de
 * `ENABLE_CONTACT_ENRICHMENT_LOCAL_REUSE_GATE` era ILEGIBLE (registros de Vercel
 * `type: sensitive`, token local caducado) y NINGÚN endpoint los publicaba. Para el
 * segundo eso deja indefendible el caso de #318: con el flag OFF la protección
 * PRE-Lusha-Prospecting no existe, y lo observable —una corrida que sí llama a
 * Lusha— es idéntico a una corrida donde la puerta se evaluó y no acertó.
 *
 * Qué se verifica:
 *   * los TRES estados de cada flag (ausente / presente-no-"true" / presente-"true");
 *   * que un valor presente NO reconocible (`1`, `yes`) sigue el comportamiento
 *     CANÓNICO del repo, comprobado contra las mismas funciones del runtime en vez
 *     de contra una expectativa inventada aquí;
 *   * que el MASTER SWITCH y la puerta de reuso local son señales INDEPENDIENTES
 *     (ninguna resuelve a la otra), que es lo que permite leer el par sin acusar al
 *     flag equivocado;
 *   * acceso admin-only: 401 anónimo, 403 autenticado sin rol, 200 admin — y que en
 *     401/403 los bloques nuevos NO aparecen;
 *   * que no sale el valor crudo del env, ni secretos, ni PII;
 *   * REGRESIÓN: los tres pares planos preexistentes siguen presentes y con la
 *     misma semántica.
 *
 * Sin red, sin Apollo, sin Lusha, sin créditos, sin escrituras.
 */

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG,
  LUSHA_PHONE_REVEAL_FALLBACK_FLAG,
  PHONE_REVEAL_WATERFALL_FLAG,
  SEARCH_MORE_PHONES_FLAG,
} from '@/lib/feature-flags.server';
import { CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG } from '@/modules/contact-enrichment-routing/routing-config.server';

type SupabaseStub = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  rpc: (fn: string, args: unknown) => Promise<{ data: unknown }>;
};

function stubSupabase(options: {
  user: { id: string } | null;
  isAdmin: unknown;
}): SupabaseStub {
  return {
    auth: { getUser: async () => ({ data: { user: options.user } }) },
    rpc: async () => ({ data: options.isAdmin }),
  };
}

/**
 * `mock.module` no admite re-mockear el mismo especificador dentro del proceso, así
 * que el estado mutable vive en el stub y no en el mock (mismo patrón que
 * route.test.ts, su archivo hermano).
 */
let currentSupabase: SupabaseStub = stubSupabase({ user: null, isAdmin: false });

mock.module('@/lib/supabase/server', {
  namedExports: { createClient: async () => currentSupabase },
});

const ADMIN = stubSupabase({ user: { id: 'u-admin' }, isAdmin: true });

async function callAs(supabase: SupabaseStub) {
  currentSupabase = supabase;
  const { GET } = await import('../route');
  return GET();
}

/** Fija el valor de UNA variable y devuelve el restaurador. */
function withEnv(name: string, value: string | undefined): () => void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

const restorers: Array<() => void> = [];

function setEnv(name: string, value: string | undefined): void {
  restorers.push(withEnv(name, value));
}

afterEach(() => {
  while (restorers.length > 0) restorers.pop()?.();
});

// ── A · la puerta de reuso local (#318) ──────────────────────────

describe('local reuse gate · los tres estados', () => {
  it('publica el nombre de la variable, nunca su valor', async () => {
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(
      body.contactEnrichmentLocalReuseGate.flagName,
      CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG,
    );
    assert.equal(
      CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG,
      'ENABLE_CONTACT_ENRICHMENT_LOCAL_REUSE_GATE',
    );
  });

  it('ausente → configured=false, resolved=false', async () => {
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, undefined);
    const response = await callAs(ADMIN);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.contactEnrichmentLocalReuseGate.configured, false);
    assert.equal(body.contactEnrichmentLocalReuseGate.resolved, false);
  });

  it('"false" → configured=true, resolved=false', async () => {
    // EL caso que las dos señales existen para separar: la variable está
    // REGISTRADA en Vercel —así que `vercel env ls` la lista— y sin embargo la
    // protección de #318 está APAGADA. Antes era indistinguible de la ausente.
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'false');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.contactEnrichmentLocalReuseGate.configured, true);
    assert.equal(body.contactEnrichmentLocalReuseGate.resolved, false);
  });

  it('"true" → configured=true, resolved=true', async () => {
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.contactEnrichmentLocalReuseGate.configured, true);
    assert.equal(body.contactEnrichmentLocalReuseGate.resolved, true);
  });

  it('los dos campos son booleanos, no el valor crudo bajo otro nombre', async () => {
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(typeof body.contactEnrichmentLocalReuseGate.configured, 'boolean');
    assert.equal(typeof body.contactEnrichmentLocalReuseGate.resolved, 'boolean');
    assert.deepEqual(
      Object.keys(body.contactEnrichmentLocalReuseGate).sort(),
      ['configured', 'flagName', 'resolved'],
    );
  });
});

// ── B · el master switch del enrutado automático ─────────────────

describe('automatic routing · el mismo contrato configured/resolved', () => {
  it('publica el nombre de la variable', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(
      body.contactEnrichmentAutomaticRouting.flagName,
      CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG,
    );
    assert.equal(
      CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG,
      'ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING',
    );
  });

  it('ausente → configured=false, resolved=false', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, undefined);
    const response = await callAs(ADMIN);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.contactEnrichmentAutomaticRouting.configured, false);
    assert.equal(body.contactEnrichmentAutomaticRouting.resolved, false);
  });

  it('"false" → configured=true, resolved=false', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'false');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.contactEnrichmentAutomaticRouting.configured, true);
    assert.equal(body.contactEnrichmentAutomaticRouting.resolved, false);
  });

  it('"true" → configured=true, resolved=true', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.contactEnrichmentAutomaticRouting.configured, true);
    assert.equal(body.contactEnrichmentAutomaticRouting.resolved, true);
  });

  it('`resolved` es el MISMO valor que resuelve el runtime, no un segundo parseo', async () => {
    // Si el endpoint duplicara el parseo, una discrepancia con el accesor real
    // haría que el diagnóstico mintiera con toda confianza. Se compara contra
    // `getContactEnrichmentRoutingConfigV1()`, que es lo que gobierna producción.
    for (const value of [undefined, 'false', 'true', '  TRUE  ']) {
      setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, value);
      const body = await (await callAs(ADMIN)).json();
      const { getContactEnrichmentRoutingConfigV1 } = await import(
        '@/modules/contact-enrichment-routing/routing-config.server'
      );
      assert.equal(
        body.contactEnrichmentAutomaticRouting.resolved,
        getContactEnrichmentRoutingConfigV1().automaticRoutingEnabled,
        `valor: ${String(value)}`,
      );
      restorers.pop()?.();
    }
  });

  it('los dos campos son booleanos y no hay una tercera clave con el valor', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(typeof body.contactEnrichmentAutomaticRouting.configured, 'boolean');
    assert.equal(typeof body.contactEnrichmentAutomaticRouting.resolved, 'boolean');
    assert.deepEqual(
      Object.keys(body.contactEnrichmentAutomaticRouting).sort(),
      ['configured', 'flagName', 'resolved'],
    );
  });
});

// ── C · valor presente NO reconocible: comportamiento canónico ───

/**
 * El repo tiene UNA definición de cada mitad y estos tests la comprueban en vez de
 * inventar una semántica nueva:
 *   * `configured` = PRESENCIA (`isEnvFlagConfigured`): `'1'` está presente, así que
 *     `configured` es `true`. Colapsarlo con «reconocible» volvería a mezclar las dos
 *     preguntas que este par separa.
 *   * `resolved` = fail-closed: sólo el token exacto `true` (tras trim + lowercase)
 *     resuelve activo; `'1'`, `'yes'`, `'on'` son `invalid` y por tanto APAGADOS.
 */
describe('C · valor presente que no es un booleano reconocible', () => {
  const NOT_RECOGNIZABLE = ['1', '0', 'yes', 'no', 'on', 'off', 'enabled', 'sí', 'TRUE!'];

  it('configured=true (está presente) y resolved=false (fail-closed) en los dos flags', async () => {
    for (const value of NOT_RECOGNIZABLE) {
      setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, value);
      setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, value);
      const body = await (await callAs(ADMIN)).json();

      assert.equal(body.contactEnrichmentLocalReuseGate.configured, true, value);
      assert.equal(body.contactEnrichmentLocalReuseGate.resolved, false, value);
      assert.equal(body.contactEnrichmentAutomaticRouting.configured, true, value);
      assert.equal(body.contactEnrichmentAutomaticRouting.resolved, false, value);

      restorers.pop()?.();
      restorers.pop()?.();
    }
  });

  it('`"  TrUe  "` SÍ resuelve activo: trim + lowercase es la regla canónica', async () => {
    // No es una excepción inventada aquí: es exactamente lo que hacen
    // `isEnvFlagEnabled` y el parser de routing-config. Se comprueba contra las
    // funciones del runtime para que el test no pueda discrepar de producción.
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, '  TrUe  ');
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, '  TrUe  ');
    const body = await (await callAs(ADMIN)).json();

    const { isContactEnrichmentLocalReuseGateEnabled } = await import(
      '@/lib/feature-flags.server'
    );
    const { getContactEnrichmentRoutingConfigV1 } = await import(
      '@/modules/contact-enrichment-routing/routing-config.server'
    );

    assert.equal(body.contactEnrichmentLocalReuseGate.resolved, true);
    assert.equal(
      body.contactEnrichmentLocalReuseGate.resolved,
      isContactEnrichmentLocalReuseGateEnabled(),
    );
    assert.equal(body.contactEnrichmentAutomaticRouting.resolved, true);
    assert.equal(
      body.contactEnrichmentAutomaticRouting.resolved,
      getContactEnrichmentRoutingConfigV1().automaticRoutingEnabled,
    );
  });

  it('cadena vacía y sólo espacios cuentan como AUSENTE, no como configurada', async () => {
    for (const value of ['', '   ']) {
      setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, value);
      setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, value);
      const body = await (await callAs(ADMIN)).json();
      assert.equal(body.contactEnrichmentLocalReuseGate.configured, false, `[${value}]`);
      assert.equal(body.contactEnrichmentAutomaticRouting.configured, false, `[${value}]`);
      restorers.pop()?.();
      restorers.pop()?.();
    }
  });
});

// ── Independencia: el master switch y la puerta no se arrastran ──

/**
 * El master switch apagado hace INALCANZABLE la puerta de reuso local, pero eso es
 * una relación de EJECUCIÓN, no de resolución: cada `resolved` debe seguir
 * reflejando SU propia variable. Si uno arrastrara al otro, el diagnóstico ya no
 * permitiría decir cuál de los dos hay que encender.
 */
describe('independencia · master switch vs puerta de reuso local', () => {
  const CASES = [
    { routing: 'false', reuse: 'false', expectRouting: false, expectReuse: false },
    { routing: 'false', reuse: 'true', expectRouting: false, expectReuse: true },
    { routing: 'true', reuse: 'false', expectRouting: true, expectReuse: false },
    { routing: 'true', reuse: 'true', expectRouting: true, expectReuse: true },
  ] as const;

  for (const c of CASES) {
    it(`routing=${c.routing}, reuse=${c.reuse} ⇒ cada resolved refleja SU variable`, async () => {
      setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, c.routing);
      setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, c.reuse);
      const body = await (await callAs(ADMIN)).json();
      assert.equal(body.contactEnrichmentAutomaticRouting.resolved, c.expectRouting);
      assert.equal(body.contactEnrichmentLocalReuseGate.resolved, c.expectReuse);
    });
  }

  it('el caso REAL a diagnosticar: reuse=true con el master OFF sigue publicándose como tal', async () => {
    // La puerta resuelve activa y aun así NO puede correr, porque el enrutador
    // automático no arranca. Publicar los dos por separado es lo que evita
    // concluir «#318 está protegiendo» cuando en realidad nada llega hasta ella.
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'false');
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.contactEnrichmentAutomaticRouting.resolved, false);
    assert.equal(body.contactEnrichmentLocalReuseGate.resolved, true);
  });
});

// ── D · seguridad ────────────────────────────────────────────────

describe('D · sigue siendo admin-only y no filtra nada', () => {
  it('anónimo → 401 y los bloques nuevos NO aparecen', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'true');
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    const response = await callAs(stubSupabase({ user: null, isAdmin: false }));
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.ok(body.error);
    assert.equal(body.contactEnrichmentAutomaticRouting, undefined);
    assert.equal(body.contactEnrichmentLocalReuseGate, undefined);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });

  it('autenticado SIN rol admin → 403 y los bloques nuevos NO aparecen', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'true');
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    const response = await callAs(stubSupabase({ user: { id: 'u-2' }, isAdmin: false }));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.ok(body.error);
    assert.equal(body.contactEnrichmentAutomaticRouting, undefined);
    assert.equal(body.contactEnrichmentLocalReuseGate, undefined);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });

  it('admin → 200 y los bloques SÍ aparecen', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'true');
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    const response = await callAs(ADMIN);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.contactEnrichmentAutomaticRouting);
    assert.ok(body.contactEnrichmentLocalReuseGate);
  });

  it('NO devuelve el valor crudo del env', async () => {
    // Valores inventados y reconocibles: si el endpoint los filtrara, saldrían
    // literales en el JSON.
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'RoUtInG-CaNaRy-9');
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'ReUsE-CaNaRy-9');
    const raw = JSON.stringify(await (await callAs(ADMIN)).json());
    assert.ok(!raw.includes('RoUtInG-CaNaRy-9'), 'no debe filtrar el valor crudo');
    assert.ok(!raw.includes('ReUsE-CaNaRy-9'), 'no debe filtrar el valor crudo');
    assert.ok(!raw.includes('CaNaRy'), 'no debe filtrar ni un fragmento del valor');
  });

  it('NO devuelve secretos ni credenciales', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'true');
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    const body = await (await callAs(ADMIN)).json();
    const raw = JSON.stringify(body);

    for (const forbidden of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'APOLLO_API_KEY',
      'LUSHA_API_KEY',
      'HUBSPOT',
      'service_role',
      'Bearer ',
      'eyJ',
    ]) {
      assert.ok(!raw.includes(forbidden), `no debe filtrar ${forbidden}`);
    }

    // Se comprueba sobre las CLAVES —incluidas las de los bloques anidados— para
    // que el nombre de un flag (que contiene «ENABLE») no dé un falso positivo.
    const nested = [
      ...Object.keys(body.contactEnrichmentAutomaticRouting),
      ...Object.keys(body.contactEnrichmentLocalReuseGate),
    ];
    for (const key of [...Object.keys(body), ...nested]) {
      assert.doesNotMatch(
        key,
        /api_key|apikey|secret|token|service_role|password|credential/i,
        `clave sospechosa: ${key}`,
      );
    }
  });

  it('NO devuelve PII: ni claves ni datos de candidatos', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'true');
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    const body = await (await callAs(ADMIN)).json();

    const nested = [
      ...Object.keys(body.contactEnrichmentAutomaticRouting),
      ...Object.keys(body.contactEnrichmentLocalReuseGate),
    ];
    for (const key of [...Object.keys(body), ...nested]) {
      assert.doesNotMatch(
        key,
        /candidate|phone_number|email|linkedin|full_name|person_id|contact_id/i,
        `clave con posible PII: ${key}`,
      );
    }

    // Los bloques nuevos son EXCLUSIVAMENTE nombre + dos booleanos: no hay sitio
    // donde pudiera viajar un dato de una persona.
    for (const block of [
      body.contactEnrichmentAutomaticRouting,
      body.contactEnrichmentLocalReuseGate,
    ]) {
      assert.equal(typeof block.flagName, 'string');
      assert.equal(typeof block.configured, 'boolean');
      assert.equal(typeof block.resolved, 'boolean');
      assert.equal(Object.keys(block).length, 3);
    }
  });
});

// ── E · regresión de los campos preexistentes ────────────────────

/**
 * Los tres pares planos que el endpoint ya publicaba deben seguir presentes y
 * significando lo mismo. Añadir observabilidad no puede romper el diagnóstico que
 * ya existía — es el modo de fallo más caro de este cambio, porque dejaría ciego
 * justo al operador que viene a leerlo.
 */
describe('E · los campos preexistentes siguen intactos', () => {
  it('los tres nombres de flag siguen publicándose', async () => {
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.phone_reveal_waterfall_flag_name, PHONE_REVEAL_WATERFALL_FLAG);
    assert.equal(
      body.lusha_phone_reveal_fallback_flag_name,
      LUSHA_PHONE_REVEAL_FALLBACK_FLAG,
    );
    assert.equal(body.search_more_phones_flag_name, SEARCH_MORE_PHONES_FLAG);
  });

  it('los seis booleanos planos siguen presentes y siguen siendo booleanos', async () => {
    const body = await (await callAs(ADMIN)).json();
    for (const key of [
      'phone_reveal_waterfall_flag_configured',
      'phone_reveal_waterfall_enabled_resolved',
      'lusha_phone_reveal_fallback_flag_configured',
      'lusha_phone_reveal_fallback_enabled_resolved',
      'search_more_phones_flag_configured',
      'search_more_phones_enabled_resolved',
    ]) {
      assert.equal(typeof body[key], 'boolean', `falta o cambió de tipo: ${key}`);
    }
    assert.ok('runtime_sha' in body);
    assert.equal(typeof body.config_version, 'string');
    assert.equal(typeof body.diagnosis_timestamp, 'string');
  });

  it('la semántica de los pares preexistentes no cambió: siguen los tres estados', async () => {
    setEnv(PHONE_REVEAL_WATERFALL_FLAG, undefined);
    let body = await (await callAs(ADMIN)).json();
    assert.equal(body.phone_reveal_waterfall_flag_configured, false);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, false);
    restorers.pop()?.();

    setEnv(PHONE_REVEAL_WATERFALL_FLAG, 'false');
    body = await (await callAs(ADMIN)).json();
    assert.equal(body.phone_reveal_waterfall_flag_configured, true);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, false);
    restorers.pop()?.();

    setEnv(PHONE_REVEAL_WATERFALL_FLAG, 'true');
    body = await (await callAs(ADMIN)).json();
    assert.equal(body.phone_reveal_waterfall_flag_configured, true);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, true);
  });

  it('los flags nuevos no arrastran a los preexistentes', async () => {
    setEnv(CONTACT_ENRICHMENT_AUTOMATIC_ROUTING_FLAG, 'true');
    setEnv(CONTACT_ENRICHMENT_LOCAL_REUSE_GATE_FLAG, 'true');
    setEnv(PHONE_REVEAL_WATERFALL_FLAG, 'false');
    setEnv(SEARCH_MORE_PHONES_FLAG, 'false');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.contactEnrichmentAutomaticRouting.resolved, true);
    assert.equal(body.contactEnrichmentLocalReuseGate.resolved, true);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, false);
    assert.equal(body.search_more_phones_enabled_resolved, false);
  });
});
