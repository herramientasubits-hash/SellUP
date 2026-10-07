/**
 * El rescate con Claude también corre SIN sesión de usuario: las vueltas en cadena
 * llegan por `/api/cron/claude-rescue-continuation` (CRON_SECRET), sin cookies.
 *
 * Prod 06-10 (sesión de Perú, lote e963023c): el catálogo de industrias se leía con
 * el cliente de SESIÓN; la vista `active_macro_industry_catalog` es security_invoker
 * y sus tablas sólo se leen como `authenticated` ⇒ sin sesión volvía vacía ⇒
 * `catalog_unavailable` en todas las vueltas extra. Ahora el rescate inyecta el
 * cliente de servicio. Sin red ni base: el cliente es un doble.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadActiveDiscoveryCatalog } from '@/modules/industry-catalog/discovery-catalog-loader';

/** Doble mínimo del cliente: responde la vista del catálogo macro. */
function fakeServiceClient() {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      return {
        select: async () => ({
          data: [
            {
              catalog_version: '2.0.0',
              industry_id: 'tec',
              industry_name: 'Tecnología',
              industry_slug: 'technology',
              industry_description: null,
              industry_sort_order: 1,
              has_active_subindustries: false,
            },
          ],
          error: null,
        }),
      };
    },
  };
  return { client: client as unknown as SupabaseClient, tables };
}

describe('catálogo del rescate sin sesión', () => {
  it('con un cliente inyectado, lee con ÉSE (no con la sesión) y devuelve las industrias', async () => {
    const { client, tables } = fakeServiceClient();
    const catalog = await loadActiveDiscoveryCatalog(client);
    assert.deepEqual(tables, ['active_macro_industry_catalog']);
    assert.equal(catalog.version, '2.0.0');
    assert.deepEqual(catalog.industries.map((i) => i.name), ['Tecnología']);
  });

  it('el rescate en vivo carga el catálogo con el cliente de servicio', () => {
    const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(
      readFileSync(
        join(process.cwd(), 'src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server.ts'),
        'utf8',
      ),
    );
    assert.match(code, /loadCatalog: \(\) => loadClassifierCatalog\(createSupabaseAdminClient\(\)\)/);
    // Ninguna dependencia del rescate usa el cliente de sesión.
    assert.doesNotMatch(code, /from '@\/lib\/supabase\/server'/);
  });
});
