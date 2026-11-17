/**
 * Consulta de HubSpot desde SellUp — resguardo estático: 0 escrituras en HubSpot.
 *
 *  - Los módulos de la consulta no importan nada que cree o actualice en HubSpot.
 *  - «Traer a SellUp» no agenda el completado de perfil (escribe país/industria en
 *    HubSpot y puede usar Claude): la resolución con `hubspot_lookup_import` lo salta.
 *  - Las lecturas van por la ruta (no por acciones del servidor, que hacen cola).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

const LOOKUP_FILES = [
  'src/server/integrations/hubspot-lookup/hubspot-lookup-core.ts',
  'src/server/integrations/hubspot-lookup/hubspot-lookup.server.ts',
  'src/server/integrations/hubspot-lookup/hubspot-properties-core.ts',
  'src/components/hubspot/hubspot-properties-section.tsx',
  'src/components/hubspot/hubspot-page-panels.tsx',
  'src/modules/hubspot-lookup/actions.ts',
  'src/modules/hubspot-lookup/lookup.server.ts',
  'src/modules/hubspot-lookup/presence.server.ts',
  'src/modules/hubspot-lookup/client.ts',
  'src/app/api/hubspot-lookup/route.ts',
];

const HUBSPOT_WRITERS = [
  /updateHubSpot\w*/,
  /createHubSpot\w*/,
  /associateHubSpot\w*/,
  /fillEmptyHubSpot\w*/,
  /syncContactToHubSpot/,
  /scheduleAccountProfileCompletion/,
  /method:\s*['"](PATCH|PUT|DELETE)['"]/,
];

describe('consulta de HubSpot: 0 escrituras en HubSpot', () => {
  for (const file of LOOKUP_FILES) {
    it(`${file} no escribe en HubSpot`, () => {
      const source = read(file);
      for (const writer of HUBSPOT_WRITERS) {
        assert.doesNotMatch(source, writer, `${file} usa ${writer}`);
      }
    });
  }

  it('los POST a HubSpot son sólo búsquedas y lecturas por lotes', () => {
    const source = read('src/server/integrations/hubspot-lookup/hubspot-lookup.server.ts');
    const posts = [...source.matchAll(/hubspotPost\(\s*token,\s*([^,]+),/g)].map((m) => m[1].trim());
    assert.ok(posts.length > 0);
    for (const target of posts) {
      assert.match(target, /\/search'|batch\/read/, `POST inesperado a ${target}`);
    }
  });

  it('traer a SellUp no agenda el completado de perfil (escritura en HubSpot + Claude)', () => {
    const deps = read('src/server/agents/contact-enrichment-toolkit/hubspot-account-resolution-deps.ts');
    assert.match(deps, /skipProfileCompletion\s*=\s*createdFrom\s*===\s*'hubspot_lookup_import'/);
    assert.match(deps, /if\s*\(!skipProfileCompletion\)\s*scheduleAccountProfileCompletion\(/);
    assert.match(read('src/modules/hubspot-lookup/actions.ts'), /'hubspot_lookup_import'/);
  });

  it('la búsqueda en todo SellUp sólo lee: reutiliza las lecturas de cada lista y va por su ruta', () => {
    const records = read('src/modules/global-search/records.server.ts');
    // No consulta tablas por su cuenta: todo pasa por las lecturas de cada lista.
    assert.doesNotMatch(records, /\.from\(|\.(insert|update|upsert)\(|\.rpc\(/);
    for (const reader of ['getGlobalCandidatesList', 'getDiscardedProspectsList', 'getSearchesForViewer', 'searchContactCandidatesForGlobalSearch']) {
      assert.match(records, new RegExp(reader), `records.server debe reutilizar ${reader}`);
    }
    assert.match(read('src/modules/global-search/client.ts'), /\/api\/search\/records/);
    assert.match(read('src/app/api/search/records/route.ts'), /resolveActiveInternalUserId/);
  });

  it('las lecturas del navegador van por la ruta, no por acciones del servidor', () => {
    const actions = read('src/modules/hubspot-lookup/actions.ts');
    assert.doesNotMatch(actions, /export async function (lookup|search|get)\w*/);
    assert.match(read('src/modules/hubspot-lookup/client.ts'), /\/api\/hubspot-lookup/);
  });

  it('las páginas completas de empresa y de contacto también traen lo de HubSpot (dueña 17-11)', () => {
    const accountPage = read('src/app/(sellup)/accounts/[accountId]/page.tsx');
    for (const piece of ['AccountHubSpotActivity', 'AccountHubSpotContacts', 'AccountHubSpotData']) {
      assert.match(accountPage, new RegExp(`<${piece}|${piece}`), `la página de empresa debe usar ${piece}`);
    }
    const contactPage = read('src/app/(sellup)/contacts/[contactId]/page.tsx');
    assert.match(contactPage, /<ContactHubSpotActivity/);
    assert.match(contactPage, /<ContactHubSpotData/);
  });

  it('los datos de HubSpot van plegados en Resumen, no en una pestaña más (dueña 17-11: ya no cabía)', () => {
    for (const file of [
      'src/components/accounts/account-detail-sheet.tsx',
      'src/components/contacts/contact-detail-sheet.tsx',
      'src/components/hubspot/hubspot-company-preview-sheet.tsx',
      'src/components/hubspot/hubspot-contact-preview-sheet.tsx',
      'src/components/hubspot/hubspot-page-panels.tsx',
    ]) {
      const source = read(file);
      assert.match(source, /HubSpotPropertiesDisclosure/, `${file} debe usar el bloque plegado`);
      assert.doesNotMatch(source, /HUBSPOT_DATA_TAB/, `${file} no debe tener la pestaña de datos de HubSpot`);
    }
    assert.doesNotMatch(read('src/app/(sellup)/accounts/[accountId]/page.tsx'), /label: 'HubSpot'/);
  });
});
