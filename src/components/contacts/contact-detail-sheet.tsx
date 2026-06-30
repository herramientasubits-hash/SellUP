'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Loader2,
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
  Sparkles,
  CheckCircle2,
  XCircle,
  Bot,
  FileCheck2,
} from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getContactById, getContactAudit } from '@/modules/contacts/actions';
import { buildContactTraceabilityViewModel } from '@/modules/contacts/contact-traceability';
import { getAccountById } from '@/modules/accounts/actions';
import {
  ROLE_LABELS,
  SENIORITY_LABELS,
  CONTACT_STATUS_LABELS,
  CONTACT_SOURCE_LABELS,
  type Contact,
  type ContactAuditEntry,
  type ContactStatus,
  type ContactRole,
  type ContactAuditAction,
} from '@/modules/contacts/types';
import type { AccountWithOwner } from '@/modules/accounts/types';
import { ContactRowActions } from './contact-row-actions';
import { ContactHubSpotSyncButton } from './contact-hubspot-sync-button';

const STATUS_STYLES: Record<ContactStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
  inactive: 'bg-muted text-muted-foreground border-transparent',
  left_company: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
  do_not_contact: 'bg-destructive/10 text-destructive border-transparent',
  archived: 'bg-muted/60 text-muted-foreground/60 border-transparent',
};

const ROLE_STYLES: Record<string, string> = {
  decision_maker: 'bg-su-brand-soft text-su-brand border-transparent',
  economic_buyer: 'bg-su-brand-soft text-su-brand border-transparent',
  champion: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
  influencer: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
};

const AUDIT_LABELS: Record<ContactAuditAction, string> = {
  contact_created: 'Contacto creado',
  contact_updated: 'Contacto actualizado',
  contact_status_changed: 'Estado cambiado',
  contact_archived: 'Contacto archivado',
  contact_primary_changed: 'Contacto primario actualizado',
  contact_role_changed: 'Rol en cuenta actualizado',
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

interface ContactDetailSheetProps {
  contactId: string | null;
  open: boolean;
  onClose: () => void;
}

export function ContactDetailSheet({ contactId, open, onClose }: ContactDetailSheetProps) {
  const [contact, setContact] = React.useState<Contact | null>(null);
  const [auditLog, setAuditLog] = React.useState<ContactAuditEntry[]>([]);
  const [account, setAccount] = React.useState<AccountWithOwner | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadData = React.useCallback(async (id: string) => {
    setLoading(true);
    try {
      const c = await getContactById(id);
      if (!c) return;
      setContact(c);
      const [log, acc] = await Promise.all([
        getContactAudit(id),
        getAccountById(c.account_id),
      ]);
      setAuditLog(log);
      setAccount(acc);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open && contactId) {
      let cancelled = false;
      (async () => {
        await loadData(contactId);
        if (cancelled) return;
      })();
      return () => { cancelled = true; };
    } else if (!open) {
      queueMicrotask(() => {
        setContact(null);
        setAuditLog([]);
        setAccount(null);
      });
    }
  }, [open, contactId, loadData]);

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      side="right"
      className="w-full sm:w-[70vw] sm:min-w-[700px] sm:!max-w-none"
      icon={<User className="h-5 w-5 text-su-brand" />}
      title={
        contact ? (
          <div className="flex items-center justify-between gap-4 mr-6">
            <span className="truncate">{contact.full_name}</span>
            <div className="flex items-center gap-2 shrink-0">
              {contact.is_primary && (
                <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  Primario
                </div>
              )}
              <Badge
                variant="outline"
                className={`text-xs ${STATUS_STYLES[contact.contact_status]}`}
              >
                {CONTACT_STATUS_LABELS[contact.contact_status]}
              </Badge>
              {contact.role_in_account && (
                <Badge
                  variant="outline"
                  className={`text-xs ${ROLE_STYLES[contact.role_in_account] ?? 'bg-muted text-muted-foreground border-transparent'}`}
                >
                  {ROLE_LABELS[contact.role_in_account as ContactRole]}
                </Badge>
              )}
              <ContactRowActions
                contact={contact}
                onActionComplete={() => loadData(contact.id)}
              />
            </div>
          </div>
        ) : 'Cargando contacto...'
      }
      description={
        contact ? (
          <div className="space-y-0.5">
            {contact.job_title && (
              <p className="text-xs text-muted-foreground">{contact.job_title}</p>
            )}
            {account && (
              <Link
                href={`/accounts/${account.id}`}
                className="text-xs text-su-brand hover:underline"
              >
                {account.name}
              </Link>
            )}
          </div>
        ) : undefined
      }
    >
      {loading || !contact ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
        </div>
      ) : (
        <Tabs defaultValue="resumen">
                <TabsList variant="segmented" className="mx-7 mt-4">
                  <TabsTrigger value="resumen"><User className="h-4 w-4" /> Resumen</TabsTrigger>
                  <TabsTrigger value="actividad"><Activity className="h-4 w-4" /> Actividad</TabsTrigger>
                  <TabsTrigger value="enriquecimiento"><Sparkles className="h-4 w-4" /> Enriquecimiento</TabsTrigger>
                  <TabsTrigger value="hubspot"><Globe className="h-4 w-4" /> HubSpot</TabsTrigger>
                </TabsList>

                {/* Resumen */}
                <TabsContent value="resumen" className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <SurfaceCard>
                      <SurfaceCardHeader title="Datos de contacto" />
                      <dl className="space-y-3">
                        {contact.email && (
                          <DetailRow icon={Mail} label="Email">
                            <a href={`mailto:${contact.email}`} className="text-su-brand hover:underline">
                              {contact.email}
                            </a>
                          </DetailRow>
                        )}
                        {contact.mobile_phone && (
                          <DetailRow icon={Phone} label="Celular">
                            <a href={`tel:${contact.mobile_phone}`} className="hover:underline">
                              {contact.mobile_phone}
                            </a>
                          </DetailRow>
                        )}
                        {contact.phone && (
                          <DetailRow icon={Phone} label="Teléfono">
                            <a href={`tel:${contact.phone}`} className="hover:underline">
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
                              className="text-su-brand hover:underline"
                            >
                              {contact.linkedin_url}
                            </a>
                          </DetailRow>
                        )}
                        <DetailRow icon={Building2} label="Cuenta">
                          {account ? (
                            <Link href={`/accounts/${account.id}`} className="text-su-brand hover:underline">
                              {account.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground/50">Sin cuenta</span>
                          )}
                        </DetailRow>
                      </dl>
                    </SurfaceCard>

                    <SurfaceCard>
                      <SurfaceCardHeader title="Cargo y función" />
                      <dl className="space-y-3">
                        {contact.job_title && (
                          <DetailRow icon={Briefcase} label="Cargo">{contact.job_title}</DetailRow>
                        )}
                        {contact.department && (
                          <DetailRow icon={Briefcase} label="Área">{contact.department}</DetailRow>
                        )}
                        {contact.seniority && (
                          <DetailRow icon={User} label="Seniority">
                            {SENIORITY_LABELS[contact.seniority]}
                          </DetailRow>
                        )}
                        {contact.role_in_account && (
                          <DetailRow icon={Tag} label="Rol en cuenta">
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${ROLE_STYLES[contact.role_in_account] ?? 'bg-muted text-muted-foreground border-transparent'}`}
                            >
                              {ROLE_LABELS[contact.role_in_account as ContactRole]}
                            </Badge>
                          </DetailRow>
                        )}
                        <DetailRow icon={Tag} label="Fuente">
                          <Badge variant="outline" className="text-[10px] bg-muted/40 border-transparent text-muted-foreground">
                            {CONTACT_SOURCE_LABELS[contact.source]}
                          </Badge>
                        </DetailRow>
                        <DetailRow icon={Tag} label="Creado">
                          {formatShortDate(contact.created_at)}
                        </DetailRow>
                      </dl>
                      {contact.notes && (
                        <div className="mt-4 rounded-lg bg-muted/40 px-3 py-2.5">
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                            Notas
                          </p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {contact.notes}
                          </p>
                        </div>
                      )}
                    </SurfaceCard>
                  </div>
                </TabsContent>

                {/* Actividad */}
                <TabsContent value="actividad">
                  <SurfaceCard>
                    <SurfaceCardHeader
                      title="Registro de actividad"
                      description="Cambios y eventos de auditoría de este contacto."
                    />
                    {auditLog.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted-foreground">
                        Sin actividad registrada todavía.
                      </p>
                    ) : (
                      <ol className="space-y-3">
                        {auditLog.map((entry) => (
                          <li key={entry.id} className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                              <Activity className="h-3.5 w-3.5 text-muted-foreground/60" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-foreground">
                                {AUDIT_LABELS[entry.action_type]}
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
                        ))}
                      </ol>
                    )}
                  </SurfaceCard>
                </TabsContent>

                {/* Enriquecimiento — Calidad y trazabilidad */}
                <TabsContent value="enriquecimiento">
                  <ContactTraceabilityPanel contact={contact} />
                </TabsContent>

                {/* HubSpot */}
                <TabsContent value="hubspot">
                  <SurfaceCard>
                    <div className="flex items-start justify-between gap-4">
                      <SurfaceCardHeader title="Sincronización HubSpot" />
                      <ContactHubSpotSyncButton
                        contactId={contact.id}
                        alreadySynced={!!contact.hubspot_contact_id}
                        hasEmail={!!contact.email}
                        onSynced={() => loadData(contact.id)}
                      />
                    </div>
                    <dl className="space-y-3">
                      <DetailRow icon={Tag} label="HubSpot Contact ID">
                        {contact.hubspot_contact_id ? (
                          <span className="font-mono text-xs">{contact.hubspot_contact_id}</span>
                        ) : (
                          <span className="text-muted-foreground/50">No vinculado</span>
                        )}
                      </DetailRow>
                      <DetailRow icon={Tag} label="Estado de sincronización">
                        <HubSpotSyncStatusBadge contact={contact} />
                      </DetailRow>
                      {(() => {
                        const sync = contact.metadata?.hubspot_sync as
                          | Record<string, unknown>
                          | undefined;
                        const syncedAt = sync?.synced_at as string | undefined;
                        return syncedAt ? (
                          <DetailRow icon={Tag} label="Sincronizado el">
                            {formatDate(syncedAt)}
                          </DetailRow>
                        ) : null;
                      })()}
                    </dl>
                    {!contact.email && (
                      <p className="mt-3 text-[11px] text-muted-foreground">
                        Este contacto no tiene email, requisito para sincronizar con HubSpot.
                      </p>
                    )}
                  </SurfaceCard>
                </TabsContent>
              </Tabs>
            )}
    </DrawerShell>
  );
}

// ── Calidad y trazabilidad ────────────────────────────────────────────────────

function TraceCard({
  title,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title={title} />
      <dl className="space-y-3">{children}</dl>
    </SurfaceCard>
  );
}

function TraceRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="min-w-0 flex-1">
        <dt className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          {label}
        </dt>
        <dd className="mt-0.5 text-xs text-foreground">{children}</dd>
      </div>
    </div>
  );
}

function EmptyTrace({ message }: { message: string }) {
  return (
    <p className="py-2 text-xs text-muted-foreground/60 italic">{message}</p>
  );
}

function ContactTraceabilityPanel({ contact }: { contact: Contact }) {
  const vm = buildContactTraceabilityViewModel(contact);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Card 1 — Origen */}
      <TraceCard icon={Bot} title="Origen del contacto">
        <TraceRow label="Origen">
          <span className="flex items-center gap-1.5">
            {vm.hasSourceCandidate ? (
              <Badge
                variant="outline"
                className="text-[10px] bg-su-brand-soft text-su-brand border-transparent"
              >
                {vm.originLabel}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] bg-muted/40 border-transparent text-muted-foreground"
              >
                {vm.originLabel}
              </Badge>
            )}
          </span>
        </TraceRow>
        <TraceRow label="Fuente">
          <Badge
            variant="outline"
            className="text-[10px] bg-muted/40 border-transparent text-muted-foreground"
          >
            {vm.sourceLabel}
          </Badge>
        </TraceRow>
        {vm.hasSourceCandidate && vm.sourceCandidateId && (
          <TraceRow label="ID candidato">
            <span className="font-mono text-[11px] text-muted-foreground">
              {vm.sourceCandidateId}
            </span>
          </TraceRow>
        )}
      </TraceCard>

      {/* Card 2 — Calidad y datos accionables */}
      <TraceCard icon={Sparkles} title="Calidad y datos accionables">
        {vm.hasRelevanceData ? (
          <>
            <TraceRow label="Relevancia">
              <RelevanceBadge label={vm.relevanceLabel} />
            </TraceRow>
            {vm.relevanceScore !== null && (
              <TraceRow label="Score">
                <span className="tabular-nums">{vm.relevanceScore.toFixed(2)}</span>
              </TraceRow>
            )}
          </>
        ) : (
          <EmptyTrace message="Sin evaluación de IA registrada" />
        )}
        {vm.hasCompletionData ? (
          <>
            {vm.completedFields.length > 0 && (
              <TraceRow label="Datos completados">
                <span className="flex flex-wrap gap-1">
                  {vm.completedFields.map((f) => (
                    <Badge
                      key={f}
                      variant="outline"
                      className="text-[10px] bg-muted/40 border-transparent text-muted-foreground"
                    >
                      {f}
                    </Badge>
                  ))}
                </span>
              </TraceRow>
            )}
            {vm.hasActionableChannel !== null && (
              <TraceRow label="Canal accionable">
                <span className="flex items-center gap-1">
                  {vm.hasActionableChannel ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
                  )}
                  <span>{vm.hasActionableChannel ? 'Sí' : 'No'}</span>
                </span>
              </TraceRow>
            )}
          </>
        ) : null}
      </TraceCard>

      {/* Card 3 — Normalización */}
      <TraceCard icon={FileCheck2} title="Normalización">
        {vm.isNormalized ? (
          <>
            <TraceRow label="Estado">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span>Normalizado</span>
              </span>
            </TraceRow>
            {vm.normalizedFields.length > 0 && (
              <TraceRow label="Campos normalizados">
                <span className="flex flex-wrap gap-1">
                  {vm.normalizedFields.map((f) => (
                    <Badge
                      key={f}
                      variant="outline"
                      className="text-[10px] bg-muted/40 border-transparent text-muted-foreground"
                    >
                      {f}
                    </Badge>
                  ))}
                </span>
              </TraceRow>
            )}
          </>
        ) : (
          <EmptyTrace message="Sin normalización registrada" />
        )}
      </TraceCard>

      {/* Card 4 — HubSpot (resumen) */}
      <TraceCard icon={Globe} title="HubSpot">
        <TraceRow label="Estado">
          {vm.hubspotContactId ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span>Sincronizado con HubSpot</span>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
              <span className="text-muted-foreground">No sincronizado con HubSpot</span>
            </span>
          )}
        </TraceRow>
        {vm.hubspotContactId && (
          <TraceRow label="HubSpot Contact ID">
            <span className="font-mono text-[11px] text-muted-foreground">
              {vm.hubspotContactId}
            </span>
          </TraceRow>
        )}
        {vm.hubspotMode && (
          <TraceRow label="Modo">
            <Badge
              variant="outline"
              className="text-[10px] bg-muted/40 border-transparent text-muted-foreground"
            >
              {vm.hubspotMode === 'created' ? 'Creado en HubSpot' :
               vm.hubspotMode === 'linked_existing' ? 'Vinculado a existente' :
               vm.hubspotMode}
            </Badge>
          </TraceRow>
        )}
        {vm.hubspotAssociationStatus && (
          <TraceRow label="Asociación con empresa">
            <Badge
              variant="outline"
              className={`text-[10px] border-transparent ${
                vm.hubspotAssociationStatus === 'associated'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              }`}
            >
              {vm.hubspotAssociationStatus === 'associated' ? 'Asociado' :
               vm.hubspotAssociationStatus === 'failed' ? 'Falló' :
               vm.hubspotAssociationStatus}
            </Badge>
          </TraceRow>
        )}
        <p className="mt-2 text-[10px] text-muted-foreground/40 italic">
          Para sincronizar o ver el detalle completo, ve al tab HubSpot.
        </p>
      </TraceCard>
    </div>
  );
}

function RelevanceBadge({ label }: { label: string }) {
  const styles: Record<string, string> = {
    Alta: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent',
    Media: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-transparent',
    Baja: 'bg-muted/40 text-muted-foreground border-transparent',
  };
  return (
    <Badge variant="outline" className={`text-[10px] ${styles[label] ?? 'bg-muted/40 text-muted-foreground border-transparent'}`}>
      {label}
    </Badge>
  );
}

function HubSpotSyncStatusBadge({ contact }: { contact: Contact }) {
  const sync = contact.metadata?.hubspot_sync as Record<string, unknown> | undefined;
  if (contact.hubspot_contact_id) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-transparent"
      >
        Sincronizado
      </Badge>
    );
  }
  if (sync?.status === 'error') {
    return (
      <Badge variant="outline" className="text-[10px] bg-destructive/10 text-destructive border-transparent">
        Error de sincronización
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] bg-muted/40 border-transparent text-muted-foreground">
      Sin sincronizar
    </Badge>
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
