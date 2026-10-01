import { formatInAppZone } from '@/lib/format-date';
import { notFound } from 'next/navigation';
import {
  type LucideIcon,
  Building2,
  Brain,
  Users,
  Activity,
  Globe,
  Link2,
  MapPin,
  Tag,
  Hash,
  Calendar,
  User,
  Briefcase,
} from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { Timeline, TimelineItem } from '@/components/data-display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getAccountById, getAccountAudit, getActiveUsers } from '@/modules/accounts/actions';
import { getContactsByAccount, getContactsSummary } from '@/modules/contacts/actions';
import { ContactsTab } from '@/components/contacts/contacts-tab';
import { getContactEnrichmentRunsByAccountId } from '@/modules/contact-enrichment/account-run-history-actions';
import { AccountAgentsRunHistory } from '@/components/contact-enrichment/account-agents-run-history';
import {
  PIPELINE_STATUS_LABELS,
  SOURCE_LABELS,
  AUDIT_ACTION_LABELS,
  type PipelineStatus,
  type AccountSource,
  type AccountAuditAction,
} from '@/modules/accounts/types';
import { AccountDetailActions } from '@/components/accounts/account-detail-actions';
import { AccountEnrichContactsButton } from '@/components/accounts/account-enrich-contacts-button';
import { RollbackBanner } from '@/components/accounts/rollback-banner';
import { readPendingHubSpotMatch } from '@/modules/accounts/hubspot-company-resolution-state';
import { HubSpotCompanyMatchReviewBanner } from '@/components/accounts/hubspot-company-match-review-banner';

interface AccountDetailPageProps {
  params: Promise<{ accountId: string }>;
}

const STATUS_VARIANT: Record<
  PipelineStatus,
  'neutral' | 'brand' | 'warning' | 'positive'
> = {
  new: 'neutral',
  ready_for_research: 'brand',
  research_in_progress: 'warning',
  ready_for_outreach: 'positive',
  archived: 'neutral',
};

function formatDate(iso: string): string {
  return formatInAppZone(iso, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }, 'es-CO');
}

function formatShortDate(iso: string): string {
  return formatInAppZone(iso, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }, 'es-CO');
}

/** Pares etiqueta/valor en rejilla: dos columnas cuando la tarjeta tiene ancho. */
const DETAIL_GRID = 'grid gap-x-6 gap-y-3 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2';

const AUDIT_ICONS: Record<AccountAuditAction, typeof Activity> = {
  account_created: Building2,
  account_updated: Briefcase,
  account_status_changed: Tag,
  account_archived: Building2,
  account_owner_changed: User,
};

export default async function AccountDetailPage({ params }: AccountDetailPageProps) {
  const { accountId } = await params;

  const [account, auditLog, users, contacts, contactsSummary, contactEnrichmentRuns] = await Promise.all([
    getAccountById(accountId),
    getAccountAudit(accountId),
    getActiveUsers(),
    getContactsByAccount(accountId),
    getContactsSummary(accountId),
    getContactEnrichmentRunsByAccountId(accountId),
  ]);

  if (!account) notFound();

  const safeMetadata =
    account.metadata !== null &&
    typeof account.metadata === 'object' &&
    !Array.isArray(account.metadata)
      ? (account.metadata as Record<string, unknown>)
      : {};

  const isRolledBack = safeMetadata.rollback_logical === true;
  const pendingHubSpotMatch = readPendingHubSpotMatch(safeMetadata);

  return (
    <div className="space-y-6">
      <PageHeader
        title={account.name}
        description={account.legal_name ?? undefined}
        backHref="/accounts"
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Empresas', href: '/accounts' }, account.name]} />
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isRolledBack && (
              <Badge variant="warning">
                No operativa
              </Badge>
            )}
            <Badge variant={STATUS_VARIANT[account.pipeline_status]}>
              {PIPELINE_STATUS_LABELS[account.pipeline_status]}
            </Badge>
            <AccountEnrichContactsButton
              preloadedCompany={{
                name: account.name,
                domain: account.domain,
                country: account.country,
                countryCode: account.country_code,
                sellupAccountId: account.id,
                hubspotCompanyId: account.hubspot_company_id,
              }}
              disabled={account.pipeline_status === 'archived'}
            />
            <AccountDetailActions
              accountId={account.id}
              currentStatus={account.pipeline_status}
              users={users}
            />
          </div>
        }
      />

      {isRolledBack && (
        <RollbackBanner
          metadata={safeMetadata}
          hubspotCompanyId={account.hubspot_company_id}
        />
      )}

      <HubSpotCompanyMatchReviewBanner
        accountId={account.id}
        pendingMatch={
          pendingHubSpotMatch
            ? {
                hubspotCompanyId: pendingHubSpotMatch.hubspotCompanyId,
                name: pendingHubSpotMatch.name,
                domain: pendingHubSpotMatch.domain,
                matchMethod: pendingHubSpotMatch.matchMethod,
                confidence: pendingHubSpotMatch.confidence,
                reason: pendingHubSpotMatch.reason,
              }
            : null
        }
      />

      <Tabs defaultValue="resumen">
        <TabsList className="mb-4">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="contactos">Contactos</TabsTrigger>
          <TabsTrigger value="inteligencia">Inteligencia</TabsTrigger>
          <TabsTrigger value="actividad">Actividad</TabsTrigger>
          <TabsTrigger value="agentes">Agentes</TabsTrigger>
        </TabsList>

        {/* ── Resumen ─────────────────────────────────────────── */}
        <TabsContent value="resumen" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Datos de la cuenta */}
            <SurfaceCard>
              <SurfaceCardHeader title="Datos de la empresa" />
              <dl className={DETAIL_GRID}>
                {account.website && (
                  <DetailRow icon={Globe} label="Sitio web">
                    <a
                      href={account.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      {account.domain ?? account.website}
                    </a>
                  </DetailRow>
                )}
                {account.linkedin_url && (
                  <DetailRow icon={Link2} label="LinkedIn">
                    <a
                      href={account.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      {account.linkedin_url.replace(/^https?:\/\/(www\.)?/i, '')}
                    </a>
                  </DetailRow>
                )}
                {(account.country ?? account.city) && (
                  <DetailRow icon={MapPin} label="Ubicación">
                    {[account.city, account.region, account.country].filter(Boolean).join(', ')}
                  </DetailRow>
                )}
                {account.industry && (
                  <DetailRow icon={Briefcase} label="Industria">
                    {account.industry}
                  </DetailRow>
                )}
                {account.company_size && (
                  <DetailRow icon={Users} label="Tamaño">
                    {account.company_size}
                  </DetailRow>
                )}
                {account.tax_identifier && (
                  <DetailRow icon={Hash} label={account.tax_identifier_type ?? 'ID fiscal'}>
                    {account.tax_identifier}
                  </DetailRow>
                )}
                <DetailRow icon={Tag} label="Fuente">
                  <Badge variant="outline">
                    {SOURCE_LABELS[account.source as AccountSource]}
                  </Badge>
                </DetailRow>
                <DetailRow icon={Calendar} label="Creada">
                  {formatShortDate(account.created_at)}
                </DetailRow>
              </dl>
            </SurfaceCard>

            {/* Owner y estado */}
            <SurfaceCard>
              <SurfaceCardHeader title="Asignación y estado" />
              <dl className={DETAIL_GRID}>
                <DetailRow icon={User} label="Owner">
                  {account.owner?.full_name ?? account.owner?.email ?? (
                    <span className="text-muted-foreground">Sin asignar</span>
                  )}
                </DetailRow>
                <DetailRow icon={Tag} label="Estado pipeline">
                  <Badge variant={STATUS_VARIANT[account.pipeline_status]}>
                    {PIPELINE_STATUS_LABELS[account.pipeline_status]}
                  </Badge>
                </DetailRow>
                {account.hubspot_company_id ? (
                  <DetailRow icon={Globe} label="HubSpot">
                    <div className="space-y-0.5">
                      <span className="text-sm font-medium text-success">
                        Sincronizado
                      </span>
                      <p className="font-mono text-xs text-muted-foreground">
                        {account.hubspot_company_id}
                      </p>
                    </div>
                  </DetailRow>
                ) : (() => {
                  const syncStatus = safeMetadata.hubspot_sync_status as string | undefined;
                  if (!syncStatus) return null;

                  const statusMap: Record<string, { label: string; className: string }> = {
                    blocked_duplicate: { label: 'No creado: duplicado en HubSpot', className: 'text-warning' },
                    blocked_inactive_or_liquidation: { label: 'No sincronizado · señal de liquidación o inactividad', className: 'text-warning' },
                    failed_create: { label: 'Error al crear en HubSpot', className: 'text-destructive' },
                    failed_lookup: { label: 'Error en verificación HubSpot', className: 'text-destructive' },
                    skipped_flag_off: { label: 'Sincronización HubSpot desactivada', className: 'text-muted-foreground' },
                    skipped_no_connection: { label: 'HubSpot sin conexión activa', className: 'text-muted-foreground' },
                    skipped_missing_write_scope: { label: 'HubSpot sin permiso de escritura', className: 'text-muted-foreground' },
                    skipped_rollback: { label: 'Cuenta no operativa · sin sync', className: 'text-muted-foreground' },
                  };

                  const info = statusMap[syncStatus];
                  if (!info) return null;

                  return (
                    <DetailRow icon={Globe} label="HubSpot">
                      <span className={`text-sm ${info.className}`}>{info.label}</span>
                    </DetailRow>
                  );
                })()}
              </dl>

              {account.notes && (
                <div className="mt-4 rounded-lg bg-surface-subtle px-3 py-2.5">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    Notas
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{account.notes}</p>
                </div>
              )}
            </SurfaceCard>
          </div>
        </TabsContent>

        {/* ── Contactos ────────────────────────────────────────── */}
        <TabsContent value="contactos">
          <ContactsTab
            accountId={account.id}
            contacts={contacts}
            summary={contactsSummary}
          />
        </TabsContent>

        {/* ── Inteligencia ─────────────────────────────────────── */}
        <TabsContent value="inteligencia">
          <PlaceholderTab
            icon={Brain}
            title="Inteligencia comercial — Próxima fase"
            description="Árbol empresarial, señales de negocio, noticias recientes y análisis de competidores. Generado por el Agente 1 y enriquecido con Apollo/Lusha."
          />
        </TabsContent>

        {/* ── Actividad ────────────────────────────────────────── */}
        <TabsContent value="actividad">
          <SurfaceCard>
            <SurfaceCardHeader
              title="Registro de actividad"
              description="Cambios y eventos de auditoría de esta cuenta."
            />
            {auditLog.length === 0 ? (
              <EmptyState variant="plain" icon={Activity} title="Sin actividad registrada todavía." />
            ) : (
              <Timeline>
                {auditLog.map((entry) => {
                  const Icon = AUDIT_ICONS[entry.action_type] ?? Activity;
                  return (
                    <TimelineItem
                      key={entry.id}
                      icon={<Icon />}
                      title={AUDIT_ACTION_LABELS[entry.action_type]}
                      time={formatDate(entry.created_at)}
                      description={
                        entry.actor
                          ? `por ${entry.actor.full_name ?? entry.actor.email}`
                          : undefined
                      }
                    />
                  );
                })}
              </Timeline>
            )}
          </SurfaceCard>
        </TabsContent>

        {/* ── Agentes ──────────────────────────────────────────── */}
        <TabsContent value="agentes">
          <AccountAgentsRunHistory runs={contactEnrichmentRuns} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Componentes auxiliares ────────────────────────────────────

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-semibold text-muted-foreground">
          {label}
        </dt>
        <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
      </div>
    </div>
  );
}

function PlaceholderTab({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <EmptyState icon={Icon} title={title} description={description} />
  );
}
