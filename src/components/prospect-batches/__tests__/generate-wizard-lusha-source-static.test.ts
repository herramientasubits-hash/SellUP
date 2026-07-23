/**
 * Q3F-5BB.3C — Static wiring guard: Lusha preview moved INTO the "Generar con
 * IA" wizard.
 *
 * Proves as source-text assertions (same technique as
 * automatic-routing-wiring-static.test.ts) that:
 *   1. The standalone "Previsualizar en Lusha" action is gone from Prospectos.
 *   2. "Generar con IA" stays the single entry point and now receives the
 *      lushaPreviewEnabled flag.
 *   3. The wizard drawer gates a Lusha source section on lushaPreviewEnabled and
 *      suppresses the IA generation footer while Lusha is active.
 *   4. The source section reuses LushaPreviewPanel and exposes NO persistence /
 *      HubSpot / enrichment CTA, and does NOT auto-run Lusha (no useEffect).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  panel: join(ROOT, 'src/components/prospects/prospects-module-panel.tsx'),
  drawer: join(ROOT, 'src/components/prospect-batches/generate-ai-batch-drawer.tsx'),
  sourceSection: join(ROOT, 'src/components/prospect-batches/generate-wizard-source-section.tsx'),
  lushaDrawerFile: join(ROOT, 'src/components/prospect-batches/lusha-preview-drawer.tsx'),
};

const sources = {
  panel: readFileSync(FILES.panel, 'utf-8'),
  drawer: readFileSync(FILES.drawer, 'utf-8'),
  sourceSection: readFileSync(FILES.sourceSection, 'utf-8'),
  lushaDrawerFile: readFileSync(FILES.lushaDrawerFile, 'utf-8'),
};

describe('Standalone Lusha button removed from Prospectos', () => {
  it('prospects-module-panel no longer imports or renders LushaPreviewDrawer', () => {
    assert.doesNotMatch(sources.panel, /LushaPreviewDrawer/);
  });

  it('lusha-preview-drawer no longer exports a standalone LushaPreviewDrawer component', () => {
    assert.doesNotMatch(sources.lushaDrawerFile, /export function LushaPreviewDrawer/);
    // The reusable panel stays exported for the in-wizard source section.
    assert.match(sources.lushaDrawerFile, /export function LushaPreviewPanel/);
  });
});

describe('"Generar con IA" remains the entry point and receives the flag', () => {
  it('panel still renders GenerateAIBatchDrawer and threads lushaPreviewEnabled', () => {
    assert.match(sources.panel, /GenerateAIBatchDrawer/);
    assert.match(sources.panel, /lushaPreviewEnabled=\{enableLushaPreview\}/);
  });

  it('the CTA copy "Generar con IA" is preserved in the wizard drawer', () => {
    assert.match(sources.drawer, /Generar con IA/);
  });
});

describe('Wizard drawer gates the Lusha source section on the flag', () => {
  it('drawer imports GenerationSourceSection and declares lushaPreviewEnabled prop', () => {
    assert.match(sources.drawer, /GenerationSourceSection/);
    assert.match(sources.drawer, /lushaPreviewEnabled/);
  });

  it('drawer only renders the source section when the flag is on', () => {
    // renderBody returns iaContent verbatim unless lushaPreviewEnabled.
    assert.match(sources.drawer, /lushaPreviewEnabled\s*\?\s*\(/);
    assert.match(sources.drawer, /const lushaActive = lushaPreviewEnabled && source === 'lusha'/);
  });

  it('drawer suppresses the IA generation footer while Lusha is active', () => {
    assert.match(sources.drawer, /lushaActive \? undefined :/);
  });
});

describe('Source section is read-only and reuses the Lusha panel', () => {
  it('reuses LushaPreviewPanel (no duplicated Lusha logic)', () => {
    assert.match(sources.sourceSection, /LushaPreviewPanel/);
  });

  it('does NOT auto-run: no useEffect / useLayoutEffect in the source section', () => {
    assert.doesNotMatch(sources.sourceSection, /useEffect/);
    assert.doesNotMatch(sources.sourceSection, /useLayoutEffect/);
  });

  it('exposes NO persistence / HubSpot / enrichment CTA', () => {
    assert.doesNotMatch(sources.sourceSection, /HubSpot|hubspot/);
    assert.doesNotMatch(sources.sourceSection, /enrich|Enrich/);
    assert.doesNotMatch(sources.sourceSection, /Crear prospecto|Guardar|Aprobar|Enviar a revisi/);
    // No calls to any generation / write server action from the section.
    assert.doesNotMatch(sources.sourceSection, /generateAIProspectBatch/);
  });
});
