import { formatInAppZone } from '@/lib/format-date';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  ChevronRight,
} from "@/icons";
import { SettingsPage, TechnicalDetails } from '@/components/settings/settings-page';
import { TechnicalRow } from '@/components/settings/integration-overview';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { DistributionBar } from '@/components/charts/DistributionBar';
import { Heading } from '@/components/typography';
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
  error: { label: 'Con error', variant: 'negative' },
  disconnected: { label: 'Desconectado', variant: 'neutral' },
  not_configured: { label: 'Sin conectar', variant: 'neutral' },
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

  return formatInAppZone(isoDate, {
    day: 'numeric',
    month: 'short',
  }, 'es-ES');
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

  const sortedRisks = [...attentionRisks, ...pendingRisks];

  // Una fila por conexión: qué es, si funciona y dónde se arregla.
  const connections: ConnectionRow[] = [
    {
      name: 'HubSpot',
      purpose: 'CRM del equipo',
      href: '/settings/integrations/hubspot',
      ...health.hubspot,
    },
    {
      name: 'Slack',
      purpose: 'Canal y avisos del equipo',
      href: '/settings/integrations/slack',
      ...health.slack,
    },
    {
      name: 'Apollo',
      purpose: 'Búsqueda de empresas y contactos',
      href: '/settings/prospecting',
      ...health.apollo,
    },
    {
      name: 'Lusha',
      purpose: 'Búsqueda de empresas y contactos',
      href: '/settings/prospecting',
      ...health.lusha,
    },
    {
      name: 'Samu IA',
      purpose: 'Reuniones y transcripciones',
      href: '/settings/integrations/samu',
      ...health.samu,
    },
  ];

  return (
    <SettingsPage
      title="Estado y auditoría"
      description="Qué funciona, qué pide atención y dónde arreglarlo."
    >
      {/* ── Resumen ───────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Funcionando"
          description="Conexiones y ajustes en orden"
          value={summary.configured_components}
          tone="positive"
        />
        <MetricCard
          title="Con problemas"
          description="Piden atención"
          value={summary.components_with_issues}
          tone={summary.components_with_issues > 0 ? 'negative' : 'neutral'}
        />
        <MetricCard
          title="Automatizaciones"
          description="Funcionan sin intervención"
          value={summary.automatic_automations}
        />
        <MetricCard
          title="Solicitudes de acceso"
          description="Esperan tu respuesta"
          value={summary.pending_access_requests}
          tone={summary.pending_access_requests > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* ── Qué pide atención: lo primero que hay que leer ───── */}
      <section className="space-y-3" aria-labelledby="status-risks">
        <Heading level={6} as="h2" id="status-risks">
          Qué pide tu atención
        </Heading>

        {sortedRisks.length === 0 ? (
          <Alert variant="success">
            <AlertTitle>Todo en orden</AlertTitle>
            <AlertDescription>No hay conexiones caídas ni solicitudes esperando.</AlertDescription>
          </Alert>
        ) : (
          <ListItemGroup>
            {sortedRisks.map((risk) => (
              <RiskItem key={risk.id} risk={risk} />
            ))}
          </ListItemGroup>
        )}
      </section>

      {/* ── Conexiones ───────────────────────────────────────── */}
      <section className="space-y-3" aria-labelledby="status-connections">
        <Heading level={6} as="h2" id="status-connections">
          Conexiones
        </Heading>
        <ListItemGroup>
          {connections.map((connection) => (
            <ConnectionItem key={connection.name} connection={connection} />
          ))}
        </ListItemGroup>
      </section>

      <div className="grid items-start gap-4 md:grid-cols-2">
        {/* IA */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Inteligencia artificial"
            description={
              health.active_ai?.provider_name
                ? `En uso: ${health.active_ai.provider_name}${health.active_ai.model_name ? ` · ${health.active_ai.model_name}` : ''}`
                : 'Todavía no se ha elegido qué proveedor de IA usar'
            }
            actions={<SectionLink href="/settings/providers" label="Ir a Proveedores y consumo" />}
          />

          {health.ai_providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay proveedores de IA. Añade uno desde Proveedores y consumo.
            </p>
          ) : (
            <ListItemGroup>
              {health.ai_providers.map((provider) => (
                <ListItem
                  key={provider.key}
                  size="sm"
                  leading={
                    <Cpu className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  }
                  title={provider.name}
                  actions={
                    <>
                      {provider.is_active_provider && <Badge variant="brand">En uso</Badge>}
                      <ConnectionBadge status={provider.connection_status} />
                    </>
                  }
                />
              ))}
            </ListItemGroup>
          )}
        </SurfaceCard>

        {/* Automatizaciones */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Automatizaciones"
            description={`${health.automations.total} en total: cuántas actúan solas, cuántas sugieren y cuántas esperan a que las hagas tú.`}
            actions={<SectionLink href="/settings/automations" label="Ir a Automatizaciones" />}
          />

          <DistributionBar
            ariaLabel="Automatizaciones por modo de ejecución"
            emptyLabel="Todavía no hay automatizaciones configuradas."
            segments={[
              { id: 'automatic', label: 'Automáticas', value: health.automations.automatic, tone: 'positive' },
              { id: 'suggested', label: 'Sugeridas', value: health.automations.suggested, tone: 'warning' },
              { id: 'manual', label: 'Manuales', value: health.automations.manual, tone: 'neutral' },
            ]}
          />
        </SurfaceCard>
      </div>

      {/* ── Lo que solo le sirve a soporte ───────────────────── */}
      <TechnicalDetails summary="Identificadores y estado interno de cada conexión. Útil para soporte.">
        <div>
          {health.hubspot.hub_id && (
            <TechnicalRow label="HubSpot · identificador de la cuenta (Hub ID)">{health.hubspot.hub_id}</TechnicalRow>
          )}
          {connections.map((connection) => (
            <TechnicalRow key={connection.name} label={`${connection.name} · credencial / conexión`}>
              {connection.credentials_status} / {connection.connection_status}
            </TechnicalRow>
          ))}
          {health.samu.user_count != null && (
            <TechnicalRow label="Samu IA · personas en la cuenta">{health.samu.user_count}</TechnicalRow>
          )}
        </div>
      </TechnicalDetails>
    </SettingsPage>
  );
}

// ============================================================
// Sub-componentes
// ============================================================

interface ConnectionRow {
  name: string;
  /** Para qué sirve, en dos o tres palabras. */
  purpose: string;
  href: string;
  credentials_status: string;
  connection_status: string;
  last_tested_at?: string | null;
  last_connection_error?: string | null;
}

function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <ChevronRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/** Una conexión en una fila: sin credencial es «Sin conectar», diga lo que diga el estado. */
function ConnectionItem({ connection }: { connection: ConnectionRow }) {
  const status = connection.credentials_status === 'stored' ? connection.connection_status : 'not_configured';
  const tested = connection.last_tested_at
    ? `Probada ${formatRelativeTime(connection.last_tested_at).toLowerCase()}`
    : 'Sin probar todavía';

  return (
    <ListItem
      href={connection.href}
      title={connection.name}
      description={
        connection.last_connection_error ? (
          <span className="line-clamp-2 whitespace-normal break-words text-destructive">
            {connection.last_connection_error}
          </span>
        ) : (
          `${connection.purpose} · ${tested}`
        )
      }
      meta={<ConnectionBadge status={status} />}
      actions={
        <ChevronRight
          className="size-3.5 text-text-muted transition-colors group-hover/list-item:text-primary"
          aria-hidden="true"
        />
      }
    />
  );
}

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
