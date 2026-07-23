/**
 * Q3F-5BB.3F — Pure final-review summary helpers.
 *
 * Proves the display-label resolution used by the "Revisa tu búsqueda" step:
 *   - Sector shows the wizard's own industry NAME (e.g. "Tecnología").
 *   - The selected SUBINDUSTRY human label is surfaced (never just an id), and
 *     is null when none was chosen.
 *   - Additional criterion is trimmed and null when empty.
 *   - The full recap carries the fixed final-review copy (title, size, provider,
 *     cost, read-only note) unchanged.
 * Pure module: no DOM, no network, no mocks.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import {
  buildWizardFinalSummaryLabels,
  buildWizardFinalRecap,
  WIZARD_FINAL_SIZE_LABEL,
  WIZARD_FINAL_PROVIDER_LABEL,
  WIZARD_FINAL_COST_LABEL,
  WIZARD_FINAL_REVIEW_TITLE,
} from '@/modules/prospect-batches/wizard-final-summary';

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'tech', name: 'Tecnología', slug: 'tech', description: null, sortOrder: 0 },
    { id: 'health', name: 'Salud', slug: 'health', description: null, sortOrder: 1 },
  ],
  subindustries: [
    {
      id: 'saas',
      industryId: 'tech',
      name: 'Software Empresarial (SaaS / ERP / CRM)',
      slug: 'saas',
      description: null,
      applicableCountries: null,
      sortOrder: 0,
    },
    {
      id: 'cyber',
      industryId: 'tech',
      name: 'Cybersecurity',
      slug: 'cyber',
      description: null,
      applicableCountries: null,
      sortOrder: 1,
    },
  ],
};

describe('buildWizardFinalSummaryLabels', () => {
  it('resolves the industry NAME as the sector label', () => {
    const labels = buildWizardFinalSummaryLabels(
      { industryId: 'tech', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
    );
    assert.equal(labels.sectorLabel, 'Tecnología');
  });

  it('surfaces the selected subindustry human label (not an id)', () => {
    const labels = buildWizardFinalSummaryLabels(
      { industryId: 'tech', subindustryIds: ['saas'], additionalCriteriaRaw: null },
      CATALOG,
    );
    assert.equal(labels.subIndustryLabel, 'Software Empresarial (SaaS / ERP / CRM)');
  });

  it('joins multiple selected subindustries', () => {
    const labels = buildWizardFinalSummaryLabels(
      { industryId: 'tech', subindustryIds: ['saas', 'cyber'], additionalCriteriaRaw: null },
      CATALOG,
    );
    assert.equal(
      labels.subIndustryLabel,
      'Software Empresarial (SaaS / ERP / CRM), Cybersecurity',
    );
  });

  it('subIndustryLabel is null when none was selected', () => {
    const labels = buildWizardFinalSummaryLabels(
      { industryId: 'tech', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
    );
    assert.equal(labels.subIndustryLabel, null);
  });

  it('trims the additional criterion and is null when empty', () => {
    const withCriteria = buildWizardFinalSummaryLabels(
      { industryId: 'tech', subindustryIds: [], additionalCriteriaRaw: '  empresas grandes  ' },
      CATALOG,
    );
    assert.equal(withCriteria.criteriaLabel, 'empresas grandes');

    const blank = buildWizardFinalSummaryLabels(
      { industryId: 'tech', subindustryIds: [], additionalCriteriaRaw: '   ' },
      CATALOG,
    );
    assert.equal(blank.criteriaLabel, null);
  });

  it('sector falls back to em dash for an unknown industry', () => {
    const labels = buildWizardFinalSummaryLabels(
      { industryId: 'missing', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
    );
    assert.equal(labels.sectorLabel, '—');
  });
});

describe('buildWizardFinalRecap', () => {
  it('carries the fixed final-review copy alongside resolved labels', () => {
    const recap = buildWizardFinalRecap(
      {
        industryId: 'tech',
        subindustryIds: ['saas'],
        additionalCriteriaRaw: 'empresas grandes de más de 200 empleados',
      },
      CATALOG,
    );
    assert.equal(recap.title, WIZARD_FINAL_REVIEW_TITLE);
    assert.equal(recap.sectorLabel, 'Tecnología');
    assert.equal(recap.subIndustryLabel, 'Software Empresarial (SaaS / ERP / CRM)');
    assert.equal(recap.criteriaLabel, 'empresas grandes de más de 200 empleados');
    assert.equal(recap.sizeLabel, WIZARD_FINAL_SIZE_LABEL);
    assert.equal(recap.providerLabel, WIZARD_FINAL_PROVIDER_LABEL);
    assert.equal(recap.costLabel, WIZARD_FINAL_COST_LABEL);
    assert.ok(recap.readOnlyNote.length > 0);
  });
});
