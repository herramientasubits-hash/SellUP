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
// AGENT1-DISCARDED-TAB-PARITY-1 — se añade una cuarta garantía: "Descartadas"
// dejó de ser una sub-pestaña y ya no puede volver a serlo. El panel renderiza
// UNA sola fila de pills (<ModuleTabsNav>) y ningún componente de sub-tabs.
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

describe('ProspectsModulePanel — una sola fila de pestañas (sin tabs dentro de tabs)', () => {
  const content = readFileSync(PANEL_PATH, 'utf8');
  const discardedPanel = readFileSync(
    path.join(__dirname, '..', 'discarded-prospects-panel.tsx'),
    'utf8',
  );

  it('renderiza <ModuleTabsNav> como la única fila de pestañas del panel', () => {
    assert.match(content, /tabs=\{<ModuleTabsNav active="prospectos" \/>\}/);
  });

  it('el panel de Descartadas usa la MISMA fila de pestañas, marcada activa', () => {
    assert.match(discardedPanel, /<ModuleTabsNav active="descartadas"/);
  });

  it('ningún panel reintroduce un componente de sub-pestañas', () => {
    for (const [name, source] of [
      ['prospects-module-panel', content],
      ['discarded-prospects-panel', discardedPanel],
    ] as const) {
      assert.ok(
        !/SubTabsNav/.test(source),
        `${name} no debe renderizar pestañas dentro de pestañas`,
      );
    }
  });
});
