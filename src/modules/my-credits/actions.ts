'use server';

/**
 * «Mis créditos» del menú de cuenta: lo que la persona conectada lleva gastado por
 * fuente este mes, frente a su límite.
 *
 * 🔴 SIN PARÁMETROS a propósito. Es una server action: cualquiera con sesión puede
 * invocarla desde el navegador. Si recibiera un `userId`, cualquiera leería el consumo
 * de otra persona (el mismo agujero que cerró SETTINGS-PROVIDERS-ADMIN-GUARD-1). La
 * identidad sale SIEMPRE de la sesión, y con «Ver como otro rol» sigue siendo la real.
 */

import { getCurrentActiveUser } from '@/modules/access/actions';
import { fetchAllPages } from '@/lib/supabase/paginated-read';
import { checkBudget } from '@/modules/budgets/budget-resolution';
import { getAdminClient, getAllActiveRules, getConsumptionForUser, getToolCatalog } from '@/modules/budgets/queries';
import { getPeriodBounds } from '@/modules/budgets/periods';
import {
  buildMyCreditsRows,
  sumOwnUsage,
  type MyCreditsProviderInput,
  type MyCreditsResult,
} from './core';

interface OwnUsageRow {
  provider_key: string | null;
  credits_used: number | string | null;
  estimated_cost_usd: number | string | null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getMyCreditUsage(): Promise<MyCreditsResult | null> {
  const me = await getCurrentActiveUser();
  if (!me) return null;

  const admin = getAdminClient();
  const month = getPeriodBounds('monthly');
  const monthStart = month.start.toISOString();
  const monthEnd = month.end.toISOString();

  const [rules, catalog, ownRead] = await Promise.all([
    getAllActiveRules(admin),
    getToolCatalog(admin),
    fetchAllPages<OwnUsageRow>((from, to) =>
      admin
        .from('provider_usage_logs')
        .select('provider_key, credits_used, estimated_cost_usd')
        .eq('triggered_by', me.id)
        .gte('created_at', monthStart)
        .lt('created_at', monthEnd)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ]);

  let partial = Boolean(ownRead.error) || ownRead.truncated;

  // Gasto propio del mes, por fuente.
  const ownByProvider = new Map<string, Array<{ creditsUsed: number | null; estimatedCostUsd: number | null }>>();
  for (const row of ownRead.rows) {
    const key = row.provider_key ?? '';
    if (!key) continue;
    const list = ownByProvider.get(key) ?? [];
    list.push({ creditsUsed: toNumber(row.credits_used), estimatedCostUsd: toNumber(row.estimated_cost_usd) });
    ownByProvider.set(key, list);
  }

  const providerKeys = [...new Set([...rules.map((r) => r.provider_key), ...ownByProvider.keys()])].filter(Boolean);

  const inputs = await Promise.all(
    providerKeys.map(async (providerKey): Promise<MyCreditsProviderInput | null> => {
      try {
        const check = await checkBudget(providerKey, me.id);
        const rule = check.matchedRule;
        const shared = rule !== null && rule.scopeType !== 'user';

        // Con cupo compartido, «tú usaste» se mide en el MISMO período que la regla.
        let own = sumOwnUsage(ownByProvider.get(providerKey) ?? []);
        if (shared && rule && rule.periodType !== 'monthly' && rule.periodType !== 'custom') {
          own = sumOwnUsage(
            await getConsumptionForUser(admin, providerKey, me.id, check.periodStart, check.periodEnd),
          );
        }

        return {
          providerKey,
          displayName: catalog.get(providerKey) ?? providerKey,
          rule: rule
            ? {
                scope: rule.scopeType,
                periodType: rule.periodType,
                limitCredits: rule.limitCredits,
                limitUsd: rule.limitUsd,
                onExceed: rule.onExceed,
                balance: rule.creditBalance ?? null,
                // Solo lo gastado: lo apartado por un revelado en curso (reservedCredits)
                // no cuenta hasta que se gasta (decisión del dueño, 27-nov).
                poolCredits: check.consumedCredits,
                poolUsd: check.consumedUsd,
              }
            : null,
          own,
        };
      } catch {
        partial = true;
        return null;
      }
    }),
  );

  return {
    periodStart: monthStart,
    periodEnd: monthEnd,
    rows: buildMyCreditsRows(inputs.filter((i): i is MyCreditsProviderInput => i !== null)),
    partial,
  };
}
