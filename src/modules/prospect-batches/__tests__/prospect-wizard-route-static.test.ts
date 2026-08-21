/**
 * Q3F-5BB.10C3-FIX-1 — static source guards for the fail-closed routing fix.
 *
 * Source-text proofs (no DOM, no network) that the three fix layers hold:
 *   P0-1  the Prospectos panel parses ENABLE_LUSHA_PREVIEW via the canonical
 *         helper, never a bespoke `=== 'true'` comparison.
 *   P0-2  the summary UI derives the generation gate from the discovery-availability
 *         contract (never from the hidden Lusha route), and asks about Lusha only
 *         through `isLushaRouteHonored` — see
 *         AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1.
 *   P1-3  the read-only dry-route action imports nothing that can spend (no
 *         execution action, no Lusha/Apollo/Tavily client, no DB-write helper),
 *         and the pure route module performs no I/O.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  panel: join(ROOT, 'src/components/prospects/prospects-module-panel.tsx'),
  summary: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx'),
  route: join(ROOT, 'src/modules/prospect-batches/prospect-wizard-route.ts'),
  routeAction: join(ROOT, 'src/modules/prospect-batches/prospect-wizard-route-actions.ts'),
  provider: join(ROOT, 'src/modules/prospect-batches/prospect-discovery-provider.ts'),
  criteria: join(ROOT, 'src/modules/prospect-batches/wizard-lusha-criteria.ts'),
};

const src = {
  panel: readFileSync(FILES.panel, 'utf-8'),
  summary: readFileSync(FILES.summary, 'utf-8'),
  route: readFileSync(FILES.route, 'utf-8'),
  routeAction: readFileSync(FILES.routeAction, 'utf-8'),
  provider: readFileSync(FILES.provider, 'utf-8'),
  criteria: readFileSync(FILES.criteria, 'utf-8'),
};

/** Import specifiers only (module paths). */
function importPaths(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
}

describe('P0-1 — panel uses the canonical Lusha flag parser', () => {
  it('reads the flag via isLushaPreviewEnabled(), not a bespoke === "true"', () => {
    assert.match(src.panel, /isLushaPreviewEnabled\(\)/);
    assert.doesNotMatch(src.panel, /ENABLE_LUSHA_PREVIEW\s*===\s*'true'/);
    assert.doesNotMatch(src.panel, /process\.env\.ENABLE_LUSHA_PREVIEW/);
  });
});

describe('P0-2 — routing is three-state and fails closed in the UI', () => {
  it('the provider decision layer exposes the blocked_lusha_disabled state', () => {
    assert.match(src.provider, /blocked_lusha_disabled/);
    // Eligibility helper exists and is flag-independent.
    assert.match(src.provider, /isProspectLushaEligible/);
  });

  it('the criteria bridge no longer collapses non-lusha into a hardcoded default_ai', () => {
    // The blocked state is forwarded verbatim (provider: decision.provider).
    assert.match(src.criteria, /provider:\s*decision\.provider/);
  });

  /**
   * AGENT1-PROVIDER-AVAILABILITY-UNIVERSAL-1 — la mitad de P0-2 que se conserva y
   * la que cambia.
   *
   * Se conserva: con el flag apagado la ruta NUNCA es `lusha`, y una corrida que va
   * a Lusha no ofrece «Generar prospectos» (`!useLushaFinalSearch`).
   *
   * Cambia: el gate de generación ya NO se deriva de la ruta del proveedor oculto.
   * Derivarlo de ahí dejaba «Empresas por criterios» sin ninguna forma de ejecutar
   * —ni selector ni botón— para toda industria que mapeara a un sector Lusha, en
   * los 20 países soportados, con Apollo desplegado y con presupuesto.
   */
  it('el gate de generación se deriva de la disponibilidad del discovery, no de la ruta de Lusha', () => {
    assert.match(
      src.summary,
      /!useLushaFinalSearch &&\s*discoveryAvailability\.available &&\s*executionEnabled &&\s*!isPersistenceBlocked/,
    );
    // La ruta del proveedor oculto ya no puede retirar el control de generación.
    assert.doesNotMatch(src.summary, /isLushaBlocked/);
    assert.doesNotMatch(src.summary, /LushaDisabledBlockedPanel/);
  });

  it('la disponibilidad del discovery se resuelve con el módulo puro y la fuente de verdad de países', () => {
    assert.match(src.summary, /resolveWizardDiscoveryAvailability\(/);
    assert.match(src.summary, /supportedCountryCodes:\s*VALID_COUNTRY_CODES/);
  });

  it('la ruta de Lusha se pregunta por su predicado, no comparando el literal', () => {
    assert.match(src.summary, /isLushaRouteHonored\(lushaCriteria\.provider\)/);
    assert.match(src.provider, /export function isLushaRouteHonored/);
  });

  it('el aviso de no disponible no atribuye la causa a un proveedor deshabilitado', () => {
    const start = src.summary.indexOf('const DISCOVERY_UNAVAILABLE_COPY');
    assert.ok(start >= 0, 'DISCOVERY_UNAVAILABLE_COPY debe existir');
    const body = src.summary.slice(start, src.summary.indexOf('function DiscoveryUnavailableNotice'));
    assert.doesNotMatch(body, /proveedor/i);
    assert.doesNotMatch(body, /habilitad/i);
    // Y sigue negando el gasto en cada variante.
    assert.doesNotMatch(body, /onExecute/);
  });
});

describe('P1-3 — dry-route action cannot spend', () => {
  it('the route ACTION imports nothing that can reach a provider, execution, or DB write', () => {
    for (const path of importPaths(src.routeAction)) {
      assert.doesNotMatch(path, /apollo/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /tavily/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /hubspot/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /chat-wizard-execution/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /pending-review/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /lusha-preview-actions/i, `forbidden import: ${path}`);
      assert.doesNotMatch(path, /lusha-client|lusha-company/i, `forbidden import: ${path}`);
    }
  });

  it('the route ACTION never references the execution / Lusha-run actions by name', () => {
    assert.doesNotMatch(src.routeAction, /executeProspectWizardGenerationAction/);
    assert.doesNotMatch(src.routeAction, /generateLushaPendingReviewBatchAction\s*\(/);
    assert.doesNotMatch(src.routeAction, /previewLushaCompaniesAction\s*\(/);
  });

  it('the route ACTION performs no DB write and no direct provider fetch', () => {
    assert.doesNotMatch(src.routeAction, /\.insert\(/);
    assert.doesNotMatch(src.routeAction, /\.update\(/);
    assert.doesNotMatch(src.routeAction, /\.upsert\(/);
    assert.doesNotMatch(src.routeAction, /\.delete\(/);
    assert.doesNotMatch(src.routeAction, /fetch\(/);
  });

  it('the pure route module does no I/O (no supabase / next / fetch)', () => {
    for (const path of importPaths(src.route)) {
      assert.doesNotMatch(path, /supabase/i, `route must not import: ${path}`);
      assert.doesNotMatch(path, /next\//, `route must not import: ${path}`);
    }
    assert.doesNotMatch(src.route, /fetch\(/);
    assert.doesNotMatch(src.route, /createClient/);
    assert.doesNotMatch(src.route, /process\.env/);
  });
});
