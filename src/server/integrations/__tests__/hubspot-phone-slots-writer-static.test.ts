/**
 * AGENT2A-HUBSPOT-PHONE-SLOTS-ORDER — guarda estática del escritor de HubSpot.
 *
 * `fillEmptyHubSpotContactProperties` es el único PATCH de «completar vacíos». Debe:
 *   1. descartar los campos de teléfono APAGADOS (`company_phone`, `telefono_2` hoy), aunque un
 *      llamador se los pase;
 *   2. ante un 400, reintentar UNA vez sin las propiedades opcionales (LinkedIn y los campos de
 *      teléfono adicionales), para que nunca impidan que `phone` / `mobilephone` lleguen.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SOURCE = readFileSync(path.resolve(process.cwd(), 'src/server/integrations/hubspot-contact-sync.ts'), 'utf8');

function fillWriterBody(): string {
  const start = SOURCE.indexOf('export async function fillEmptyHubSpotContactProperties(');
  assert.ok(start >= 0, 'existe fillEmptyHubSpotContactProperties');
  const end = SOURCE.indexOf('\nexport ', start + 10);
  return SOURCE.slice(start, end === -1 ? undefined : end);
}

describe('escritor de completar vacíos (AGENT2A-HUBSPOT-PHONE-SLOTS-ORDER)', () => {
  it('filtra los campos no escribibles antes de armar el PATCH', () => {
    assert.match(fillWriterBody(), /if \(!isHubSpotFillPropertyWritable\(name\)\) continue;/);
  });

  it('el reintento ante 400 quita LinkedIn y los campos de teléfono adicionales', () => {
    const optional = SOURCE.match(/HUBSPOT_FILL_OPTIONAL_PROPERTY_NAMES[^=]*=\s*\[([^\]]*)\]/);
    assert.ok(optional, 'existe la lista de opcionales');
    for (const name of ['hs_linkedin_url', 'company_phone', 'telefono_2']) {
      assert.ok(optional[1].includes(`'${name}'`), `${name} es opcional`);
    }
    assert.ok(!optional[1].includes("'phone'") && !optional[1].includes("'mobilephone'"), 'phone / mobilephone nunca se quitan');
    assert.match(fillWriterBody(), /first\.status === 400 && optionalSent\.length > 0/);
  });
});
