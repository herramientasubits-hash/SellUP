// FEEDBACK 29-10 — la búsqueda por NIT en HubSpot usaba propiedades que NO existen en el
// portal de UBITS (`nit`, `identificacion_fiscal`…) ⇒ HTTP 400 ⇒ empresas «sin verificar».
// Los nombres internos reales son `identificaci_n_fiscal`, `rfc_mx_` y `doc_identificacion_fiscal`.
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUBSPOT_FISCAL_PROPERTIES } from '../fiscal-duplicate-classification';

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');

describe('propiedades fiscales de HubSpot', () => {
  it('la revisión de duplicados busca en las propiedades REALES y en ≤ 5 grupos (límite de HubSpot)', () => {
    assert.deepEqual([...HUBSPOT_FISCAL_PROPERTIES], ['identificaci_n_fiscal', 'rfc_mx_', 'doc_identificacion_fiscal']);
    assert.ok(HUBSPOT_FISCAL_PROPERTIES.length <= 5);
  });

  it('el verificador comercial (capa gratuita, fuentes oficiales) busca el NIT en `identificaci_n_fiscal`', () => {
    const src = read('hubspot-commercial-checker.ts');
    assert.match(src, /const HUBSPOT_NIT_PROPERTY = 'identificaci_n_fiscal';/);
    assert.doesNotMatch(src, /propertyName: 'nit'/);
    // Con y sin dígito de verificación, como la revisión de duplicados.
    assert.match(src, /buildFiscalLookupNeedles\(\[nit\], countryCode\)/);
    assert.match(src, /operator: 'IN'/);
  });

  it('una empresa LIBRE en HubSpot no se resume como «no encontrada en HubSpot»', () => {
    const src = read('duplicate-checker.ts');
    assert.match(src, /ya está en HubSpot, libre \(/);
    assert.match(src, /summary: freeSummary \?\? summary/);
  });
});
