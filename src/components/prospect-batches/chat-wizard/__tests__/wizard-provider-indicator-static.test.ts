/**
 * A1-APOLLO-WIZARD-1 — pruebas estáticas de la FUENTE DE VERDAD del indicador.
 *
 * El hallazgo de QA visual no se arregla sólo pintando una etiqueta: la etiqueta
 * tiene que venir de la resolución real del backend. Estas pruebas de texto
 * fuente sostienen esa cadena contra ediciones futuras:
 *
 *   1. El panel servidor resuelve el proveedor con `resolveWizardDiscoveryProvider()`
 *      — la MISMA función que enruta `executeProspectWizardGeneration` — y lo pasa
 *      hacia abajo como prop.
 *   2. El drawer sólo lo transporta (import de TIPO, nada ejecutable).
 *   3. El wizard cliente no lee env ni flags: recibe el valor y lo reduce con el
 *      módulo puro.
 *   4. La presentación no contiene nombres de env vars, flags, roles ni claves.
 *
 * Sin DOM, sin red, sin base de datos.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  panel: join(ROOT, 'src/components/prospects/prospects-module-panel.tsx'),
  drawer: join(ROOT, 'src/components/prospect-batches/generate-ai-batch-drawer.tsx'),
  wizard: join(ROOT, 'src/components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx'),
  row: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-provider-indicator.tsx'),
  presentation: join(
    ROOT,
    'src/components/prospect-batches/chat-wizard/wizard-provider-execution-summary.ts',
  ),
  resolution: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-provider-indicator.ts',
  ),
  executionAction: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
  ),
};

const src = Object.fromEntries(
  Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf-8')]),
) as Record<keyof typeof FILES, string>;

/** Quita comentarios para que la prosa no satisfaga una aserción de código. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('1 — el proveedor se resuelve en el servidor', () => {
  it('el panel servidor llama al resolutor canónico', () => {
    assert.match(stripComments(src.panel), /resolveWizardDiscoveryProvider\(\)/);
  });

  it('el panel pasa el proveedor resuelto al drawer', () => {
    assert.match(src.panel, /discoveryProvider=\{wizardDiscoveryProvider\}/);
  });

  it('es la misma función que enruta la ejecución real', () => {
    // Si la ejecución dejara de usar este resolutor, el indicador podría mentir.
    assert.match(stripComments(src.executionAction), /resolveWizardDiscoveryProvider/);
  });
});

describe('2 — el drawer sólo transporta el valor', () => {
  it('lo reenvía al wizard sin interpretarlo', () => {
    assert.match(src.drawer, /<ProspectChatWizard[\s\S]*?discoveryProvider=\{discoveryProvider\}/);
  });

  it('importa el resolutor sólo como tipo (nada ejecutable en el cliente)', () => {
    const imports = [
      ...src.drawer.matchAll(
        /import\s+(type\s+)?\{[^}]*\}\s+from\s+'([^']*wizard-provider-resolver)'/g,
      ),
    ];
    assert.equal(imports.length, 1, 'exactamente un import del resolutor');
    assert.ok(imports[0][1], 'debe ser `import type`');
  });

  it('no resuelve el proveedor por su cuenta', () => {
    assert.doesNotMatch(stripComments(src.drawer), /resolveWizardDiscoveryProvider\(/);
  });
});

describe('3 — el wizard cliente no infiere el proveedor', () => {
  it('recibe el proveedor como prop', () => {
    assert.match(src.wizard, /discoveryProvider\?:\s*WizardDiscoveryProviderKey\s*\|\s*null/);
  });

  it('renderiza la fila del indicador', () => {
    assert.match(src.wizard, /<WizardProviderIndicatorRow indicator=\{providerIndicator\}/);
  });

  it('reduce el estado con el módulo puro, sin lógica propia de flags', () => {
    assert.match(src.wizard, /resolveWizardProviderIndicator\(/);
    assert.match(src.wizard, /serverDiscoveryProvider:\s*discoveryProvider/);
  });

  it('el nombre del proveedor omitido viene del backend, no de un supuesto', () => {
    assert.match(src.wizard, /setSkippedProvider\(result\.providerSkipped\.provider\)/);
  });

  it('no lee env ni flags en el cliente', () => {
    const code = stripComments(src.wizard);
    assert.doesNotMatch(code, /process\.env/);
    assert.doesNotMatch(code, /NEXT_PUBLIC_/);
    assert.doesNotMatch(code, /ENABLE_/);
    assert.doesNotMatch(code, /isApolloCompanySearchEnabled/);
  });

  it('la fila es un componente tonto: no resuelve nada', () => {
    const code = stripComments(src.row);
    assert.doesNotMatch(code, /process\.env/);
    assert.doesNotMatch(code, /ENABLE_/);
    assert.doesNotMatch(code, /resolveWizardDiscoveryProvider/);
  });
});

describe('4 — la presentación no expone detalle técnico', () => {
  it('el prefijo visible es el acordado', () => {
    assert.match(src.presentation, /'Proveedor de búsqueda'/);
  });

  it('los nombres mostrados son comerciales, no claves internas', () => {
    const map = src.presentation.match(/PROVIDER_DISPLAY_NAMES[\s\S]*?\};/);
    assert.ok(map, 'mapa de nombres encontrado');
    assert.match(map![0], /tavily:\s*'Tavily'/);
    assert.match(map![0], /apollo_organizations:\s*'Apollo'/);
    assert.match(map![0], /lusha:\s*'Lusha'/);
  });

  it('ninguna copy del indicador nombra env vars, flags, roles ni credenciales', () => {
    const literals = [...src.presentation.matchAll(/'([^']{4,})'/g)].map((m) => m[1]);
    for (const literal of literals) {
      for (const forbidden of [
        /ENABLE_/,
        /AGENT1_/,
        /api[\s_-]?key/i,
        /\btoken\b/i,
        /\bvault\b/i,
        /\badmin\b/i,
      ]) {
        assert.doesNotMatch(literal, forbidden, `copy filtra detalle técnico: ${literal}`);
      }
    }
  });

  it('la resolución pura no lee env ni hace I/O', () => {
    const code = stripComments(src.resolution);
    assert.doesNotMatch(code, /process\.env/);
    assert.doesNotMatch(code, /fetch\(/);
    assert.doesNotMatch(code, /createClient/);
  });
});
