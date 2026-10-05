/**
 * PA PanamaCompra — ETL del RUC de personas jurídicas (SOURCES-PA-RUC-BY-NAME-1)
 *
 * Lee (sólo lectura) el buscador público de proveedores de PanamaCompraEnCifras y
 * carga en `source_company_snapshots` (source_key='pa_panamacompra_ruc_registry')
 * una fila por RUC de PERSONA JURÍDICA (nunca cédulas de personas naturales).
 *
 * El buscador devuelve como mucho 10.000 resultados por consulta: se pide la lista
 * sin filtro (20 páginas de 500) y, además, filtrada por forma societaria
 * («S.A», «INC», «CORP», «CONSORCIO», «LTD», «S. DE R»), con 2 s entre peticiones.
 *
 * Uso (DRY-RUN por defecto: consulta, cuenta y NO escribe):
 *   npx tsx scripts/source-catalog/run-pa-panamacompra-ruc-etl.ts
 *
 * Escritura REAL (sólo con autorización explícita de la dueña):
 *   npx tsx scripts/source-catalog/run-pa-panamacompra-ruc-etl.ts --apply
 *
 * Certificado: el servidor no envía su certificado intermedio (RapidSSL TLS RSA
 * CA G1, de DigiCert), así que Node no puede verificarlo. NUNCA se desactiva la
 * verificación: se le pasa a Node el intermedio oficial, bajado de la dirección que
 * trae el propio certificado (http://cacerts.rapidssl.com/RapidSSLTLSRSACAG1.crt):
 *   curl -so g1.der http://cacerts.rapidssl.com/RapidSSLTLSRSACAG1.crt
 *   openssl x509 -inform DER -in g1.der -out g1.pem
 *   NODE_EXTRA_CA_CERTS=g1.pem npx tsx scripts/source-catalog/run-pa-panamacompra-ruc-etl.ts
 *
 * Guardrails: dry-run por defecto; `--apply` escribe SÓLO source_key=
 * 'pa_panamacompra_ruc_registry'; `assertLargeImportAllowed` antes de escribir.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createClient } from '@supabase/supabase-js';
// CLI-only: Node < 22 no trae WebSocket global y el cliente de Supabase lo necesita.
import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';

import {
  buildPaPanamaCompraRucRows,
  PA_PANAMACOMPRA_RUC_SOURCE_KEY,
  parsePanamaCompraSupplier,
  type PaPanamaCompraSupplier,
} from '../../src/server/source-catalog/connectors/panamacompra-pa/pa-panamacompra-ruc-rows';
import { RECORD_IDENTITY_ON_CONFLICT } from '../../src/server/source-catalog/record-identity';
import { assertLargeImportAllowed } from '../../src/server/source-catalog/large-import-guardrail';

const ENDPOINT = 'https://v2.panamacompraencifras.gob.pa/backend/suppliers?format=json';
const PAGE_SIZE = 500;
const PAUSE_MS = 2_000;
const FILTERS = ['', 'S.A', 'INC', 'CORP', 'CONSORCIO', 'LTD', 'S. DE R'];
const UPSERT_CHUNK = 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchSuppliers(): Promise<PaPanamaCompraSupplier[]> {
  const suppliers: PaPanamaCompraSupplier[] = [];
  for (const filter of FILTERS) {
    for (let page = 1; ; page++) {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ supplier: filter, page, paginateBy: PAGE_SIZE }),
      });
      const body = (await response.json().catch(() => null)) as {
        results?: unknown[];
        pagination?: { has_next?: boolean };
      } | null;
      await sleep(PAUSE_MS);
      // Pasado el tope de 10.000 el buscador responde un aviso sin `results`: se para ahí.
      if (!response.ok || !body || !Array.isArray(body.results)) break;
      for (const result of body.results) {
        const supplier = parsePanamaCompraSupplier(result);
        if (supplier !== null) suppliers.push(supplier);
      }
      console.log(`  «${filter || '(todos)'}» página ${page}: ${body.results.length}`);
      if (!body.pagination?.has_next) break;
    }
  }
  return suppliers;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`PA PANAMACOMPRA RUC ETL — ${apply ? 'APPLY' : 'DRY-RUN (no escribe)'}`);

  const suppliers = await fetchSuppliers();
  const rows = buildPaPanamaCompraRucRows(suppliers, {
    sourceYear: new Date().getUTCFullYear(),
    importedAt: new Date().toISOString(),
  }).filter((row) => row.record_identity_key !== null);
  const cores = new Map<string, number>();
  for (const row of rows) cores.set(row.normalized_legal_name, (cores.get(row.normalized_legal_name) ?? 0) + 1);
  const unique = rows.filter((row) => cores.get(row.normalized_legal_name) === 1).length;

  console.log(`  Proveedores leídos: ${suppliers.length}`);
  console.log(`  Personas jurídicas con RUC: ${rows.length}`);
  console.log(`  Con nombre único (RUC asignable con seguridad): ${unique} (${((100 * unique) / Math.max(rows.length, 1)).toFixed(1)} %)`);

  if (!apply) {
    console.log('  DRY-RUN: no se escribió nada. Usa --apply (con autorización) para persistir.');
    return;
  }

  assertLargeImportAllowed({
    sourceKey: PA_PANAMACOMPRA_RUC_SOURCE_KEY,
    countryCode: 'PA',
    estimatedRows: rows.length,
    isDryRun: false,
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('supabase_service_role_not_configured');
  ensureNode20WebSocketShim();
  const client = createClient(url, key);

  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await client
      .from('source_company_snapshots')
      .upsert(chunk, { onConflict: RECORD_IDENTITY_ON_CONFLICT });
    if (error) throw new Error(`upsert_failed_at_offset_${i}: ${error.message}`);
    upserted += chunk.length;
  }
  console.log(`  rowsUpserted = ${upserted}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
