/**
 * AR — recalcula la macro industria GUARDADA con la tabla vigente
 * (SOURCES-AR-E2E-1).
 *
 * El buscador gratuito de Argentina filtra por `raw_data->>macro_industry_key`,
 * que se escribió al cargar. Cuando la tabla aprobada cambia (v1 → v2:
 * informática → Tecnología, equipo médico → Salud), las filas ya cargadas siguen
 * con la macro vieja: el adapter las rechaza al pedir Retail, pero nunca las lee
 * al pedir Tecnología o Salud. Este script las pone al día sin recargar el RNS.
 *
 * Uso (DRY-RUN por defecto: lee y cuenta, NO escribe):
 *   npx tsx scripts/source-catalog/run-ar-macro-remap.ts [--source=ar_rns]
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   … --apply
 *
 * Guardrails:
 *   - Sólo `ar_rns` o `ar_atp_employers`; sólo cambia `raw_data.macro_industry_key`
 *     y `raw_data.macro_table_version` de las filas cuya macro cambia.
 *   - No toca otras columnas, otras fuentes, cuentas ni candidatos.
 *   - Reversible: volver a correrlo con la tabla anterior.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  AR_RNS_MACRO_TABLE_VERSION,
  resolveArActivityMacro,
} from '../../src/server/prospect-batches/country-source-discovery/ar-rns-macro-table';

const ALLOWED_SOURCES = new Set(['ar_rns', 'ar_atp_employers']);
const PAGE = 1000;

type Row = { id: string; raw_data: Record<string, unknown> | null };

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const source = (argv.find((a) => a.startsWith('--source='))?.slice(9) ?? 'ar_rns').trim();
  if (!ALLOWED_SOURCES.has(source)) throw new Error(`config_invalid: --source debe ser ${[...ALLOWED_SOURCES].join(' | ')}`);
  const apply = argv.includes('--apply');
  console.log(`AR macro remap (${source}) — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'} · tabla ${AR_RNS_MACRO_TABLE_VERSION}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('source_company_snapshots')
      .select('id, raw_data')
      .eq('source_key', source)
      .eq('country_code', 'AR')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read_failed_at_${from}: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }

  const changes = rows
    .map((row) => {
      const raw = row.raw_data ?? {};
      const code = typeof raw['actividad_codigo'] === 'string' ? raw['actividad_codigo'] : null;
      const before = (raw['macro_industry_key'] as string | null | undefined) ?? null;
      const after = resolveArActivityMacro(code);
      return { row, raw, before, after };
    })
    .filter((c) => c.before !== c.after);

  const moves = new Map<string, number>();
  for (const c of changes) {
    const label = `${c.before ?? '(sin macro)'} → ${c.after ?? '(sin macro)'}`;
    moves.set(label, (moves.get(label) ?? 0) + 1);
  }
  console.log(`  Filas leídas: ${rows.length} · a cambiar: ${changes.length}`);
  for (const [label, n] of [...moves].sort((a, b) => b[1] - a[1])) console.log(`    ${label}: ${n}`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  let updated = 0;
  for (const c of changes) {
    const { error } = await client
      .from('source_company_snapshots')
      .update({
        raw_data: { ...c.raw, macro_industry_key: c.after, macro_table_version: AR_RNS_MACRO_TABLE_VERSION },
      })
      .eq('id', c.row.id)
      .eq('source_key', source);
    if (error) throw new Error(`update_failed_at_${updated}: ${error.message}`);
    updated++;
  }
  console.log(`  rowsUpdated = ${updated}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
