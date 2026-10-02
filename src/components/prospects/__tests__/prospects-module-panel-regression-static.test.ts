// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — Test O: "Por revisar" must keep
// working exactly as before. `ProspectsModulePanel` is an async React Server
// Component with heavy Supabase/feature-flag dependencies, so a full render
// test is out of scope here (no RSC test harness in this repo) — this is a
// structural/static guard instead:
//
//   1. The new "Descartadas" branch is gated on the EXACT string
//      `params.view === 'descartadas'` — any other value (including the
//      absence of `view`, which is the historical default) falls through to
//      the untouched legacy code below it.
//   2. The branch is placed BEFORE every existing line of the function so
//      the legacy code path is reached completely unmodified (no interleaving).
//   3. The legacy "Por revisar" render (`<ProspectsDataTableClient ... />`)
//      is still present, unedited in its own call.
//
// AGENT1-DISCARDED-TAB-PARITY-1 — "Descartadas" dejó de ser una sub-pestaña y
// no puede volver a serlo. Desde que la navegación entre vistas vive en el
// menú lateral, ningún panel pinta pestañas de módulo: el título dice la vista
// y las migas, el módulo.
//
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PANEL_PATH = path.join(__dirname, '..', 'prospects-module-panel.tsx');

describe('ProspectsModulePanel — "Por revisar" regression guard (Test O)', () => {
  const content = readFileSync(PANEL_PATH, 'utf8');

  it('branches to Descartadas on the exact literal, not a loose truthy check', () => {
    assert.match(content, /if\s*\(\s*params\.view\s*===\s*'descartadas'\s*\)\s*\{/);
  });

  it('the Descartadas branch appears before requireActiveUser-adjacent legacy logic resumes', () => {
    const branchIndex = content.indexOf("params.view === 'descartadas'");
    const legacyFlagLine = content.indexOf('isProspectChatWizardEnabled()');
    assert.ok(branchIndex >= 0 && legacyFlagLine >= 0);
    assert.ok(
      branchIndex < legacyFlagLine,
      'the Descartadas branch must short-circuit BEFORE the legacy flag-resolution logic runs',
    );
  });

  it('still renders ProspectsDataTableClient for the default ("Por revisar") path', () => {
    assert.ok(content.includes('<ProspectsDataTableClient'));
  });

  it('still passes the same candidates/sourceId/scope props to ProspectsDataTableClient', () => {
    const clientCallIndex = content.indexOf('<ProspectsDataTableClient');
    const clientCallBlock = content.slice(clientCallIndex, clientCallIndex + 400);
    for (const prop of ['candidates=', 'sourceId=', 'scopeFilterOptions=', 'currentUserId=']) {
      assert.ok(clientCallBlock.includes(prop), `expected prop ${prop} to still be passed`);
    }
  });

  it('getGlobalCandidatesList is still called with the historical default statuses fallback', () => {
    assert.match(content, /statuses = \['needs_review', 'generated', 'normalized'\]/);
  });
});

describe('Módulo Empresas — sin pestañas de página (la navegación vive en el menú lateral)', () => {
  const content = readFileSync(PANEL_PATH, 'utf8');
  const discardedPanel = readFileSync(
    path.join(__dirname, '..', 'discarded-prospects-panel.tsx'),
    'utf8',
  );
  const accountsPage = readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', '(sellup)', 'accounts', 'page.tsx'),
    'utf8',
  );

  it('ningún panel del módulo pinta pestañas de módulo ni sub-pestañas', () => {
    for (const [name, source] of [
      ['prospects-module-panel', content],
      ['discarded-prospects-panel', discardedPanel],
      ['accounts/page', accountsPage],
    ] as const) {
      assert.ok(!/<ModuleTabsNav\b/.test(source), `${name} no debe pintar pestañas de módulo`);
      assert.ok(!/SubTabsNav/.test(source), `${name} no debe pintar pestañas dentro de pestañas`);
      assert.ok(!/\btabs=\{/.test(source), `${name} no pasa pestañas a la cabecera`);
    }
  });

  it('el título dice la vista y las migas el módulo: «Empresas › Por revisar»', () => {
    assert.match(content, /title=\{EMPRESAS_VIEW_TITLES\.prospectos\}/);
    assert.match(content, /empresasViewCrumbs\('prospectos'\)/);
  });

  it('Descartadas, igual: su título y sus migas', () => {
    assert.match(discardedPanel, /title=\{EMPRESAS_VIEW_TITLES\.descartadas\}/);
    assert.match(discardedPanel, /empresasViewCrumbs\('descartadas'\)/);
  });

  it('las rutas no cambian: la página sigue resolviendo la vista por los mismos parámetros', () => {
    assert.match(accountsPage, /tab !== 'prospectos'/);
    assert.match(accountsPage, /prospectsParams\.view === 'descartadas'/);
  });
});
