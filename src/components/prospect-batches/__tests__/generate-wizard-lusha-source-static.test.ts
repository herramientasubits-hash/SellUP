/**
 * Q3F-5BB.3D — Static wiring guard: Lusha is a HIDDEN provider (no source tabs).
 *
 * Q3F-5BB.3C had shipped two visible source tabs ("Búsqueda con IA" /
 * "Lusha (previsualización)"). The user rejected that. This suite proves, as
 * source-text assertions, that:
 *   1. The visible source selector is gone: no "Fuente de generación" title, no
 *      tab labels, no role="tab" switch in the criteria section.
 *   2. "Generar con IA" stays the single entry point and still receives the
 *      lushaPreviewEnabled flag.
 *   3. The wizard drawer renders the hidden-provider criteria section (not a tab
 *      selector) when the flag is on, and suppresses the IA generation footer.
 *   4. The section reuses LushaPreviewPanel, resolves the provider via
 *      resolveProspectDiscoveryProvider, exposes NO persistence / HubSpot /
 *      enrichment CTA, and does NOT auto-run Lusha (no useEffect).
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
  resolver: join(ROOT, 'src/modules/prospect-batches/prospect-discovery-provider.ts'),
};

const sources = {
  panel: readFileSync(FILES.panel, 'utf-8'),
  drawer: readFileSync(FILES.drawer, 'utf-8'),
  sourceSection: readFileSync(FILES.sourceSection, 'utf-8'),
  lushaDrawerFile: readFileSync(FILES.lushaDrawerFile, 'utf-8'),
  resolver: readFileSync(FILES.resolver, 'utf-8'),
};

describe('No visible source tabs remain (product decision Q3F-5BB.3D)', () => {
  it('the criteria section exposes NO "Fuente de generación" selector', () => {
    assert.doesNotMatch(sources.sourceSection, /Fuente de generación/);
  });

  it('the criteria section exposes NO "Búsqueda con IA" tab label', () => {
    assert.doesNotMatch(sources.sourceSection, /Búsqueda con IA/);
  });

  it('the criteria section exposes NO "Lusha (previsualización)" tab label', () => {
    assert.doesNotMatch(sources.sourceSection, /Lusha \(previsualización\)/);
  });

  it('the criteria section has NO tab switch (no role="tab" / tablist)', () => {
    assert.doesNotMatch(sources.sourceSection, /role="tab"/);
    assert.doesNotMatch(sources.sourceSection, /role="tablist"/);
  });

  it('the drawer no longer imports the removed GenerationSourceSection tab component', () => {
    assert.doesNotMatch(sources.drawer, /GenerationSourceSection/);
  });
});

describe('Standalone Lusha button stays removed; panel stays reusable', () => {
  it('prospects-module-panel no longer references a standalone LushaPreviewDrawer', () => {
    assert.doesNotMatch(sources.panel, /LushaPreviewDrawer/);
  });

  it('lusha-preview-drawer exports the reusable LushaPreviewPanel', () => {
    assert.match(sources.lushaDrawerFile, /export function LushaPreviewPanel/);
    assert.doesNotMatch(sources.lushaDrawerFile, /export function LushaPreviewDrawer/);
  });
});

describe('"Generar con IA" remains the single entry point and receives the flag', () => {
  it('panel renders GenerateAIBatchDrawer and threads lushaPreviewEnabled', () => {
    assert.match(sources.panel, /GenerateAIBatchDrawer/);
    assert.match(sources.panel, /lushaPreviewEnabled=\{enableLushaPreview\}/);
  });

  it('the CTA copy "Generar con IA" is preserved in the wizard drawer', () => {
    assert.match(sources.drawer, /Generar con IA/);
  });
});

describe('Wizard drawer renders the hidden-provider criteria section on the flag', () => {
  it('drawer imports ProspectCriteriaSection and gates it on lushaPreviewEnabled', () => {
    assert.match(sources.drawer, /ProspectCriteriaSection/);
    assert.match(sources.drawer, /lushaPreviewEnabled \? <ProspectCriteriaSection \/> : iaContent/);
  });

  it('drawer suppresses the IA generation footer when the flag is on', () => {
    assert.match(sources.drawer, /lushaPreviewEnabled \? undefined :/);
  });
});

describe('Criteria section is read-only, reuses the panel, and resolves the provider', () => {
  it('reuses LushaPreviewPanel (no duplicated Lusha logic)', () => {
    assert.match(sources.sourceSection, /LushaPreviewPanel/);
  });

  it('resolves the internal provider via resolveProspectDiscoveryProvider', () => {
    assert.match(sources.sourceSection, /resolveProspectDiscoveryProvider/);
  });

  it('shows provider traceability only in results (no visible selector)', () => {
    assert.match(sources.sourceSection, /providerTraceabilityLabel/);
  });

  it('does NOT auto-run: no useEffect / useLayoutEffect in the section', () => {
    assert.doesNotMatch(sources.sourceSection, /useEffect/);
    assert.doesNotMatch(sources.sourceSection, /useLayoutEffect/);
  });

  it('exposes NO persistence / HubSpot / enrichment CTA', () => {
    assert.doesNotMatch(sources.sourceSection, /HubSpot|hubspot/);
    assert.doesNotMatch(sources.sourceSection, /enrich|Enrich/);
    assert.doesNotMatch(sources.sourceSection, /Crear prospecto|Guardar|Aprobar|Enviar a HubSpot/);
    assert.doesNotMatch(sources.sourceSection, /generateAIProspectBatch/);
  });
});

describe('Provider resolver is a pure, side-effect-free module', () => {
  it('does not import Apollo / Tavily / Supabase / HubSpot', () => {
    assert.doesNotMatch(sources.resolver, /apollo|tavily|supabase|hubspot/i);
  });

  it('does not read env vars or perform I/O directly', () => {
    assert.doesNotMatch(sources.resolver, /process\.env/);
    assert.doesNotMatch(sources.resolver, /fetch\(/);
  });
});
