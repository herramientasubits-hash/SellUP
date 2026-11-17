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

  it('las lecturas del navegador van por la ruta, no por acciones del servidor', () => {
    const actions = read('src/modules/hubspot-lookup/actions.ts');
    assert.doesNotMatch(actions, /export async function (lookup|search|get)\w*/);
    assert.match(read('src/modules/hubspot-lookup/client.ts'), /\/api\/hubspot-lookup/);
  });
});
