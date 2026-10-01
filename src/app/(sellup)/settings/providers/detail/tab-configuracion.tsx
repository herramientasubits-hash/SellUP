'use client';

/**
 * tab-configuracion.tsx — pestaña «Config.» del panel de un proveedor. Reparte
 * entre la de IA (`tab-configuracion-ia`) y la de los proveedores de datos, que
 * vive aquí: conexión, para qué se usa, su estado operativo y notas.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Bot, Lock, Settings, Zap } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { DrawerSection } from '@/components/shared/drawer-section';
import type { AdminProviderBudgetRow } from '@/modules/budgets';
import {
  MEASUREMENT_STATUS_BADGE,
  MEASUREMENT_STATUS_LABEL,
  type MeasurementStatus,
} from '@/modules/budgets/provider-measurement';
import {
  getProviderOperationalType,
  OPERATIONAL_TYPE_BADGE,
  OPERATIONAL_TYPE_LABEL,
} from '@/modules/budgets/provider-operational-type';
import type { AiProviderDetailResult } from '@/modules/ai-config/provider-ai-detail-queries';
import {
  disconnectProspectingProviderForPanel,
  loadProspectingProviderConnectionForPanel,
  testProspectingProviderConnectionForPanel,
  updateProspectingProviderCredentialForPanel,
  type AiConnectionPanelState,
  type ProspectingConnectionPanelState,
} from '../provider-detail-actions';
import { ConfigNotes, type ConfigNote } from './config-pieces';
import { ConnectionControls } from './connection-controls';
import {
  deriveConsumedInfo,
  formatAllowance,
  formatDateShort,
  quotaSourceLabel,
  type ActionFeedback,
} from './detail-format';
import {
  ConnectionStatusBadge,
  InfoList,
  InfoRow,
  LoadingBlock,
  ProgressiveNote,
  RetryAlert,
} from './detail-shared';
import { TabConfiguracionIA } from './tab-configuracion-ia';

const OPERATIONAL_USE_MAP: Record<string, string> = {
  tavily:  'Búsqueda web y señales externas en prospección y enriquecimiento',
  lusha:   'Enriquecimiento de contactos (teléfono, email verificado)',
  apollo:  'Prospección de cuentas y enriquecimiento de contactos',
  samu_ia: 'Post-reunión — no medido directamente desde SellUp',
};

const MODULES_MAP: Record<string, string> = {
  tavily: 'Agente 1, Prospección',
  lusha:  'Agente 2A, Enriquecimiento',
  apollo: 'Agente 1, Agente 2A, Enriquecimiento',
};

const API_KEY_NOTES: Record<string, { where: string; tips: string }> = {
  apollo: {
    where: 'En app.apollo.io → Settings → Integrations → API Keys.',
    tips:  'Se requiere plan Professional o superior para acceso a People Search.',
  },
  lusha: {
    where: 'En dashboard.lusha.com → Integrations → API.',
    tips:  'Asegúrate de activar los permisos de Person Enrichment.',
  },
  tavily: {
    where: 'En app.tavily.com → API Keys.',
    tips:  'Cada test de conexión consume 1 crédito de Tavily.',
  },
};

const ADVANCED_NOTE: ConfigNote = {
  id: 'advanced',
  label: 'Configuración avanzada por agente',
  body: 'La configuración avanzada por agente se conectará progresivamente dentro del workspace del proveedor.',
};

function configNotesFor(pkey: string): ConfigNote[] {
  const apiNotes = API_KEY_NOTES[pkey];
  if (!apiNotes) return [ADVANCED_NOTE];
  return [
    { id: 'where', label: 'Dónde obtener la API key', body: apiNotes.where },
    { id: 'tips', label: 'Recomendaciones de configuración', body: apiNotes.tips },
    ADVANCED_NOTE,
  ];
}

/** Conexión de un proveedor de datos: estado, credencial y sus tres acciones. */
function ProspectingConnectionSection({
  pkey,
  initialConnState,
}: {
  pkey: string;
  initialConnState?: ProspectingConnectionPanelState | null;
}) {
  const router = useRouter();
  const isProspecting = pkey === 'apollo' || pkey === 'lusha';

  const [connState, setConnState] = useState<ProspectingConnectionPanelState | null>(initialConnState ?? null);
  const [loadingConn, setLoadingConn] = useState(isProspecting ? false : true);
  const [connLoadError, setConnLoadError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Sync when server re-renders with fresh state (after router.refresh())
  useEffect(() => {
    if (initialConnState) {
      setConnState(initialConnState);
      setLoadingConn(false);
      setConnLoadError(false);
    }
  }, [initialConnState]);

  const loadConn = useCallback(async () => {
    setLoadingConn(true);
    setConnLoadError(false);
    try {
      const s = await loadProspectingProviderConnectionForPanel(pkey);
      setConnState(s);
    } catch {
      setConnLoadError(true);
    } finally {
      setLoadingConn(false);
    }
  }, [pkey]);

  // Only fetch on mount for non-prospecting providers (e.g. tavily)
  useEffect(() => {
    if (!isProspecting) void loadConn();
  }, [loadConn, isProspecting]);

  // After mutations: server-refresh for apollo/lusha, direct reload for others
  const refreshConn = useCallback(() => {
    if (isProspecting) {
      router.refresh();
    } else {
      void loadConn();
    }
  }, [isProspecting, router, loadConn]);

  const handleTest = () => {
    setFeedback(null);
    startTransition(async () => {
      const r = await testProspectingProviderConnectionForPanel(pkey);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Conexión verificada' : 'Error al probar') });
      refreshConn();
    });
  };

  const handleSaveKey = () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) return;
    setFeedback(null);
    startTransition(async () => {
      const r = await updateProspectingProviderCredentialForPanel(pkey, trimmed);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Credencial guardada' : 'Error al guardar') });
      setApiKeyInput('');
      if (r.ok) setShowKeyForm(false);
      refreshConn();
    });
  };

  const handleDisconnect = () => {
    setFeedback(null);
    startTransition(async () => {
      const r = await disconnectProspectingProviderForPanel(pkey);
      setFeedback({ ok: r.ok, msg: r.message ?? r.error ?? (r.ok ? 'Desconectado' : 'Error al desconectar') });
      setShowDisconnectConfirm(false);
      refreshConn();
    });
  };

  const supported = connState?.supported !== false;
  const hasCredential = connState?.credentialsStatus === 'stored';

  return (
    <DrawerSection title="Conexión" icon={Activity} contentClassName="space-y-3">
      {loadingConn ? (
        <LoadingBlock label="Cargando estado de conexión..." />
      ) : connLoadError || connState?.loadErrorMsg ? (
        <RetryAlert
          title={connState?.loadErrorMsg ?? 'No fue posible cargar el estado de conexión.'}
          onRetry={() => void loadConn()}
        />
      ) : !supported ? (
        <ProgressiveNote>
          Configuración progresiva — este proveedor estará disponible en una próxima versión del workspace.
        </ProgressiveNote>
      ) : (
        <>
          <InfoList>
            <InfoRow
              label="Estado de conexión"
              value={<ConnectionStatusBadge status={connState?.connectionStatus ?? 'not_configured'} />}
            />
            <InfoRow
              label="Credencial"
              value={
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {hasCredential ? 'Credencial almacenada' : 'Sin credencial'}
                </span>
              }
            />
            {connState?.lastTestedAt && (
              <InfoRow
                label="Última prueba"
                value={<span className="text-muted-foreground">{formatDateShort(connState.lastTestedAt)}</span>}
              />
            )}
            {connState?.lastConnectedAt && (
              <InfoRow
                label="Última conexión"
                value={<span className="text-muted-foreground">{formatDateShort(connState.lastConnectedAt)}</span>}
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
            hasCredential={hasCredential}
            feedback={feedback}
            showKeyForm={showKeyForm}
            apiKeyInput={apiKeyInput}
            keyPlaceholder="••••••••"
            onApiKeyChange={setApiKeyInput}
            onToggleKeyForm={() => { setShowKeyForm((v) => !v); setShowDisconnectConfirm(false); }}
            onCancelKeyForm={() => { setShowKeyForm(false); setApiKeyInput(''); }}
            onSaveKey={handleSaveKey}
            showDisconnectConfirm={showDisconnectConfirm}
            disconnectTitle="¿Desconectar el proveedor?"
            disconnectDescription="Se eliminarán las credenciales almacenadas."
            onRequestDisconnect={() => { setShowDisconnectConfirm((v) => !v); setShowKeyForm(false); }}
            onCancelDisconnect={() => setShowDisconnectConfirm(false)}
            onDisconnect={handleDisconnect}
            onTest={handleTest}
          />
        </>
      )}
    </DrawerSection>
  );
}

/** Cómo está el proveedor hoy: tipo, medición, consumo, cuota y sincronización. */
function OperationalStatusSection({ row, ms }: { row: AdminProviderBudgetRow; ms: MeasurementStatus }) {
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];
  const opType = getProviderOperationalType(row.providerKey);
  const opBadge = OPERATIONAL_TYPE_BADGE[opType];

  const allowance = formatAllowance(row.providerMonthlyCreditsAllowance, row.providerMonthlyUsdAllowance);
  const consumed: { label: string; description?: string } = ms === 'active'
    ? (() => {
        const info = deriveConsumedInfo(row.consumedCredits, row.consumedUsd, row.hasUnknownCost);
        return info.label === '—' ? { label: '0 cr' } : info;
      })()
    : { label: '—' };

  const syncedAt = row.quotaSyncedAt
    ? formatDateShort(row.quotaSyncedAt)
    : row.latestBudgetCheckLog?.createdAt
      ? formatDateShort(row.latestBudgetCheckLog.createdAt)
      : null;

  return (
    <DrawerSection title="Estado operativo" icon={Zap}>
      <InfoList>
        <InfoRow
          label="Tipo operativo"
          value={<Badge variant="outline" className={opBadge}>{OPERATIONAL_TYPE_LABEL[opType]}</Badge>}
        />
        <InfoRow
          label="Estado de medición"
          value={<Badge variant="outline" className={msBadge.className}>{MEASUREMENT_STATUS_LABEL[ms]}</Badge>}
        />
        <InfoRow label="Consumo del mes" value={<span title={consumed.description}>{consumed.label}</span>} />
        <InfoRow label="Cuota configurada" value={allowance} />
        <InfoRow
          label="Fuente de cuota"
          value={<span className="text-muted-foreground">{quotaSourceLabel(row.quotaSource)}</span>}
        />
        {row.creditsRemainingExternal != null && (
          <InfoRow
            label="Créditos disponibles (API)"
            value={<span className="text-foreground">{row.creditsRemainingExternal.toLocaleString()}</span>}
          />
        )}
        {syncedAt && <InfoRow label="Última sync" value={<span className="text-muted-foreground">{syncedAt}</span>} />}
        {row.quotaSyncError && (
          <InfoRow label="Error sync" value={<span className="text-xs text-destructive">{row.quotaSyncError}</span>} />
        )}
      </InfoList>
    </DrawerSection>
  );
}

interface TabConfiguracionNoIAProps {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  initialConnState?: ProspectingConnectionPanelState | null;
}

function TabConfiguracionNoIA({ row, ms, initialConnState }: TabConfiguracionNoIAProps) {
  const pkey = row.providerKey.toLowerCase();
  const operationalUse = OPERATIONAL_USE_MAP[pkey] ?? 'Uso operativo pendiente de documentar';
  const modules = MODULES_MAP[pkey] ?? 'Pendiente de mapear';

  return (
    <div className="space-y-4">
      <ProspectingConnectionSection pkey={pkey} initialConnState={initialConnState} />

      <DrawerSection title="Descripción y uso en SellUp" icon={Bot} tone="neutral" contentClassName="space-y-1">
        <p className="text-sm leading-relaxed text-foreground">{operationalUse}</p>
        <p className="text-xs text-muted-foreground">Módulos: {modules}</p>
      </DrawerSection>

      <OperationalStatusSection row={row} ms={ms} />

      <DrawerSection title="Notas de configuración" icon={Settings} tone="neutral" contentClassName="pt-1">
        <ConfigNotes notes={configNotesFor(pkey)} />
      </DrawerSection>
    </div>
  );
}

export interface TabConfiguracionProps {
  row: AdminProviderBudgetRow;
  ms: MeasurementStatus;
  initialConnState?: ProspectingConnectionPanelState | null;
  aiInitialConnState?: AiConnectionPanelState | null;
  aiProviderDetail: AiProviderDetailResult | null;
  loadingDetail: boolean;
  onRefresh: () => void;
}

/** Reparte entre la configuración de IA y la de los proveedores de datos. */
export function TabConfiguracion({
  row,
  ms,
  initialConnState,
  aiInitialConnState,
  aiProviderDetail,
  loadingDetail,
  onRefresh,
}: TabConfiguracionProps) {
  const opType = getProviderOperationalType(row.providerKey);
  return opType === 'ia'
    ? (
      <TabConfiguracionIA
        row={row}
        ms={ms}
        initialConnState={aiInitialConnState}
        aiProviderDetail={aiProviderDetail}
        loadingDetail={loadingDetail}
        onRefresh={onRefresh}
      />
    )
    : <TabConfiguracionNoIA row={row} ms={ms} initialConnState={initialConnState} />;
}
