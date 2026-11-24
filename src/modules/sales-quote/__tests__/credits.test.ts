/**
 * Planes de créditos y recomendador: igual al cotizador original
 * (`fixtures/oracle-credits.json`, generado con su código el 24-11-2026).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CREDIT_PACK_2026,
  CREDIT_PACK_2027,
  clampPacks,
  creditTierOptions,
  lmsAiUsage,
  recommendCreditTier,
  selectionCreditsUsed,
  selectionMix,
  type CreditFit,
  type CreditTier,
  type LmsAiUsageSetId,
  type UsageQuantities,
} from '../credits';

const FIT_FROM_ORIGINAL: Record<string, CreditFit> = { alcanza: 'fits', justo: 'tight', 'no-alcanza': 'short' };

interface OriginalOption {
  tier: CreditTier;
  price: number;
  credits: number;
  ratio: number;
  status: string;
  topups: number;
  totalCost: number;
  slack: number;
}

const fromOriginal = (option: OriginalOption | null) =>
  option && {
    tier: option.tier,
    price: option.price,
    credits: option.credits,
    ratio: option.ratio,
    fit: FIT_FROM_ORIGINAL[option.status],
    packs: option.topups,
    totalCost: option.totalCost,
    slack: option.slack,
  };

const oracle: {
  tierOptions: { used: number; pack: '2026' | '2027'; options: OriginalOption[]; recommended: OriginalOption | null }[];
  usage: {
    setId: LmsAiUsageSetId;
    tier: CreditTier | null;
    packs: number;
    quantities: UsageQuantities;
    expected: Record<string, number | string>;
  }[];
  selection: { industry: number; vacancies: number; expected: number }[];
} = JSON.parse(readFileSync(new URL('./fixtures/oracle-credits.json', import.meta.url), 'utf8'));

describe('créditos · igual al original', () => {
  it('opciones de plan y recomendación', () => {
    for (const { used, pack, options, recommended } of oracle.tierOptions) {
      const creditPack = pack === '2026' ? CREDIT_PACK_2026 : CREDIT_PACK_2027;
      assert.deepEqual(creditTierOptions(used, creditPack), options.map(fromOriginal), `${used} · ${pack}`);
      assert.deepEqual(recommendCreditTier(used, creditPack), fromOriginal(recommended), `${used} · ${pack}`);
    }
  });

  it('consumo de LMS AI frente al plan', () => {
    for (const { setId, tier, packs, quantities, expected } of oracle.usage) {
      const { status, ...numbers } = expected;
      const usage = lmsAiUsage(setId, quantities, tier, packs, CREDIT_PACK_2027);
      const { fit, ...rest } = usage;
      assert.deepEqual(rest, numbers);
      assert.equal(fit, FIT_FROM_ORIGINAL[status as string]);
    }
  });

  it('consumo de Selección por industria', () => {
    for (const { industry, vacancies, expected } of oracle.selection) {
      assert.equal(selectionCreditsUsed(vacancies, selectionMix(industry)), expected);
    }
  });
});

describe('créditos · paquetes', () => {
  it('entero, sin negativos y con tope de 20', () => {
    assert.equal(clampPacks(2.7, CREDIT_PACK_2027), 2);
    assert.equal(clampPacks(-1, CREDIT_PACK_2027), 0);
    assert.equal(clampPacks(25, CREDIT_PACK_2027), 20);
  });
});
