'use client';

import { formatInAppZone } from '@/lib/format-date';
import * as React from 'react';
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
} from "@/icons";
import { DrawerShell } from '@/components/shared/drawer-shell';
import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { DrawerSection } from '@/components/shared/drawer-section';
import { SurfaceCard } from '@/components/shared/surface-card';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { Timeline, TimelineItem } from '@/components/data-display';
import { getAccountById, getAccountAudit, getActiveUsers } from '@/modules/accounts/actions';
import { getContactsByAccount, getContactsSummary } from '@/modules/contacts/actions';
import { getContactEnrichmentRunsByAccountId } from '@/modules/contact-enrichment/account-run-history-actions';
import { AccountAgentsRunHistory } from '@/components/contact-enrichment/account-agents-run-history';
import type { AccountContactEnrichmentRun } from '@/modules/contact-enrichment/account-run-history-types';
import {
  PIPELINE_STATUS_LABELS,
  SOURCE_LABELS,
  AUDIT_ACTION_LABELS,
  type PipelineStatus,
  type AccountSource,
  type AccountAuditAction,
  type AccountWithOwner,
  type AccountAuditEntry,
  type InternalUserOption,
} from '@/modules/accounts/types';
import type { Contact, ContactsSummary } from '@/modules/contacts/types';
import { AccountDetailActions } from './account-detail-actions';
import { AccountEnrichContactsButton } from './account-enrich-contacts-button';
import type { ContactEnrichmentInitialCompany } from '@/components/contact-enrichment/contact-enrichment-drawer';
import { ContactsTab } from '@/components/contacts/contacts-tab';
import { ContactDetailSheet } from '@/components/contacts/contact-detail-sheet';
import { PeruSunatLegalValidationBlock } from '@/components/prospect-batches/peru-sunat-legal-validation-block';
import type { PeruSunatEnrichmentBlock } from '@/server/prospect-batches/peru-sunat-post-approval-enrichment';
import { PeruMigoLegalValidationBlock } from '@/components/prospect-batches/peru-migo-legal-validation-block';
import type { PeMigoApiEnrichmentBlock } from '@/server/prospect-batches/peru-migo-legal-enrichment';

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

const STATUS_VARIANT: Record<PipelineStatus, BadgeVariant> = {
  new: 'neutral',
  ready_for_research: 'brand',
  research_in_progress: 'warning',
  ready_for_outreach: 'positive',
  archived: 'neutral',
};

const AUDIT_ICONS: Partial<Record<AccountAuditAction, React.ComponentType<{ className?: string }>>> = {
  account_created: Building2,
  account_updated: Briefcase,
  account_status_changed: Tag,
  account_archived: Building2,
  account_owner_changed: User,
};

function formatDate(iso: string) {
  return formatInAppZone(iso, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }, 'es-CO');
}

function formatShortDate(iso: string) {
  return formatInAppZone(iso, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }, 'es-CO');
}

interface AccountDetailSheetProps {
  accountId: string | null;
  open: boolean;
  onClose: () => void;
  /**
   * When provided, clicking "Enriquecer contactos" inside the sheet delegates
   * the open action to the parent instead of opening a nested drawer. The parent
   * is responsible for closing this sheet before opening the enrichment drawer.
   */
  onRequestEnrich?: (company: ContactEnrichmentInitialCompany) => void;
}

interface SheetData {
  account: AccountWithOwner;
  auditLog: AccountAuditEntry[];
  contacts: Contact[];
  contactsSummary: ContactsSummary;
  users: InternalUserOption[];
  contactEnrichmentRuns: AccountContactEnrichmentRun[];
}

export function AccountDetailSheet({ accountId, open, onClose, onRequestEnrich }: AccountDetailSheetProps) {
  const [data, setData] = React.useState<SheetData | null>(null);
  const [loading, setLoading] = React.useState(false);
  // Antes, si la empresa no se podía leer, el panel se quedaba girando para
  // siempre. Ahora lo dice y ofrece reintentar.
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [contactSheetId, setContactSheetId] = React.useState<string | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = React.useState(false);

  const loadData = React.useCallback(async (id: string) => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const account = await getAccountById(id);
      if (!account) {
        setLoadFailed(true);
        return;
      }
      const [auditLog, contacts, contactsSummary, users, contactEnrichmentRuns] = await Promise.all([
        getAccountAudit(id),
        getContactsByAccount(id),
        getContactsSummary(id),
        getActiveUsers(),
        getContactEnrichmentRunsByAccountId(id),
      ]);
      setData({ account, auditLog, contacts, contactsSummary, users, contactEnrichmentRuns });
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open && accountId) {
      let cancelled = false;
      (async () => {
        await loadData(accountId);
        if (cancelled) return;
      })();
      return () => { cancelled = true; };
    } else if (!open) {
      queueMicrotask(() => {
        setData(null);
        setLoadFailed(false);
      });
    }
  }, [open, accountId, loadData]);

  function openContactDetail(cId: string) {
    setContactSheetId(cId);
    setContactSheetOpen(true);
  }

  return (
    <>
      <DrawerShell
        open={open}
        onOpenChange={(v) => !v && onClose()}
        side="right"
        className="w-full sm:w-[58vw] sm:min-w-[660px] sm:!max-w-[900px]"
        icon={<Building2 className="h-4 w-4" />}
        title={data ? data.account.name : loadFailed ? 'Empresa no disponible' : 'Cargando empresa…'}
        description={data ? (data.account.legal_name || undefined) : undefined}
        titleBadge={
          data ? (
            <Badge
              variant={STATUS_VARIANT[data.account.pipeline_status]}
            >
              {PIPELINE_STATUS_LABELS[data.account.pipeline_status]}
            </Badge>
          ) : undefined
        }
        loading={loading && !data}
        // Pie: lo secundario (editar, cambiar estado, archivar) a la izquierda y
        // la acción principal del panel a la derecha.
        actions={
          data ? (
            <>
              <AccountDetailActions
                accountId={data.account.id}
                currentStatus={data.account.pipeline_status}
                users={data.users}
                onChanged={() => loadData(data.account.id)}
                onArchived={onClose}
              />
              <AccountEnrichContactsButton
                variant="default"
                label="Buscar contactos"
                preloadedCompany={{
                  name: data.account.name,
                  domain: data.account.domain,
                  country: data.account.country,
                  countryCode: data.account.country_code,
                  sellupAccountId: data.account.id,
                  hubspotCompanyId: data.account.hubspot_company_id,
                }}
                disabled={data.account.pipeline_status === 'archived'}
                onRequestOpen={onRequestEnrich}
              />
            </>
          ) : undefined
        }
      >
        {!data ? (
          loadFailed ? (
            <EmptyState
              variant="plain"
              icon={Building2}
              title="No pudimos cargar esta empresa"
              description="Puede que ya no exista o que no tengas acceso a ella. Si crees que es un error, inténtalo de nuevo."
              action={
                accountId ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => loadData(accountId)}>
                    Reintentar
                  </Button>
                ) : undefined
              }
            />
          ) : null
        ) : (
          <div className="space-y-4">
            {/* Lo esencial, antes de las pestañas: quién la lleva, dónde está,
                cómo se llega a ella y cuánta gente conocemos dentro. */}
            <section aria-label="Resumen de la empresa">
              <SurfaceCard className="p-4">
              <DetailList columns={4}>
                <DetailItem icon={User} label="Responsable" emptyLabel="Sin asignar">
                  {data.account.owner?.full_name ?? data.account.owner?.email}
                </DetailItem>
                <DetailItem icon={MapPin} label="Ubicación" emptyLabel="Sin ubicación">
                  {[data.account.city, data.account.region, data.account.country].filter(Boolean).join(', ')}
                </DetailItem>
                <DetailItem icon={Globe} label="Sitio web" emptyLabel="Sin sitio web">
                  {data.account.website ? (
                    <a
                      href={data.account.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                    >
                      {data.account.domain ?? data.account.website}
                    </a>
                  ) : null}
                </DetailItem>
                <DetailItem icon={Users} label="Contactos">
                  <span className="tabular-nums">{data.contacts.length}</span>
                </DetailItem>
              </DetailList>
            </SurfaceCard>
            </section>

          {/* Design Refresh v3: tabs alineados con el contenido (antes mx-7 mt-4
              sumaban al px-7 del cuerpo del drawer y quedaban indentados 28px más). */}
          <Tabs defaultValue="resumen">
                  <TabsList variant="segmented" className="mb-2">
                    <TabsTrigger value="resumen"><Building2 className="h-4 w-4" /> Resumen</TabsTrigger>
                    <TabsTrigger value="contactos"><Users className="h-4 w-4" /> Contactos</TabsTrigger>
                    <TabsTrigger value="inteligencia"><Brain className="h-4 w-4" /> Inteligencia</TabsTrigger>
                    <TabsTrigger value="actividad"><Activity className="h-4 w-4" /> Actividad</TabsTrigger>
                    <TabsTrigger value="agentes"><Bot className="h-4 w-4" /> Agentes</TabsTrigger>
                  </TabsList>

                  {/* Resumen */}
                  <TabsContent value="resumen" className="space-y-4">
                    {/* Peru SUNAT legal validation block */}
                    {data.account.country_code?.toUpperCase() === 'PE' && (() => {
                      const peSunatBlock = (
                        (data.account.metadata?.source_enrichment as Record<string, unknown> | undefined)
                          ?.pe_sunat_bulk as PeruSunatEnrichmentBlock | null | undefined
                      ) ?? null;
                      return <PeruSunatLegalValidationBlock block={peSunatBlock} />;
                    })()}

                    {/* Validación complementaria Migo — solo si existe pe_migo_api */}
                    {data.account.country_code?.toUpperCase() === 'PE' && (() => {
                      const peMigoBlock = (
                        (data.account.metadata?.source_enrichment as Record<string, unknown> | undefined)
                          ?.pe_migo_api as PeMigoApiEnrichmentBlock | null | undefined
                      ) ?? null;
                      return peMigoBlock ? <PeruMigoLegalValidationBlock block={peMigoBlock} /> : null;
                    })()}
                    <div className="grid gap-4 md:grid-cols-2">
                      {/* Sitio web, ubicación, responsable y contactos ya van en
                          el resumen de arriba: aquí no se repiten. */}
                      <DrawerSection title="Datos de la empresa" icon={Building2}>
                        <dl className="space-y-3">
                          <DetailRow icon={Briefcase} label="Industria">
                            {data.account.industry || <EmptyValue />}
                          </DetailRow>
                          <DetailRow icon={Users} label="Tamaño">
                            {data.account.company_size || <EmptyValue />}
                          </DetailRow>
                          <DetailRow
                            icon={Hash}
                            label={data.account.tax_identifier_type ?? 'ID fiscal'}
                          >
                            {data.account.tax_identifier
                              ? <span className="break-all font-mono text-xs tabular-nums">{data.account.tax_identifier}</span>
                              : <EmptyValue />}
                          </DetailRow>
                          <DetailRow icon={Tag} label="Fuente">
                            {SOURCE_LABELS[data.account.source as AccountSource]}
                          </DetailRow>
                          <DetailRow icon={Globe} label="ID en HubSpot">
                            {data.account.hubspot_company_id
                              ? <span className="break-all font-mono text-xs tabular-nums">{data.account.hubspot_company_id}</span>
                              : <EmptyValue>Sin sincronizar</EmptyValue>}
                          </DetailRow>
                          <DetailRow icon={Calendar} label="Creada">
                            {formatShortDate(data.account.created_at)}
                          </DetailRow>
                        </dl>
                      </DrawerSection>

                      <DrawerSection title="Notas" icon={Tag}>
                        {data.account.notes ? (
                          <p className="break-words text-sm leading-relaxed text-foreground">
                            {data.account.notes}
                          </p>
                        ) : (
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            Sin notas todavía. Añádelas con «Editar empresa», en el menú de acciones del pie.
                          </p>
                        )}
                      </DrawerSection>
                    </div>

                    {/* Actividad reciente — llena el Resumen y da contexto sin
                        cambiar de tab. Usa el mismo auditLog del tab Actividad. */}
                    <DrawerSection
                      title="Actividad reciente"
                      icon={Activity}
                      action={
                        data.auditLog.length > 3 ? (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {data.auditLog.length} eventos
                          </span>
                        ) : undefined
                      }
                    >
                      {data.auditLog.length === 0 ? (
                        <EmptyState
                          variant="plain"
                          icon={Activity}
                          title="Sin actividad todavía"
                          description="Los cambios de estado, de responsable y las ediciones de esta empresa aparecerán aquí."
                        />
                      ) : (
                        <Timeline>
                          {data.auditLog.slice(0, 4).map((entry) => {
                            const Icon = AUDIT_ICONS[entry.action_type] ?? Activity;
                            return (
                              <TimelineItem
                                key={entry.id}
                                icon={<Icon />}
                                title={AUDIT_ACTION_LABELS[entry.action_type]}
                                description={
                                  <>
                                    {entry.actor
                                      ? `${entry.actor.full_name ?? entry.actor.email} · `
                                      : ''}
                                    {formatDate(entry.created_at)}
                                  </>
                                }
                              />
                            );
                          })}
                        </Timeline>
                      )}
                    </DrawerSection>
                  </TabsContent>

                  {/* Contactos */}
                  <TabsContent value="contactos">
                    <ContactsTab
                      accountId={data.account.id}
                      contacts={data.contacts}
                      summary={data.contactsSummary}
                      onViewContact={openContactDetail}
                      onContactsChanged={() => loadData(data.account.id)}
                    />
                  </TabsContent>

                  {/* Inteligencia */}
                  <TabsContent value="inteligencia">
                    <EmptyState
                      icon={Brain}
                      title="Todavía no hay inteligencia comercial"
                      description="Aquí verás el árbol empresarial, las señales de negocio y los competidores de esta empresa cuando estén disponibles."
                    />
                  </TabsContent>

                  {/* Actividad */}
                  <TabsContent value="actividad">
                    <DrawerSection title="Registro de actividad" icon={Activity} hint="Cambios y eventos de auditoría de esta empresa.">
                      {data.auditLog.length === 0 ? (
                        <EmptyState
                          variant="plain"
                          icon={Activity}
                          title="Sin actividad todavía"
                          description="Los cambios de estado, de responsable y las ediciones de esta empresa aparecerán aquí."
                        />
                      ) : (
                        <Timeline>
                          {data.auditLog.map((entry) => {
                            const Icon = AUDIT_ICONS[entry.action_type] ?? Activity;
                            return (
                              <TimelineItem
                                key={entry.id}
                                icon={<Icon />}
                                title={AUDIT_ACTION_LABELS[entry.action_type]}
                                description={formatDate(entry.created_at)}
                              >
                                {entry.actor && (
                                  <p className="text-xs text-muted-foreground">
                                    por {entry.actor.full_name ?? entry.actor.email}
                                  </p>
                                )}
                              </TimelineItem>
                            );
                          })}
                        </Timeline>
                      )}
                    </DrawerSection>
                  </TabsContent>

                  {/* Agentes */}
                  <TabsContent value="agentes">
                    <AccountAgentsRunHistory runs={data.contactEnrichmentRuns} />
                  </TabsContent>
                </Tabs>
          </div>
        )}
      </DrawerShell>

      {/* Nested contact detail sheet */}
      <ContactDetailSheet
        contactId={contactSheetId}
        open={contactSheetOpen}
        onClose={() => setContactSheetOpen(false)}
      />
    </>
  );
}

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  // Design Refresh v3: label en fila horizontal (label a la izquierda, valor a
  // la derecha) para una lectura más tabular y ordenada; contraste del label
  // subido de /50 a /70.
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex shrink-0 items-center gap-2 min-w-[104px]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <dt className="text-xs text-muted-foreground">{label}</dt>
      </div>
      <dd className="min-w-0 flex-1 break-words text-sm text-foreground sm:text-right">{children}</dd>
    </div>
  );
}

/** Valor vacío consistente para campos sin dato (— o texto custom). */
function EmptyValue({ children }: { children?: React.ReactNode }) {
  return <span className="text-text-muted">{children ?? '—'}</span>;
}
