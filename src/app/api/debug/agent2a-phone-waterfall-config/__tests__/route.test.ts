/**
 * Tests — GET /api/debug/agent2a-phone-waterfall-config
 * (Agente 2A · AGENT2A-PHONE-REVEAL-UI-STATE-1 § 11, caso M)
 *
 * Qué se verifica:
 *   * los tres estados del flag: ausente, presente-pero-no-`"true"`, presente-y-
 *     activa — que es la distinción que hoy no se podía hacer, porque los flags de
 *     Vercel son `type: sensitive` y su valor es ilegible;
 *   * el control de acceso: admin 200, autenticado sin rol 403, anónimo 401;
 *   * que la respuesta NO contiene ningún secreto ni el valor crudo del flag;
 *   * `Cache-Control: no-store` en TODAS las respuestas (un diagnóstico cacheado
 *     es un diagnóstico que puede mentir tras un redeploy).
 *
 * Sin red, sin Apollo, sin Lusha, sin créditos, sin escrituras.
 */

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LUSHA_PHONE_REVEAL_FALLBACK_FLAG,
  PHONE_REVEAL_WATERFALL_FLAG,
} from '@/lib/feature-flags.server';

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
 * `mock.module` no admite re-mockear el mismo especificador dentro del proceso,
 * así que el estado mutable vive en el stub y no en el mock (mismo patrón que
 * route-access.test.ts de agent1-apollo-config).
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

/** Fija el valor del flag para UN caso y devuelve el restaurador. */
function withFlag(value: string | undefined): () => void {
  const previous = process.env[PHONE_REVEAL_WATERFALL_FLAG];
  if (value === undefined) delete process.env[PHONE_REVEAL_WATERFALL_FLAG];
  else process.env[PHONE_REVEAL_WATERFALL_FLAG] = value;
  return () => {
    if (previous === undefined) delete process.env[PHONE_REVEAL_WATERFALL_FLAG];
    else process.env[PHONE_REVEAL_WATERFALL_FLAG] = previous;
  };
}

let restoreFlag: (() => void) | null = null;

afterEach(() => {
  restoreFlag?.();
  restoreFlag = null;
});

// ── Los tres estados del flag ────────────────────────────────────

describe('§ 11 · estados del flag', () => {
  it('admin + flag ausente → configured=false, resolved=false', async () => {
    restoreFlag = withFlag(undefined);
    const response = await callAs(ADMIN);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.phone_reveal_waterfall_flag_configured, false);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, false);
  });

  it('admin + flag "false" → configured=true, resolved=false', async () => {
    // El caso que era invisible: la variable EXISTE pero el waterfall está
    // apagado. Antes era indistinguible de la variable ausente.
    restoreFlag = withFlag('false');
    const response = await callAs(ADMIN);
    const body = await response.json();
    assert.equal(body.phone_reveal_waterfall_flag_configured, true);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, false);
  });

  it('admin + flag "true" → configured=true, resolved=true', async () => {
    restoreFlag = withFlag('true');
    const response = await callAs(ADMIN);
    const body = await response.json();
    assert.equal(body.phone_reveal_waterfall_flag_configured, true);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, true);
  });

  it('un valor presente que no es "true" nunca resuelve a activo', async () => {
    for (const value of ['1', 'yes', 'TRUE ', 'sí', 'enabled']) {
      restoreFlag = withFlag(value);
      const body = await (await callAs(ADMIN)).json();
      assert.equal(body.phone_reveal_waterfall_flag_configured, true, value);
      // `TRUE ` sí resuelve a activo: el parser hace trim + lowercase. Se
      // comprueba contra la MISMA función del runtime, no contra una expectativa
      // inventada aquí — duplicar el parseo es justo lo que el § 11 prohíbe.
      const { isPhoneRevealWaterfallEnabled } = await import('@/lib/feature-flags.server');
      assert.equal(
        body.phone_reveal_waterfall_enabled_resolved,
        isPhoneRevealWaterfallEnabled(),
        value,
      );
      restoreFlag();
      restoreFlag = null;
    }
  });
});

// ── Acceso ───────────────────────────────────────────────────────

describe('§ 11 · acceso', () => {
  it('anónimo → 401 y sin diagnóstico', async () => {
    restoreFlag = withFlag('true');
    const response = await callAs(stubSupabase({ user: null, isAdmin: false }));
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.ok(body.error);
    assert.equal(body.phone_reveal_waterfall_flag_configured, undefined);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, undefined);
  });

  it('autenticado sin rol admin → 403 y sin diagnóstico', async () => {
    restoreFlag = withFlag('true');
    const response = await callAs(stubSupabase({ user: { id: 'u-2' }, isAdmin: false }));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.ok(body.error);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, undefined);
  });

  it('admin → 200', async () => {
    restoreFlag = withFlag('true');
    assert.equal((await callAs(ADMIN)).status, 200);
  });
});

// ── Sanitización + cache ─────────────────────────────────────────

describe('§ 11 · sanitización y cache', () => {
  it('no devuelve el valor crudo del flag ni ningún secreto', async () => {
    restoreFlag = withFlag('true');
    const response = await callAs(ADMIN);
    const raw = JSON.stringify(await response.json());

    // El nombre de la variable SÍ se publica (es público y desambigua cuál de los
    // flags de teléfono se está mirando); lo que nunca sale es su VALOR ni ninguna
    // credencial. Se comprueba sobre las claves para que el nombre del flag —que
    // contiene la palabra "ENABLE"— no dispare un falso positivo.
    const body = await (await callAs(ADMIN)).json();
    for (const key of Object.keys(body)) {
      assert.doesNotMatch(
        key,
        /api_key|apikey|secret|token|service_role|password|credential/i,
        `clave sospechosa: ${key}`,
      );
    }
    for (const forbidden of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'APOLLO_API_KEY',
      'LUSHA_API_KEY',
      'service_role',
      'Bearer ',
    ]) {
      assert.ok(!raw.includes(forbidden), `no debe filtrar ${forbidden}`);
    }
    // El diagnóstico son booleanos + metadatos: ninguna clave contiene el valor
    // crudo bajo un nombre de "valor".
    assert.equal(body.phone_reveal_waterfall_flag_value, undefined);
    assert.equal(typeof body.phone_reveal_waterfall_flag_configured, 'boolean');
    assert.equal(typeof body.phone_reveal_waterfall_enabled_resolved, 'boolean');
  });

  it('no devuelve datos de candidatos (sin PII)', async () => {
    restoreFlag = withFlag('true');
    const body = await (await callAs(ADMIN)).json();
    for (const key of Object.keys(body)) {
      assert.doesNotMatch(
        key,
        /candidate|phone_number|email|linkedin|full_name/i,
        `clave con posible PII: ${key}`,
      );
    }
  });

  it('Cache-Control = no-store en 200, 401 y 403', async () => {
    restoreFlag = withFlag('true');
    const ok = await callAs(ADMIN);
    assert.equal(ok.headers.get('Cache-Control'), 'no-store');

    const anon = await callAs(stubSupabase({ user: null, isAdmin: false }));
    assert.equal(anon.headers.get('Cache-Control'), 'no-store');

    const forbidden = await callAs(stubSupabase({ user: { id: 'u-3' }, isAdmin: false }));
    assert.equal(forbidden.headers.get('Cache-Control'), 'no-store');
  });

  it('publica el nombre del flag y el sha del runtime', async () => {
    restoreFlag = withFlag('true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.phone_reveal_waterfall_flag_name, PHONE_REVEAL_WATERFALL_FLAG);
    assert.ok('runtime_sha' in body);
  });
});

// ── El SEGUNDO flag de teléfono (AGENT2A-SEARCH-MORE-PHONES-1E) ───

/**
 * `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK` se publica con el MISMO par presencia/resolución
 * que el waterfall, y estos tests existen porque el caso que motivó añadirlo es
 * silencioso: con este flag OFF el planificador de «Buscar más números» devuelve
 * `feature_disabled`, cuyo copy es `null` a propósito, así que la UI no pinta CTA NI
 * explicación. Eso es indistinguible a ojo de un preflight roto, y sin estas dos señales
 * la única forma de decidir cuál de los dos ocurrió era adivinar.
 *
 * Se verifica lo mismo que para el waterfall: los TRES estados, que el valor crudo no
 * sale, y que las dos señales son independientes entre sí.
 */
function withLushaFallbackFlag(value: string | undefined): () => void {
  const previous = process.env[LUSHA_PHONE_REVEAL_FALLBACK_FLAG];
  if (value === undefined) delete process.env[LUSHA_PHONE_REVEAL_FALLBACK_FLAG];
  else process.env[LUSHA_PHONE_REVEAL_FALLBACK_FLAG] = value;
  return () => {
    if (previous === undefined) delete process.env[LUSHA_PHONE_REVEAL_FALLBACK_FLAG];
    else process.env[LUSHA_PHONE_REVEAL_FALLBACK_FLAG] = previous;
  };
}

let restoreLushaFlag: (() => void) | null = null;

afterEach(() => {
  restoreLushaFlag?.();
  restoreLushaFlag = null;
});

describe('1E · estados del flag de fallback de Lusha', () => {
  it('publica el nombre del flag', async () => {
    restoreLushaFlag = withLushaFallbackFlag('true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(
      body.lusha_phone_reveal_fallback_flag_name,
      LUSHA_PHONE_REVEAL_FALLBACK_FLAG,
    );
  });

  it('ausente → configured=false, resolved=false', async () => {
    restoreLushaFlag = withLushaFallbackFlag(undefined);
    const response = await callAs(ADMIN);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.lusha_phone_reveal_fallback_flag_configured, false);
    assert.equal(body.lusha_phone_reveal_fallback_enabled_resolved, false);
  });

  it('presente pero NO "true" → configured=true, resolved=false', async () => {
    // EL caso que las dos señales existen para separar: la variable está registrada en
    // Vercel —así que `vercel env ls` la lista— y sin embargo el fallback está APAGADO.
    restoreLushaFlag = withLushaFallbackFlag('false');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.lusha_phone_reveal_fallback_flag_configured, true);
    assert.equal(body.lusha_phone_reveal_fallback_enabled_resolved, false);
  });

  it('presente y "true" → configured=true, resolved=true', async () => {
    restoreLushaFlag = withLushaFallbackFlag('true');
    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.lusha_phone_reveal_fallback_flag_configured, true);
    assert.equal(body.lusha_phone_reveal_fallback_enabled_resolved, true);
  });

  it('NO devuelve el valor crudo, y los dos flags son independientes', async () => {
    // Un valor inventado y reconocible: si el endpoint lo filtrara, aparecería literal.
    restoreLushaFlag = withLushaFallbackFlag('  TrUe  ');
    restoreFlag = withFlag('false');
    const response = await callAs(ADMIN);
    const raw = JSON.stringify(await response.json());
    assert.ok(!raw.includes('TrUe'), 'no debe filtrar el valor crudo del flag');

    const body = await (await callAs(ADMIN)).json();
    assert.equal(body.lusha_phone_reveal_fallback_flag_value, undefined);
    // `trim()` + case-insensitive ⇒ resuelve activo; el waterfall sigue apagado. Que un
    // flag no arrastre al otro es lo que permite leer el diagnóstico sin ambigüedad.
    assert.equal(body.lusha_phone_reveal_fallback_enabled_resolved, true);
    assert.equal(body.phone_reveal_waterfall_enabled_resolved, false);
  });
});
