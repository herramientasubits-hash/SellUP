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
} from 'lucide-react';
import { X } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { getContactById, getContactAudit } from '@/modules/contacts/actions';
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
      loadData(contactId);
    } else if (!open) {
      setContact(null);
      setAuditLog([]);
      setAccount(null);
    }
  }, [open, contactId, loadData]);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent showCloseButton={false} className="flex flex-col gap-0 overflow-hidden p-0 sm:w-[70vw] sm:min-w-[700px] sm:!max-w-none">
        {loading || !contact ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Header */}
            <SheetHeader className="shrink-0 border-b border-border/50 px-7 pb-5 pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground/70">
                    {contact.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="space-y-0.5">
                    <SheetTitle className="text-base font-semibold">
                      {contact.full_name}
                    </SheetTitle>
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
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {contact.is_primary && (
                    <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
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
                  <SheetClose className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent transition-colors">
                    <X className="h-4 w-4 text-muted-foreground" />
                    <span className="sr-only">Cerrar</span>
                  </SheetClose>
                </div>
              </div>
            </SheetHeader>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-7 py-5">
              <Tabs defaultValue="resumen">
                <TabsList className="mb-4">
                  <TabsTrigger value="resumen">Resumen</TabsTrigger>
                  <TabsTrigger value="actividad">Actividad</TabsTrigger>
                  <TabsTrigger value="enriquecimiento">Enriquecimiento</TabsTrigger>
                  <TabsTrigger value="hubspot">HubSpot</TabsTrigger>
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

                {/* Enriquecimiento */}
                <TabsContent value="enriquecimiento">
                  <SurfaceCard>
                    <div className="flex flex-col items-center gap-3 py-10 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
                        <Globe className="h-5 w-5 text-muted-foreground/40" />
                      </div>
                      <div className="max-w-sm space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          Enriquecimiento — Próxima fase
                        </p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Enriquecimiento automático con Apollo y Lusha: email verificado,
                          teléfono directo, cargo actualizado y señales de intención.
                        </p>
                      </div>
                    </div>
                  </SurfaceCard>
                </TabsContent>

                {/* HubSpot */}
                <TabsContent value="hubspot">
                  <SurfaceCard>
                    <SurfaceCardHeader title="Sincronización HubSpot" />
                    <dl className="space-y-3">
                      <DetailRow icon={Tag} label="HubSpot Contact ID">
                        {contact.hubspot_contact_id ? (
                          <span className="font-mono text-xs">{contact.hubspot_contact_id}</span>
                        ) : (
                          <span className="text-muted-foreground/50">No vinculado</span>
                        )}
                      </DetailRow>
                      <DetailRow icon={Tag} label="Estado de sincronización">
                        <Badge variant="outline" className="text-[10px] bg-muted/40 border-transparent text-muted-foreground">
                          Sincronización no activa
                        </Badge>
                      </DetailRow>
                    </dl>
                  </SurfaceCard>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
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
