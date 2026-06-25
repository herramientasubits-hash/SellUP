'use client';

import * as React from 'react';
import {
  Loader2,
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
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getAccountById, getAccountAudit, getActiveUsers } from '@/modules/accounts/actions';
import { getContactsByAccount, getContactsSummary } from '@/modules/contacts/actions';
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
import { ContactsTab } from '@/components/contacts/contacts-tab';
import { ContactDetailSheet } from '@/components/contacts/contact-detail-sheet';
import { PeruSunatLegalValidationBlock } from '@/components/prospect-batches/peru-sunat-legal-validation-block';
import type { PeruSunatEnrichmentBlock } from '@/server/prospect-batches/peru-sunat-post-approval-enrichment';

const STATUS_STYLES: Record<PipelineStatus, string> = {
  new: 'bg-muted text-muted-foreground border-transparent',
  ready_for_research: 'bg-su-brand-soft text-su-brand border-transparent',
  research_in_progress: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
  ready_for_outreach: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
  archived: 'bg-muted/60 text-muted-foreground/60 border-transparent',
};

const AUDIT_ICONS: Partial<Record<AccountAuditAction, React.ComponentType<{ className?: string }>>> = {
  account_created: Building2,
  account_updated: Briefcase,
  account_status_changed: Tag,
  account_archived: Building2,
  account_owner_changed: User,
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

interface AccountDetailSheetProps {
  accountId: string | null;
  open: boolean;
  onClose: () => void;
}

interface SheetData {
  account: AccountWithOwner;
  auditLog: AccountAuditEntry[];
  contacts: Contact[];
  contactsSummary: ContactsSummary;
  users: InternalUserOption[];
}

export function AccountDetailSheet({ accountId, open, onClose }: AccountDetailSheetProps) {
  const [data, setData] = React.useState<SheetData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [contactSheetId, setContactSheetId] = React.useState<string | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = React.useState(false);

  const loadData = React.useCallback(async (id: string) => {
    setLoading(true);
    try {
      const account = await getAccountById(id);
      if (!account) return;
      const [auditLog, contacts, contactsSummary, users] = await Promise.all([
        getAccountAudit(id),
        getContactsByAccount(id),
        getContactsSummary(id),
        getActiveUsers(),
      ]);
      setData({ account, auditLog, contacts, contactsSummary, users });
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
      queueMicrotask(() => setData(null));
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
        className="w-full sm:w-[70vw] sm:min-w-[700px] sm:!max-w-none"
        icon={<Building2 className="h-5 w-5 text-su-brand" />}
        title={
          data ? (
            <div className="flex items-center justify-between gap-4 mr-6">
              <span className="truncate">{data.account.name}</span>
              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  variant="outline"
                  className={`text-xs ${STATUS_STYLES[data.account.pipeline_status]}`}
                >
                  {PIPELINE_STATUS_LABELS[data.account.pipeline_status]}
                </Badge>
                <AccountDetailActions
                  accountId={data.account.id}
                  currentStatus={data.account.pipeline_status}
                  users={data.users}
                />
              </div>
            </div>
          ) : 'Cargando cuenta...'
        }
        description={data ? (data.account.legal_name || undefined) : undefined}
      >
        {loading || !data ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
          </div>
        ) : (
          <Tabs defaultValue="resumen">
                  <TabsList variant="segmented" className="mx-7 mt-4">
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <SurfaceCard>
                        <SurfaceCardHeader title="Datos de la empresa" />
                        <dl className="space-y-3">
                          {data.account.website && (
                            <DetailRow icon={Globe} label="Sitio web">
                              <a
                                href={data.account.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-su-brand hover:underline"
                              >
                                {data.account.domain ?? data.account.website}
                              </a>
                            </DetailRow>
                          )}
                          {(data.account.country ?? data.account.city) && (
                            <DetailRow icon={MapPin} label="Ubicación">
                              {[data.account.city, data.account.region, data.account.country]
                                .filter(Boolean)
                                .join(', ')}
                            </DetailRow>
                          )}
                          {data.account.industry && (
                            <DetailRow icon={Briefcase} label="Industria">
                              {data.account.industry}
                            </DetailRow>
                          )}
                          {data.account.company_size && (
                            <DetailRow icon={Users} label="Tamaño">
                              {data.account.company_size}
                            </DetailRow>
                          )}
                          {data.account.tax_identifier && (
                            <DetailRow
                              icon={Hash}
                              label={data.account.tax_identifier_type ?? 'ID fiscal'}
                            >
                              {data.account.tax_identifier}
                            </DetailRow>
                          )}
                          <DetailRow icon={Tag} label="Fuente">
                            <Badge variant="outline" className="text-[10px]">
                              {SOURCE_LABELS[data.account.source as AccountSource]}
                            </Badge>
                          </DetailRow>
                          <DetailRow icon={Calendar} label="Creada">
                            {formatShortDate(data.account.created_at)}
                          </DetailRow>
                        </dl>
                      </SurfaceCard>

                      <SurfaceCard>
                        <SurfaceCardHeader title="Asignación y estado" />
                        <dl className="space-y-3">
                          <DetailRow icon={User} label="Owner">
                            {data.account.owner?.full_name ??
                              data.account.owner?.email ?? (
                                <span className="text-muted-foreground/50">Sin asignar</span>
                              )}
                          </DetailRow>
                          <DetailRow icon={Tag} label="Estado pipeline">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[data.account.pipeline_status]}`}
                            >
                              {PIPELINE_STATUS_LABELS[data.account.pipeline_status]}
                            </span>
                          </DetailRow>
                          {data.account.hubspot_company_id && (
                            <DetailRow icon={Globe} label="HubSpot ID">
                              <span className="font-mono text-xs">
                                {data.account.hubspot_company_id}
                              </span>
                            </DetailRow>
                          )}
                        </dl>
                        {data.account.notes && (
                          <div className="mt-4 rounded-lg bg-muted/40 px-3 py-2.5">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                              Notas
                            </p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {data.account.notes}
                            </p>
                          </div>
                        )}
                      </SurfaceCard>
                    </div>
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
                    <SurfaceCard>
                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
                          <Brain className="h-5 w-5 text-muted-foreground/40" />
                        </div>
                        <div className="max-w-sm space-y-1">
                          <p className="text-sm font-semibold text-foreground">
                            Inteligencia comercial — Próxima fase
                          </p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Árbol empresarial, señales de negocio y análisis de competidores.
                          </p>
                        </div>
                      </div>
                    </SurfaceCard>
                  </TabsContent>

                  {/* Actividad */}
                  <TabsContent value="actividad">
                    <SurfaceCard>
                      <SurfaceCardHeader
                        title="Registro de actividad"
                        description="Cambios y eventos de auditoría de esta cuenta."
                      />
                      {data.auditLog.length === 0 ? (
                        <p className="py-6 text-center text-xs text-muted-foreground">
                          Sin actividad registrada todavía.
                        </p>
                      ) : (
                        <ol className="space-y-3">
                          {data.auditLog.map((entry) => {
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

                  {/* Agentes */}
                  <TabsContent value="agentes">
                    <SurfaceCard>
                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
                          <Bot className="h-5 w-5 text-muted-foreground/40" />
                        </div>
                        <div className="max-w-sm space-y-1">
                          <p className="text-sm font-semibold text-foreground">
                            Agentes IA — Próxima fase
                          </p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Agente 1 de enriquecimiento, speech comercial y análisis de
                            oportunidades.
                          </p>
                        </div>
                      </div>
                    </SurfaceCard>
                  </TabsContent>
                </Tabs>
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
