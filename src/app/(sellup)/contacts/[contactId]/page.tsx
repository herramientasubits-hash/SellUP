import { formatInAppZone } from '@/lib/format-date';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Mail,
  Phone,
  Link2,
  Briefcase,
  Activity,
  Tag,
  Star,
  User,
  Building2,
  Globe,
} from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { Timeline, TimelineItem } from '@/components/data-display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getContactById, getContactAudit } from '@/modules/contacts/actions';
import { getAccountById } from '@/modules/accounts/actions';
import {
  ROLE_LABELS,
  SENIORITY_LABELS,
  CONTACT_STATUS_LABELS,
  CONTACT_SOURCE_LABELS,
  type ContactStatus,
  type ContactRole,
  type ContactAuditAction,
} from '@/modules/contacts/types';
import { ContactRowActions } from '@/components/contacts/contact-row-actions';
import { ContactHubSpotSyncBadge } from '@/components/contacts/contact-hubspot-sync-badge';

interface ContactDetailPageProps {
  params: Promise<{ contactId: string }>;
}

type BadgeTone = 'neutral' | 'brand' | 'warning' | 'positive' | 'negative';

const STATUS_VARIANT: Record<ContactStatus, BadgeTone> = {
  active: 'positive',
  inactive: 'neutral',
  left_company: 'warning',
  do_not_contact: 'negative',
  archived: 'neutral',
};

const ROLE_VARIANT: Record<string, BadgeTone> = {
  decision_maker: 'brand',
  economic_buyer: 'brand',
  champion: 'positive',
  influencer: 'warning',
};

/** Pares etiqueta/valor en rejilla: dos columnas cuando la tarjeta tiene ancho. */
const DETAIL_GRID = 'grid gap-x-6 gap-y-3 sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2';

const AUDIT_LABELS: Record<ContactAuditAction, string> = {
  contact_created: 'Contacto creado',
  contact_updated: 'Contacto actualizado',
  contact_status_changed: 'Estado cambiado',
  contact_archived: 'Contacto archivado',
  contact_primary_changed: 'Contacto primario actualizado',
  contact_role_changed: 'Rol en cuenta actualizado',
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

export default async function ContactDetailPage({ params }: ContactDetailPageProps) {
  const { contactId } = await params;

  const contact = await getContactById(contactId);
  if (!contact) notFound();

  const [auditLog, account] = await Promise.all([
    getContactAudit(contactId),
    getAccountById(contact.account_id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={contact.full_name}
        description={contact.job_title ?? undefined}
        backHref="/contacts"
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Contactos', href: '/contacts' }, contact.full_name]} />
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {contact.is_primary && (
              <Badge variant="warning">
                <Star className="fill-warning" aria-hidden="true" />
                Primario
              </Badge>
            )}
            <Badge variant={STATUS_VARIANT[contact.contact_status]}>
              {CONTACT_STATUS_LABELS[contact.contact_status]}
            </Badge>
            {contact.role_in_account && (
              <Badge variant={ROLE_VARIANT[contact.role_in_account] ?? 'neutral'}>
                {ROLE_LABELS[contact.role_in_account as ContactRole]}
              </Badge>
            )}
            <ContactRowActions contact={contact} />
          </div>
        }
      />

      <Tabs defaultValue="resumen">
        <TabsList className="mb-4">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="actividad">Actividad</TabsTrigger>
          <TabsTrigger value="enriquecimiento">Enriquecimiento</TabsTrigger>
          <TabsTrigger value="hubspot">HubSpot</TabsTrigger>
        </TabsList>

        {/* ── Resumen ─────────────────────────────────────────── */}
        <TabsContent value="resumen" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Datos de contacto */}
            <SurfaceCard>
              <SurfaceCardHeader title="Datos de contacto" />
              <dl className={DETAIL_GRID}>
                {contact.email && (
                  <DetailRow icon={Mail} label="Email">
                    <a
                      href={`mailto:${contact.email}`}
                      className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      {contact.email}
                    </a>
                  </DetailRow>
                )}
                {contact.mobile_phone && (
                  <DetailRow icon={Phone} label="Celular">
                    <a href={`tel:${contact.mobile_phone}`} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                      {contact.mobile_phone}
                    </a>
                  </DetailRow>
                )}
                {contact.phone && (
                  <DetailRow icon={Phone} label="Teléfono">
                    <a href={`tel:${contact.phone}`} className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                      {contact.phone}
                    </a>
                  </DetailRow>
                )}
                {contact.linkedin_url && (
                  <DetailRow icon={Link2} label="LinkedIn">
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      {contact.linkedin_url}
                    </a>
                  </DetailRow>
                )}
                <DetailRow icon={Building2} label="Cuenta">
                  {account ? (
                    <Link href={`/accounts/${account.id}`} className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                      {account.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Sin cuenta</span>
                  )}
                </DetailRow>
              </dl>
            </SurfaceCard>

            {/* Cargo y función */}
            <SurfaceCard>
              <SurfaceCardHeader title="Cargo y función" />
              <dl className={DETAIL_GRID}>
                {contact.job_title && (
                  <DetailRow icon={Briefcase} label="Cargo">
                    {contact.job_title}
                  </DetailRow>
                )}
                {contact.department && (
                  <DetailRow icon={Briefcase} label="Área">
                    {contact.department}
                  </DetailRow>
                )}
                {contact.seniority && (
                  <DetailRow icon={User} label="Seniority">
                    {SENIORITY_LABELS[contact.seniority]}
                  </DetailRow>
                )}
                {contact.role_in_account && (
                  <DetailRow icon={Tag} label="Rol en cuenta">
                    <Badge variant={ROLE_VARIANT[contact.role_in_account] ?? 'neutral'}>
                      {ROLE_LABELS[contact.role_in_account as ContactRole]}
                    </Badge>
                  </DetailRow>
                )}
                <DetailRow icon={Tag} label="Fuente">
                  <Badge variant="neutral">
                    {CONTACT_SOURCE_LABELS[contact.source]}
                  </Badge>
                </DetailRow>
                <DetailRow icon={Tag} label="Creado">
                  {formatShortDate(contact.created_at)}
                </DetailRow>
              </dl>

              {contact.notes && (
                <div className="mt-4 rounded-lg bg-surface-subtle px-3 py-2.5">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    Notas
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{contact.notes}</p>
                </div>
              )}
            </SurfaceCard>
          </div>
        </TabsContent>

        {/* ── Actividad ────────────────────────────────────────── */}
        <TabsContent value="actividad">
          <SurfaceCard>
            <SurfaceCardHeader
              title="Registro de actividad"
              description="Cambios y eventos de auditoría de este contacto."
            />
            {auditLog.length === 0 ? (
              <EmptyState variant="plain" icon={Activity} title="Sin actividad registrada todavía." />
            ) : (
              <Timeline>
                {auditLog.map((entry) => (
                  <TimelineItem
                    key={entry.id}
                    icon={<Activity />}
                    title={AUDIT_LABELS[entry.action_type]}
                    time={formatDate(entry.created_at)}
                    description={
                      entry.actor
                        ? `por ${entry.actor.full_name ?? entry.actor.email}`
                        : undefined
                    }
                  >
                    {Object.keys(entry.details).length > 0 && (
                      <p className="break-words text-xs text-muted-foreground">
                        {JSON.stringify(entry.details)}
                      </p>
                    )}
                  </TimelineItem>
                ))}
              </Timeline>
            )}
          </SurfaceCard>
        </TabsContent>

        {/* ── Enriquecimiento ──────────────────────────────────── */}
        <TabsContent value="enriquecimiento">
          <EmptyState
            icon={Globe}
            title="Enriquecimiento — Próxima fase"
            description="Enriquecimiento automático con Apollo y Lusha: email verificado, teléfono directo, cargo actualizado y señales de intención."
          />
        </TabsContent>

        {/* ── HubSpot ──────────────────────────────────────────── */}
        <TabsContent value="hubspot">
          <SurfaceCard>
            <SurfaceCardHeader title="Sincronización HubSpot" />
            <dl className={DETAIL_GRID}>
              <DetailRow icon={Tag} label="HubSpot Contact ID">
                {contact.hubspot_contact_id ? (
                  <span className="font-mono text-xs">{contact.hubspot_contact_id}</span>
                ) : (
                  <span className="text-muted-foreground">No vinculado</span>
                )}
              </DetailRow>
              <DetailRow icon={Tag} label="Estado de sincronización">
                {/* AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX — antes esto era un badge HARDCODEADO
                    «Sincronización no activa» (preexistente, 21-05). Ignoraba el estado durable
                    y contradecía al drawer sobre el mismo contacto: un contacto SÍ sincronizado
                    seguía leyéndose aquí como si la sync no existiera. Ahora lo dice la misma
                    autoridad, así que las dos superficies no pueden divergir. */}
                <ContactHubSpotSyncBadge
                  contact={{
                    hubspot_contact_id: contact.hubspot_contact_id,
                    metadata: contact.metadata as Record<string, unknown> | null,
                  }}
                />
              </DetailRow>
            </dl>
            <div className="mt-4 rounded-lg bg-surface-subtle px-3 py-2.5">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">
                Propiedades mapeadas
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {/* AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX — se cae «antes de activar la sync»:
                    afirmaba lo mismo que el badge hardcodeado de arriba, y dejarla haría que el
                    párrafo contradijera al estado durable que el badge ya dice bien. Lo que sí
                    sigue siendo cierto —y es todo lo que esta frase puede afirmar— es que las 7
                    propiedades custom siguen pendientes de crear en el portal. */}
                Este contacto está preparado para sincronizar con HubSpot Contact. El mapping
                cubre{' '}
                <span className="font-medium text-foreground">
                  firstname, lastname, email, phone, mobilephone, jobtitle, seniority, hs_linkedin_url
                </span>
                {' '}y 7 propiedades custom (<span className="font-mono text-xs">sellup_*</span>)
                pendientes de crear en el portal UBITS.
              </p>
            </div>
          </SurfaceCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Componente auxiliar ────────────────────────────────────────

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
