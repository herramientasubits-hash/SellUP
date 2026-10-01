'use client';

/**
 * tab-presupuesto.tsx — pestaña «Presupuesto» del panel de un proveedor: el
 * plan contratado, la cuota (con su edición y su sincronización) y las reglas.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import { syncProviderQuota } from '@/modules/budgets';
import type { BudgetRuleFormOptions, BudgetRuleRow } from '@/modules/budgets/rule-queries';
import type { ProviderContractPlanView } from '@/modules/budgets/provider-contract-plan';
import { ProviderAllowanceDrawer } from '@/app/(sellup)/settings/budget-credits/provider-allowance-drawer';
import { ProviderContractPlanCard } from '../provider-contract-plan-card';
import type { ActionFeedback } from './detail-format';
import { LoadingBlock } from './detail-shared';
import { QuotaSection } from './quota-section';
import { ProviderRulesSection } from './provider-rules-section';

// ── Pestaña ───────────────────────────────────────────────────────────────────

export interface TabPresupuestoProps {
  row: AdminProviderBudgetRow;
  /** SETTINGS-PROVIDER-CONTRACT-PLAN-1 — null ⇒ proveedor sin contrato de créditos. */
  contractPlan?: ProviderContractPlanView | null;
  providerRules: BudgetRuleRow[];
  formOptions: BudgetRuleFormOptions | null;
  loading: boolean;
  onRefresh: () => void;
  onConfigureAllowance: (row: AdminProviderBudgetRow) => void;
}

export function TabPresupuesto({
  row,
  providerRules,
  formOptions,
  loading,
  onRefresh,
  contractPlan = null,
}: TabPresupuestoProps) {
  const router = useRouter();
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<ActionFeedback | null>(null);
  const isNotMeasured = row.measurementStatus === 'not_measured';

  const handleSync = () => {
    setSyncFeedback(null);
    setIsSyncing(true);
    startTransition(async () => {
      try {
        const result = await syncProviderQuota(row.providerKey);
        if (result.success) {
          setSyncFeedback({
            ok: true,
            msg: result.skippedAllowance
              ? 'Dato externo actualizado (cuota manual preservada).'
              : 'Cuota sincronizada con la API del proveedor.',
          });
          onRefresh();
          router.refresh();
        } else {
          setSyncFeedback({ ok: false, msg: result.error ?? 'No se pudo sincronizar la cuota.' });
        }
      } catch {
        setSyncFeedback({ ok: false, msg: 'No se pudo sincronizar la cuota.' });
      } finally {
        setIsSyncing(false);
      }
    });
  };

  return (
    <div className="space-y-4">
      {contractPlan && <ProviderContractPlanCard plan={contractPlan} />}

      <QuotaSection
        row={row}
        isSyncing={isSyncing}
        syncFeedback={syncFeedback}
        onEditQuota={() => setAllowanceOpen(true)}
        onSync={handleSync}
      />

      {loading ? (
        <LoadingBlock label="Cargando reglas..." />
      ) : (
        <ProviderRulesSection
          rules={providerRules}
          formOptions={formOptions}
          providerKey={row.providerKey}
          isNotMeasured={isNotMeasured}
          onRefresh={onRefresh}
        />
      )}

      <ProviderAllowanceDrawer
        provider={row}
        open={allowanceOpen}
        onClose={() => setAllowanceOpen(false)}
        onSaved={() => {
          setAllowanceOpen(false);
          startTransition(() => { window.location.reload(); });
        }}
      />
    </div>
  );
}
