import { formatInAppZone } from '@/lib/format-date';
import { notFound } from 'next/navigation';
import {
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
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { Heading } from '@/components/typography/heading';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { UrlTabs, type UrlTab } from '@/components/navigation/url-tabs';
import {
  StatusBadge,
  Timeline,
  TimelineItem,
  type StatusType,
  type TimelineTone,
} from '@/components/data-display';
import { TabsContent } from '@/components/ui/tabs';
import { getAccountById, getAccountAudit, getActiveUsers } from '@/modules/accounts/actions';
import { getContactsByAccount, getContactsSummary } from '@/modules/contacts/actions';
import { ContactsTab } from '@/components/contacts/contacts-tab';
import { getContactEnrichmentRunsByAccountId } from '@/modules/contact-enrichment/account-run-history-actions';
import { AccountAgentsRunHistory } from '@/components/contact-enrichment/account-agents-run-history';
import {
  PIPELINE_STATUS_LABELS,
  SOURCE_LABELS,
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
  searchParams: Promise<{ tab?: string | string[] }>;
}

const PIPELINE_STATUS_TYPE: Record<PipelineStatus, StatusType> = {
  new: 'neutral',
  ready_for_research: 'info',
  research_in_progress: 'pending',
  ready_for_outreach: 'active',
  archived: 'inactive',
};

const LINK_CLASSES =
  'rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40';

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

interface AuditPresentation {
  title: string;
  icon: typeof Activity;
  tone: TimelineTone;
}

const AUDIT_PRESENTATION: Record<AccountAuditAction, AuditPresentation> = {
  account_created: { title: 'Empresa creada', icon: Building2, tone: 'positive' },
  account_updated: { title: 'Datos actualizados', icon: Briefcase, tone: 'default' },
  account_status_changed: { title: 'Cambio de estado', icon: Tag, tone: 'primary' },
  account_archived: { title: 'Empresa archivada', icon: Building2, tone: 'warning' },
  account_owner_changed: { title: 'Cambio de responsable', icon: User, tone: 'info' },
};

const FALLBACK_AUDIT: AuditPresentation = { title: 'Cambio registrado', icon: Activity, tone: 'default' };

interface HubSpotPresentation {
  label: string;
  status: StatusType;
}

/** Por qué una empresa sin ficha en HubSpot todavía no la tiene. */
const HUBSPOT_SYNC_STATUS: Record<string, HubSpotPresentation> = {
  blocked_duplicate: { label: 'No se creó: ya existe en HubSpot', status: 'warning' },
  blocked_inactive_or_liquidation: {
    label: 'No se envió: la empresa parece inactiva o en liquidación',
    status: 'warning',
  },
  failed_create: { label: 'No se pudo crear en HubSpot', status: 'error' },
  failed_lookup: { label: 'No se pudo comprobar en HubSpot', status: 'error' },
  skipped_flag_off: { label: 'El envío a HubSpot está desactivado', status: 'neutral' },
  skipped_no_connection: { label: 'HubSpot no está conectado', status: 'neutral' },
  skipped_missing_write_scope: { label: 'Falta permiso para escribir en HubSpot', status: 'neutral' },
  skipped_rollback: { label: 'No se envía: la empresa no está operativa', status: 'neutral' },
};

function resolveHubSpotPresentation(
  hubspotCompanyId: string | null | undefined,
  metadata: Record<string, unknown>,
): HubSpotPresentation {
  if (hubspotCompanyId) return { label: 'Sincronizada', status: 'active' };
  const syncStatus = metadata.hubspot_sync_status;
  const known = typeof syncStatus === 'string' ? HUBSPOT_SYNC_STATUS[syncStatus] : undefined;
  return known ?? { label: 'Aún no está en HubSpot', status: 'neutral' };
}

export default async function AccountDetailPage({ params, searchParams }: AccountDetailPageProps) {
  const [{ accountId }, { tab }] = await Promise.all([params, searchParams]);

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
  const hubspot = resolveHubSpotPresentation(account.hubspot_company_id, safeMetadata);
  const location = [account.city, account.region, account.country].filter(Boolean).join(', ');
  const ownerName = account.owner?.full_name ?? account.owner?.email ?? null;

  const tabs: UrlTab[] = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'contactos', label: 'Contactos', count: contacts.length },
    { id: 'inteligencia', label: 'Inteligencia' },
    { id: 'actividad', label: 'Actividad' },
    { id: 'agentes', label: 'Agentes', count: contactEnrichmentRuns.length },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        className="pb-0"
        title={account.name}
        description={account.legal_name ?? undefined}
        backHref="/accounts"
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Empresas', href: '/accounts' }, account.name]} />
        }
        meta={
          <>
            <StatusBadge
              status={PIPELINE_STATUS_TYPE[account.pipeline_status]}
              label={PIPELINE_STATUS_LABELS[account.pipeline_status]}
            />
            {isRolledBack && <StatusBadge status="warning" label="No operativa" />}
          </>
        }
        actions={
          <>
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
          </>
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

      {/* Lo esencial de la empresa, de un vistazo y antes de las pestañas. */}
      <SurfaceCard className="p-5">
        <DetailList columns={4} aria-label="Datos clave">
          <DetailItem icon={User} label="Responsable" emptyLabel="Sin asignar">
            {ownerName}
          </DetailItem>
          <DetailItem icon={Briefcase} label="Industria">
            {account.industry}
          </DetailItem>
          <DetailItem icon={MapPin} label="Ubicación">
            {location}
          </DetailItem>
          <DetailItem icon={Users} label="Contactos" emptyLabel="Sin contactos todavía">
            {contactsSummary.total > 0 && (
              <span className="tabular-nums">
                {contactsSummary.total}
                {contactsSummary.decision_makers > 0 && (
                  <span className="text-muted-foreground">
                    {' '}· {contactsSummary.decision_makers}{' '}
                    {contactsSummary.decision_makers === 1 ? 'decisor' : 'decisores'}
                  </span>
                )}
              </span>
            )}
          </DetailItem>
        </DetailList>
      </SurfaceCard>

      <UrlTabs
        ariaLabel="Secciones de la empresa"
        tabs={tabs}
        initialTab={typeof tab === 'string' ? tab : undefined}
      >
        {/* ── Resumen ─────────────────────────────────────────── */}
        <TabsContent value="resumen">
          <div className="grid gap-4 lg:grid-cols-2">
            <SurfaceCard>
              <SurfaceCardHeader title="Datos de la empresa" />
              <DetailList>
                {account.website && (
                  <DetailItem icon={Globe} label="Sitio web">
                    <a
                      href={account.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={LINK_CLASSES}
                    >
                      {account.domain ?? account.website}
                    </a>
                  </DetailItem>
                )}
                {account.linkedin_url && (
                  <DetailItem icon={Link2} label="LinkedIn">
                    <a
                      href={account.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`break-all ${LINK_CLASSES}`}
                    >
                      {account.linkedin_url.replace(/^https?:\/\/(www\.)?/i, '')}
                    </a>
                  </DetailItem>
                )}
                <DetailItem icon={MapPin} label="Ubicación">
                  {location}
                </DetailItem>
                <DetailItem icon={Briefcase} label="Industria">
                  {account.industry}
                </DetailItem>
                <DetailItem icon={Users} label="Tamaño">
                  {account.company_size}
                </DetailItem>
                {account.tax_identifier && (
                  <DetailItem icon={Hash} label={account.tax_identifier_type ?? 'ID fiscal'}>
                    <span className="tabular-nums">{account.tax_identifier}</span>
                  </DetailItem>
                )}
              </DetailList>
            </SurfaceCard>

            <SurfaceCard>
              <SurfaceCardHeader title="Seguimiento" />
              <DetailList>
                <DetailItem icon={User} label="Responsable" emptyLabel="Sin asignar">
                  {ownerName}
                </DetailItem>
                <DetailItem icon={Globe} label="HubSpot">
                  <StatusBadge status={hubspot.status} label={hubspot.label} />
                  {account.hubspot_company_id && (
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      Ficha n.º {account.hubspot_company_id}
                    </p>
                  )}
                </DetailItem>
                <DetailItem icon={Tag} label="Cómo llegó">
                  <Badge variant="outline">
                    {SOURCE_LABELS[account.source as AccountSource]}
                  </Badge>
                </DetailItem>
                <DetailItem icon={Calendar} label="Creada">
                  {formatShortDate(account.created_at)}
                </DetailItem>
              </DetailList>

              <section className="mt-4 border-t border-border/60 pt-4">
                <Heading level={6} as="h3" weight="medium" className="mb-1 text-xs leading-normal text-muted-foreground">
                  Notas
                </Heading>
                {account.notes ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{account.notes}</p>
                ) : (
                  <p className="text-sm text-text-muted">
                    Sin notas. Añádelas con «Editar empresa», en el menú de acciones.
                  </p>
                )}
              </section>
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
          <EmptyState
            icon={Brain}
            title="Aún no hay inteligencia comercial de esta empresa"
            description="Cuando esté disponible verás aquí su estructura, sus señales de negocio y sus noticias recientes. Mientras tanto, empieza por sus contactos."
          />
        </TabsContent>

        {/* ── Actividad ────────────────────────────────────────── */}
        <TabsContent value="actividad">
          <SurfaceCard>
            <SurfaceCardHeader
              title="Historial"
              description="Quién cambió qué en esta empresa, de lo más reciente a lo más antiguo."
            />
            {auditLog.length === 0 ? (
              <EmptyState
                variant="plain"
                icon={Activity}
                title="Aún no hay cambios registrados"
                description="Cuando alguien cambie el estado, el responsable o los datos de la empresa, quedará anotado aquí."
              />
            ) : (
              <Timeline>
                {auditLog.map((entry) => {
                  const presentation = AUDIT_PRESENTATION[entry.action_type] ?? FALLBACK_AUDIT;
                  const Icon = presentation.icon;
                  return (
                    <TimelineItem
                      key={entry.id}
                      icon={<Icon />}
                      tone={presentation.tone}
                      title={presentation.title}
                      time={formatDate(entry.created_at)}
                      description={
                        entry.actor
                          ? `Por ${entry.actor.full_name ?? entry.actor.email}`
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
      </UrlTabs>
    </div>
  );
}
