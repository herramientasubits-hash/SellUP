// AGENT2A-LINKEDIN-CONTACT-SEARCH (F2) — la URL de LinkedIn no va a logs ni al registro de uso.
//
// Prueba estática sobre el código de la búsqueda por LinkedIn: ningún `console.*` y la metadata
// del uso de proveedores no lleva la URL ni el slug.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FILES = [
  'src/modules/contact-enrichment/linkedin-profile-url.ts',
  'src/modules/contact-enrichment/linkedin-preview-token.ts',
  'src/modules/contact-enrichment/linkedin-contact-search-core.ts',
  'src/modules/contact-enrichment/linkedin-contact-search-providers.server.ts',
  'src/modules/contact-enrichment/linkedin-contact-search-actions.ts',
  'src/components/contact-enrichment/contact-enrichment-linkedin-search.tsx',
  'src/components/contact-enrichment/linkedin-candidate-company-dialog.tsx',
];

function code(file: string): string {
  // Sin comentarios: sólo lo que se ejecuta.
  return readFileSync(join(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('búsqueda por LinkedIn · datos personales', () => {
  it('ningún archivo escribe en consola', () => {
    for (const file of FILES) assert.equal(/console\.(log|info|warn|error|debug)/.test(code(file)), false, file);
  });

  it('el registro de uso de proveedores no lleva la URL ni el slug', () => {
    const actions = code('src/modules/contact-enrichment/linkedin-contact-search-actions.ts');
    const logBlock = actions.slice(actions.indexOf('async logUsage('), actions.indexOf('signPreview:'));
    assert.ok(logBlock.includes('logProviderUsage('));
    assert.equal(/linkedin(Url|_url|Slug)|canonicalUrl|slug/i.test(logBlock.replace(/entry_mode: 'linkedin_single'/, '')), false);
  });

  it('un error inesperado no reenvía el mensaje crudo (podría citar la URL)', () => {
    const actions = code('src/modules/contact-enrichment/linkedin-contact-search-actions.ts');
    assert.equal(/catch \((err|error|e)\)/.test(actions), false);
  });
});
