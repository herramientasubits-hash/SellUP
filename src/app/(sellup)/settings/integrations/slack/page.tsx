import { withAppTimeZone } from '@/lib/format-date';
import { redirect } from 'next/navigation';
import { CheckCircle2, XCircle, Clock, WifiOff, ShieldCheck, Hash } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getSlackIntegration } from '@/modules/integrations/actions';
import { SlackActionsPanel } from './slack-actions-client';
import type { SlackMetadata } from '@/modules/integrations/types';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', withAppTimeZone({
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })).format(new Date(iso));
}

function ConnectionStatusBlock({ connectionStatus }: { connectionStatus: string | undefined }) {
  const status = connectionStatus ?? 'not_tested';

  const map: Record<
    string,
    {
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      variant: 'positive' | 'negative' | 'warning' | 'neutral';
    }
  > = {
    connected: {
      label: 'Conectado',
      icon: CheckCircle2,
      variant: 'positive',
    },
    error: {
      label: 'Error de conexión',
      icon: XCircle,
      variant: 'negative',
    },
    disconnected: {
      label: 'Desconectado',
      icon: WifiOff,
      variant: 'warning',
    },
    not_tested: {
      label: 'Sin probar',
      icon: Clock,
      variant: 'neutral',
    },
  };

  const config = map[status] ?? map.not_tested;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant}>
      <Icon />
      {config.label}
    </Badge>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-b-0">
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
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Configuración', href: '/settings' },
              { label: 'Integraciones comerciales', href: '/settings/integrations' },
              'Slack',
            ]}
          />
        }
        title="Slack"
        description="Conecta el workspace de Slack para crear un canal oficial de SellUp y habilitar futuras alertas y comunicaciones operativas."
        backHref="/settings/integrations"
      />

      {justConnected && (
        <Alert variant="success">
          Slack conectado correctamente. Ahora puedes crear el canal oficial de SellUp.
        </Alert>
      )}

      {oauthError && <Alert variant="destructive">{decodeURIComponent(oauthError)}</Alert>}

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
                <Badge variant="positive">
                  <span className="size-1.5 rounded-full bg-success" />
                  Bot token almacenado
                </Badge>
              ) : (
                <Badge variant="neutral">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                  No configurado
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Conexión</span>
              <ConnectionStatusBlock connectionStatus={conn?.connection_status} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Canal oficial</span>
              {hasChannel ? (
                <Badge variant="positive">
                  <Hash className="size-3" />
                  {metadata.channel_name ?? 'Configurado'}
                </Badge>
              ) : (
                <Badge variant="neutral">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                  Sin canal
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Última prueba</span>
              <span className="text-xs font-medium text-foreground">
                {formatDate(conn?.last_tested_at ?? null)}
              </span>
            </div>

            {conn?.last_connection_error && (
              <Alert variant="destructive">
                <p className="text-xs font-medium">Último error</p>
                <p className="text-xs">{conn.last_connection_error}</p>
              </Alert>
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
              {metadata.bot_user_id && <MetaRow label="Bot User ID" value={metadata.bot_user_id} />}
              {metadata.channel_name && (
                <MetaRow
                  label="Canal oficial"
                  value={
                    <span className="inline-flex items-center gap-1">
                      <Hash className="size-3 text-muted-foreground" />
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
                      <Badge key={scope} variant="neutral">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <EmptyState
              variant="plain"
              icon={ShieldCheck}
              title={isConnected ? 'Prueba la conexión para ver la información del workspace.' : 'Conecta Slack para ver la información del workspace.'}
            />
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
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className=" text-sm font-semibold text-foreground">
              Almacenamiento seguro de credenciales
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              El bot token de Slack se almacena exclusivamente en Supabase Vault y nunca se expone
              en el navegador ni en los logs. SellUp lo usa únicamente para validar la conexión,
              gestionar el canal oficial y enviar comunicaciones cuando los flujos estén
              habilitados.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
