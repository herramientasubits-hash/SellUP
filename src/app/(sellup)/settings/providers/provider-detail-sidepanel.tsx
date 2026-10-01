'use client';

/**
 * provider-detail-sidepanel.tsx — el panel lateral de un proveedor.
 *
 * Es el orquestador: guarda qué pestaña está abierta, carga el detalle del
 * proveedor y reparte los datos. Cada pestaña vive en `./detail/`:
 *
 *   tab-resumen · tab-configuracion (+ tab-configuracion-ia) · tab-consumo ·
 *   tab-presupuesto (+ provider-rules-section) · tab-efectividad · tab-logs
 *
 * Anatomía (Foundation § 11): `DrawerShell` + `Tabs` + `DrawerSection`.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Activity, Settings, BarChart2, DollarSign, TrendingUp, ScrollText,
} from "@/icons";
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';
import {
  MEASUREMENT_STATUS_LABEL,
  MEASUREMENT_STATUS_BADGE,
  type MeasurementStatus,
} from '@/modules/budgets/provider-measurement';
import { getProviderOperationalContext } from '@/modules/budgets/provider-operational-type';
import {
  loadProviderDetailForPanel,
  type SidepanelDetailData,
  type AiConnectionPanelState,
  type ProspectingConnectionPanelState,
} from './provider-detail-actions';
import type { SidepanelInitialTab } from './detail/detail-format';
import { TabResumen } from './detail/tab-resumen';
import { TabConfiguracion } from './detail/tab-configuracion';
import { TabConsumo } from './detail/tab-consumo';
import { TabPresupuesto } from './detail/tab-presupuesto';
import { TabEfectividad } from './detail/tab-efectividad';
import { TabLogs } from './detail/tab-logs';

export type { SidepanelInitialTab };

// ── Main component ────────────────────────────────────────────────────────────

interface ProviderDetailSidepanelProps {
  provider: AdminProviderBudgetRow | null;
  open: boolean;
  initialTab?: SidepanelInitialTab;
  onClose: () => void;
  onConfigureAllowance: (row: AdminProviderBudgetRow) => void;
  allRules?: BudgetRuleRow[];
  providerConnectionStates?: Record<string, ProspectingConnectionPanelState>;
  aiProviderConnectionStates?: Record<string, AiConnectionPanelState>;
  /** Notified when the user switches tabs, so a parent can mirror it into the URL (Q3F-10E.1). Not called for the initialTab-driven sync. */
  onActiveTabChange?: (tab: SidepanelInitialTab) => void;
}

export function ProviderDetailSidepanel({
  provider,
  open,
  initialTab = 'resumen',
  onClose,
  onConfigureAllowance,
  allRules = [],
  providerConnectionStates,
  aiProviderConnectionStates,
  onActiveTabChange,
}: ProviderDetailSidepanelProps) {
  const ms: MeasurementStatus = provider?.measurementStatus ?? 'prepared';
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];

  const [detailData, setDetailData] = useState<SidepanelDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<SidepanelInitialTab>(initialTab);

  const fetchDetail = useCallback(async (providerKey: string) => {
    setLoadingDetail(true);
    try {
      const data = await loadProviderDetailForPanel(providerKey);
      if (data) setDetailData(data);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!provider) {
      setDetailData(null);
      return;
    }
    setDetailData(null);
    fetchDetail(provider.providerKey);
  }, [provider?.providerKey, fetchDetail]);

  // Respect initialTab when provider or entry point changes
  useEffect(() => {
    setActiveTab(initialTab);
  }, [provider?.providerKey, initialTab]);

  // URL-safe tab navigation (Q3F-13S) — identical to the Tabs onValueChange
  // handler below. Any programmatic tab switch (e.g. an investigation CTA)
  // must go through this, not setActiveTab alone, or the URL (?ptab=) falls
  // out of sync with the visible tab.
  const navigateToTab = useCallback(
    (tab: SidepanelInitialTab) => {
      setActiveTab(tab);
      onActiveTabChange?.(tab);
    },
    [onActiveTabChange],
  );

  const hasAttention = provider && (
    (provider.quotaSource === 'sync_error' && !provider.providerMonthlyCreditsAllowance && !provider.providerMonthlyUsdAllowance) ||
    (provider.remainingCredits != null && provider.remainingCredits <= 0) ||
    (provider.remainingUsd != null && provider.remainingUsd <= 0)
  );

  // Use lazy-loaded rules when available, fall back to filtered allRules
  const providerRules = detailData?.providerRules
    ?? (provider ? allRules.filter((r) => r.provider_key === provider.providerKey) : []);

  const usageLogs = detailData?.usageLogs ?? [];
  const syncLogs = detailData?.syncLogs ?? [];
  const formOptions = detailData?.formOptions ?? null;

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      size="workspace"
      title={provider?.displayName ?? provider?.providerKey ?? 'Proveedor'}
      titleBadge={
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={msBadge.className}>
            {MEASUREMENT_STATUS_LABEL[ms]}
          </Badge>
          {hasAttention && <Badge variant="warning">Atención</Badge>}
        </div>
      }
      description={provider ? getProviderOperationalContext(provider.providerKey) : ''}
      icon={<Activity className="h-4 w-4" />}
    >
      {provider && (
        <Tabs
          value={activeTab}
          onValueChange={(v) => navigateToTab(v as SidepanelInitialTab)}
        >
          <TabsList variant="segmented" className="mb-5 max-w-full overflow-x-auto">
            <TabsTrigger value="resumen">
              <Activity className="h-4 w-4" />
              Resumen
            </TabsTrigger>
            <TabsTrigger value="configuracion">
              <Settings className="h-4 w-4" />
              Config.
            </TabsTrigger>
            <TabsTrigger value="consumo">
              <BarChart2 className="h-4 w-4" />
              Consumo
            </TabsTrigger>
            <TabsTrigger value="presupuesto">
              <DollarSign className="h-4 w-4" />
              Presupuesto
            </TabsTrigger>
            <TabsTrigger value="efectividad">
              <TrendingUp className="h-4 w-4" />
              Efectividad
            </TabsTrigger>
            <TabsTrigger value="logs">
              <ScrollText className="h-4 w-4" />
              Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="resumen">
            <TabResumen
              row={provider}
              ms={ms}
              usageLogs={usageLogs}
              syncLogs={syncLogs}
              providerRules={providerRules}
              loadingDetail={loadingDetail}
              onNavigate={setActiveTab}
            />
          </TabsContent>

          <TabsContent value="configuracion">
            <TabConfiguracion
              row={provider}
              ms={ms}
              initialConnState={providerConnectionStates?.[provider.providerKey.toLowerCase()]}
              aiInitialConnState={aiProviderConnectionStates?.[provider.providerKey.toLowerCase()]}
              aiProviderDetail={detailData?.aiProviderDetail ?? null}
              loadingDetail={loadingDetail}
              onRefresh={() => fetchDetail(provider.providerKey)}
            />
          </TabsContent>

          <TabsContent value="consumo">
            <TabConsumo row={provider} ms={ms} providerKey={provider.providerKey} isActive={activeTab === 'consumo'} />
          </TabsContent>

          <TabsContent value="presupuesto">
            <TabPresupuesto
              row={provider}
              contractPlan={detailData?.contractPlan ?? null}
              providerRules={providerRules}
              formOptions={formOptions}
              loading={loadingDetail}
              onRefresh={() => fetchDetail(provider.providerKey)}
              onConfigureAllowance={onConfigureAllowance}
            />
          </TabsContent>

          <TabsContent value="efectividad">
            <TabEfectividad
              row={provider}
              usageLogs={usageLogs}
              syncLogs={syncLogs}
              contactEnrichmentEffectiveness={detailData?.contactEnrichmentEffectiveness ?? null}
              loading={loadingDetail}
              onRevisarLogs={() => navigateToTab('logs')}
            />
          </TabsContent>

          <TabsContent value="logs">
            <TabLogs
              row={provider}
              ms={ms}
              usageLogs={usageLogs}
              syncLogs={syncLogs}
              loading={loadingDetail}
              isActive={activeTab === 'logs'}
            />
          </TabsContent>
        </Tabs>
      )}
    </DrawerShell>
  );
}
