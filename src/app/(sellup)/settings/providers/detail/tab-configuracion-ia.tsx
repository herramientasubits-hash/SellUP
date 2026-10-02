'use client';

/**
 * tab-configuracion-ia.tsx — pestaña «Config.» de un proveedor de IA: su
 * conexión, si está activo, sus modelos con tarifa y cómo se mide.
 */

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Bot, Cpu, Database, Loader2, Lock, Power, RefreshCw } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { DrawerSection } from '@/components/shared/drawer-section';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import { MEASUREMENT_STATUS_LABEL, type MeasurementStatus } from '@/modules/budgets/provider-measurement';
import type { AiProviderDetailResult } from '@/modules/ai-config/provider-ai-detail-queries';
import {
  disconnectAiProviderForPanel,
  syncAnthropicModelsForPanel,
  testAiProviderConnectionForPanel,
  updateAiProviderCredentialForPanel,
  updateAiProviderStatusForPanel,
  type AiConnectionPanelState,
} from '../provider-detail-actions';
import { AiModelRow } from './ai-model-row';
import { ConnectionControls } from './connection-controls';
import { ReadOnlyToggle } from './config-pieces';
import { formatDateShort, quotaSourceLabel, type ActionFeedback } from './detail-format';
import { ConnectionStatusBadge, InfoList, InfoRow, InlineFeedback, LoadingBlock } from './detail-shared';

export interface TabConfiguracionIAProps {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  initialConnState?: AiConnectionPanelState | null;
  aiProviderDetail: AiProviderDetailResult | null;
  loadingDetail: boolean;
  onRefresh: () => void;
}

/** Conexión del proveedor de IA: estado, credencial y sus tres acciones. */
function AiConnectionSection({
  providerKey,
  initialConnState,
}: {
  providerKey: string;
  initialConnState?: AiConnectionPanelState | null;
}) {
  const router = useRouter();
  const [connState, setConnState] = useState<AiConnectionPanelState | null>(initialConnState ?? null);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Sync when server re-renders with fresh initial state (after router.refresh())
  useEffect(() => {
    setConnState(initialConnState ?? null);
  }, [initialConnState]);

  const handleTest = () => {
    setFeedback(null);
    startTransition(async () => {
      const r = await testAiProviderConnectionForPanel(providerKey);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Conexión verificada' : 'Error al probar') });
      router.refresh();
    });
  };

  const handleSaveKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    setFeedback(null);
    startTransition(async () => {
      const r = await updateAiProviderCredentialForPanel(providerKey, trimmed);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Credencial guardada' : 'Error al guardar') });
      setApiKeyInput('');
      if (r.ok) setShowKeyForm(false);
      router.refresh();
    });
  };

  const handleDisconnect = () => {
    setFeedback(null);
    startTransition(async () => {
      const r = await disconnectAiProviderForPanel(providerKey);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Desconectado' : 'Error al desconectar') });
      setShowDisconnectConfirm(false);
      router.refresh();
    });
  };

  return (
    <DrawerSection title="Conexión" icon={Activity} contentClassName="space-y-3">
      <InfoList>
        <InfoRow
          label="Estado"
          value={<ConnectionStatusBadge status={connState?.connectionStatus ?? 'not_configured'} />}
        />
        <InfoRow
          label="Credencial"
          value={
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
              {connState?.hasCredential ? 'Credencial almacenada' : 'Sin credencial'}
            </span>
          }
        />
        {connState?.lastTestedAt && (
          <InfoRow
            label="Última prueba"
            value={<span className="text-muted-foreground">{formatDateShort(connState.lastTestedAt)}</span>}
          />
        )}
        {connState?.lastConnectionError && (
          <InfoRow
            label="Error"
            value={<span className="text-xs leading-relaxed text-destructive">{connState.lastConnectionError}</span>}
          />
        )}
      </InfoList>

      <ConnectionControls
        isPending={isPending}
        hasCredential={Boolean(connState?.hasCredential)}
        feedback={feedback}
        showKeyForm={showKeyForm}
        apiKeyInput={apiKeyInput}
        keyPlaceholder="sk-••••••••"
        onApiKeyChange={setApiKeyInput}
        onToggleKeyForm={() => { setShowKeyForm((v) => !v); setShowDisconnectConfirm(false); }}
        onCancelKeyForm={() => { setShowKeyForm(false); setApiKeyInput(''); }}
        onSaveKey={handleSaveKey}
        showDisconnectConfirm={showDisconnectConfirm}
        disconnectTitle="¿Desconectar el proveedor?"
        disconnectDescription="Se eliminarán las credenciales. Esta acción no se puede deshacer."
        onRequestDisconnect={() => { setShowDisconnectConfirm((v) => !v); setShowKeyForm(false); }}
        onCancelDisconnect={() => setShowDisconnectConfirm(false)}
        onDisconnect={handleDisconnect}
        onTest={handleTest}
      />
    </DrawerSection>
  );
}

/** Si el proveedor de IA está activo, y el botón que lo cambia. */
function AiProviderStatusSection({
  aiProviderDetail,
  onRefresh,
}: {
  aiProviderDetail: AiProviderDetailResult;
  onRefresh: () => void;
}) {
  const [statusPending, startStatusTransition] = useTransition();
  const [statusFeedback, setStatusFeedback] = useState<ActionFeedback | null>(null);
  const isActive = aiProviderDetail.providerStatus === 'active';

  const handleToggleProviderStatus = () => {
    const nextStatus = aiProviderDetail.providerStatus === 'active' ? 'inactive' : 'active';
    setStatusFeedback(null);
    startStatusTransition(async () => {
      const r = await updateAiProviderStatusForPanel(aiProviderDetail.providerId, nextStatus);
      setStatusFeedback({ ok: r.ok, msg: r.error ?? (r.ok ? 'Estado del proveedor actualizado' : 'Error al actualizar estado') });
      if (r.ok) onRefresh();
    });
  };

  return (
    <DrawerSection
      title="Estado del proveedor IA"
      icon={Power}
      tone={isActive ? 'positive' : 'neutral'}
      contentClassName="space-y-3"
    >
      <InfoList>
        <InfoRow
          label="Estado"
          value={<Badge variant={isActive ? 'positive' : 'neutral'}>{isActive ? 'Activo' : 'Inactivo'}</Badge>}
        />
      </InfoList>
      <Button size="xs" variant="outline" type="button" disabled={statusPending} onClick={handleToggleProviderStatus}>
        {statusPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Power aria-hidden="true" />}
        {isActive ? 'Desactivar proveedor' : 'Activar proveedor'}
      </Button>
      <InlineFeedback feedback={statusFeedback} />
    </DrawerSection>
  );
}

/** Modelos disponibles, su tarifa vigente y la actualización del catálogo. */
function AiModelsSection({
  aiProviderDetail,
  loadingDetail,
  isAnthropic,
  onRefresh,
}: {
  aiProviderDetail: AiProviderDetailResult | null;
  loadingDetail: boolean;
  isAnthropic: boolean;
  onRefresh: () => void;
}) {
  const [syncPending, startSyncTransition] = useTransition();
  const [syncFeedback, setSyncFeedback] = useState<ActionFeedback | null>(null);

  const handleSyncModels = () => {
    setSyncFeedback(null);
    startSyncTransition(async () => {
      const r = await syncAnthropicModelsForPanel();
      setSyncFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Modelos actualizados' : 'Error al actualizar modelos') });
      if (r.ok) onRefresh();
    });
  };

  const modelCount = aiProviderDetail?.models.length ?? 0;

  return (
    <DrawerSection
      title="Modelos y tarifas"
      hint="Modelos disponibles y tarifa vigente para este proveedor."
      icon={Cpu}
      badge={modelCount > 0 ? modelCount : undefined}
      contentClassName="space-y-3"
      action={
        isAnthropic ? (
          <Button size="xs" variant="outline" type="button" disabled={syncPending} onClick={handleSyncModels}>
            {syncPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Actualizar modelos
          </Button>
        ) : undefined
      }
    >
      {loadingDetail ? (
        <LoadingBlock label="Cargando modelos..." />
      ) : !aiProviderDetail || aiProviderDetail.models.length === 0 ? (
        <EmptyState variant="plain" title="Sin modelos configurados para este proveedor." className="py-4" />
      ) : (
        <>
          <InfoList>
            <InfoRow
              label="Modelo activo"
              value={
                aiProviderDetail.isActiveProviderGlobal && aiProviderDetail.activeModelKey ? (
                  <span className="text-foreground">{aiProviderDetail.activeModelKey}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Ningún modelo de este proveedor está activo globalmente</span>
                )
              }
            />
          </InfoList>
          {!aiProviderDetail.models.some((m) => m.latestPricing) && (
            <p className="text-xs text-muted-foreground">Sin tarifa vigente configurada.</p>
          )}
          <ul className="divide-y divide-border/50 border-t border-border/50 pt-3">
            {aiProviderDetail.models.map((m) => (
              <AiModelRow key={m.id} model={m} providerId={aiProviderDetail.providerId} onRefresh={onRefresh} />
            ))}
          </ul>
        </>
      )}
      <InlineFeedback feedback={syncFeedback} />
    </DrawerSection>
  );
}

export function TabConfiguracionIA({
  row,
  ms,
  initialConnState,
  aiProviderDetail,
  loadingDetail,
  onRefresh,
}: TabConfiguracionIAProps) {
  const isAnthropic = row.providerKey.toLowerCase() === 'anthropic';
  const measurementUnit = row.providerMonthlyCreditsAllowance != null ? 'Créditos'
    : row.providerMonthlyUsdAllowance != null ? 'USD'
    : 'No definida';

  return (
    <div className="space-y-4">
      <AiConnectionSection providerKey={row.providerKey} initialConnState={initialConnState} />

      {aiProviderDetail && <AiProviderStatusSection aiProviderDetail={aiProviderDetail} onRefresh={onRefresh} />}

      <AiModelsSection
        aiProviderDetail={aiProviderDetail}
        loadingDetail={loadingDetail}
        isAnthropic={isAnthropic}
        onRefresh={onRefresh}
      />

      <DrawerSection title="Medición y consumo" icon={Database} tone="neutral">
        <InfoList>
          <InfoRow label="Modo de medición" value={MEASUREMENT_STATUS_LABEL[ms]} />
          <InfoRow label="Unidad" value={<span className="text-muted-foreground">{measurementUnit}</span>} />
          <InfoRow label="Fuente" value={<span className="text-muted-foreground">{quotaSourceLabel(row.quotaSource)}</span>} />
        </InfoList>
        <div className="mt-2 border-t border-border/50">
          <ReadOnlyToggle
            label="Participa en reportes de consumo"
            checked={ms === 'active'}
            note="Activo cuando hay registros de uso medidos"
          />
        </div>
      </DrawerSection>

      <DrawerSection title="Uso operativo" icon={Bot} tone="neutral">
        <ReadOnlyToggle
          label="Habilitado para agentes"
          checked={ms === 'active' || ms === 'connected'}
          note="Pendiente de configurar por agente"
        />
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          La configuración por agente se conectará progresivamente dentro de este workspace.
        </p>
      </DrawerSection>
    </div>
  );
}
