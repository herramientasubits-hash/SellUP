'use client';

import { formatInAppZone } from '@/lib/format-date';
import * as React from 'react';
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
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertCircle,
  UserX,
  Pencil,
} from "@/icons";
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DrawerSection } from '@/components/shared/drawer-section';
import { DetailItem, DetailList } from '@/components/shared/detail-list';
import { SurfaceCard } from '@/components/shared/surface-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Timeline, TimelineItem } from '@/components/data-display';
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
import { ContactTraceabilityPanel, TraceCard, TraceRow } from './contact-traceability-panel';
import { EditContactDrawer } from './edit-contact-drawer';
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

// El estado, por variante del sistema (el mismo mapa que la tabla de contactos).
const STATUS_VARIANT: Record<ContactStatus, 'positive' | 'neutral' | 'warning' | 'negative'> = {
  active: 'positive',
  inactive: 'neutral',
  left_company: 'warning',
  do_not_contact: 'negative',
  archived: 'neutral',
};

const INLINE_LINK =
  'rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40';

const AUDIT_LABELS: Record<ContactAuditAction, string> = {
  contact_created: 'Contacto creado',
  contact_updated: 'Contacto actualizado',
  contact_status_changed: 'Estado cambiado',
  contact_archived: 'Contacto archivado',
  contact_primary_changed: 'Contacto primario actualizado',
  contact_role_changed: 'Rol en la empresa actualizado',
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
  // «Editar contacto» es el botón principal del pie: el panel abre el editor y,
  // al cerrarlo, vuelve a leer la ficha.
  const [editOpen, setEditOpen] = React.useState(false);

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
    <>
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      side="right"
      className="w-full sm:w-[70vw] sm:min-w-[700px] sm:!max-w-none"
      icon={<User className="h-4 w-4" />}
      title={
        contact
          ? contact.full_name
          : loadOutcome === 'not_found'
            ? CONTACT_DETAIL_NOT_FOUND_TITLE_COPY
            : loadOutcome === 'load_error'
              ? CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY
              : CONTACT_DETAIL_LOADING_TITLE_COPY
      }
      // Cabecera: nombre + estado (y la marca de primario). El rol y el cargo
      // bajan al resumen, donde se leen con su etiqueta.
      titleBadge={
        contact ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[contact.contact_status]}>
              {CONTACT_STATUS_LABELS[contact.contact_status]}
            </Badge>
            {contact.is_primary && (
              <Badge variant="warning">
                <Star className="fill-warning" />
                Primario
              </Badge>
            )}
          </span>
        ) : undefined
      }
      // `span`: la descripción del panel es un párrafo y no admite bloques dentro.
      description={
        contact && (contact.job_title || account) ? (
          <span className="flex flex-wrap items-center gap-x-1.5">
            {contact.job_title && <span>{contact.job_title}</span>}
            {contact.job_title && account && <span aria-hidden>·</span>}
            {account && <span>{account.name}</span>}
          </span>
        ) : undefined
      }
      loading={loading && !contact}
      // Pie: lo secundario a la izquierda, la acción principal a la derecha.
      actions={
        contact ? (
          <>
            <ContactRowActions
              contact={contact}
              placement="drawer"
              onActionComplete={() => loadData(contact.id)}
            />
            <Button type="button" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden="true" />
              Editar contacto
            </Button>
          </>
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
      {loading && !contact ? null : !contact ? (
        <EmptyState
          variant="plain"
          className="py-20"
          icon={loadOutcome === 'load_error' ? AlertCircle : UserX}
          title={
            loadOutcome === 'load_error'
              ? CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY
              : CONTACT_DETAIL_NOT_FOUND_TITLE_COPY
          }
          description={
            loadOutcome === 'load_error'
              ? CONTACT_DETAIL_LOAD_ERROR_BODY_COPY
              : CONTACT_DETAIL_NOT_FOUND_BODY_COPY
          }
          // Reintentar sólo tiene sentido ante un fallo: si el contacto no está, insistir
          // no lo va a traer.
          action={
            loadOutcome === 'load_error' && contactId ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => loadData(contactId)}
              >
                {CONTACT_DETAIL_RETRY_COPY}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {/* Lo esencial, antes de las pestañas: de qué empresa es, qué hace
              allí y qué papel tiene para nosotros. */}
          <section aria-label="Resumen del contacto">
            <SurfaceCard className="p-4">
            <DetailList columns={4}>
              <DetailItem icon={Building2} label="Empresa" emptyLabel="Sin empresa">
                {account ? (
                  <Link href={`/accounts/${account.id}`} className={INLINE_LINK}>
                    {account.name}
                  </Link>
                ) : null}
              </DetailItem>
              <DetailItem icon={Briefcase} label="Cargo" emptyLabel="Sin cargo">
                {contact.job_title}
              </DetailItem>
              <DetailItem icon={Tag} label="Rol en la empresa" emptyLabel="Sin rol asignado">
                {contact.role_in_account ? ROLE_LABELS[contact.role_in_account as ContactRole] : null}
              </DetailItem>
              <DetailItem icon={User} label="Seniority" emptyLabel="Sin seniority">
                {contact.seniority ? SENIORITY_LABELS[contact.seniority] : null}
              </DetailItem>
            </DetailList>
            </SurfaceCard>
          </section>

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
                    <DrawerSection title="Datos de contacto" icon={Mail}>
                      <DetailList className="gap-y-3 sm:grid-cols-1">
                        <DetailItem icon={Mail} label="Email">
                          {contact.email ? (
                            <a href={`mailto:${contact.email}`} className={`break-all ${INLINE_LINK}`}>
                              {contact.email}
                            </a>
                          ) : (
                            <span className="text-text-muted">Sin email. Añádelo con «Editar contacto».</span>
                          )}
                        </DetailItem>
                        {contact.mobile_phone && (
                          <DetailItem icon={Phone} label="Celular">
                            <a href={`tel:${contact.mobile_phone}`} className="tabular-nums hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                              {contact.mobile_phone}
                            </a>
                          </DetailItem>
                        )}
                        {contact.phone && (
                          <DetailItem icon={Phone} label="Teléfono">
                            <a href={`tel:${contact.phone}`} className="tabular-nums hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
                              {contact.phone}
                            </a>
                          </DetailItem>
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
                          <DetailItem icon={Link2} label="LinkedIn">
                            <a
                              href={contact.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="break-all text-primary hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                            >
                              {contact.linkedin_url}
                            </a>
                          </DetailItem>
                        )}
                      </DetailList>
                    </DrawerSection>

                    {/* Empresa, cargo, rol y seniority ya van en el resumen de
                        arriba: aquí no se repiten. */}
                    <DrawerSection title="Otros datos" icon={Briefcase}>
                      <DetailList className="gap-y-3 sm:grid-cols-1">
                        <DetailItem icon={Briefcase} label="Área">
                          {contact.department || <span className="text-text-muted">Sin área</span>}
                        </DetailItem>
                        <DetailItem icon={Tag} label="Fuente">
                          {CONTACT_SOURCE_LABELS[contact.source]}
                        </DetailItem>
                        <DetailItem icon={Tag} label="Creado">
                          {formatShortDate(contact.created_at)}
                        </DetailItem>
                      </DetailList>
                      {/* Sin caja propia: las notas son un apartado más de la tarjeta,
                          separado por una divisoria. */}
                      <div className="mt-4 border-t border-border/50 pt-3">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          Notas
                        </p>
                        {contact.notes ? (
                          <p className="break-words text-sm leading-relaxed text-foreground">
                            {contact.notes}
                          </p>
                        ) : (
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            Sin notas todavía. Añádelas con «Editar contacto».
                          </p>
                        )}
                      </div>
                    </DrawerSection>
                  </div>
                </TabsContent>

                {/* Actividad */}
                <TabsContent value="actividad">
                  <DrawerSection title="Registro de actividad" icon={Activity} hint="Cambios y eventos de auditoría de este contacto.">
                    {auditLog.length === 0 ? (
                      <EmptyState
                        variant="plain"
                        icon={Activity}
                        title="Sin actividad todavía"
                        description="Los cambios de estado, de rol y las ediciones de este contacto aparecerán aquí."
                      />
                    ) : (
                      <Timeline>
                        {auditLog.map((entry) => (
                          <TimelineItem
                            key={entry.id}
                            icon={<Activity />}
                            title={AUDIT_LABELS[entry.action_type]}
                            description={formatDate(entry.created_at)}
                          >
                            {entry.actor && (
                              <p className="text-xs text-muted-foreground">
                                por {entry.actor.full_name ?? entry.actor.email}
                              </p>
                            )}
                          </TimelineItem>
                        ))}
                      </Timeline>
                    )}
                  </DrawerSection>
                </TabsContent>

                {/* Enriquecimiento — Calidad y trazabilidad */}
                <TabsContent value="enriquecimiento">
                  <ContactTraceabilityTab contact={contact} />
                </TabsContent>

                {/* HubSpot */}
                <TabsContent value="hubspot">
                  {/* AGENT2-FINAL-LOCAL-CLOSURE-MICROFIX: cero deducción aquí. El botón
                      consulta `resolveHubSpotSyncAction`, la misma autoridad que el badge de
                      abajo usa para el copy, así que la tarjeta ya no puede mostrar un
                      «Sincronizado» verde junto a un «Vinculado a HubSpot» neutro. */}
                  <DrawerSection
                    title="Sincronización con HubSpot"
                    icon={Globe}
                    action={
                      <ContactHubSpotSyncButton
                        contact={{
                          id: contact.id,
                          email: contact.email,
                          hubspot_contact_id: contact.hubspot_contact_id,
                          metadata: contact.metadata as Record<string, unknown> | null,
                        }}
                        onSynced={() => loadData(contact.id)}
                      />
                    }
                  >
                    <DetailList className="gap-y-3 sm:grid-cols-1">
                      <DetailItem icon={Tag} label="ID en HubSpot">
                        {contact.hubspot_contact_id ? (
                          <span className="break-all font-mono text-xs">{contact.hubspot_contact_id}</span>
                        ) : (
                          <span className="text-muted-foreground">No vinculado</span>
                        )}
                      </DetailItem>
                      <DetailItem icon={Tag} label="Estado de sincronización">
                        <HubSpotSyncStatusBadge contact={contact} />
                      </DetailItem>
                      {(() => {
                        const sync = contact.metadata?.hubspot_sync as
                          | Record<string, unknown>
                          | undefined;
                        const syncedAt = sync?.synced_at as string | undefined;
                        return syncedAt ? (
                          <DetailItem icon={Tag} label="Sincronizado el">
                            {formatDate(syncedAt)}
                          </DetailItem>
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
                              <DetailItem icon={Tag} label="Último intento">
                                {formatDate(state.attempted_at)}
                              </DetailItem>
                            ) : null}
                            {/* CUT-2 — desde cuándo HubSpot está desactualizado, no cuándo se
                                registró el último cambio: es lo que responde «¿cuánto lleva
                                esto sin enviarse?». */}
                            {state.stale_since ? (
                              <DetailItem icon={Tag} label="Pendiente desde">
                                {formatDate(state.stale_since)}
                              </DetailItem>
                            ) : null}
                          </>
                        );
                      })()}
                    </DetailList>
                    {!contact.email && (
                      <p className="mt-3 text-xs text-muted-foreground">
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
                        <p className="mt-3 text-xs text-muted-foreground">
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
                        <p className="mt-3 text-xs text-muted-foreground">
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
                        <p className="mt-3 text-xs text-muted-foreground">
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
                    <p className="mt-3 text-xs text-muted-foreground">
                      «Sincronizado» significa que el contacto existe en HubSpot y está vinculado
                      a SellUp. «Pendiente de actualizar» significa que el teléfono cambió en
                      SellUp después de vincularlo y todavía no se ha enviado: se envía con el
                      botón y, si tu organización tiene habilitada la actualización automática,
                      también puede enviarse solo. Un teléfono retirado por una solicitud de
                      privacidad NUNCA se envía solo. Otros campos no se actualizan en HubSpot en
                      esta versión.
                    </p>
                  </DrawerSection>
                </TabsContent>
              </Tabs>
        </div>
            )}
    </DrawerShell>

      {contact && (
        <EditContactDrawer
          key={contact.id}
          contact={contact}
          open={editOpen}
          onClose={() => {
            setEditOpen(false);
            void loadData(contact.id);
          }}
        />
      )}
    </>
  );
}
// ── Calidad y trazabilidad ────────────────────────────────────────────────────

/**
 * Pestaña «Origen y calidad». Las tres primeras tarjetas viven en
 * `contact-traceability-panel.tsx`; la de HubSpot se queda AQUÍ porque el tono
 * de su check lo decide la misma autoridad que el badge de la pestaña HubSpot.
 */
function ContactTraceabilityTab({ contact }: { contact: Contact }) {
  const vm = buildContactTraceabilityViewModel(contact);

  return (
    <ContactTraceabilityPanel vm={vm}>
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
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              <span>{vm.hubspotSyncLabel}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 text-text-muted" />
              <span className="text-muted-foreground">{vm.hubspotSyncLabel}</span>
            </span>
          )}
        </TraceRow>
        {vm.hubspotContactId && (
          <TraceRow label="ID en HubSpot">
            <span className="break-all font-mono text-xs text-muted-foreground">
              {vm.hubspotContactId}
            </span>
          </TraceRow>
        )}
        {vm.hubspotMode && (
          <TraceRow label="Modo">
            <Badge variant="neutral">
              {vm.hubspotMode === 'created' ? 'Creado en HubSpot' :
               vm.hubspotMode === 'linked_existing' ? 'Vinculado a existente' :
               vm.hubspotMode}
            </Badge>
          </TraceRow>
        )}
        {vm.hubspotAssociationStatus && (
          <TraceRow label="Asociación con empresa">
            <Badge variant={vm.hubspotAssociationStatus === 'associated' ? 'positive' : 'warning'}>
              {vm.hubspotAssociationStatus === 'associated' ? 'Asociado' :
               vm.hubspotAssociationStatus === 'failed' ? 'Falló' :
               vm.hubspotAssociationStatus}
            </Badge>
          </TraceRow>
        )}
        <p className="mt-2 text-xs text-text-muted">
          Para sincronizar o ver el detalle completo, ve a la pestaña HubSpot.
        </p>
      </TraceCard>
    </ContactTraceabilityPanel>
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
