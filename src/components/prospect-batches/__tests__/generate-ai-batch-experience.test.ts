/**
 * A1-LEGACY-PATH-FENCE-1 — Capas 1 & 3: canonical flag parsers + experience
 * resolution with `legacy` removed as an automatic destination.
 *
 * The P0: three distinct conditions (wizard flag off, catalog empty, catalog
 * failed to load) all resolved to `legacy`, which rendered the legacy Apollo form
 * whose CTA could spend up to 25 Apollo credits per click. The flags are declared
 * `sensitive` in Vercel, so their literal values cannot be read from outside —
 * the deployed code must interpret ANY value correctly, which a strict
 * `=== 'true'` did not.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveGenerateProspectsExperience,
  resolveGenerateProspectsUnavailableKind,
  type GenerateProspectsExperience,
} from '@/components/prospect-batches/generate-ai-batch-experience';
import type { CatalogAvailability } from '@/modules/industry-catalog/catalog-availability';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import {
  isProspectChatWizardEnabled,
  isExploratorySearchFormV2Enabled,
  isLegacyApolloProspectGenerationEnabled,
  PROSPECT_CHAT_WIZARD_FLAG,
  EXPLORATORY_SEARCH_FORM_V2_FLAG,
  LEGACY_APOLLO_PROSPECT_GENERATION_FLAG,
} from '@/lib/feature-flags.server';

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'ind-1', name: 'Tecnología', slug: 'tecnologia', description: null, sortOrder: 1 },
  ],
  subindustries: [
    {
      id: 'sub-1',
      name: 'SaaS',
      slug: 'saas',
      description: null,
      industryId: 'ind-1',
      applicableCountries: null,
      sortOrder: 1,
    },
  ],
};

const READY: CatalogAvailability = { status: 'ready', catalog: CATALOG };
const EMPTY: CatalogAvailability = { status: 'empty' };
const DISABLED: CatalogAvailability = { status: 'disabled' };
const RETRYABLE: CatalogAvailability = {
  status: 'unavailable',
  reason: 'query_failed',
  retryable: true,
};
const BROKEN: CatalogAvailability = {
  status: 'unavailable',
  reason: 'inconsistent_payload',
  retryable: false,
};

/** Every availability state that is not `ready`. */
const NOT_READY: CatalogAvailability[] = [EMPTY, DISABLED, RETRYABLE, BROKEN];

// ── Capa 1: canonical flag parsers ────────────────────────────────────────────

/** Runs `fn` with `flag` set to `value` (or unset), restoring the previous value. */
function withFlag<T>(flag: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[flag];
  if (value === undefined) delete process.env[flag];
  else process.env[flag] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[flag];
    else process.env[flag] = prev;
  }
}

const TRUTHY_VARIANTS = ['true', 'TRUE', 'True', ' true', 'true ', '  true  ', 'true\n', '\ttrue\t'];
const FALSY_VARIANTS = ['false', 'FALSE', '', ' ', '1', 'yes', 'on', 'truthy', 'true true', undefined];

const PARSERS: { name: string; flag: string; read: () => boolean }[] = [
  {
    name: 'isProspectChatWizardEnabled',
    flag: PROSPECT_CHAT_WIZARD_FLAG,
    read: isProspectChatWizardEnabled,
  },
  {
    name: 'isExploratorySearchFormV2Enabled',
    flag: EXPLORATORY_SEARCH_FORM_V2_FLAG,
    read: isExploratorySearchFormV2Enabled,
  },
  {
    name: 'isLegacyApolloProspectGenerationEnabled',
    flag: LEGACY_APOLLO_PROSPECT_GENERATION_FLAG,
    read: isLegacyApolloProspectGenerationEnabled,
  },
];

for (const parser of PARSERS) {
  describe(`Capa 1 — ${parser.name} canonical parsing`, () => {
    for (const value of TRUTHY_VARIANTS) {
      it(`reads ${JSON.stringify(value)} as ON`, () => {
        assert.equal(withFlag(parser.flag, value, parser.read), true);
      });
    }

    for (const value of FALSY_VARIANTS) {
      it(`reads ${JSON.stringify(value)} as OFF (fail-closed)`, () => {
        assert.equal(withFlag(parser.flag, value, parser.read), false);
      });
    }

    it('defaults to OFF when the variable is absent', () => {
      assert.equal(withFlag(parser.flag, undefined, parser.read), false);
    });
  });
}

describe('Capa 1 — the legacy capability defaults OFF', () => {
  it('is false with no environment configuration at all', () => {
    assert.equal(
      withFlag(LEGACY_APOLLO_PROSPECT_GENERATION_FLAG, undefined, () =>
        isLegacyApolloProspectGenerationEnabled(),
      ),
      false,
    );
  });
});

// ── Capa 3: experience resolution ─────────────────────────────────────────────

describe('Capa 3 — resolveGenerateProspectsExperience', () => {
  it('chat wizard flag on + catalog ready → chat_wizard', () => {
    assert.equal(resolveGenerateProspectsExperience(true, false, READY), 'chat_wizard');
  });

  it('chat wizard takes precedence over v2', () => {
    assert.equal(resolveGenerateProspectsExperience(true, true, READY), 'chat_wizard');
  });

  it('v2 flag on + catalog ready → exploratory_form_v2', () => {
    assert.equal(
      resolveGenerateProspectsExperience(false, true, READY),
      'exploratory_form_v2',
    );
  });

  it('both flags off + catalog ready → unavailable', () => {
    assert.equal(resolveGenerateProspectsExperience(false, false, READY), 'unavailable');
  });
});

describe('Capa 3 — NO availability state resolves to legacy (the P0)', () => {
  for (const availability of NOT_READY) {
    for (const [chat, v2] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      it(`${availability.status} + chat=${chat} v2=${v2} → unavailable`, () => {
        const exp = resolveGenerateProspectsExperience(chat, v2, availability);
        assert.equal(exp, 'unavailable');
      });
    }
  }

  it('the experience union does not contain "legacy" at all', () => {
    // Type-level proof: this assignment must not compile as 'legacy'.
    const values: GenerateProspectsExperience[] = [
      'chat_wizard',
      'exploratory_form_v2',
      'unavailable',
    ];
    assert.equal(values.includes('legacy' as GenerateProspectsExperience), false);
  });

  it('never returns legacy across the full cartesian product of inputs', () => {
    const all: CatalogAvailability[] = [READY, ...NOT_READY];
    for (const availability of all) {
      for (const chat of [true, false]) {
        for (const v2 of [true, false]) {
          const exp = resolveGenerateProspectsExperience(chat, v2, availability);
          assert.notEqual(exp as string, 'legacy');
          assert.ok(
            ['chat_wizard', 'exploratory_form_v2', 'unavailable'].includes(exp),
          );
        }
      }
    }
  });
});

// ── Capa 4 inputs: which unavailable copy ─────────────────────────────────────

describe('Capa 4 — resolveGenerateProspectsUnavailableKind', () => {
  it('catalog ready + a flag on → null (no error state over a working wizard)', () => {
    assert.equal(resolveGenerateProspectsUnavailableKind(true, false, READY), null);
    assert.equal(resolveGenerateProspectsUnavailableKind(false, true, READY), null);
  });

  it('no flag on → wizard_disabled', () => {
    assert.equal(
      resolveGenerateProspectsUnavailableKind(false, false, DISABLED),
      'wizard_disabled',
    );
    assert.equal(
      resolveGenerateProspectsUnavailableKind(false, false, READY),
      'wizard_disabled',
    );
  });

  it('empty catalog → catalog_needs_admin (a retry cannot help)', () => {
    assert.equal(
      resolveGenerateProspectsUnavailableKind(true, false, EMPTY),
      'catalog_needs_admin',
    );
  });

  it('retryable read failure → catalog_retryable', () => {
    assert.equal(
      resolveGenerateProspectsUnavailableKind(true, false, RETRYABLE),
      'catalog_retryable',
    );
  });

  it('structural inconsistency → catalog_needs_admin', () => {
    assert.equal(
      resolveGenerateProspectsUnavailableKind(true, false, BROKEN),
      'catalog_needs_admin',
    );
  });

  it('unknown-reason failure → catalog_needs_admin (non-retryable)', () => {
    assert.equal(
      resolveGenerateProspectsUnavailableKind(true, false, {
        status: 'unavailable',
        reason: 'unknown',
        retryable: false,
      }),
      'catalog_needs_admin',
    );
  });
});
