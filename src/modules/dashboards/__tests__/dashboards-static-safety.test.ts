// TABLEROS-1 — Guardas estáticas de /dashboards.
//
// 🔴 Los tableros SÓLO LEEN y cada lectura va limitada al alcance de quien mira
// ANTES de pedir las filas (un BD nunca recibe filas de otra persona). El
// navegador nunca recibe correos ni teléfonos: sólo si un dato existe o no.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const QUERIES = 'src/modules/dashboards/dashboard-queries.server.ts';
const CORE = 'src/modules/dashboards/dashboard-core.ts';
const PAGE_DIR = 'src/app/(sellup)/dashboards';

describe('dashboard-queries.server — sólo lee y siempre con alcance', () => {
  const code = stripComments(read(QUERIES));

  it('es sólo de servidor', () => {
    assert.match(code, /^import 'server-only';/m);
  });

  it('no escribe: ni insert, ni update, ni upsert, ni delete, ni rpc', () => {
    for (const verb of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
      assert.doesNotMatch(code, new RegExp(`\\.${verb}\\(`), `.${verb}( no puede aparecer`);
    }
  });

  it('cada lectura principal va limitada a las personas del alcance por su columna de autoría', () => {
    const scopedColumns = [...code.matchAll(/readScoped<\w+>\(userIds, '([^']+)'/g)].map((match) => match[1]);
    assert.deepEqual(scopedColumns.sort(), [
      'created_by',
      'metadata->hubspot_enrichment_request->>requested_by',
      'reviewed_by',
      'reviewed_by',
      'triggered_by',
    ]);
  });

  it('no lee antes del lanzamiento ni del corte de visibilidad', () => {
    assert.match(code, /clampToVisibleSince\(range\.fromIso\)/);
    assert.match(code, /resolveDashboardRange\(filters, today\)/);
  });

  it('el alcance sale del alcance comercial de siempre', () => {
    assert.match(code, /resolveCommercialScope\(\)/);
    assert.match(code, /resolveDashboardAudience\(/);
  });
});

describe('el navegador nunca recibe datos de contacto', () => {
  it('las filas de contacto del núcleo sólo dicen si hay correo, teléfono o LinkedIn', () => {
    const core = stripComments(read(CORE));
    for (const name of ['ContactCandidateRow', 'LinkedContactRow']) {
      const body = core.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
      assert.ok(body, `no se encontró ${name}`);
      assert.doesNotMatch(body, /\b(email|phone|mobilePhone|linkedinUrl)\s*:/, `${name} no lleva datos de contacto`);
      assert.match(body, /hasPhone: boolean/);
    }
  });

  it('ningún archivo de la página usa el cliente de servicio ni las lecturas directas', () => {
    for (const file of readdirSync(join(repoRoot, PAGE_DIR))) {
      if (!/\.tsx?$/.test(file)) continue;
      const body = read(join(PAGE_DIR, file));
      assert.doesNotMatch(body, /@\/lib\/supabase\/admin/, `${file} no puede usar el cliente de servicio`);
      if (/^["']use client["']/m.test(body)) {
        assert.doesNotMatch(body, /dashboard-queries\.server/, `${file} es de cliente: no puede importar las lecturas`);
      }
    }
  });
});
