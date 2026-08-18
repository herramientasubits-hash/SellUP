/**
 * Q3F-5BB.3E — Static wiring guard: CONVERSATIONAL wizard restored; Lusha is a
 * HIDDEN provider used ONLY at the final search step.
 *
 * Q3F-5BB.3D had (incorrectly) replaced the conversational "Generar con IA"
 * wizard body with a FLAT criteria form (`ProspectCriteriaSection`). The user
 * rejected that. This suite proves, as source-text assertions, that:
 *   1. The conversational `ProspectChatWizard` is the wizard body again — the
 *      flat form component and the `renderBody` body-swap are gone.
 *   2. There are NO source tabs anywhere (no "Fuente de generación", no
 *      "Búsqueda con IA" / "Lusha (previsualización)" tabs, no role="tab").
 *   3. "Generar con IA" stays the single entry point; the flag is threaded down
 *      to the conversational wizard.
 *   4. The final search step wires Lusha as a hidden provider: the summary gates
 *      `WizardLushaFinalSearch` on provider === 'lusha', that component reuses
 *      `LushaPreviewPanel`, shows traceability only, exposes NO persistence /
 *      HubSpot / enrichment CTA, and does NOT auto-run (no useEffect).
 *   5. The criteria bridge + resolver are pure, side-effect-free modules.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  panel: join(ROOT, 'src/components/prospects/prospects-module-panel.tsx'),
  drawer: join(ROOT, 'src/components/prospect-batches/generate-ai-batch-drawer.tsx'),
  wizard: join(ROOT, 'src/components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx'),
  summary: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx'),
  finalSearch: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-lusha-final-search.tsx'),
  lushaDrawerFile: join(ROOT, 'src/components/prospect-batches/lusha-preview-drawer.tsx'),
  resolver: join(ROOT, 'src/modules/prospect-batches/prospect-discovery-provider.ts'),
  criteria: join(ROOT, 'src/modules/prospect-batches/wizard-lusha-criteria.ts'),
};

const sources = {
  panel: readFileSync(FILES.panel, 'utf-8'),
  drawer: readFileSync(FILES.drawer, 'utf-8'),
  wizard: readFileSync(FILES.wizard, 'utf-8'),
  summary: readFileSync(FILES.summary, 'utf-8'),
  finalSearch: readFileSync(FILES.finalSearch, 'utf-8'),
  lushaDrawerFile: readFileSync(FILES.lushaDrawerFile, 'utf-8'),
  resolver: readFileSync(FILES.resolver, 'utf-8'),
  criteria: readFileSync(FILES.criteria, 'utf-8'),
};

/**
 * AGENT1-LUSHA-HIDDEN-PROVIDER-TEST-REPAIR-1 — the invariant these modules must
 * satisfy is that they never IMPORT a provider / network / DB runtime. Scanning
 * the whole file for the words `apollo|tavily|supabase|hubspot` cannot express
 * that: prose naming the neighboring providers is documentation, not coupling.
 * #271 added exactly such a comment to the resolver (explaining that Agent 1
 * discovery — Tavily / Apollo — stays reachable when the hidden Lusha route is
 * not honored), and the whole-file grep turned it into a false failure. The
 * guards below read the module specifiers instead, which is what "does not
 * import" actually means.
 */
const FORBIDDEN_IMPORT_SPECIFIER = /apollo|tavily|supabase|hubspot/i;

function importSpecifiersOf(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
}

/** Pure mapping/helper modules the resolver is allowed to depend on. */
const ALLOWED_RESOLVER_IMPORTS: ReadonlySet<string> = new Set([
  '@/server/prospect-batches/lusha-sector-mapping',
  '@/server/prospect-batches/lusha-preview',
]);

/** Pure mapping/helper/type modules the criteria bridge is allowed to depend on. */
const ALLOWED_CRITERIA_IMPORTS: ReadonlySet<string> = new Set([
  '@/modules/industry-catalog/types',
  '@/modules/prospect-batches/prospect-discovery-provider',
  '@/server/prospect-batches/lusha-sector-mapping',
  '@/server/prospect-batches/lusha-preview',
]);

describe('Conversational wizard restored (product decision Q3F-5BB.3E)', () => {
  it('the flat criteria form component is no longer imported by the drawer', () => {
    assert.doesNotMatch(sources.drawer, /ProspectCriteriaSection/);
    assert.doesNotMatch(sources.drawer, /generate-wizard-source-section/);
  });

  it('the drawer no longer body-swaps the wizard via a renderBody helper', () => {
    assert.doesNotMatch(sources.drawer, /renderBody/);
    assert.doesNotMatch(sources.drawer, /lushaPreviewEnabled \? <ProspectCriteriaSection/);
  });

  it('the drawer renders the conversational ProspectChatWizard as the body', () => {
    assert.match(sources.drawer, /<ProspectChatWizard/);
  });

  it('the drawer threads lushaPreviewEnabled into the conversational wizard', () => {
    assert.match(sources.drawer, /<ProspectChatWizard[\s\S]*?lushaPreviewEnabled=\{lushaPreviewEnabled\}/);
  });

  it('the drawer no longer suppresses the legacy footer on the flag', () => {
    assert.doesNotMatch(sources.drawer, /lushaPreviewEnabled \? undefined/);
  });
});

describe('No visible source tabs remain (product decision)', () => {
  it('no "Fuente de generación" selector in wizard/summary/final-search', () => {
    assert.doesNotMatch(sources.wizard, /Fuente de generación/);
    assert.doesNotMatch(sources.summary, /Fuente de generación/);
    assert.doesNotMatch(sources.finalSearch, /Fuente de generación/);
  });

  it('no "Búsqueda con IA" / "Lusha (previsualización)" tab labels', () => {
    for (const src of [sources.wizard, sources.summary, sources.finalSearch]) {
      assert.doesNotMatch(src, /Lusha \(previsualización\)/);
    }
  });

  it('no tab switch (no role="tab" / tablist) in the final-search surface', () => {
    assert.doesNotMatch(sources.finalSearch, /role="tab"/);
    assert.doesNotMatch(sources.finalSearch, /role="tablist"/);
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

  it('prospects-module-panel no longer references a standalone LushaPreviewDrawer', () => {
    assert.doesNotMatch(sources.panel, /LushaPreviewDrawer/);
  });

  it('lusha-preview-drawer exports the reusable LushaPreviewPanel', () => {
    assert.match(sources.lushaDrawerFile, /export function LushaPreviewPanel/);
    assert.doesNotMatch(sources.lushaDrawerFile, /export function LushaPreviewDrawer/);
  });
});

describe('Final search step persists Lusha results as pending review (Q3F-5BB.4)', () => {
  it('the summary gates the final Lusha search on the honored-route predicate', () => {
    assert.match(sources.summary, /WizardLushaFinalSearch/);
    // AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 (#271) intentionally retired the
    // literal `lushaCriteria.provider === 'lusha'` in favour of the predicate the
    // resolver exports. The predicate is behaviorally identical
    // (`provider === 'lusha'`) and is the ONLY sanctioned way to ask whether the
    // hidden provider participates — comparing the literal is precisely what got
    // misread as "search blocked". So the guard asserts the CURRENT contract
    // rather than resurrecting the retired literal.
    assert.match(
      sources.summary,
      /import \{[^}]*\bisLushaRouteHonored\b[^}]*\} from '@\/modules\/prospect-batches\/prospect-discovery-provider'/,
    );
    // The gate keeps BOTH terms: the preview flag AND the honored Lusha route.
    assert.match(
      sources.summary,
      /const useLushaFinalSearch =[\s\S]{0,400}?\blushaPreviewEnabled\b[\s\S]{0,400}?\bisLushaRouteHonored\(lushaCriteria\.provider\)/,
    );
    // ...and WizardLushaFinalSearch is mounted in exactly one place: behind it.
    assert.equal([...sources.summary.matchAll(/<WizardLushaFinalSearch/g)].length, 1);
    assert.match(
      sources.summary,
      /\{useLushaFinalSearch && lushaCriteria\.input && \(\s*<WizardLushaFinalSearch/,
    );
  });

  it('the conversational wizard resolves the hidden provider decision', () => {
    assert.match(sources.wizard, /resolveWizardLushaCriteria/);
  });

  it('the final-search reuses the shared Lusha recap (no duplicated criteria logic)', () => {
    assert.match(sources.finalSearch, /LockedCriteriaRecap/);
  });

  it('the final-search CTA copy is "Buscar con IA"', () => {
    assert.match(sources.finalSearch, /Buscar con IA/);
  });

  it('persists via the dedicated batch/candidate server action', () => {
    assert.match(sources.finalSearch, /generateLushaPendingReviewBatchAction/);
  });

  it('shows provider traceability only in the confirmation (no visible selector)', () => {
    assert.match(sources.finalSearch, /Fuente usada/);
    assert.match(sources.finalSearch, /Lusha/);
    assert.doesNotMatch(sources.finalSearch, /role="tab"/);
  });

  it('does NOT auto-run: no useEffect / useLayoutEffect in the final-search component', () => {
    assert.doesNotMatch(sources.finalSearch, /useEffect/);
    assert.doesNotMatch(sources.finalSearch, /useLayoutEffect/);
  });

  it('exposes NO account / HubSpot-sync / enrichment / approve CTA in the drawer', () => {
    // The only CTAs are "Ver prospectos" and "Generar otra búsqueda". These check
    // real CTA phrasings + import specifiers (not the file's own safety docstring).
    assert.doesNotMatch(sources.finalSearch, /Aprobar/);
    assert.doesNotMatch(sources.finalSearch, /Crear cuenta|Enviar a HubSpot|Sincronizar con/);
    assert.doesNotMatch(sources.finalSearch, /generateAIProspectBatch/);
    // Never imports HubSpot / enrichment / accounts / people modules.
    for (const m of [...sources.finalSearch.matchAll(/from\s+'([^']+)'/g)].map((x) => x[1])) {
      assert.doesNotMatch(m, /hubspot|enrich|apollo|tavily|accounts|people/i);
    }
  });
});

describe('Provider resolver + criteria bridge are pure, side-effect-free modules', () => {
  it('resolver does not import Apollo / Tavily / Supabase / HubSpot', () => {
    const specifiers = importSpecifiersOf(sources.resolver);
    assert.ok(specifiers.length > 0, 'expected the resolver to declare imports to scan');
    for (const specifier of specifiers) {
      assert.doesNotMatch(specifier, FORBIDDEN_IMPORT_SPECIFIER);
      assert.ok(
        ALLOWED_RESOLVER_IMPORTS.has(specifier),
        `resolver imports a module outside the pure mapping/helper allowlist: ${specifier}`,
      );
    }
  });

  it('resolver does not read env vars or perform I/O directly', () => {
    assert.doesNotMatch(sources.resolver, /process\.env/);
    assert.doesNotMatch(sources.resolver, /fetch\(/);
  });

  it('criteria bridge does not import Apollo / Tavily / Supabase / HubSpot', () => {
    const specifiers = importSpecifiersOf(sources.criteria);
    assert.ok(specifiers.length > 0, 'expected the criteria bridge to declare imports to scan');
    for (const specifier of specifiers) {
      assert.doesNotMatch(specifier, FORBIDDEN_IMPORT_SPECIFIER);
      assert.ok(
        ALLOWED_CRITERIA_IMPORTS.has(specifier),
        `criteria bridge imports a module outside the pure mapping/helper allowlist: ${specifier}`,
      );
    }
  });

  it('criteria bridge does not read env vars or perform I/O directly', () => {
    assert.doesNotMatch(sources.criteria, /process\.env/);
    assert.doesNotMatch(sources.criteria, /fetch\(/);
  });

  it('criteria bridge never runs Lusha (no server action import)', () => {
    assert.doesNotMatch(sources.criteria, /previewLushaCompaniesAction/);
  });
});
