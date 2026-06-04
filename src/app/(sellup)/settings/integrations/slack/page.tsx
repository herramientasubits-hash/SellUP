import { redirect } from 'next/navigation';
import {
  CheckCircle2,
  XCircle,
  Clock,
  WifiOff,
  ShieldCheck,
  Hash,
  AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getSlackIntegration } from '@/modules/integrations/actions';
import { SlackActionsPanel } from './slack-actions-client';
import type { SlackMetadata } from '@/modules/integrations/types';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function ConnectionStatusBlock({ connectionStatus }: { connectionStatus: string | undefined }) {
  const status = connectionStatus ?? 'not_tested';

  const map: Record<
    string,
    {
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      color: string;
      bg: string;
      border: string;
    }
  > = {
    connected: {
      label: 'Conectado',
      icon: CheckCircle2,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
    },
    error: {
      label: 'Error de conexión',
      icon: XCircle,
      color: 'text-destructive',
      bg: 'bg-destructive/10',
      border: 'border-destructive/30',
    },
    disconnected: {
      label: 'Desconectado',
      icon: WifiOff,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
    },
    not_tested: {
      label: 'Sin probar',
      icon: Clock,
      color: 'text-muted-foreground',
      bg: 'bg-muted/30',
      border: 'border-border/40',
    },
  };

  const config = map[status] ?? map.not_tested;
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${config.bg} ${config.border} ${config.color}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {config.label}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/40 py-2.5 last:border-b-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-medium text-foreground">{value}</span>
    </div>
  );
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SlackIntegrationPage({ searchParams }: PageProps) {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getSlackIntegration();
  if (!integration) redirect('/settings/integrations');

  const params = await searchParams;
  const justConnected = params.connected === '1';
  const oauthError = typeof params.error === 'string' ? params.error : null;

  const conn = integration.connection;
  const isConnected =
    conn?.credentials_status === 'stored' && conn?.connection_status !== 'disconnected';
  const metadata = (conn?.metadata ?? {}) as SlackMetadata;
  const hasChannel = !!metadata.channel_id;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Slack"
        description="Conecta el workspace de Slack para crear un canal oficial de SellUp y habilitar futuras alertas y comunicaciones operativas."
        backHref="/settings/integrations"
      />

      {justConnected && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            Slack conectado correctamente. Ahora puedes crear el canal oficial de SellUp.
          </p>
        </div>
      )}

      {oauthError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{decodeURIComponent(oauthError)}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Estado de la integración */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Estado de la integración"
            description="Estado actual de credencial y conexión con el workspace de Slack."
          />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Credencial</span>
              {conn?.credentials_status === 'stored' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Bot token almacenado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
                  No configurado
                </span>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Conexión</span>
              <ConnectionStatusBlock connectionStatus={conn?.connection_status} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Canal oficial</span>
              {hasChannel ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-500">
                  <Hash className="h-3 w-3" />
                  {metadata.channel_name ?? 'Configurado'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
                  Sin canal
                </span>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Última prueba</span>
              <span className="text-xs font-medium text-foreground">
                {formatDate(conn?.last_tested_at ?? null)}
              </span>
            </div>

            {conn?.last_connection_error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
                <p className="mb-0.5 text-[11px] font-medium text-destructive">Último error</p>
                <p className="text-[11px] text-destructive/80">{conn.last_connection_error}</p>
              </div>
            )}
          </div>
        </SurfaceCard>

        {/* Información del workspace */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Información del workspace"
            description="Datos del workspace de Slack conectado."
          />
          {metadata.team_id ? (
            <div>
              <MetaRow label="Workspace" value={metadata.team_name ?? '—'} />
              <MetaRow label="Team ID" value={metadata.team_id} />
              {metadata.bot_user_id && (
                <MetaRow label="Bot User ID" value={metadata.bot_user_id} />
              )}
              {metadata.channel_name && (
                <MetaRow
                  label="Canal oficial"
                  value={
                    <span className="inline-flex items-center gap-1">
                      <Hash className="h-3 w-3 text-muted-foreground" />
                      {metadata.channel_name}
                    </span>
                  }
                />
              )}
              {metadata.scopes && metadata.scopes.length > 0 && (
                <>
                  <MetaRow
                    label="Scopes"
                    value={`${metadata.scopes.length} scope${metadata.scopes.length !== 1 ? 's' : ''}`}
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {metadata.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/40">
                <ShieldCheck className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                {isConnected
                  ? 'Prueba la conexión para ver la información del workspace.'
                  : 'Conecta Slack para ver la información del workspace.'}
              </p>
            </div>
          )}
        </SurfaceCard>
      </div>

      {/* Panel de acciones */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Acciones"
          description={
            isConnected
              ? 'Prueba la conexión o desconecta Slack.'
              : 'Conecta SellUp con el workspace de Slack mediante OAuth.'
          }
        />
        <SlackActionsPanel isConnected={isConnected} />
      </SurfaceCard>

      {/* Nota de seguridad */}
      <SurfaceCard elevated>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
          <div>
            <p className=" text-[0.8125rem] font-semibold text-foreground">
              Almacenamiento seguro de credenciales
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              El bot token de Slack se almacena exclusivamente en Supabase Vault y nunca se
              expone en el navegador ni en los logs. SellUp lo usa únicamente para validar
              la conexión, gestionar el canal oficial y enviar comunicaciones cuando los
              flujos estén habilitados.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
