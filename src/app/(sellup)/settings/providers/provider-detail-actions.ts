'use server';

import { getProviderDetail } from '@/modules/budgets/provider-detail-queries';
import type { ProviderUsageLogRow, ProviderSyncLogRow } from '@/modules/budgets/provider-detail-queries';
import type { BudgetRuleRow, BudgetRuleFormOptions } from '@/modules/budgets/rule-queries';

export type { ProviderUsageLogRow, ProviderSyncLogRow };

export interface SidepanelDetailData {
  usageLogs: ProviderUsageLogRow[];
  syncLogs: ProviderSyncLogRow[];
  providerRules: BudgetRuleRow[];
  formOptions: BudgetRuleFormOptions;
}

export async function loadProviderDetailForPanel(providerKey: string): Promise<SidepanelDetailData | null> {
  try {
    const detail = await getProviderDetail(providerKey);
    if (!detail) return null;
    return {
      usageLogs: detail.recentUsageLogs,
      syncLogs: detail.recentSyncLogs,
      providerRules: detail.allRulesForProvider,
      formOptions: detail.formOptions,
    };
  } catch {
    return null;
  }
}
