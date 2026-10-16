/**
 * Verifica, SOLO LEYENDO, que cada sigla de `co-entity-aliases.ts` resuelve a la
 * entidad correcta en el registro cargado (`co_public_entities` de
 * `source_company_snapshots`): el mismo camino que usa «Proveedores de una empresa»
 * (`buildCoLookups().findPublicEntities` + `pickPublicBuyer`).
 *
 * Para cada entidad dice una de estas cosas:
 *   OK            resuelve a UNA entidad y su NIT es el de la tabla
 *   NIT_DISTINTO  resuelve a otra entidad: la entrada está MAL, hay que quitarla
 *   AMBIGUA       el nombre oficial coincide con varias entidades: el paso no correría
 *   NO_ENCONTRADA el registro no tiene ese nombre (o la lectura falló): quedaría como hoy
 *
 * Uso (no escribe NADA; sólo SELECT sobre `source_company_snapshots`):
 *   ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD=true \
 *     npx tsx scripts/agent1/verify-co-entity-aliases.ts
 *
 * Sale con código 1 si alguna entrada es NIT_DISTINTO (una sigla que llevaría a la
 * entidad equivocada es el único resultado realmente dañino). AMBIGUA y NO_ENCONTRADA
 * no dañan —el paso no corre y todo queda como antes— pero conviene revisarlas.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { createSupabaseAdminClient } from '../../src/lib/supabase/admin';
import { CO_COUNTRY } from '../../src/server/prospect-batches/supplier-search/countries/co';
import { CO_PUBLIC_ENTITY_ALIASES } from '../../src/server/prospect-batches/supplier-search/countries/co-entity-aliases';
import { buildCoLookups } from '../../src/server/prospect-batches/supplier-search/countries/co.server';
import {
  pickPublicBuyer,
  type PublicEntityLookup,
} from '../../src/server/prospect-batches/supplier-search/public-buyer-suppliers';

type Verdict = 'OK' | 'NIT_DISTINTO' | 'AMBIGUA' | 'NO_ENCONTRADA';

async function main(): Promise<void> {
  const lookups = buildCoLookups(createSupabaseAdminClient());
  const normalize = CO_COUNTRY.normalizeBuyerName ?? ((raw: string) => raw);
  const rows: Array<{ verdict: Verdict; siglas: string; esperado: string; obtenido: string }> = [];

  for (const entry of CO_PUBLIC_ENTITY_ALIASES) {
    const found = await lookups.findPublicEntities(normalize(entry.officialName));
    const lookup: PublicEntityLookup = Array.isArray(found) ? { rows: found, truncated: false } : found;
    let verdict: Verdict;
    let obtained = '';
    if (lookup.truncated) {
      verdict = 'AMBIGUA';
      obtained = 'lista cortada por el tope';
    } else {
      const picked = pickPublicBuyer(entry.officialName, lookup.rows, normalize);
      if (picked.entity !== null) {
        obtained = `${picked.entity.taxId} ${picked.entity.normalizedLegalName}`;
        verdict = picked.entity.taxId === entry.nit ? 'OK' : 'NIT_DISTINTO';
      } else if (picked.reason === 'ambiguous_entity') {
        verdict = 'AMBIGUA';
        obtained = `${lookup.rows.length} candidatas`;
      } else {
        verdict = 'NO_ENCONTRADA';
      }
    }
    rows.push({ verdict, siglas: entry.aliases.join(' / '), esperado: `${entry.nit} ${entry.officialName}`, obtenido: obtained });
  }

  const count = (v: Verdict) => rows.filter((row) => row.verdict === v).length;
  console.log(
    `Entidades: ${rows.length} · OK ${count('OK')} · NIT_DISTINTO ${count('NIT_DISTINTO')} · AMBIGUA ${count('AMBIGUA')} · NO_ENCONTRADA ${count('NO_ENCONTRADA')}`,
  );
  for (const row of rows.filter((r) => r.verdict !== 'OK')) {
    console.log(`\n${row.verdict}  ${row.siglas}\n  esperado: ${row.esperado}\n  obtenido: ${row.obtenido || '—'}`);
  }
  if (count('NIT_DISTINTO') > 0) process.exit(1);
}

main().catch((error) => {
  console.error('[verify-co-entity-aliases]', error instanceof Error ? error.message : error);
  process.exit(2);
});
