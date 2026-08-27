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
  AlertCircle,
  UserX,
} from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { ContactHubSpotSyncBadge } from './contact-hubspot-sync-badge';
import {
  HUBSPOT_AUTO_SYNC_BLOCKED_LABELS,
  HUBSPOT_AUTO_UPDATE_BLOCKED_DETAIL,
  hasPendingHubSpotPhoneChange,
  readContactAutoPhoneUpdateAnnex,
  readContactAutoSyncAnnex,
  readHubSpotSyncState,
} from '@/modules/contacts/contact-hubspot-sync-state';
// AGENT2A-PHONE-REVEAL-4O-H4 — «Ver más números» del contacto OFICIAL.
// Sólo LECTURA: abrirlo hace un SELECT sobre la colección oficial de
// teléfonos del contacto y nada más. Ni proveedor, ni crédito, ni escritura.
import { getOfficialContactStoredPhoneSummaryAction } from '@/modules/contact-enrichment/official-contact-stored-phones-actions';
import { OfficialContactStoredPhonesDisclosure } from './official-contact-stored-phones-disclosure';
// AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1 — «Revelar teléfono» desde el
// contacto OFICIAL. El botón sólo aparece cuando el SERVIDOR resuelve un candidato fuente
// durable (`metadata.source_candidate_id`) y el contacto no tiene un teléfono reutilizable.
// No construye un waterfall propio: delega en el pipeline del candidato.
import { OfficialContactPhoneRevealCta } from './post-approval-reveal-cta';
// AGENT2A-P0-R2 — el drawer del contacto SIEMPRE termina de cargar: o hay contacto, o hay
// un estado terminal declarado. Nunca un spinner eterno.
import { isNextControlFlowSignal } from '@/modules/contact-enrichment/next-control-flow-signal';
import {
  CONTACT_DETAIL_LOADING_TITLE_COPY,
  CONTACT_DETAIL_NOT_FOUND_TITLE_COPY,
  CONTACT_DETAIL_NOT_FOUND_BODY_COPY,
  CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY,
  CONTACT_DETAIL_LOAD_ERROR_BODY_COPY,
  CONTACT_DETAIL_RETRY_COPY,
  type ContactDetailLoadOutcome,
} from './contact-detail-load-copy';

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
  // 4O-H4: CUÁNTOS números adicionales hay almacenados. Es un entero y nada más —
  // ningún número viaja al navegador hasta que el operador abre el disclosure.
  const [additionalPhoneCount, setAdditionalPhoneCount] = React.useState(0);
  // AGENT2A-P0-R2: por qué el contacto no está. `null` ⇒ hay contacto, o sigue cargando.
  // Sin este estado, «no encontrado» y «la lectura falló» eran indistinguibles de «todavía
  // cargando», y las tres se pintaban como el mismo spinner que nunca se iba.
  const [loadOutcome, setLoadOutcome] =
    React.useState<ContactDetailLoadOutcome | null>(null);

  const loadData = React.useCallback(async (id: string) => {
    setLoading(true);
    setLoadOutcome(null);
    try {
      const c = await getContactById(id);
      // La lectura funcionó y no hay fila: archivado, eliminado o fuera del alcance del
      // actor. Es terminal e informativo — antes se salía con un `return` que dejaba el
      // spinner puesto para siempre.
      if (!c) {
        setLoadOutcome('not_found');
        return;
      }
      setContact(c);

      // El contexto (auditoría, cuenta y el CONTEO de números adicionales) es
      // COMPLEMENTARIO: el contacto ya está en pantalla y que falte no justifica tumbar el
      // detalle entero. Se resuelve por separado para que un fallo aquí no se confunda con
      // «no se pudo cargar el contacto».
      //
      // 4O-H4 entra por esta misma puerta a propósito. La acción ya devuelve `0` ante sus
      // propios fallos, pero un fallo de TRANSPORTE de la Server Action lanza aquí; sin este
      // `catch` un tropiezo leyendo teléfonos adicionales dejaría el drawer entero en «no se
      // pudo cargar el contacto» con el contacto ya cargado. Fail-closed hacia «no ofrecer el
      // CTA»: se pierde un botón, nunca la ficha.
      const [log, acc, storedPhones] = await Promise.all([
        getContactAudit(id).catch(() => [] as ContactAuditEntry[]),
        getAccountById(c.account_id).catch(() => null),
        getOfficialContactStoredPhoneSummaryAction({ contactId: id }).catch(() => ({
          additionalCount: 0,
        })),
      ]);
      setAuditLog(log);
      setAccount(acc);
      setAdditionalPhoneCount(storedPhones.additionalCount);
    } catch (caught) {
      // `redirect()` de Next señaliza LANZANDO (`NEXT_REDIRECT`). Tragarlo aquí convertiría
      // una sesión caducada en «no se pudo cargar el contacto» en vez de llevar al login.
      if (isNextControlFlowSignal(caught)) throw caught;
      // Cualquier otro fallo es terminal y se DECLARA. El drawer tiene prohibido `console.*`
      // (AGENT2A-PROD-INCIDENT #279), así que el rastro lo deja el servidor, no el cliente.
      setLoadOutcome('load_error');
    } finally {
      // Invariante del hito: pase lo que pase, el paso de carga se cierra.
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
        setAdditionalPhoneCount(0);
        // Sin esto, reabrir el drawer tras un fallo mostraría el estado terminal
        // anterior antes de que la nueva lectura terminara.
        setLoadOutcome(null);
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
        contact
          ? contact.full_name
          : loadOutcome === 'not_found'
            ? CONTACT_DETAIL_NOT_FOUND_TITLE_COPY
            : loadOutcome === 'load_error'
              ? CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY
              : CONTACT_DETAIL_LOADING_TITLE_COPY
      }
      titleBadge={
        contact ? (
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={`text-xs ${STATUS_STYLES[contact.contact_status]}`}
            >
              {CONTACT_STATUS_LABELS[contact.contact_status]}
            </Badge>
            {contact.is_primary && (
              <div className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                Primario
              </div>
            )}
            {contact.role_in_account && (
              <Badge
                variant="outline"
                className={`text-xs ${ROLE_STYLES[contact.role_in_account] ?? 'bg-muted text-muted-foreground border-transparent'}`}
              >
                {ROLE_LABELS[contact.role_in_account as ContactRole]}
              </Badge>
            )}
          </div>
        ) : undefined
      }
      headerActions={
        contact ? (
          <ContactRowActions
            contact={contact}
            onActionComplete={() => loadData(contact.id)}
          />
        ) : undefined
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
      {/*
        AGENT2A-P0-R2 — el spinner sólo representa CARGA EN CURSO.
        Antes la condición era `loading || !contact`, así que en cuanto la carga terminaba sin
        contacto —por fallo o por no encontrado— volvía a caer en el spinner y ya no había
        nada que lo quitara. Ahora, terminada la carga, hay exactamente tres salidas y las
        tres son estables: contacto, «no disponible» o «no se pudo cargar».
      */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
        </div>
      ) : !contact ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-3 rounded-full bg-muted/60 p-3">
            {loadOutcome === 'load_error' ? (
              <AlertCircle className="h-6 w-6 text-destructive/70" />
            ) : (
              <UserX className="h-6 w-6 text-muted-foreground/40" />
            )}
          </div>
          <p className="text-sm font-medium text-foreground">
            {loadOutcome === 'load_error'
              ? CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY
              : CONTACT_DETAIL_NOT_FOUND_TITLE_COPY}
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            {loadOutcome === 'load_error'
              ? CONTACT_DETAIL_LOAD_ERROR_BODY_COPY
              : CONTACT_DETAIL_NOT_FOUND_BODY_COPY}
          </p>
          {/* Reintentar sólo tiene sentido ante un fallo: si el contacto no está, insistir
              no lo va a traer. */}
          {loadOutcome === 'load_error' && contactId && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => loadData(contactId)}
            >
              {CONTACT_DETAIL_RETRY_COPY}
            </Button>
          )}
        </div>
      ) : (
        <Tabs defaultValue="resumen">
                <TabsList variant="segmented" className="mb-2">
                  <TabsTrigger value="resumen"><User className="h-4 w-4" /> Resumen</TabsTrigger>
                  <TabsTrigger value="actividad"><Activity className="h-4 w-4" /> Actividad</TabsTrigger>
                  <TabsTrigger value="enriquecimiento"><Sparkles className="h-4 w-4" /> Origen y calidad</TabsTrigger>
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
                        {/*
                          4O-H4 — «Ver N números más». El CTA existe SÓLO si el
                          servidor contó extras, y los escalares de arriba siguen
                          visibles exactamente como estaban: esto AÑADE una
                          superficie de lectura, no reemplaza ninguna.
                        */}
                        {additionalPhoneCount > 0 && (
                          <OfficialContactStoredPhonesDisclosure
                            contactId={contact.id}
                            additionalCount={additionalPhoneCount}
                          />
                        )}
                        {/*
                          POST-APPROVAL REVEAL — la ficha de un contacto creado al aprobar un
                          candidato podía quedarse SIN teléfono para siempre: el pipeline de
                          reveal existe entero, pero sólo era alcanzable desde la revisión del
                          candidato, que ya salió de revisión. El CTA lo hace alcanzable desde
                          aquí, reutilizando ese pipeline tal cual. Se pinta debajo de los
                          escalares y no reemplaza nada de lo que ya se mostraba.
                        */}
                        <OfficialContactPhoneRevealCta
                          contactId={contact.id}
                          onPhoneProjected={() => {
                            // La AUTORIDAD de lo que se muestra es la ficha, no la respuesta del
                            // reveal: ningún teléfono viaja en ese resultado. Se relee por la vía
                            // normal, que además refresca el conteo de números adicionales.
                            void loadData(contact.id);
                          }}
                        />
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
                      {/* AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX: cero deducción aquí. El botón
                          consulta `resolveHubSpotSyncAction`, la misma autoridad que el badge de
                          abajo usa para el copy, así que la tarjeta ya no puede mostrar un
                          «Sincronizado» verde junto a un «Vinculado a HubSpot» neutro. */}
                      <ContactHubSpotSyncButton
                        contact={{
                          id: contact.id,
                          email: contact.email,
                          hubspot_contact_id: contact.hubspot_contact_id,
                          metadata: contact.metadata as Record<string, unknown> | null,
                        }}
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
                      {(() => {
                        const state = readHubSpotSyncState(
                          contact.metadata as Record<string, unknown> | null,
                        );
                        if (!state) return null;
                        return (
                          <>
                            {state.attempted_at ? (
                              <DetailRow icon={Tag} label="Último intento">
                                {formatDate(state.attempted_at)}
                              </DetailRow>
                            ) : null}
                            {/* CUT-2 — desde cuándo HubSpot está desactualizado, no cuándo se
                                registró el último cambio: es lo que responde «¿cuánto lleva
                                esto sin enviarse?». */}
                            {state.stale_since ? (
                              <DetailRow icon={Tag} label="Pendiente desde">
                                {formatDate(state.stale_since)}
                              </DetailRow>
                            ) : null}
                          </>
                        );
                      })()}
                    </dl>
                    {!contact.email && (
                      <p className="mt-3 text-[11px] text-muted-foreground">
                        Este contacto no tiene email, requisito para sincronizar con HubSpot.
                      </p>
                    )}
                    {/*
                      CUT-3B — el anexo operativo del autosync. Se muestra SÓLO mientras el
                      contacto siga sin vínculo: en cuanto exista uno, el bloqueo dejó de
                      describir la situación y seguir mostrándolo sería noticia vieja.

                      El tono es NEUTRO a propósito. No es un error del contacto ni de quien lo
                      aprobó: es una condición del workspace, y el `status` sigue diciendo la
                      verdad —nunca se intentó— sin que haga falta un badge nuevo.
                    */}
                    {(() => {
                      if (contact.hubspot_contact_id) return null;
                      const annex = readContactAutoSyncAnnex(
                        contact.metadata as Record<string, unknown> | null,
                      );
                      if (!annex) return null;
                      return (
                        <p className="mt-3 text-[11px] text-muted-foreground">
                          {HUBSPOT_AUTO_SYNC_BLOCKED_LABELS[annex.blocked_reason]} (
                          {formatDate(annex.checked_at)}). Puedes sincronizarlo con el botón
                          cuando la conexión esté disponible.
                        </p>
                      );
                    })()}
                    {/*
                      CUT-3C — el anexo operativo del PATCH automático. Se muestra SÓLO mientras
                      siga habiendo algo pendiente: en cuanto el cambio viaje, el bloqueo dejó de
                      describir la situación.

                      Tono NEUTRO, igual que el del autosync, y por la misma razón: no hubo un
                      intento fallido —no salió ninguna petición— sino una condición del
                      workspace. El badge sigue diciendo «Pendiente de actualizar», que es la
                      verdad, y no hace falta un badge nuevo para contar esto.
                    */}
                    {(() => {
                      const state = readHubSpotSyncState(
                        contact.metadata as Record<string, unknown> | null,
                      );
                      if (!hasPendingHubSpotPhoneChange(state)) return null;
                      const annex = readContactAutoPhoneUpdateAnnex(
                        contact.metadata as Record<string, unknown> | null,
                      );
                      if (!annex) return null;
                      return (
                        <p className="mt-3 text-[11px] text-muted-foreground">
                          No se pudo actualizar automáticamente porque{' '}
                          {HUBSPOT_AUTO_UPDATE_BLOCKED_DETAIL[annex.blocked_reason]} (
                          {formatDate(annex.checked_at)}). El cambio sigue pendiente y se puede
                          enviar con el botón.
                        </p>
                      );
                    })()}
                    {/*
                      CUT-3C — la retención por PRIVACIDAD, dicha sin decir de quién ni por qué.
                      Un teléfono retirado por una solicitud de privacidad se queda `stale` a
                      propósito: enviarlo solo convertiría una erasure en una escritura hacia un
                      tercero. Decirlo aquí evita que el operador lea el pendiente como un fallo
                      del sistema y se pregunte por qué «no funciona».
                    */}
                    {(() => {
                      const state = readHubSpotSyncState(
                        contact.metadata as Record<string, unknown> | null,
                      );
                      if (!hasPendingHubSpotPhoneChange(state)) return null;
                      if (state?.stale_source !== 'privacy') return null;
                      return (
                        <p className="mt-3 text-[11px] text-muted-foreground">
                          Este cambio proviene de una solicitud de privacidad, así que no se envía
                          automáticamente: requiere una acción explícita con el botón.
                        </p>
                      );
                    })()}
                    {/*
                      «Sincronizado» dice que el contacto existe en HubSpot y está vinculado, no
                      que sus campos estén al día: un teléfono revelado después de la aprobación
                      todavía no viaja a HubSpot. Decirlo aquí evita que el badge se lea como una
                      promesa que este corte no cumple.
                    */}
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      «Sincronizado» significa que el contacto existe en HubSpot y está vinculado
                      a SellUp. «Pendiente de actualizar» significa que el teléfono cambió en
                      SellUp después de vincularlo y todavía no se ha enviado: se envía con el
                      botón y, si tu organización tiene habilitada la actualización automática,
                      también puede enviarse solo. Un teléfono retirado por una solicitud de
                      privacidad NUNCA se envía solo. Otros campos no se actualizan en HubSpot en
                      esta versión.
                    </p>
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
        {/*
          BACKFILL LEGACY — el icono y el copy vienen del ViewModel, que los pide a la MISMA
          autoridad que el badge del drawer. El check verde queda reservado al ÚNICO caso en que
          consta una sincronización observada; un vínculo sin estado legible se cuenta en neutro
          en vez de disfrazarse de contacto al día.
        */}
        <TraceRow label="Estado">
          {vm.hubspotSyncTone === 'synced' ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span>{vm.hubspotSyncLabel}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
              <span className="text-muted-foreground">{vm.hubspotSyncLabel}</span>
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

/**
 * Estado durable de sincronización con HubSpot (CUT-1).
 *
 * AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX — el componente y su mapa de tonos se MUDARON a
 * `contact-hubspot-sync-badge.tsx`. Vivían aquí, dentro de un archivo `'use client'`, y por eso
 * la página de detalle legada (componente de SERVIDOR) no podía importarlos y acabó con su
 * propio badge hardcodeado «Sincronización no activa». Este alias mantiene el nombre local para
 * que las llamadas de este archivo no cambien.
 */
const HubSpotSyncStatusBadge = ContactHubSpotSyncBadge;

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  // Design Refresh v6: layout horizontal (label izquierda / valor derecha),
  // consistente con el drawer de Empresa.
  return (
    <div className="flex items-center gap-3">
      <div className="flex shrink-0 items-center gap-2 min-w-[104px]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <dt className="text-[11px] font-medium text-muted-foreground/80">
          {label}
        </dt>
      </div>
      <dd className="min-w-0 flex-1 text-right text-xs text-foreground">{children}</dd>
    </div>
  );
}
