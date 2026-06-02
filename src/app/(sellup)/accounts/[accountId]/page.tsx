import { notFound } from 'next/navigation';
import {
  Building2,
  Brain,
  Users,
  Activity,
  Bot,
  Globe,
  MapPin,
  Tag,
  Hash,
  Calendar,
  User,
  Briefcase,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getAccountById, getAccountAudit, getActiveUsers } from '@/modules/accounts/actions';
import { getContactsByAccount, getContactsSummary } from '@/modules/contacts/actions';
import { ContactsTab } from '@/components/contacts/contacts-tab';
import {
  PIPELINE_STATUS_LABELS,
  SOURCE_LABELS,
  AUDIT_ACTION_LABELS,
  type PipelineStatus,
  type AccountSource,
  type AccountAuditAction,
} from '@/modules/accounts/types';
import { AccountDetailActions } from '@/components/accounts/account-detail-actions';
import { RollbackBanner } from '@/components/accounts/rollback-banner';

interface AccountDetailPageProps {
  params: Promise<{ accountId: string }>;
}

const STATUS_STYLES: Record<PipelineStatus, string> = {
  new: 'bg-muted text-muted-foreground border-transparent',
  ready_for_research: 'bg-su-brand-soft text-su-brand border-transparent',
  research_in_progress: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
  ready_for_outreach: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
  archived: 'bg-muted/60 text-muted-foreground/60 border-transparent',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const AUDIT_ICONS: Record<AccountAuditAction, typeof Activity> = {
  account_created: Building2,
  account_updated: Briefcase,
  account_status_changed: Tag,
  account_archived: Building2,
  account_owner_changed: User,
};

export default async function AccountDetailPage({ params }: AccountDetailPageProps) {
  const { accountId } = await params;

  const [account, auditLog, users, contacts, contactsSummary] = await Promise.all([
    getAccountById(accountId),
    getAccountAudit(accountId),
    getActiveUsers(),
    getContactsByAccount(accountId),
    getContactsSummary(accountId),
  ]);

  if (!account) notFound();

  const safeMetadata =
    account.metadata !== null &&
    typeof account.metadata === 'object' &&
    !Array.isArray(account.metadata)
      ? (account.metadata as Record<string, unknown>)
      : {};

  const isRolledBack = safeMetadata.rollback_logical === true;

  return (
    <div className="space-y-6">
      <PageHeader
        title={account.name}
        description={account.legal_name ?? undefined}
        backHref="/accounts"
        actions={
          <div className="flex items-center gap-2">
            {isRolledBack && (
              <Badge
                variant="outline"
                className="text-xs border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                No operativa
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-xs ${STATUS_STYLES[account.pipeline_status]}`}
            >
              {PIPELINE_STATUS_LABELS[account.pipeline_status]}
            </Badge>
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
              <dl className="space-y-3">
                {account.website && (
                  <DetailRow icon={Globe} label="Sitio web">
                    <a
                      href={account.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-su-brand hover:underline"
                    >
                      {account.domain ?? account.website}
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
                  <Badge variant="outline" className="text-[10px]">
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
              <dl className="space-y-3">
                <DetailRow icon={User} label="Owner">
                  {account.owner?.full_name ?? account.owner?.email ?? (
                    <span className="text-muted-foreground/50">Sin asignar</span>
                  )}
                </DetailRow>
                <DetailRow icon={Tag} label="Estado pipeline">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      STATUS_STYLES[account.pipeline_status]
                    }`}
                  >
                    {PIPELINE_STATUS_LABELS[account.pipeline_status]}
                  </span>
                </DetailRow>
                {account.hubspot_company_id && (
                  <DetailRow icon={Globe} label="HubSpot ID">
                    <span className="font-mono text-xs">{account.hubspot_company_id}</span>
                  </DetailRow>
                )}
              </dl>

              {account.notes && (
                <div className="mt-4 rounded-lg bg-muted/40 px-3 py-2.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
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
              <p className="py-6 text-center text-xs text-muted-foreground">
                Sin actividad registrada todavía.
              </p>
            ) : (
              <ol className="space-y-3">
                {auditLog.map((entry) => {
                  const Icon = AUDIT_ICONS[entry.action_type] ?? Activity;
                  return (
                    <li key={entry.id} className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground">
                          {AUDIT_ACTION_LABELS[entry.action_type]}
                        </p>
                        {entry.actor && (
                          <p className="text-[11px] text-muted-foreground">
                            por {entry.actor.full_name ?? entry.actor.email}
                          </p>
                        )}
                        <p className="text-[11px] text-muted-foreground/50">
                          {formatDate(entry.created_at)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </SurfaceCard>
        </TabsContent>

        {/* ── Agentes ──────────────────────────────────────────── */}
        <TabsContent value="agentes">
          <PlaceholderTab
            icon={Bot}
            title="Agentes IA — Próxima fase"
            description="Desde aquí se ejecutarán y monitorearán los agentes IA sobre esta cuenta: Agente 1 de enriquecimiento, speech comercial, análisis de oportunidades y más."
          />
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
        <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          {label}
        </dt>
        <dd className="mt-0.5 text-xs text-foreground">{children}</dd>
      </div>
    </div>
  );
}

function PlaceholderTab({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <SurfaceCard>
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
          <Icon className="h-5 w-5 text-muted-foreground/40" />
        </div>
        <div className="max-w-sm space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
    </SurfaceCard>
  );
}
