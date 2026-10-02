'use client';

/**
 * quota-section.tsx — «Cuota del proveedor» de la pestaña «Presupuesto»: de
 * dónde sale la cuota, cuánto es y sus dos acciones (editarla y sincronizarla
 * con la API del proveedor). Solo presentación: las acciones llegan por props.
 */

import { Database, Loader2, RefreshCw } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DrawerSection } from '@/components/shared/drawer-section';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import { monthlyCreditsLabel } from '../provider-contract-plan-card';
import {
  formatDateShort,
  quotaSourceLabel,
  SYNC_CAPABLE_PROVIDERS,
  type ActionFeedback,
} from './detail-format';
import { InfoList, InfoRow, InlineFeedback } from './detail-shared';

export function getQuotaButtonLabel(providerKey: string, row: AdminProviderBudgetRow): string | null {
  if (row.measurementStatus === 'not_measured') return null;
  const hasAllowance =
    row.providerMonthlyCreditsAllowance != null || row.providerMonthlyUsdAllowance != null;
  switch (providerKey) {
    case 'tavily':
    case 'lusha':
      return 'Editar cuota';
    case 'apollo':
      return hasAllowance ? 'Editar cuota manual' : 'Configurar cuota manual';
    case 'anthropic':
      return hasAllowance ? 'Editar presupuesto USD' : 'Configurar presupuesto USD';
    case 'openai':
    case 'gemini':
      return 'Configurar presupuesto';
    default:
      return hasAllowance ? 'Editar cuota' : 'Configurar cuota';
  }
}

function syncButtonLabel(isSyncing: boolean, quotaSource: AdminProviderBudgetRow['quotaSource']): string {
  if (isSyncing) return 'Sincronizando…';
  return quotaSource === 'sync_error' ? 'Reintentar sincronización' : 'Sincronizar con API';
}

function QuotaDetails({ row }: { row: AdminProviderBudgetRow }) {
  return (
    <>
      <InfoList>
        <InfoRow label="Fuente" value={<span className="text-muted-foreground">{quotaSourceLabel(row.quotaSource)}</span>} />
        <InfoRow
          // SETTINGS-PROVIDER-CONTRACT-PLAN-1 — la API de Lusha devuelve el
          // total del PLAN anual, no un cupo mensual: rotularlo «mensual»
          // multiplicaba por doce lo que se podía gastar.
          label={monthlyCreditsLabel(row)}
          value={row.providerMonthlyCreditsAllowance != null
            ? `${row.providerMonthlyCreditsAllowance.toLocaleString()} cr`
            : 'No configurado'}
        />
        <InfoRow
          label="Presupuesto USD"
          value={row.providerMonthlyUsdAllowance != null
            ? `$${row.providerMonthlyUsdAllowance.toFixed(2)}`
            : 'No configurado'}
        />
        {row.providerCreditsAvailable != null && (
          <InfoRow label="Créditos disponibles" value={`${row.providerCreditsAvailable.toLocaleString()} cr`} />
        )}
        {row.quotaSyncedAt && (
          <InfoRow
            label="Última sync"
            value={<span className="text-muted-foreground">{formatDateShort(row.quotaSyncedAt)}</span>}
          />
        )}
      </InfoList>
      {row.quotaSyncError && (
        <Alert variant="warning">
          <AlertDescription className="break-words text-xs">{row.quotaSyncError}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

export interface QuotaSectionProps {
  row: AdminProviderBudgetRow;
  isSyncing: boolean;
  syncFeedback: ActionFeedback | null;
  onEditQuota: () => void;
  onSync: () => void;
}

/** La cuota del proveedor y sus dos acciones: editarla y sincronizarla con su API. */
export function QuotaSection({ row, isSyncing, syncFeedback, onEditQuota, onSync }: QuotaSectionProps) {
  const quotaButtonLabel = getQuotaButtonLabel(row.providerKey, row);
  const isNotMeasured = row.measurementStatus === 'not_measured';
  const isSyncCapable = SYNC_CAPABLE_PROVIDERS.has(row.providerKey);

  return (
    <DrawerSection title="Cuota del proveedor" icon={Database} contentClassName="space-y-3">
      {isNotMeasured ? (
        <EmptyState
          variant="plain"
          title="Este proveedor no tiene cuota de medición configurada."
          className="py-4"
        />
      ) : (
        <QuotaDetails row={row} />
      )}

      <div className="flex flex-wrap gap-2 empty:hidden">
        {!isNotMeasured && quotaButtonLabel && (
          <Button variant="outline" size="xs" type="button" onClick={onEditQuota}>
            {quotaButtonLabel}
          </Button>
        )}
        {!isNotMeasured && isSyncCapable && (
          <Button variant="outline" size="xs" type="button" disabled={isSyncing} onClick={onSync}>
            {isSyncing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {syncButtonLabel(isSyncing, row.quotaSource)}
          </Button>
        )}
      </div>
      {!isNotMeasured && row.providerKey === 'anthropic' && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Sync de costo requiere Admin API key. Anthropic requiere una Admin API key
          para sincronizar costo USD. Mientras tanto, configura el presupuesto
          mensual de forma manual.
        </p>
      )}
      <InlineFeedback feedback={syncFeedback} />
    </DrawerSection>
  );
}
