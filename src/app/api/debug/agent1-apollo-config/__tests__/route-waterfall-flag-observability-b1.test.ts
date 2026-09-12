/**
 * route-waterfall-flag-observability-b1.test.ts
 *
 * AGENT1-WATERFALL-FLAG-OBSERVABILITY-B1 — el diagnóstico admin-only publica el
 * ESTADO RESUELTO de `ENABLE_AGENT1_APOLLO_LUSHA_WATERFALL`, nunca su valor.
 *
 * Por qué existe: en Vercel la variable es `type: sensitive`, así que desde fuera
 * no se puede leer. Sin estos dos campos, la única forma de saber si el waterfall
 * está encendido en Producción era ejecutar una corrida y mirar si nacía una
 * pierna Lusha — es decir, GASTAR CRÉDITOS para responder una pregunta de
 * configuración, justo antes de la certificación.
 *
 * Lo que fija cada bloque (y la mutación que mata):
 *   A · presencia ⇒ configured=true, sin revelar el valor.
 *   B · ausencia  ⇒ configured=false.
 *   C · enabled=true SÓLO con el token exacto `true` (trim + lowercase).
 *       Mata «devolver process.env directamente»: ` TrUe ` es true para la
 *       autoridad y false para una comparación cruda.
 *   D · `false`, `1`, `yes`, `on`, vacío y ausente ⇒ enabled=false.
 *       Mata «hardcodear enabled=true» y «quitar el fail-closed» (que haría
 *       enabled=configured).
 *   E · el valor crudo NUNCA sale en el cuerpo, ni normalizado.
 *   F · sigue siendo admin-only: 401 / 403 no ven ninguno de los dos campos.
 *   G · guarda estática (con comentarios ELIMINADOS): el endpoint no lee
 *       `process.env` de la bandera; invoca las dos funciones de autoridad.
 *   H · leer el diagnóstico no muta el entorno ni el resultado de la autoridad.
 *
 * 0 llamadas a proveedor · 0 créditos · 0 Supabase real · 0 escrituras ·
 * 0 migraciones · 0 cambios de bandera.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  AGENT1_APOLLO_LUSHA_WATERFALL_FLAG,
  isAgent1ApolloLushaWaterfallEnabled,
  isAgent1ApolloLushaWaterfallFlagConfigured,
} from '@/lib/feature-flags.server';

const CONFIGURED_FIELD = 'agent1_apollo_lusha_waterfall_flag_configured';
const ENABLED_FIELD = 'agent1_apollo_lusha_waterfall_enabled_resolved';

type SupabaseStub = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  rpc: (fn: string, args: unknown) => Promise<{ data: unknown }>;
};

function stubSupabase(options: { user: { id: string } | null; isAdmin: unknown }): SupabaseStub {
  return {
    auth: { getUser: async () => ({ data: { user: options.user } }) },
    rpc: async () => ({ data: options.isAdmin }),
  };
}

/**
 * `mock.module` no admite re-mockear el mismo especificador dentro del proceso,
 * así que el estado de sesión vive en el stub y no en el mock. `hasApolloApiKey`
 * devuelve un booleano: el endpoint nunca ve la credencial.
 */
let currentSupabase: SupabaseStub = stubSupabase({ user: null, isAdmin: false });

/**
 * Los mocks se registran contra la RUTA REAL del módulo, no contra el alias
 * `@/…`: `mock.module` resuelve el especificador con el resolutor de Node, que
 * en Node 20 no conoce los alias de tsconfig y aborta el fichero entero. Con la
 * ruta resuelta la suite corre igual en Node 20 (local) y en Node 24 (CI), que es
 * la única forma de que «verde en local» signifique algo.
 */
const fromHere = (relative: string): string =>
  pathToFileURL(path.join(import.meta.dirname, relative)).href;

mock.module(fromHere('../../../../../lib/supabase/server.ts'), {
  namedExports: { createClient: async () => currentSupabase },
});
mock.module(fromHere('../../../../../server/services/apollo-connection.ts'), {
  namedExports: { hasApolloApiKey: async () => false },
});

const ADMIN = stubSupabase({ user: { id: 'admin-1' }, isAdmin: true });

/** Fija la bandera (o la borra), corre, y restaura exactamente lo que había. */
async function withFlag<T>(raw: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env[AGENT1_APOLLO_LUSHA_WATERFALL_FLAG];
  if (raw === undefined) {
    delete process.env[AGENT1_APOLLO_LUSHA_WATERFALL_FLAG];
  } else {
    process.env[AGENT1_APOLLO_LUSHA_WATERFALL_FLAG] = raw;
  }
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[AGENT1_APOLLO_LUSHA_WATERFALL_FLAG];
    } else {
      process.env[AGENT1_APOLLO_LUSHA_WATERFALL_FLAG] = previous;
    }
  }
}

async function readDiagnostics(
  raw: string | undefined,
  supabase: SupabaseStub = ADMIN,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return withFlag(raw, async () => {
    currentSupabase = supabase;
    const { GET } = await import('../route');
    const response = await GET();
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });
}

describe('B-1 · A/B — presencia de la bandera, nunca su valor', () => {
  it('A · variable presente ⇒ configured=true', async () => {
    const { status, body } = await readDiagnostics('true');
    assert.equal(status, 200);
    assert.equal(body[CONFIGURED_FIELD], true);
  });

  it('A · presente con un valor que NO la enciende ⇒ configured=true igualmente', async () => {
    const { body } = await readDiagnostics('false');
    assert.equal(body[CONFIGURED_FIELD], true, 'presencia y activación son preguntas distintas');
    assert.equal(body[ENABLED_FIELD], false);
  });

  it('B · variable ausente ⇒ configured=false', async () => {
    const { body } = await readDiagnostics(undefined);
    assert.equal(body[CONFIGURED_FIELD], false);
    assert.equal(body[ENABLED_FIELD], false);
  });

  it('B · variable vacía / sólo espacios ⇒ configured=false (no cuenta como definida)', async () => {
    for (const raw of ['', '   ']) {
      const { body } = await readDiagnostics(raw);
      assert.equal(body[CONFIGURED_FIELD], false, `"${raw}" no debería contar como configurada`);
      assert.equal(body[ENABLED_FIELD], false);
    }
  });
});

describe('B-1 · C/D — enabled refleja EXACTAMENTE el parser fail-closed', () => {
  /**
   * Tokens que la autoridad SÍ acepta. ` TrUe ` es el caso que mata la mutación
   * «comparar `process.env.X === "true"` a pelo».
   */
  for (const raw of ['true', 'TRUE', ' true ', ' TrUe ']) {
    it(`C · "${raw}" ⇒ enabled=true`, async () => {
      const { body } = await readDiagnostics(raw);
      assert.equal(body[ENABLED_FIELD], true, `"${raw}" debería resolverse como encendida`);
      assert.equal(body[CONFIGURED_FIELD], true);
    });
  }

  for (const raw of ['false', 'FALSE', ' false ', '1', '0', 'yes', 'no', 'on', 'off', 'true!', 'truthy']) {
    it(`D · "${raw}" ⇒ enabled=false`, async () => {
      const { body } = await readDiagnostics(raw);
      assert.equal(body[ENABLED_FIELD], false, `"${raw}" NO debería encender el waterfall`);
    });
  }

  it('D · ausente ⇒ enabled=false (default fail-closed intacto)', async () => {
    const { body } = await readDiagnostics(undefined);
    assert.equal(body[ENABLED_FIELD], false);
  });

  it('D · configured=true con token inválido NO implica enabled=true', async () => {
    const { body } = await readDiagnostics('yes');
    assert.equal(body[CONFIGURED_FIELD], true);
    assert.equal(body[ENABLED_FIELD], false, 'enabled no puede ser un alias de configured');
  });

  it('C/D · los dos campos son booleanos, nunca strings ni null', async () => {
    for (const raw of ['true', 'false', 'yes', undefined]) {
      const { body } = await readDiagnostics(raw);
      assert.equal(typeof body[CONFIGURED_FIELD], 'boolean');
      assert.equal(typeof body[ENABLED_FIELD], 'boolean');
    }
  });

  it('C/D · el endpoint dice lo MISMO que la autoridad, token a token', async () => {
    for (const raw of ['true', ' TrUe ', 'false', 'yes', '', undefined]) {
      const { body } = await readDiagnostics(raw);
      const [authorityEnabled, authorityConfigured] = await withFlag(raw, async () => [
        isAgent1ApolloLushaWaterfallEnabled(),
        isAgent1ApolloLushaWaterfallFlagConfigured(),
      ]);
      assert.equal(body[ENABLED_FIELD], authorityEnabled, `enabled discrepa para "${raw}"`);
      assert.equal(body[CONFIGURED_FIELD], authorityConfigured, `configured discrepa para "${raw}"`);
    }
  });
});

describe('B-1 · E — el valor crudo nunca sale del endpoint', () => {
  it('E · ningún campo contiene el valor crudo ni su normalización', async () => {
    const sentinel = ' YeS-Sentinel-RAW-9f3c ';
    const { body } = await readDiagnostics(sentinel);
    const serialized = JSON.stringify(body);

    for (const forbidden of [sentinel, sentinel.trim(), sentinel.trim().toLowerCase()]) {
      assert.ok(
        !serialized.includes(forbidden),
        `el diagnóstico filtró el valor crudo de la bandera: ${forbidden}`,
      );
    }
    assert.ok(!serialized.includes('Sentinel'), 'se filtró una porción del valor crudo');
    assert.equal(body[CONFIGURED_FIELD], true);
    assert.equal(body[ENABLED_FIELD], false);
  });

  it('E · tampoco sale el valor cuando la bandera SÍ está encendida', async () => {
    const { body } = await readDiagnostics(' TrUe ');
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('TrUe'), 'se filtró el valor crudo en mayúsculas/minúsculas');
    assert.ok(
      !serialized.includes(AGENT1_APOLLO_LUSHA_WATERFALL_FLAG),
      'el nombre de la variable de entorno tampoco se publica',
    );
  });
});

describe('B-1 · F — sigue siendo admin-only', () => {
  it('F · no autenticado ⇒ 401 y ninguno de los dos campos', async () => {
    const { status, body } = await readDiagnostics(
      'true',
      stubSupabase({ user: null, isAdmin: true }),
    );
    assert.equal(status, 401);
    assert.equal(CONFIGURED_FIELD in body, false);
    assert.equal(ENABLED_FIELD in body, false);
  });

  it('F · autenticado sin rol admin ⇒ 403 y ninguno de los dos campos', async () => {
    const { status, body } = await readDiagnostics(
      'true',
      stubSupabase({ user: { id: 'u-2' }, isAdmin: false }),
    );
    assert.equal(status, 403);
    assert.equal(CONFIGURED_FIELD in body, false);
    assert.equal(ENABLED_FIELD in body, false);
  });

  it('F · is_admin ilegible (null) ⇒ 403: falla cerrado', async () => {
    const { status, body } = await readDiagnostics(
      'true',
      stubSupabase({ user: { id: 'u-3' }, isAdmin: null }),
    );
    assert.equal(status, 403);
    assert.equal(ENABLED_FIELD in body, false);
  });
});

describe('B-1 · G/H — autoridad única y lectura sin efectos', () => {
  /** Elimina comentarios: nombrar la variable en una explicación no es leerla. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  const routeSource = stripComments(
    readFileSync(path.join(import.meta.dirname, '..', 'route.ts'), 'utf8'),
  );

  it('G · el endpoint NO lee process.env de la bandera del waterfall', async () => {
    assert.ok(
      !routeSource.includes(AGENT1_APOLLO_LUSHA_WATERFALL_FLAG),
      'el endpoint cita la variable de entorno en código ejecutable',
    );
    assert.doesNotMatch(
      routeSource,
      /process\.env\[[^\]]*WATERFALL[^\]]*\]/,
      'el endpoint indexa process.env con la bandera del waterfall',
    );
  });

  it('G · el endpoint invoca las DOS funciones de autoridad', () => {
    assert.match(routeSource, /isAgent1ApolloLushaWaterfallFlagConfigured\(\)/);
    assert.match(routeSource, /isAgent1ApolloLushaWaterfallEnabled\(\)/);
  });

  it('H · leer el diagnóstico no muta el entorno ni la decisión de la autoridad', async () => {
    await withFlag('true', async () => {
      const before = process.env[AGENT1_APOLLO_LUSHA_WATERFALL_FLAG];
      const enabledBefore = isAgent1ApolloLushaWaterfallEnabled();

      currentSupabase = ADMIN;
      const { GET } = await import('../route');
      await GET();

      assert.equal(process.env[AGENT1_APOLLO_LUSHA_WATERFALL_FLAG], before);
      assert.equal(isAgent1ApolloLushaWaterfallEnabled(), enabledBefore);
    });
  });
});
