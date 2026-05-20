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
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
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

function ConnectionBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string; dot: string }> = {
    connected: {
      label: 'Conectado',
      classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
      dot: 'bg-emerald-500',
    },
    not_tested: {
      label: 'Sin probar',
      classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
      dot: 'bg-amber-500',
    },
    error: {
      label: 'Error',
      classes: 'border-destructive/30 bg-destructive/10 text-destructive',
      dot: 'bg-destructive',
    },
    disconnected: {
      label: 'Desconectado',
      classes: 'border-border/40 bg-muted/30 text-muted-foreground/60',
      dot: 'bg-muted-foreground/25',
    },
    not_configured: {
      label: 'Sin configurar',
      classes: 'border-border/40 bg-muted/30 text-muted-foreground/60',
      dot: 'bg-muted-foreground/25',
    },
  };

  const config = map[status] ?? map['not_configured'];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${config.classes}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function RiskBadge({ severity }: { severity: RiskSeverity }) {
  const map: Record<RiskSeverity, { label: string; classes: string }> = {
    attention: {
      label: 'Atención',
      classes: 'border-destructive/30 bg-destructive/10 text-destructive',
    },
    pending: {
      label: 'Pendiente',
      classes: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
    },
    ok: {
      label: 'Correcto',
      classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
    },
  };

  const config = map[severity];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${config.classes}`}
    >
      {config.label}
    </span>
  );
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
    <div className="space-y-8">
      <PageHeader
        title="Estado y auditoría"
        description="Consulta la salud operativa de la configuración de SellUp y revisa los cambios administrativos más recientes."
        backHref="/settings"
      />

      {/* ── Bloque 1: Resumen ejecutivo ──────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Componentes OK
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-emerald-500">
            {summary.configured_components}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">configurados y activos</p>
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Con alertas
          </p>
          <p
            className={`mt-2 text-3xl font-semibold tracking-tight ${
              summary.components_with_issues > 0 ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {summary.components_with_issues}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">requieren atención</p>
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Automáticas
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
            {summary.automatic_automations}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">automatizaciones en auto</p>
        </SurfaceCard>

        <SurfaceCard>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Acceso pendiente
          </p>
          <p
            className={`mt-2 text-3xl font-semibold tracking-tight ${
              summary.pending_access_requests > 0 ? 'text-amber-500' : 'text-muted-foreground'
            }`}
          >
            {summary.pending_access_requests}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">solicitudes esperando</p>
        </SurfaceCard>
      </div>

      {/* ── Bloque 2: Estado de conexiones ───────────────────── */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">
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
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              }
            />

            <div className="space-y-2">
              {health.ai_providers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No se encontraron proveedores.
                </p>
              ) : (
                health.ai_providers.map((provider) => (
                  <div
                    key={provider.key}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-xs font-medium text-foreground truncate">
                        {provider.name}
                      </span>
                      {provider.is_active_provider && (
                        <span className="text-[10px] text-su-brand font-medium">activo</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ConnectionBadge status={provider.connection_status} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </SurfaceCard>

          {/* HubSpot */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="HubSpot CRM"
              description="Integración comercial"
              actions={
                <Link
                  href="/settings/integrations/hubspot"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Credencial</span>
                <span
                  className={`text-xs font-medium ${
                    health.hubspot.credentials_status === 'stored'
                      ? 'text-emerald-500'
                      : 'text-muted-foreground'
                  }`}
                >
                  {health.hubspot.credentials_status === 'stored' ? 'Guardada' : 'No configurada'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Conexión</span>
                <ConnectionBadge status={health.hubspot.connection_status} />
              </div>
              {health.hubspot.hub_id && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Hub ID</span>
                  <span className="text-xs font-medium text-foreground font-mono">
                    {health.hubspot.hub_id}
                  </span>
                </div>
              )}
              {health.hubspot.last_tested_at && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Última prueba</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(health.hubspot.last_tested_at)}
                  </span>
                </div>
              )}
              {health.hubspot.last_connection_error && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-1.5">
                  <p className="text-[10px] text-destructive line-clamp-2">
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
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Credencial</span>
                <span
                  className={`text-xs font-medium ${
                    health.apollo.credentials_status === 'stored'
                      ? 'text-emerald-500'
                      : 'text-muted-foreground'
                  }`}
                >
                  {health.apollo.credentials_status === 'stored' ? 'Guardada' : 'No configurada'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Conexión</span>
                <ConnectionBadge status={health.apollo.connection_status} />
              </div>
              {health.apollo.last_tested_at && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Última prueba</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(health.apollo.last_tested_at)}
                  </span>
                </div>
              )}
              {health.apollo.last_connection_error && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-1.5">
                  <p className="text-[10px] text-destructive line-clamp-2">
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
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Credencial</span>
                <span
                  className={`text-xs font-medium ${
                    health.lusha.credentials_status === 'stored'
                      ? 'text-emerald-500'
                      : 'text-muted-foreground'
                  }`}
                >
                  {health.lusha.credentials_status === 'stored' ? 'Guardada' : 'No configurada'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Conexión</span>
                <ConnectionBadge status={health.lusha.connection_status} />
              </div>
              {health.lusha.last_tested_at && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Última prueba</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(health.lusha.last_tested_at)}
                  </span>
                </div>
              )}
              {health.lusha.last_connection_error && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-1.5">
                  <p className="text-[10px] text-destructive line-clamp-2">
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
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Credencial</span>
                <span
                  className={`text-xs font-medium ${
                    health.samu.credentials_status === 'stored'
                      ? 'text-emerald-500'
                      : 'text-muted-foreground'
                  }`}
                >
                  {health.samu.credentials_status === 'stored' ? 'Guardada' : 'No configurada'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Conexión</span>
                <ConnectionBadge status={health.samu.connection_status} />
              </div>
              {health.samu.user_count != null && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Usuarios en entorno</span>
                  <span className="text-xs font-medium text-foreground">
                    {health.samu.user_count}
                  </span>
                </div>
              )}
              {health.samu.last_tested_at && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Última prueba</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(health.samu.last_tested_at)}
                  </span>
                </div>
              )}
              {health.samu.last_connection_error && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-1.5">
                  <p className="text-[10px] text-destructive line-clamp-2">
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
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              }
            />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total configuradas</span>
                <span className="text-xs font-medium text-foreground">
                  {health.automations.total}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {[
                  {
                    label: 'Automático',
                    count: health.automations.automatic,
                    color: 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10',
                  },
                  {
                    label: 'Sugerido',
                    count: health.automations.suggested,
                    color: 'text-amber-500 border-amber-500/30 bg-amber-500/10',
                  },
                  {
                    label: 'Manual',
                    count: health.automations.manual,
                    color: 'text-muted-foreground border-border/40 bg-muted/30',
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`flex-1 rounded-lg border px-2 py-2 text-center ${item.color}`}
                  >
                    <p className="text-lg font-semibold">{item.count}</p>
                    <p className="text-[10px] opacity-80">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </SurfaceCard>
        </div>
      </div>

      {/* ── Bloque 3: Riesgos y pendientes ───────────────────── */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-foreground">
          Pendientes y alertas administrativas
        </h2>

        {risks.length === 0 ? (
          <SurfaceCard>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
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
          <div className="space-y-2">
            {[...attentionRisks, ...pendingRisks].map((risk) => (
              <RiskItem key={risk.id} risk={risk} />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ============================================================
// Sub-componente RiskItem
// ============================================================

function RiskItem({ risk }: { risk: AdminRisk }) {
  const iconMap: Record<RiskSeverity, React.ReactNode> = {
    attention: <AlertTriangle className="h-4 w-4 text-destructive" />,
    pending: <Clock className="h-4 w-4 text-amber-500" />,
    ok: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  };

  return (
    <Link href={risk.action_href}>
      <SurfaceCard className="group cursor-pointer transition-all hover:border-su-brand/20">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">{iconMap[risk.severity]}</div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm text-foreground leading-relaxed">{risk.message}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RiskBadge severity={risk.severity} />
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-su-brand transition-colors" />
          </div>
        </div>
      </SurfaceCard>
    </Link>
  );
}
