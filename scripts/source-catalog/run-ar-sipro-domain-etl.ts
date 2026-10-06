/**
 * AR — dominio corporativo desde el SIPRO histórico (SOURCES-AR-SIPRO-DOMAIN-1)
 *
 * Añade `raw_data.website_domain` a las filas del buscador gratuito de Argentina
 * (`ar_rns` y `ar_atp_employers`) cuya CUIT tiene un correo corporativo en el
 * SIPRO histórico y su dominio se parece a la razón social (`ar-sipro-domain.ts`).
 * Archivo público (datos.gob.ar, CC-BY 4.0) que el operador descarga antes:
 *
 *   https://infra.datos.gob.ar/catalog/modernizacion/dataset/2/distribution/2.12/download/proveedores-sistema-legacy.csv
 *
 * Uso (DRY-RUN por defecto: lee, cruza, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-ar-sipro-domain-etl.ts --sipro-legacy=<csv>
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   … --apply
 *
 * Guardrails:
 *   - Sólo `ar_rns` y `ar_atp_employers`; sólo cambia `raw_data.website_domain`
 *     (y `raw_data.website_domain_source`) de las filas cuyo dominio cambia.
 *   - Nunca guarda correos, teléfonos ni direcciones.
 *   - Reversible: correr con un archivo vacío deja `website_domain = null`.
 *   - No llama a ningún proveedor.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';
import {
  buildArSiproDomainMap,
  domainMatchesCurrentArName,
} from '../../src/server/source-catalog/connectors/rns-argentina/ar-sipro-domain';

const SOURCE_KEYS = ['ar_rns', 'ar_atp_employers'] as const;
const DOMAIN_SOURCE = 'sipro_legacy_email';
const PAGE = 1000;

type Row = { id: string; normalized_tax_id: string | null; legal_name: string | null; raw_data: Record<string, unknown> | null };

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const path = argv.find((a) => a.startsWith('--sipro-legacy='))?.slice('--sipro-legacy='.length);
  if (!path) throw new Error('config_invalid: falta --sipro-legacy=<csv>');
  const apply = argv.includes('--apply');
  console.log(`AR dominio SIPRO histórico — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const rows: Record<string, string>[] = [];
  for await (const row of readCsvFile(path)) rows.push(row);
  if (rows.length === 0 || !('email' in rows[0]) || !('cuit' in rows[0])) {
    throw new Error('sipro_csv_invalido: el archivo no trae las columnas cuit / email');
  }
  const domains = buildArSiproDomainMap(rows);
  console.log(`  Filas SIPRO histórico: ${rows.length} · CUIT con dominio aceptado: ${domains.size}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  for (const sourceKey of SOURCE_KEYS) {
    const snapshot: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('source_company_snapshots')
        .select('id, normalized_tax_id, legal_name, raw_data')
        .eq('source_key', sourceKey)
        .eq('country_code', 'AR')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`read_failed_${sourceKey}_${from}: ${error.message}`);
      snapshot.push(...((data ?? []) as Row[]));
      if (!data || data.length < PAGE) break;
    }

    const planned = snapshot.map((row) => {
      const raw = row.raw_data ?? {};
      const before = typeof raw['website_domain'] === 'string' ? raw['website_domain'] : null;
      const candidate = (row.normalized_tax_id && domains.get(row.normalized_tax_id)) || null;
      // El dominio también tiene que parecerse al nombre ACTUAL de la sociedad.
      const after = candidate !== null && domainMatchesCurrentArName(candidate, row.legal_name) ? candidate : null;
      return { row, raw, before, candidate, after };
    });
    const changes = planned.filter((c) => c.before !== c.after);
    const inSipro = planned.filter((c) => c.candidate !== null).length;
    const accepted = planned.filter((c) => c.after !== null).length;

    console.log(
      `  ${sourceKey}: ${snapshot.length} filas · dominio en SIPRO ${inSipro} · ` +
        `aceptado con el nombre actual ${accepted} · a cambiar ${changes.length}`,
    );
    for (const c of planned.filter((p) => p.candidate !== null && p.after === null).slice(0, 5)) {
      console.log(`    descartado por nombre actual: ${c.row.legal_name} ✗ ${c.candidate}`);
    }
    for (const c of changes.slice(0, 8)) console.log(`    ${c.row.legal_name} → ${c.after}`);

    if (!apply) continue;
    let updated = 0;
    for (const c of changes) {
      const { error } = await client
        .from('source_company_snapshots')
        .update({
          raw_data: {
            ...c.raw,
            website_domain: c.after,
            website_domain_source: c.after === null ? null : DOMAIN_SOURCE,
          },
        })
        .eq('id', c.row.id)
        .eq('source_key', sourceKey);
      if (error) throw new Error(`update_failed_${sourceKey}_${updated}: ${error.message}`);
      updated++;
    }
    console.log(`  ${sourceKey}: rowsUpdated = ${updated}`);
  }

  if (!apply) console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
