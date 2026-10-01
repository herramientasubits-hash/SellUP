import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Badge } from '@/components/ui/badge';
import {
  ListItem,
  ListItemGroup,
  StatusBadge,
  type StatusType,
} from '@/components/data-display';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import {
  getSystemHealthSummary,
  getConfigurationHealthDetails,
  deriveAdministrativeRisks,
} from '@/modules/system-status/actions';
import type { AdminRisk, RiskSeverity } from '@/modules/system-status/types';

// ============================================================
// Helpers de presentación
// ============================================================

type ConnectionTone = 'positive' | 'warning' | 'negative' | 'neutral';

const CONNECTION_DOT: Record<ConnectionTone, string> = {
  positive: 'bg-success',
  warning: 'bg-warning',
  negative: 'bg-destructive',
  neutral: 'bg-muted-foreground',
};

const CONNECTION_STATUS: Record<string, { label: string; variant: ConnectionTone }> = {
  connected: { label: 'Conectado', variant: 'positive' },
  not_tested: { label: 'Sin probar', variant: 'warning' },
  error: { label: 'Error', variant: 'negative' },
  disconnected: { label: 'Desconectado', variant: 'neutral' },
  not_configured: { label: 'Sin configurar', variant: 'neutral' },
};

function ConnectionBadge({ status }: { status: string }) {
  const config = CONNECTION_STATUS[status] ?? CONNECTION_STATUS['not_configured'];

  return (
    <Badge variant={config.variant}>
      <span className={`h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[config.variant]}`} aria-hidden="true" />
      {config.label}
    </Badge>
  );
}

const RISK_STATUS: Record<RiskSeverity, { label: string; status: StatusType }> = {
  attention: { label: 'Atención', status: 'error' },
  pending: { label: 'Pendiente', status: 'pending' },
  ok: { label: 'Correcto', status: 'completed' },
};

function RiskBadge({ severity }: { severity: RiskSeverity }) {
  const config = RISK_STATUS[severity];
  return <StatusBadge status={config.status} label={config.label} />;
}

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return 'Hace un momento';
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `Hace ${Math.floor(diff / 86400)} días`;

  return new Date(isoDate).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'short',
  });
}

// ============================================================
// Page
// ============================================================

export default async function SystemStatusPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [summary, health] = await Promise.all([
    getSystemHealthSummary(),
    getConfigurationHealthDetails(),
  ]);

  const risks = await deriveAdministrativeRisks(health, summary.pending_access_requests);
  const attentionRisks = risks.filter((r) => r.severity === 'attention');
  const pendingRisks = risks.filter((r) => r.severity === 'pending');

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Configuración', href: '/settings' },
              'Estado y auditoría',
            ]}
          />
        }
        title="Estado y auditoría"
        description="Consulta la salud operativa de la configuración de SellUp y revisa los cambios administrativos más recientes."
        backHref="/settings"
      />

      {/* ── Bloque 1: Resumen ejecutivo ──────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Componentes OK"
          description="configurados y activos"
          value={summary.configured_components}
          tone="positive"
        />
        <MetricCard
          title="Con alertas"
          description="requieren atención"
          value={summary.components_with_issues}
          tone={summary.components_with_issues > 0 ? 'negative' : 'neutral'}
        />
        <MetricCard
          title="Automáticas"
          description="automatizaciones en auto"
          value={summary.automatic_automations}
        />
        <MetricCard
          title="Acceso pendiente"
          description="solicitudes esperando"
          value={summary.pending_access_requests}
          tone={summary.pending_access_requests > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* ── Bloque 2: Estado de conexiones ───────────────────── */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Estado de conexiones y configuraciones
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          {/* IA */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Proveedores de IA"
              description={
                health.active_ai?.provider_name
                  ? `Activo: ${health.active_ai.provider_name} · ${health.active_ai.model_name ?? 'sin modelo'}`
                  : 'Sin configuración activa seleccionada'
              }
              actions={
                <Link
                  href="/settings/ai"
                  aria-label="Ir a Proveedores de IA"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              }
            />

            {health.ai_providers.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No se encontraron proveedores.
              </p>
            ) : (
              <ListItemGroup>
                {health.ai_providers.map((provider) => (
                  <ListItem
                    key={provider.key}
                    size="sm"
                    leading={
                      <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    }
                    title={provider.name}
                    actions={
                      <>
                        {provider.is_active_provider && <Badge variant="brand">activo</Badge>}
                        <ConnectionBadge status={provider.connection_status} />
                      </>
                    }
                  />
                ))}
              </ListItemGroup>
            )}
          </SurfaceCard>

          {/* HubSpot */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="HubSpot CRM"
              description="Integración comercial"
              actions={
                <Link
                  href="/settings/integrations/hubspot"
                  aria-label="Ir a HubSpot CRM"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Credencial</span>
                <span
                  className={`text-xs font-medium ${
                    health.hubspot.credentials_status === 'stored'
                      ? 'text-success'
                      : 'text-muted-foreground'
                  }`}
                >
                  {health.hubspot.credentials_status === 'stored' ? 'Guardada' : 'No configurada'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Conexión</span>
                <ConnectionBadge status={health.hubspot.connection_status} />
              </div>
              {health.hubspot.hub_id && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">Hub ID</span>
                  <span className="truncate font-mono text-xs font-medium tabular-nums text-foreground">
                    {health.hubspot.hub_id}
                  </span>
                </div>
              )}
              {health.hubspot.last_tested_at && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">Última prueba</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(health.hubspot.last_tested_at)}
                  </span>
                </div>
              )}
              {health.hubspot.last_connection_error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 py-1.5">
                  <p className="line-clamp-2 break-words text-xs text-destructive">
                    {health.hubspot.last_connection_error}
                  </p>
                </div>
              )}
            </div>
          </SurfaceCard>

          {/* Apollo.io */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Apollo.io"
              description="Prospección y enriquecimiento"
              actions={
                <Link
                  href="/settings/prospecting"
                  aria-label="Ir a Apollo.io"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Credencial</span>
                <span
                  className={`text-xs font-medium ${
                    health.apollo.credentials_status === 'stored'
                      ? 'text-success'
                      : 'text-muted-foreground'
                  }`}
                >
                  {health.apollo.credentials_status === 'stored' ? 'Guardada' : 'No configurada'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Conexión</span>
                <ConnectionBadge status={health.apollo.connection_status} />
              </div>
              {health.apollo.last_tested_at && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">Última prueba</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(health.apollo.last_tested_at)}
                  </span>
                </div>
              )}
              {health.apollo.last_connection_error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 py-1.5">
                  <p className="line-clamp-2 break-words text-xs text-destructive">
                    {health.apollo.last_connection_error}
                  </p>
                </div>
              )}
            </div>
          </SurfaceCard>

          {/* Lusha */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Lusha"
              description="Prospección y enriquecimiento"
              actions={
                <Link
                  href="/settings/prospecting"
                  aria-label="Ir a Lusha"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Credencial</span>
                <span
                  className={`text-xs font-medium ${
                    health.lusha.credentials_status === 'stored'
                      ? 'text-success'
                      : 'text-muted-foreground'
                  }`}
                >
                  {health.lusha.credentials_status === 'stored' ? 'Guardada' : 'No configurada'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Conexión</span>
                <ConnectionBadge status={health.lusha.connection_status} />
              </div>
              {health.lusha.last_tested_at && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">Última prueba</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(health.lusha.last_tested_at)}
                  </span>
                </div>
              )}
              {health.lusha.last_connection_error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 py-1.5">
                  <p className="line-clamp-2 break-words text-xs text-destructive">
                    {health.lusha.last_connection_error}
                  </p>
                </div>
              )}
            </div>
          </SurfaceCard>

          {/* Samu IA */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Samu IA"
              description="Integración de reuniones y transcripciones"
              actions={
                <Link
                  href="/settings/integrations/samu"
                  aria-label="Ir a Samu IA"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Credencial</span>
                <span
                  className={`text-xs font-medium ${
                    health.samu.credentials_status === 'stored'
                      ? 'text-success'
                      : 'text-muted-foreground'
                  }`}
                >
                  {health.samu.credentials_status === 'stored' ? 'Guardada' : 'No configurada'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Conexión</span>
                <ConnectionBadge status={health.samu.connection_status} />
              </div>
              {health.samu.user_count != null && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">Usuarios en entorno</span>
                  <span className="text-xs font-medium tabular-nums text-foreground">
                    {health.samu.user_count}
                  </span>
                </div>
              )}
              {health.samu.last_tested_at && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">Última prueba</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(health.samu.last_tested_at)}
                  </span>
                </div>
              )}
              {health.samu.last_connection_error && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 py-1.5">
                  <p className="line-clamp-2 break-words text-xs text-destructive">
                    {health.samu.last_connection_error}
                  </p>
                </div>
              )}
            </div>
          </SurfaceCard>

          {/* Automatizaciones */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Automatizaciones"
              description="Configuración de modos de ejecución"
              actions={
                <Link
                  href="/settings/automations"
                  aria-label="Ir a Automatizaciones"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Total configuradas</span>
                <span className="text-xs font-medium tabular-nums text-foreground">
                  {health.automations.total}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {[
                  {
                    label: 'Automático',
                    count: health.automations.automatic,
                    color: 'text-success border-success/30 bg-success/10',
                  },
                  {
                    label: 'Sugerido',
                    count: health.automations.suggested,
                    color: 'text-warning border-warning/30 bg-warning/10',
                  },
                  {
                    label: 'Manual',
                    count: health.automations.manual,
                    color: 'text-muted-foreground border-border/60 bg-surface-subtle',
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`min-w-0 flex-1 rounded-lg border px-2 py-2 text-center ${item.color}`}
                  >
                    <p className="text-lg font-semibold tabular-nums">{item.count}</p>
                    <p className="truncate text-xs">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </SurfaceCard>
        </div>
      </section>

      {/* ── Bloque 3: Riesgos y pendientes ───────────────────── */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          Pendientes y alertas administrativas
        </h2>

        {risks.length === 0 ? (
          <SurfaceCard>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Sin alertas ni pendientes detectados
                </p>
                <p className="text-xs text-muted-foreground">
                  La configuración activa no presenta ningún riesgo identificable.
                </p>
              </div>
            </div>
          </SurfaceCard>
        ) : (
          <ListItemGroup>
            {[...attentionRisks, ...pendingRisks].map((risk) => (
              <RiskItem key={risk.id} risk={risk} />
            ))}
          </ListItemGroup>
        )}
      </section>
    </div>
  );
}

// ============================================================
// Sub-componente RiskItem
// ============================================================

function RiskItem({ risk }: { risk: AdminRisk }) {
  const iconMap: Record<RiskSeverity, React.ReactNode> = {
    attention: <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />,
    pending: <Clock className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />,
    ok: <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />,
  };

  return (
    <ListItem
      href={risk.action_href}
      leading={iconMap[risk.severity]}
      // El mensaje de un riesgo se lee entero: envuelve en vez de truncarse.
      title={
        <span className="whitespace-normal break-words font-normal leading-relaxed">
          {risk.message}
        </span>
      }
      meta={<RiskBadge severity={risk.severity} />}
      actions={
        <ChevronRight
          className="h-3.5 w-3.5 text-text-muted transition-colors group-hover/list-item:text-primary"
          aria-hidden="true"
        />
      }
    />
  );
}
