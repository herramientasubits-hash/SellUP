/**
 * CO — ETL de la web de las empresas del SIIS (SOURCES-CO-CLOSE-1)
 *
 * Escribe `raw_data.website_domain` y `raw_data.website_domain_source` en las
 * filas `co_siis` de `source_company_snapshots`. Sin web, el buscador gratuito
 * manda cada empresa del SIIS a «Descartadas» (02-10-2026: 100 de 100).
 *
 * Entradas (descargas públicas de datos.gov.co, en JSON tal como las da la API):
 *   --secop=<json>             qmzu-gj57 «SECOP II - Proveedores Registrados» (por NIT del SIIS)
 *   --supersociedades=<json>   dd55-74ss «Sujetos obligados» de Supersociedades (por NIT del SIIS)
 *   --siis=<json>              6cat-2gcs «10.000 Empresas más grandes del país» (sólo DRY-RUN:
 *                              nombres para medir sin leer la base)
 *
 * Uso (DRY-RUN por defecto: lee los archivos, cuenta y NO escribe ni lee la base):
 *   npx tsx scripts/source-catalog/run-co-siis-domain-etl.ts --secop=… --supersociedades=… --siis=…
 *
 * Escritura REAL (sólo con autorización explícita de la dueña): añadir --apply.
 * Con --apply lee las filas `co_siis` de la base, calcula el dominio con su razón
 * social y reescribe SÓLO las dos claves de `raw_data` (el resto de la fila queda
 * igual). Una empresa sin dominio queda con `website_domain = null`. Reversible:
 * volver a correr con archivos vacíos de dominio, o quitar las dos claves.
 * Nunca se guardan correos ni contactos: sólo el dominio.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildCoSiisDomainMap,
  type SecopProviderRow,
  type SupersociedadesSubjectRow,
} from '../../src/server/source-catalog/connectors/siis-colombia/co-siis-domain';

const PAGE = 1000;
const SIIS_SOURCE_KEY = 'co_siis';

function value(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function readJsonArray<T>(path: string, label: string): T[] {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${label}_invalido: ${path}`);
  return parsed as T[];
}

type SiisDbRow = { id: string; tax_id: string; legal_name: string | null; raw_data: Record<string, unknown> | null };

/** Todas las filas `co_siis` (10.000), sólo lectura, paginadas por id. */
async function readSiisRows(client: SupabaseClient): Promise<SiisDbRow[]> {
  const out: SiisDbRow[] = [];
  let last = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('id, tax_id, legal_name, raw_data')
      .eq('source_key', SIIS_SOURCE_KEY)
      .eq('country_code', 'CO')
      .gt('id', last)
      .order('id', { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`read_failed_co_siis: ${error.message}`);
    const rows = (data ?? []) as SiisDbRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    last = rows[rows.length - 1].id;
  }
}

function report(map: Map<string, { domain: string; source: string }>, total: number): void {
  const bySource: Record<string, number> = {};
  for (const { source } of map.values()) bySource[source] = (bySource[source] ?? 0) + 1;
  console.log(`  Con web: ${map.size} de ${total} (${((100 * map.size) / Math.max(total, 1)).toFixed(1)} %) · por origen ${JSON.stringify(bySource)}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const secopPath = value(argv, 'secop');
  const superPath = value(argv, 'supersociedades');
  if (!secopPath || !superPath) throw new Error('config_invalid: indica --secop=<json> y --supersociedades=<json>');
  console.log(`CO SIIS DOMAIN ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const secop = readJsonArray<SecopProviderRow>(secopPath, 'secop');
  const supersociedades = readJsonArray<SupersociedadesSubjectRow>(superPath, 'supersociedades');
  console.log(`  SECOP II proveedores: ${secop.length} filas · Supersociedades: ${supersociedades.length} filas`);

  if (!apply) {
    const siisPath = value(argv, 'siis');
    if (!siisPath) throw new Error('config_invalid: en DRY-RUN indica --siis=<json> (no se lee la base)');
    const siisRaw = readJsonArray<Record<string, string>>(siisPath, 'siis');
    // datos.gov.co publica el NIT como número con decimales («901241645.00»).
    const siis = siisRaw.map((r) => ({ nit: String(r['nit'] ?? '').replace(/\.0+$/, ''), legalName: String(r['raz_n_social'] ?? '') }));
    const map = buildCoSiisDomainMap({ siis, secop, supersociedades });
    report(map, new Set(siis.map((s) => s.nit)).size);
    for (const [nit, { domain, source }] of [...map].slice(0, 10)) {
      console.log(`    ${nit} ${siis.find((s) => s.nit.startsWith(nit))?.legalName ?? ''} → ${domain} (${source})`);
    }
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const rows = await readSiisRows(client);
  const map = buildCoSiisDomainMap({
    siis: rows.map((r) => ({ nit: r.tax_id, legalName: r.legal_name ?? '' })),
    secop,
    supersociedades,
  });
  report(map, rows.length);

  let updated = 0;
  for (const row of rows) {
    const hit = map.get(row.tax_id);
    const rawData = {
      ...(row.raw_data ?? {}),
      website_domain: hit?.domain ?? null,
      website_domain_source: hit?.source ?? null,
    };
    const { error } = await client.from('source_company_snapshots').update({ raw_data: rawData }).eq('id', row.id).eq('source_key', SIIS_SOURCE_KEY);
    if (error) throw new Error(`update_failed_${row.id}: ${error.message}`);
    updated += 1;
    if (updated % 1000 === 0) console.log(`    ${updated} filas actualizadas`);
  }
  console.log(`  rowsUpdated = ${updated}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
