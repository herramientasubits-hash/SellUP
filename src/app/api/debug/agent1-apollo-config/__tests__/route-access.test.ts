/**
 * Tests de ACCESO y SANITIZACIÓN — GET /api/debug/agent1-apollo-config
 * (A1-APOLLO-TWO-ROUND-QA-READINESS-1 § 2).
 *
 * Los tests preexistentes (`route.test.ts`) cubren los resolvers puros que el
 * endpoint emite. Estos cubren lo que faltaba: quién puede leerlo y qué NO
 * puede salir por él.
 *
 * Tres casos exigidos por el § 2:
 *   admin           → diagnóstico sanitizado
 *   no autenticado  → rechazo
 *   autenticado sin rol admin → rechazo
 *
 * Sin llamadas a Apollo, sin créditos, sin escrituras.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

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
 * La sesión y la credencial se simulan UNA vez; cada caso sólo cambia el estado
 * que el stub devuelve. `mock.module` no admite re-mockear el mismo especificador
 * dentro del mismo proceso, así que la mutabilidad vive en el stub, no en el mock.
 *
 * `hasApolloApiKey` devuelve un booleano, nunca la clave — que es exactamente el
 * contrato que el endpoint debe respetar.
 */
let currentSupabase: SupabaseStub = stubSupabase({ user: null, isAdmin: false });

mock.module('@/lib/supabase/server', {
  namedExports: { createClient: async () => currentSupabase },
});
mock.module('@/server/services/apollo-connection', {
  namedExports: { hasApolloApiKey: async () => true },
});

async function loadRoute(supabase: SupabaseStub) {
  currentSupabase = supabase;
  return import('../route');
}

describe('§ 2 · acceso al diagnóstico runtime', () => {
  it('no autenticado → 401, sin cuerpo de diagnóstico', async () => {
    const { GET } = await loadRoute(stubSupabase({ user: null, isAdmin: false }));
    const response = await GET();

    assert.strictEqual(response.status, 401);
    const body = await response.json();
    assert.strictEqual(body.agent1_provider_resolved, undefined);
    assert.ok(body.error);
  });

  it('autenticado sin rol admin → 403, sin cuerpo de diagnóstico', async () => {
    const { GET } = await loadRoute(stubSupabase({ user: { id: 'u-1' }, isAdmin: false }));
    const response = await GET();

    assert.strictEqual(response.status, 403);
    const body = await response.json();
    assert.strictEqual(body.apollo_company_search_enabled_resolved, undefined);
  });

  it('is_admin ilegible (null) → rechazo: falla cerrado', async () => {
    const { GET } = await loadRoute(stubSupabase({ user: { id: 'u-1' }, isAdmin: null }));
    const response = await GET();
    assert.strictEqual(response.status, 403);
  });

  it('admin → 200 con TODOS los campos que el § 2 exige', async () => {
    const { GET } = await loadRoute(stubSupabase({ user: { id: 'u-1' }, isAdmin: true }));
    const response = await GET();

    assert.strictEqual(response.status, 200);
    const body = await response.json();

    const requiredFields = [
      'agent1_provider_resolved',
      'agent1_provider_reason',
      'apollo_company_search_enabled_resolved',
      'apollo_two_round_discovery_enabled_resolved',
      'wizard_run_provider_override_enabled_resolved',
      'apollo_target_eligible_companies_resolved',
      'apollo_max_search_rounds_resolved',
      'apollo_max_results_per_round_resolved',
      'apollo_max_raw_results_per_run_resolved',
      'apollo_max_enrichments_per_run_resolved',
    ];
    for (const field of requiredFields) {
      assert.ok(field in body, `falta el campo ${field}`);
      assert.notStrictEqual(body[field], undefined, `${field} es undefined`);
    }
  });

  it('admin → los cinco topes de dos rondas salen como enteros resueltos', async () => {
    const { GET } = await loadRoute(stubSupabase({ user: { id: 'u-1' }, isAdmin: true }));
    const body = await (await GET()).json();

    for (const field of [
      'apollo_target_eligible_companies_resolved',
      'apollo_max_search_rounds_resolved',
      'apollo_max_results_per_round_resolved',
      'apollo_max_raw_results_per_run_resolved',
      'apollo_max_enrichments_per_run_resolved',
    ]) {
      assert.ok(Number.isInteger(body[field]), `${field} no es un entero: ${body[field]}`);
    }
    // Ningún tope puede superar el techo absoluto que vive en el código.
    assert.ok(body.apollo_max_search_rounds_resolved <= 2);
    assert.ok(body.apollo_max_results_per_round_resolved <= 5);
    assert.ok(body.apollo_max_raw_results_per_run_resolved <= 10);
    assert.ok(body.apollo_max_enrichments_per_run_resolved <= 2);
    assert.ok(body.apollo_target_eligible_companies_resolved <= 5);
  });

  it('admin → el cuerpo no filtra secretos', async () => {
    const { GET } = await loadRoute(stubSupabase({ user: { id: 'u-1' }, isAdmin: true }));
    const body = await (await GET()).json();

    // La presencia de credencial se reporta como booleano, nunca como valor.
    assert.strictEqual(typeof body.has_apollo_api_key, 'boolean');

    // Se inspeccionan los VALORES, no los nombres de campo: `has_apollo_api_key`
    // es un nombre legítimo, y buscar la subcadena en la serialización completa
    // sólo probaría que nadie nombró un campo "api_key".
    const values: unknown[] = [];
    const collect = (node: unknown): void => {
      if (node !== null && typeof node === 'object') {
        Object.values(node as Record<string, unknown>).forEach(collect);
        return;
      }
      values.push(node);
    };
    collect(body);

    for (const value of values) {
      if (typeof value !== 'string') continue;
      // El único string largo legítimo es el timestamp ISO del diagnóstico.
      if (value === body.diagnosis_timestamp) continue;
      assert.ok(
        value.length <= 64,
        `valor sospechosamente largo en el diagnóstico: ${value.slice(0, 24)}…`,
      );
      assert.doesNotMatch(
        value,
        /bearer |sk-|service_role|eyJ[A-Za-z0-9_-]{10,}/i,
        `el diagnóstico expone un valor con forma de credencial: ${value.slice(0, 24)}…`,
      );
    }
    // Tampoco se emiten valores crudos de entorno: sólo enteros y etiquetas de origen.
    for (const source of Object.values(body.apollo_two_round_config_sources ?? {})) {
      assert.ok(
        ['default', 'env_override', 'env_clamped_to_absolute_max', 'env_invalid_fallback_default'].includes(
          source as string,
        ),
        `origen inesperado: ${String(source)}`,
      );
    }
  });
});
