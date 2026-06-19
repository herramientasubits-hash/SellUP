/**
 * Fedesoft Connector — Sample Dry Run
 *
 * Ejecuta el conector completo en memoria.
 * No escribe en Supabase. No modifica datos.
 */

import { runFedesoftConnector } from '../../src/server/source-catalog/connectors/fedesoft-colombia';

async function main() {
  console.log('Fedesoft Connector Sample\n');

  const result = await runFedesoftConnector({ perPage: 100, maxPages: 5 });

  const matched = result.companies.filter(
    (c) => c.matchSource === 'directory_and_member_table',
  );
  const directoryOnly = result.companies.filter(
    (c) => c.matchSource === 'directory_only',
  );
  const memberTableOnly = result.companies.filter(
    (c) => c.matchSource === 'member_table_only',
  );
  const withNit = result.companies.filter((c) => c.normalizedTaxId !== null);
  const withoutNit = result.companies.filter((c) => c.normalizedTaxId === null);

  console.log(`Listings REST: ${result.listings.length}`);
  console.log(`Members table: ${result.members.length}`);
  console.log(`Categories: ${result.categoriesById.size}`);
  console.log(`Locations: ${result.locationsById.size}`);
  console.log(`Companies built: ${result.companies.length}`);
  console.log(`Matched directory + member table: ${matched.length}`);
  console.log(`Directory only: ${directoryOnly.length}`);
  console.log(`Member table only: ${memberTableOnly.length}`);
  console.log(`With NIT: ${withNit.length}`);
  console.log(`Without NIT: ${withoutNit.length}`);

  console.log('\nCategory names:');
  for (const [id, name] of result.categoriesById) {
    console.log(`  ${id}: ${name}`);
  }

  console.log('\nLocation names:');
  for (const [id, name] of result.locationsById) {
    console.log(`  ${id}: ${name}`);
  }

  console.log('\nSample (5 companies):');
  const sample = result.companies.slice(0, 5);
  for (const c of sample) {
    console.log(`  - name: ${c.name}`);
    console.log(`    nit: ${c.taxId}`);
    console.log(`    categories: ${c.categories.join(', ')}`);
    console.log(`    locations: ${c.locations.join(', ')}`);
    console.log(`    matchSource: ${c.matchSource}`);
    console.log('');
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
