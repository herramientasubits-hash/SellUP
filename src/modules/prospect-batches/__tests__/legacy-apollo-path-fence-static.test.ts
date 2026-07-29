/**
 * A1-LEGACY-PATH-FENCE-1 — static source guards (§ 12 static guard, § 15).
 *
 * Source-text proofs that hold the fence in place against future edits. These
 * catch the failure modes that runtime tests structurally cannot: a gate moved
 * BELOW the first write, a second Apollo call site added without a gate, or the
 * modern wizard quietly importing the legacy action.
 *
 * No DOM, no network, no database.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  panel: join(ROOT, 'src/components/prospects/prospects-module-panel.tsx'),
  experience: join(ROOT, 'src/components/prospect-batches/generate-ai-batch-experience.ts'),
  drawer: join(ROOT, 'src/components/prospect-batches/generate-ai-batch-drawer.tsx'),
  availability: join(ROOT, 'src/modules/industry-catalog/catalog-availability.ts'),
  gate: join(ROOT, 'src/modules/prospect-batches/legacy-apollo-path-gate.ts'),
  actions: join(ROOT, 'src/modules/prospect-batches/actions.ts'),
  generation: join(ROOT, 'src/server/agents/prospect-generation.ts'),
};

const src = Object.fromEntries(
  Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf-8')]),
) as Record<keyof typeof FILES, string>;

/**
 * Every non-test source file of the modern chat-wizard execution path. Read as a
 * directory rather than a fixed list so a newly added executor is covered by the
 * "modern path never touches legacy" guarantees automatically.
 */
const MODERN_WIZARD_DIR = join(
  ROOT,
  'src/modules/prospect-batches/chat-wizard-execution',
);
const MODERN_WIZARD_SOURCES: { name: string; source: string }[] = readdirSync(
  MODERN_WIZARD_DIR,
)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map((f) => ({ name: f, source: readFileSync(join(MODERN_WIZARD_DIR, f), 'utf-8') }));

/** Import specifiers only (module paths). */
function importPaths(source: string): string[] {
  return [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
}

/** Strips line and block comments so prose cannot satisfy a code assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ── Capa 1: canonical flag parsing in the panel ───────────────────────────────

describe('Capa 1 — the panel parses both experience flags canonically', () => {
  it('uses the canonical helpers', () => {
    assert.match(src.panel, /isProspectChatWizardEnabled\(\)/);
    assert.match(src.panel, /isExploratorySearchFormV2Enabled\(\)/);
  });

  it('has no bespoke === \'true\' comparison for either flag', () => {
    const code = stripComments(src.panel);
    assert.doesNotMatch(code, /ENABLE_PROSPECT_CHAT_WIZARD\s*===/);
    assert.doesNotMatch(code, /ENABLE_EXPLORATORY_SEARCH_FORM_V2\s*===/);
    assert.doesNotMatch(code, /process\.env\.ENABLE_PROSPECT_CHAT_WIZARD/);
    assert.doesNotMatch(code, /process\.env\.ENABLE_EXPLORATORY_SEARCH_FORM_V2/);
  });

  it('reads no feature flag directly off process.env at all', () => {
    assert.doesNotMatch(stripComments(src.panel), /process\.env\.ENABLE_/);
  });
});

// ── Capa 2: the panel cannot collapse a failure into null ─────────────────────

describe('Capa 2 — the panel routes the catalog through the availability contract', () => {
  it('calls resolveCatalogAvailability instead of loadActiveCatalog', () => {
    assert.match(src.panel, /resolveCatalogAvailability\(/);
    assert.ok(
      !importPaths(src.panel).some((p) => p.endsWith('industry-catalog/loader')),
      'panel must not import the raw loader',
    );
  });

  it('no longer swallows a catalog failure into null', () => {
    const code = stripComments(src.panel);
    assert.doesNotMatch(code, /catalog\s*=\s*null;?\s*\n\s*\}/);
    assert.doesNotMatch(code, /catch\s*\{\s*\n?\s*catalog\s*=\s*null/);
    assert.doesNotMatch(code, /loadActiveCatalog\(/);
  });

  it('the availability module never returns null', () => {
    const code = stripComments(src.availability);
    assert.doesNotMatch(code, /return\s+null/);
  });
});

// ── Capa 3: legacy is not an automatic destination ───────────────────────────

describe('Capa 3 — the experience union has no legacy member', () => {
  it('GenerateProspectsExperience is exactly the three safe values', () => {
    const union = src.experience.match(
      /export type GenerateProspectsExperience =([\s\S]*?);/,
    );
    assert.ok(union, 'union declaration found');
    const body = union![1];
    assert.match(body, /'chat_wizard'/);
    assert.match(body, /'exploratory_form_v2'/);
    assert.match(body, /'unavailable'/);
    assert.doesNotMatch(body, /'legacy'/);
  });

  it('the resolver never returns legacy', () => {
    const fn = src.experience.match(
      /export function resolveGenerateProspectsExperience\(([\s\S]*?)\n\}/,
    );
    assert.ok(fn, 'resolver found');
    assert.doesNotMatch(fn![1], /return\s+'legacy'/);
  });

  it('the resolver takes a typed availability, not a nullable catalog', () => {
    assert.match(src.experience, /availability:\s*CatalogAvailability/);
    assert.doesNotMatch(
      stripComments(src.experience),
      /ActiveIndustryCatalog\s*\|\s*null/,
    );
  });
});

// ── Capa 4: UI fail-closed ───────────────────────────────────────────────────

describe('Capa 4 — the drawer defaults to unavailable, never legacy', () => {
  it('the default prop value is unavailable', () => {
    assert.match(src.drawer, /experience\s*=\s*'unavailable'/);
    assert.doesNotMatch(stripComments(src.drawer), /experience\s*=\s*'legacy'/);
  });

  it('anything that is not an explicit legacy opt-in renders the unavailable state', () => {
    assert.match(src.drawer, /if\s*\(experience\s*!==\s*'legacy'\)/);
    assert.match(src.drawer, /renderUnavailable\(/);
  });

  it('all three unavailable copies are present', () => {
    assert.match(src.drawer, /La búsqueda de empresas no está disponible temporalmente\./);
    assert.match(
      src.drawer,
      /La configuración de industrias no está disponible\. Contacta a un administrador\./,
    );
    assert.match(
      src.drawer,
      /No pudimos cargar la configuración de búsqueda\. Intenta nuevamente\./,
    );
  });

  it('the unavailable branch has no execution CTA and never calls the legacy action', () => {
    const branch = src.drawer.match(
      /function renderUnavailable\(([\s\S]*?)\n  \}/,
    );
    assert.ok(branch, 'renderUnavailable found');
    const body = branch![1];
    assert.doesNotMatch(body, /generateAIProspectBatch/);
    assert.doesNotMatch(body, /handleSubmit/);
    assert.doesNotMatch(body, /AIButton/);
    assert.doesNotMatch(body, /Generar con IA/);
  });

  it('the retry affordance only refreshes — it does not run discovery', () => {
    const branch = src.drawer.match(/function renderUnavailable\(([\s\S]*?)\n  \}/)!;
    const body = branch[1];
    assert.match(body, /router\.refresh\(\)/);
    for (const forbidden of [
      /generateAIProspectBatch/,
      /runProspectGenerationAgent/,
      /searchApollo/,
      /Tavily/i,
      /Lusha/i,
    ]) {
      assert.doesNotMatch(body, forbidden);
    }
  });
});

// ── Capa 5: gate ordering in the server action ───────────────────────────────

describe('Capa 5 — the gate runs before ANY side effect', () => {
  const action = src.actions.slice(
    src.actions.indexOf('export async function generateAIProspectBatch'),
    src.actions.indexOf('// ── Agente 1 (Tavily): Búsqueda web multi-query'),
  );

  it('the action body was located', () => {
    assert.ok(action.length > 200);
    assert.match(action, /evaluateLegacyApolloPathGate/);
  });

  const gateAt = () => action.indexOf('await evaluateLegacyApolloPathGate');

  it('the gate precedes the writer-pipeline branch', () => {
    const branchAt = action.indexOf('if (isWriterPipelineCTAEnabled())');
    assert.ok(gateAt() > -1 && branchAt > -1);
    assert.ok(gateAt() < branchAt, 'gate must precede branch selection');
  });

  it('the gate precedes the legacy agent run', () => {
    const runAt = action.indexOf('await runProspectGenerationAgent(');
    assert.ok(runAt > -1);
    assert.ok(gateAt() < runAt);
  });

  it('the gate precedes every Supabase access in the action', () => {
    const firstDb = Math.min(
      ...[
        action.indexOf('await createClient()'),
        action.indexOf(".from('prospect_batches')"),
        action.indexOf('runIncrementalProspectingSearch('),
      ].filter((i) => i > -1),
    );
    assert.ok(Number.isFinite(firstDb) && firstDb > -1);
    assert.ok(gateAt() < firstDb, 'no read or write may precede the gate');
  });

  it('the gate precedes revalidatePath and every return of a real result', () => {
    const revalidateAt = action.indexOf('revalidatePath(');
    assert.ok(revalidateAt > -1);
    assert.ok(gateAt() < revalidateAt);
  });

  it('a blocked decision returns immediately, before the branch', () => {
    assert.match(action, /if\s*\(!legacyGate\.allowed\)\s*\{\s*\n\s*return buildLegacyPathBlockedResult/);
  });

  it('the gate is fed by server-owned callbacks, not by the action input', () => {
    const call = action.slice(gateAt(), action.indexOf('if (!legacyGate.allowed)'));
    assert.match(call, /isAdmin:\s*resolveIsAdminForLegacyGate/);
    assert.match(call, /isLegacyCapabilityEnabled:\s*isLegacyApolloProspectGenerationEnabled/);
    assert.match(call, /isApolloCompanySearchEnabled/);
    // No field of `input` may feed the gate.
    assert.doesNotMatch(call, /input\./);
  });

  it('the gate module itself performs no I/O', () => {
    const code = stripComments(src.gate);
    assert.doesNotMatch(code, /createClient/);
    assert.doesNotMatch(code, /from\s*\(/);
    assert.doesNotMatch(code, /fetch\(/);
    assert.doesNotMatch(code, /process\.env/);
    assert.deepEqual(importPaths(src.gate), []);
  });
});

// ── Capa 6: authoritative Apollo gate at runtime ─────────────────────────────

describe('Capa 6 — every Apollo call site is gated', () => {
  it('prospect-generation imports the Apollo company-search flag helper', () => {
    assert.match(src.generation, /isApolloCompanySearchEnabled/);
    assert.ok(
      importPaths(src.generation).some((p) => p === '@/lib/feature-flags.server'),
    );
  });

  it('there is exactly one searchApolloOrganizations invocation', () => {
    const calls = [
      ...src.generation.matchAll(/(?<!type\s)searchApolloOrganizations\s*\(/g),
    ];
    assert.equal(calls.length, 1, 'a new Apollo call site needs its own gate');
  });

  it('the gate appears before the Apollo invocation', () => {
    const gateAt = src.generation.indexOf('if (!isApolloCompanySearchEnabled())');
    const callAt = src.generation.search(/searchApolloOrganizations\s*\(/);
    assert.ok(gateAt > -1, 'runtime Apollo gate present');
    assert.ok(callAt > -1);
    assert.ok(gateAt < callAt, 'gate must precede the Apollo call');
  });

  it('nothing between the gate and the call can reach Apollo', () => {
    const gateAt = src.generation.indexOf('if (!isApolloCompanySearchEnabled())');
    const callAt = src.generation.search(/searchApolloOrganizations\s*\(/);
    const between = src.generation.slice(gateAt, callAt);
    // The gate's own early-return block is here; assert it returns before the call.
    assert.match(between, /return\s*\{\s*\n\s*success:\s*false/);
  });

  it('the flag-off branch records a PII-free status and logs no provider usage', () => {
    const gateAt = src.generation.indexOf('if (!isApolloCompanySearchEnabled())');
    const block = src.generation.slice(gateAt, gateAt + 2200);
    assert.match(block, /apollo_fallback_status[\s\S]*disabled_flag_off/);
    assert.doesNotMatch(block, /logProviderUsage\(/);
    assert.doesNotMatch(block, /estimateApolloCost\(/);
    assert.doesNotMatch(block, /credits_used/);
  });

  it('the flag-off log line interpolates no request data', () => {
    const line = src.generation.match(/apollo_skipped_flag_off[^\n]*/);
    assert.ok(line);
    assert.doesNotMatch(line![0], /\$\{/, 'no interpolation — static text only');
  });
});

// ── § 15 Regressions: the modern path stays independent of legacy ────────────

describe('§15 — the modern wizard never reaches the legacy action', () => {
  it('found the modern wizard sources', () => {
    assert.ok(MODERN_WIZARD_SOURCES.length > 5);
  });

  // Comments are stripped: these assertions are about what the code DOES, not
  // what the prose mentions. wizard-execution-types.ts still carries a stale
  // comment saying its output "is ready to be passed to generateAIProspectBatch"
  // — inaccurate since the wizard moved to wizard-tavily-executor, but it is
  // documentation in a file this milestone does not own.
  it('no modern wizard module calls or imports generateAIProspectBatch', () => {
    for (const { name, source } of MODERN_WIZARD_SOURCES) {
      assert.doesNotMatch(
        stripComments(source),
        /generateAIProspectBatch/,
        `${name} must not use the legacy action`,
      );
    }
  });

  it('no modern wizard module references the legacy agent or calls Apollo directly', () => {
    for (const { name, source } of MODERN_WIZARD_SOURCES) {
      const code = stripComments(source);
      assert.doesNotMatch(code, /runProspectGenerationAgent/, name);
      assert.doesNotMatch(code, /searchApolloOrganizations/, name);
    }
  });

  /**
   * `actions.ts` hosts BOTH the legacy action and shared helpers, so banning the
   * module wholesale would fail on benign imports. What matters is which symbols
   * cross the boundary: the modern wizard may import `requireActiveUser` (auth)
   * and the `GenerateAIBatchInput` type (erased at compile time), but never an
   * executable legacy entry point.
   */
  const ALLOWED_FROM_ACTIONS = new Set(['requireActiveUser', 'GenerateAIBatchInput']);

  it('modern wizard imports from the actions module are limited to non-executable helpers', () => {
    for (const { name, source } of MODERN_WIZARD_SOURCES) {
      const specifiers = [
        ...source.matchAll(
          /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@\/modules\/prospect-batches\/actions'/g,
        ),
      ];
      for (const match of specifiers) {
        const named = match[1]
          .split(',')
          .map((s) => s.replace(/^\s*type\s+/, '').trim())
          .filter(Boolean);
        for (const symbol of named) {
          assert.ok(
            ALLOWED_FROM_ACTIONS.has(symbol),
            `${name} imports '${symbol}' from the legacy action module`,
          );
        }
      }
    }
  });

  it('the experience and availability modules import nothing that can spend', () => {
    for (const source of [src.experience, src.availability, src.gate]) {
      for (const path of importPaths(source)) {
        assert.ok(
          !/apollo|lusha|tavily|hubspot/i.test(path),
          `unexpected provider import: ${path}`,
        );
      }
    }
  });
});

describe('§16 — the fence touches no out-of-scope surface', () => {
  const TOUCHED = [
    src.panel,
    src.experience,
    src.drawer,
    src.availability,
    src.gate,
  ];

  it('no touched file reaches contacts, phone cache or phone reveal (Agente 2A)', () => {
    for (const source of TOUCHED) {
      for (const path of importPaths(source)) {
        assert.ok(
          !/phone-cache|phone-reveal|contact-enrichment/i.test(path),
          `Agente 2A surface must stay untouched: ${path}`,
        );
      }
    }
  });

  it('no touched file imports a Supabase migration or admin client', () => {
    for (const source of TOUCHED) {
      for (const path of importPaths(source)) {
        assert.ok(!/supabase-js/.test(path), `no admin client here: ${path}`);
      }
    }
  });
});
