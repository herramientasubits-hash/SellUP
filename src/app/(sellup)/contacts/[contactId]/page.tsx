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
  Calendar,
  UserSearch,
} from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { describeContactAuditDetails } from './audit-details';

interface ContactDetailPageProps {
  params: Promise<{ contactId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}

type BadgeTone = 'neutral' | 'brand' | 'warning' | 'positive' | 'negative';

const CONTACT_STATUS_TYPE: Record<ContactStatus, StatusType> = {
  active: 'active',
  inactive: 'inactive',
  left_company: 'warning',
  do_not_contact: 'error',
  archived: 'neutral',
};

const ROLE_VARIANT: Record<string, BadgeTone> = {
  decision_maker: 'brand',
  economic_buyer: 'brand',
  champion: 'positive',
  influencer: 'warning',
};

const LINK_CLASSES =
  'rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40';

interface AuditPresentation {
  title: string;
  tone: TimelineTone;
}

const AUDIT_PRESENTATION: Record<ContactAuditAction, AuditPresentation> = {
  contact_created: { title: 'Contacto creado', tone: 'positive' },
  contact_updated: { title: 'Datos actualizados', tone: 'default' },
  contact_status_changed: { title: 'Cambio de estado', tone: 'primary' },
  contact_archived: { title: 'Contacto archivado', tone: 'warning' },
  contact_primary_changed: { title: 'Cambio de contacto principal', tone: 'info' },
  contact_role_changed: { title: 'Cambio de rol en la empresa', tone: 'primary' },
};

const FALLBACK_AUDIT: AuditPresentation = { title: 'Cambio registrado', tone: 'default' };

const TABS: readonly UrlTab[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'actividad', label: 'Actividad' },
  { id: 'enriquecimiento', label: 'Enriquecimiento' },
  { id: 'hubspot', label: 'HubSpot' },
];

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

export default async function ContactDetailPage({ params, searchParams }: ContactDetailPageProps) {
  const [{ contactId }, { tab }] = await Promise.all([params, searchParams]);

  const contact = await getContactById(contactId);
  if (!contact) notFound();

  const [auditLog, account] = await Promise.all([
    getContactAudit(contactId),
    getAccountById(contact.account_id),
  ]);

  const bestPhone = contact.mobile_phone ?? contact.phone ?? null;
  const hubspotContact = {
    hubspot_contact_id: contact.hubspot_contact_id,
    metadata: contact.metadata as Record<string, unknown> | null,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        className="pb-0"
        title={contact.full_name}
        description={
          [contact.job_title, account?.name].filter(Boolean).join(' · ') || undefined
        }
        backHref="/contacts"
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Contactos', href: '/contacts' }, contact.full_name]} />
        }
        meta={
          <>
            <StatusBadge
              status={CONTACT_STATUS_TYPE[contact.contact_status]}
              label={CONTACT_STATUS_LABELS[contact.contact_status]}
            />
            {contact.is_primary && (
              <Badge variant="warning">
                <Star className="fill-warning" aria-hidden="true" />
                Contacto principal
              </Badge>
            )}
            {contact.role_in_account && (
              <Badge variant={ROLE_VARIANT[contact.role_in_account] ?? 'neutral'}>
                {ROLE_LABELS[contact.role_in_account as ContactRole]}
              </Badge>
            )}
          </>
        }
        actions={<ContactRowActions contact={contact} />}
      />

      {/* Lo esencial del contacto, de un vistazo y antes de las pestañas. */}
      <SurfaceCard className="p-5">
        <DetailList columns={4} aria-label="Datos clave">
          <DetailItem icon={Building2} label="Empresa" emptyLabel="Sin empresa">
            {account && (
              <Link href={`/accounts/${account.id}`} className={LINK_CLASSES}>
                {account.name}
              </Link>
            )}
          </DetailItem>
          <DetailItem icon={Mail} label="Correo" emptyLabel="Sin correo">
            {contact.email && (
              <a href={`mailto:${contact.email}`} className={`break-all ${LINK_CLASSES}`}>
                {contact.email}
              </a>
            )}
          </DetailItem>
          <DetailItem icon={Phone} label="Teléfono" emptyLabel="Sin teléfono">
            {bestPhone && (
              <a href={`tel:${bestPhone}`} className={`tabular-nums ${LINK_CLASSES}`}>
                {bestPhone}
              </a>
            )}
          </DetailItem>
          <DetailItem icon={Tag} label="HubSpot">
            <ContactHubSpotSyncBadge contact={hubspotContact} />
          </DetailItem>
        </DetailList>
      </SurfaceCard>

      <UrlTabs
        ariaLabel="Secciones del contacto"
        tabs={TABS}
        initialTab={typeof tab === 'string' ? tab : undefined}
      >
        {/* ── Resumen ─────────────────────────────────────────── */}
        <TabsContent value="resumen">
          <div className="grid gap-4 lg:grid-cols-2">
            <SurfaceCard>
              <SurfaceCardHeader title="Cómo contactarle" />
              <DetailList>
                <DetailItem icon={Mail} label="Correo" emptyLabel="Sin correo">
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className={`break-all ${LINK_CLASSES}`}>
                      {contact.email}
                    </a>
                  )}
                </DetailItem>
                <DetailItem icon={Phone} label="Celular" emptyLabel="Sin celular">
                  {contact.mobile_phone && (
                    <a href={`tel:${contact.mobile_phone}`} className={`tabular-nums ${LINK_CLASSES}`}>
                      {contact.mobile_phone}
                    </a>
                  )}
                </DetailItem>
                <DetailItem icon={Phone} label="Teléfono fijo" emptyLabel="Sin teléfono fijo">
                  {contact.phone && (
                    <a href={`tel:${contact.phone}`} className={`tabular-nums ${LINK_CLASSES}`}>
                      {contact.phone}
                    </a>
                  )}
                </DetailItem>
                <DetailItem icon={Link2} label="LinkedIn" emptyLabel="Sin perfil">
                  {contact.linkedin_url && (
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`break-all ${LINK_CLASSES}`}
                    >
                      {contact.linkedin_url.replace(/^https?:\/\/(www\.)?/i, '')}
                    </a>
                  )}
                </DetailItem>
              </DetailList>
            </SurfaceCard>

            <SurfaceCard>
              <SurfaceCardHeader title="Su papel en la empresa" />
              <DetailList>
                <DetailItem icon={Briefcase} label="Cargo">
                  {contact.job_title}
                </DetailItem>
                <DetailItem icon={Briefcase} label="Área">
                  {contact.department}
                </DetailItem>
                <DetailItem icon={User} label="Nivel">
                  {contact.seniority ? SENIORITY_LABELS[contact.seniority] : null}
                </DetailItem>
                <DetailItem icon={Tag} label="Rol en la venta" emptyLabel="Sin definir">
                  {contact.role_in_account && (
                    <Badge variant={ROLE_VARIANT[contact.role_in_account] ?? 'neutral'}>
                      {ROLE_LABELS[contact.role_in_account as ContactRole]}
                    </Badge>
                  )}
                </DetailItem>
                <DetailItem icon={Tag} label="Cómo llegó">
                  <Badge variant="neutral">
                    {CONTACT_SOURCE_LABELS[contact.source]}
                  </Badge>
                </DetailItem>
                <DetailItem icon={Calendar} label="Creado">
                  {formatShortDate(contact.created_at)}
                </DetailItem>
              </DetailList>

              <section className="mt-4 border-t border-border/60 pt-4">
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">Notas</h3>
                {contact.notes ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{contact.notes}</p>
                ) : (
                  <p className="text-sm text-text-muted">
                    Sin notas. Añádelas con «Editar», en el menú de acciones.
                  </p>
                )}
              </section>
            </SurfaceCard>
          </div>
        </TabsContent>

        {/* ── Actividad ────────────────────────────────────────── */}
        <TabsContent value="actividad">
          <SurfaceCard>
            <SurfaceCardHeader
              title="Historial"
              description="Quién cambió qué en este contacto, de lo más reciente a lo más antiguo."
            />
            {auditLog.length === 0 ? (
              <EmptyState
                variant="plain"
                icon={Activity}
                title="Aún no hay cambios registrados"
                description="Cuando alguien cambie su estado, su rol o sus datos, quedará anotado aquí."
              />
            ) : (
              <Timeline>
                {auditLog.map((entry) => {
                  const presentation = AUDIT_PRESENTATION[entry.action_type] ?? FALLBACK_AUDIT;
                  const detail = describeContactAuditDetails(entry.action_type, entry.details);
                  return (
                    <TimelineItem
                      key={entry.id}
                      icon={<Activity />}
                      tone={presentation.tone}
                      title={presentation.title}
                      time={formatDate(entry.created_at)}
                      description={
                        entry.actor
                          ? `Por ${entry.actor.full_name ?? entry.actor.email}`
                          : undefined
                      }
                    >
                      {detail && <p className="break-words text-xs text-muted-foreground">{detail}</p>}
                    </TimelineItem>
                  );
                })}
              </Timeline>
            )}
          </SurfaceCard>
        </TabsContent>

        {/* ── Enriquecimiento ──────────────────────────────────── */}
        <TabsContent value="enriquecimiento">
          <EmptyState
            icon={UserSearch}
            title="Aquí todavía no hay historial de enriquecimiento"
            description={
              account
                ? 'Para buscar su correo verificado o su teléfono, usa «Enriquecer contactos» desde la ficha de la empresa.'
                : 'Asocia este contacto a una empresa para poder buscar su correo verificado o su teléfono.'
            }
            action={
              account ? (
                <Button asChild variant="outline">
                  <Link href={`/accounts/${account.id}?tab=contactos`}>Ir a {account.name}</Link>
                </Button>
              ) : undefined
            }
          />
        </TabsContent>

        {/* ── HubSpot ──────────────────────────────────────────── */}
        <TabsContent value="hubspot">
          <SurfaceCard>
            <SurfaceCardHeader
              title="Sincronización con HubSpot"
              description="Si este contacto ya tiene ficha en HubSpot y en qué estado está."
            />
            <DetailList>
              <DetailItem icon={Tag} label="Estado">
                {/* AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX — antes esto era un badge HARDCODEADO
                    (preexistente, 21-05). Ignoraba el estado durable y contradecía al drawer
                    sobre el mismo contacto: un contacto SÍ sincronizado seguía leyéndose aquí
                    como si la sync no existiera. Ahora lo dice la misma autoridad, así que las
                    dos superficies no pueden divergir. */}
                <ContactHubSpotSyncBadge contact={hubspotContact} />
              </DetailItem>
              <DetailItem icon={Tag} label="Ficha en HubSpot" emptyLabel="Aún no tiene ficha">
                {contact.hubspot_contact_id && (
                  <span className="tabular-nums">n.º {contact.hubspot_contact_id}</span>
                )}
              </DetailItem>
            </DetailList>
            <section className="mt-4 border-t border-border/60 pt-4">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Qué se envía</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {/* AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX — este párrafo no afirma nada sobre si la
                    sincronización está activa: eso lo dice el badge de arriba. Lo que sí sigue
                    siendo cierto es que las 7 propiedades propias de SellUp están pendientes de
                    crear en el portal. */}
                Al sincronizar viajan el nombre, el correo, los teléfonos, el cargo, el nivel y
                el perfil de LinkedIn. Hay 7 campos propios de SellUp que todavía están
                pendientes de crear en HubSpot.
              </p>
            </section>
          </SurfaceCard>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
