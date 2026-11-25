'use client';

/**
 * «Contactos de otras fuentes» en la pestaña Contactos de la empresa (Agente 1, Bryan 25-11).
 *
 * Va entre «Contactos» (los aprobados) y «Contactos en HubSpot». Lista lo que Apollo, Lusha y las
 * demás fuentes trajeron para la empresa y sigue esperando una decisión en el Agente 2A:
 *  - «Por revisar»: Aprobar (de un clic, como «Traer») o Rechazar con motivo;
 *  - «Posibles duplicados»: Fusionar con el contacto que ya existe (con confirmación) o Rechazar.
 * El nombre abre la MISMA ficha del candidato que en «Por revisar», con revelar, verificar y
 * reasignar empresa. Los de HubSpot no salen aquí: tienen su propio bloque.
 *
 * El servidor sigue siendo la autoridad de cada decisión: esta pieza sólo traduce sus respuestas.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { ChevronDown, GitMerge, Inbox, Mail, Phone, RefreshCw, UserCheck, UserX } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/feedback/spinner';
import { DrawerSection } from '@/components/shared/drawer-section';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ListItem, ListItemGroup } from '@/components/data-display';
import { SOURCE_LABELS } from '@/components/contact-enrichment/contact-candidate-detail-format';
import { BAR_REJECTION_REASONS } from '@/components/contact-enrichment/use-reject-candidates';
import {
  approveContactCandidate,
  discardContactCandidate,
  getAccountCandidatesFromOtherSources,
  getDuplicateCandidateMergeOffer,
  mergeContactCandidateIntoExistingContactAction,
  type AccountOtherSourcesCandidatesResult,
} from '@/modules/contact-enrichment/actions';
import {
  classifyAccountOtherSourcesApprove,
  groupAccountOtherSourceCandidates,
  type AccountOtherSourceCandidate,
} from '@/modules/contact-enrichment/account-other-sources-candidates-core';
import { OPEN_IMPORTED_CONTACT_LABEL } from '@/modules/hubspot-lookup/import-copy';
import { formatInAppZone } from '@/lib/format-date';

// La ficha del candidato es grande: sólo se carga al abrir un candidato.
const ContactCandidateDetailSheet = React.lazy(() =>
  import('@/components/contact-enrichment/contact-candidate-detail-sheet').then((m) => ({
    default: m.ContactCandidateDetailSheet,
  })),
);

export const ACCOUNT_OTHER_SOURCES_COPY = {
  title: 'Contactos de otras fuentes',
  hint: 'Lo que trajeron Apollo, Lusha y otras fuentes para esta empresa y espera tu decisión.',
  loading: 'Leyendo los contactos por revisar…',
  errorTitle: 'No pudimos leer los contactos por revisar',
  errorBody: 'Vuelve a intentarlo en un momento.',
  retry: 'Reintentar',
  emptyTitle: 'No hay contactos por revisar',
  emptyBody: 'Cuando Apollo, Lusha u otra fuente traigan contactos de esta empresa, aparecerán aquí.',
  pendingGroup: 'Por revisar',
  duplicatesGroup: 'Posibles duplicados',
  approve: 'Aprobar',
  reject: 'Rechazar',
  merge: 'Fusionar',
  matchedWith: (name: string | null) => (name ? `Coincide con ${name}` : 'Coincide con un contacto que ya existe'),
  approved: (name: string) => `${name} quedó como contacto aprobado`,
  becameDuplicate: 'Quedó en «Posibles duplicados» para que decidas si lo fusionas.',
  needsReview: 'Revísalo en su ficha antes de aprobar.',
  mergeUnavailable: 'No se puede fusionar desde aquí: revísalo en su ficha.',
  mergeTitle: (name: string | null) => (name ? `¿Fusionar con ${name}?` : '¿Fusionar con el contacto existente?'),
  mergeBody: (candidate: string, existing: string | null) =>
    `Lo nuevo de ${candidate} (correo, teléfonos, LinkedIn y cargo) se agrega a ${existing ?? 'el contacto que ya existe'}. No se crea un contacto nuevo.`,
  mergeConfirm: 'Fusionar',
  rejectedWithReason: (reason: string) => `Motivo: ${reason}.`,
} as const;

type SectionState = { status: 'loading' } | AccountOtherSourcesCandidatesResult;

/** Lee los candidatos de la empresa sólo cuando `enabled` (al abrir la pestaña Contactos). */
function useAccountOtherSourcesCandidates(accountId: string, enabled: boolean) {
  const [attempt, setAttempt] = React.useState(0);
  const key = enabled ? `${accountId}:${attempt}` : null;
  const [loaded, setLoaded] = React.useState<{ key: string; state: AccountOtherSourcesCandidatesResult } | null>(null);

  React.useEffect(() => {
    if (!key) return;
    let cancelled = false;
    getAccountCandidatesFromOtherSources(accountId)
      .then((state) => {
        if (!cancelled) setLoaded({ key, state });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, state: { status: 'error' } });
      });
    return () => {
      cancelled = true;
    };
  }, [key, accountId]);

  // Al recargar se conserva la lista anterior (sin parpadeo) hasta que llega la nueva.
  const state: SectionState | null = !key ? null : loaded?.key === key ? loaded.state : loaded?.state ?? { status: 'loading' };
  const reload = React.useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}

function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return formatInAppZone(iso, { day: 'numeric', month: 'short' }, undefined, '') || null;
}

interface AccountOtherSourcesContactsProps {
  accountId: string;
  /** Empresa archivada: se listan sin acciones. */
  archived?: boolean;
  /** Se lee al abrir la pestaña Contactos. Por defecto, de una vez. */
  enabled?: boolean;
  /** Tras aprobar o fusionar: el bloque «Contactos» de la empresa cambió. */
  onContactsChanged?: () => void;
  /** Abre un contacto aprobado (desde el aviso de «Aprobar»). */
  onOpenContact?: (contactId: string) => void;
}

export function AccountOtherSourcesContacts({
  accountId,
  archived = false,
  enabled = true,
  onContactsChanged,
  onOpenContact,
}: AccountOtherSourcesContactsProps) {
  const { state, reload } = useAccountOtherSourcesCandidates(accountId, enabled);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [openCandidateId, setOpenCandidateId] = React.useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = React.useState<{
    candidate: AccountOtherSourceCandidate;
    contactId: string;
    contactName: string | null;
  } | null>(null);
  const [merging, setMerging] = React.useState(false);

  const refreshAll = React.useCallback(() => {
    reload();
    onContactsChanged?.();
  }, [reload, onContactsChanged]);

  if (!state) return null;

  const candidates = state.status === 'ok' ? state.candidates : [];
  const groups = groupAccountOtherSourceCandidates(candidates);
  const canAct = !archived && busyId === null && !merging;

  async function handleApprove(candidate: AccountOtherSourceCandidate) {
    setBusyId(candidate.id);
    try {
      const result = await approveContactCandidate(candidate.id);
      const outcome = classifyAccountOtherSourcesApprove(result);
      if (outcome === 'approved') {
        const contactId = result.contactId;
        toast.success(ACCOUNT_OTHER_SOURCES_COPY.approved(candidate.full_name), {
          description: result.message,
          action:
            contactId && onOpenContact
              ? { label: OPEN_IMPORTED_CONTACT_LABEL, onClick: () => onOpenContact(contactId) }
              : undefined,
        });
        refreshAll();
      } else if (outcome === 'duplicate') {
        toast.warning(result.error ?? 'Este candidato parece estar duplicado con un contacto existente.', {
          description: ACCOUNT_OTHER_SOURCES_COPY.becameDuplicate,
        });
        reload();
      } else if (outcome === 'needs_review') {
        toast.warning(result.error ?? ACCOUNT_OTHER_SOURCES_COPY.needsReview);
        setOpenCandidateId(candidate.id);
      } else {
        toast.error(result.error ?? 'No fue posible aprobar el candidato.');
      }
    } catch {
      toast.error('No fue posible aprobar el candidato.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(candidate: AccountOtherSourceCandidate, reason: string) {
    setBusyId(candidate.id);
    try {
      const result = await discardContactCandidate(candidate.id, reason);
      if (result.ok) {
        toast.success(result.message ?? 'Candidato rechazado.', {
          description: ACCOUNT_OTHER_SOURCES_COPY.rejectedWithReason(reason),
        });
        reload();
      } else {
        toast.error(result.error ?? 'No fue posible rechazar el candidato.');
      }
    } catch {
      toast.error('No fue posible rechazar el candidato.');
    } finally {
      setBusyId(null);
    }
  }

  /** «Fusionar»: el servidor dice con quién (identidad exacta); si no puede, a la ficha. */
  async function handleMergeClick(candidate: AccountOtherSourceCandidate) {
    setBusyId(candidate.id);
    try {
      const offer = await getDuplicateCandidateMergeOffer(candidate.id);
      if (offer?.offered) {
        setMergeTarget({
          candidate,
          contactId: offer.contactId,
          contactName: offer.contactId === candidate.matched_contact?.id ? candidate.matched_contact.fullName : null,
        });
      } else {
        toast.info(ACCOUNT_OTHER_SOURCES_COPY.mergeUnavailable);
        setOpenCandidateId(candidate.id);
      }
    } catch {
      toast.error('No pudimos preparar la fusión. Vuelve a intentarlo.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmMerge() {
    if (!mergeTarget || merging) return;
    setMerging(true);
    try {
      const result = await mergeContactCandidateIntoExistingContactAction(mergeTarget.candidate.id, mergeTarget.contactId);
      if (result.ok) {
        toast.success(result.message ?? 'Información agregada al contacto existente.');
        setMergeTarget(null);
        refreshAll();
      } else {
        toast.error(result.error ?? 'No fue posible agregar la información al contacto existente.');
      }
    } catch {
      toast.error('No fue posible agregar la información al contacto existente.');
    } finally {
      setMerging(false);
    }
  }

  function rejectMenu(candidate: AccountOtherSourceCandidate) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" disabled={!canAct} />}>
          <UserX className="h-3.5 w-3.5" />
          {ACCOUNT_OTHER_SOURCES_COPY.reject}
          <ChevronDown className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {BAR_REJECTION_REASONS.map((reason) => (
            <DropdownMenuItem key={reason} variant="destructive" onClick={() => void handleReject(candidate, reason)}>
              {reason}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function row(candidate: AccountOtherSourceCandidate) {
    const isDuplicate = candidate.status === 'duplicate';
    const day = formatDay(candidate.created_at);
    return (
      <ListItem
        key={candidate.id}
        size="sm"
        title={candidate.full_name || 'Sin nombre'}
        description={
          <span className="flex flex-col gap-0.5">
            {candidate.title && <span>{candidate.title}</span>}
            {(candidate.email || candidate.phone) && (
              <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                {candidate.email && (
                  <span className="inline-flex items-center gap-1 break-all">
                    <Mail className="h-3 w-3 shrink-0" /> {candidate.email}
                  </span>
                )}
                {candidate.phone && (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Phone className="h-3 w-3 shrink-0" /> {candidate.phone}
                  </span>
                )}
              </span>
            )}
            {isDuplicate && (
              <span className="inline-flex items-center gap-1 text-warning-foreground dark:text-warning">
                <GitMerge className="h-3 w-3 shrink-0" />
                {ACCOUNT_OTHER_SOURCES_COPY.matchedWith(candidate.matched_contact?.fullName ?? null)}
              </span>
            )}
          </span>
        }
        meta={
          <span className="flex flex-col items-end gap-0.5">
            <Badge variant="outline">{SOURCE_LABELS[candidate.source] ?? candidate.source}</Badge>
            {day && <span>{day}</span>}
          </span>
        }
        onClick={() => setOpenCandidateId(candidate.id)}
        actions={
          archived ? undefined : (
            <span className="flex items-center gap-1">
              {isDuplicate ? (
                <Button type="button" variant="outline" size="sm" disabled={!canAct} onClick={() => void handleMergeClick(candidate)}>
                  {busyId === candidate.id ? <Spinner size="xs" decorative /> : <GitMerge className="h-3.5 w-3.5" />}
                  {ACCOUNT_OTHER_SOURCES_COPY.merge}
                </Button>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled={!canAct} onClick={() => void handleApprove(candidate)}>
                  {busyId === candidate.id ? <Spinner size="xs" decorative /> : <UserCheck className="h-3.5 w-3.5" />}
                  {ACCOUNT_OTHER_SOURCES_COPY.approve}
                </Button>
              )}
              {rejectMenu(candidate)}
            </span>
          )
        }
      />
    );
  }

  function group(label: string, items: AccountOtherSourceCandidate[]) {
    if (items.length === 0) return null;
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {label} <span className="tabular-nums">· {items.length}</span>
        </p>
        <ListItemGroup>{items.map(row)}</ListItemGroup>
      </div>
    );
  }

  return (
    <>
      <DrawerSection
        title={ACCOUNT_OTHER_SOURCES_COPY.title}
        icon={Inbox}
        badge={state.status === 'ok' ? <span className="text-xs tabular-nums text-muted-foreground">{candidates.length}</span> : undefined}
        hint={ACCOUNT_OTHER_SOURCES_COPY.hint}
      >
        {state.status === 'loading' ? (
          <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Spinner size="xs" decorative />
            {ACCOUNT_OTHER_SOURCES_COPY.loading}
          </div>
        ) : state.status === 'error' ? (
          <EmptyState
            variant="plain"
            icon={Inbox}
            title={ACCOUNT_OTHER_SOURCES_COPY.errorTitle}
            description={ACCOUNT_OTHER_SOURCES_COPY.errorBody}
            action={
              <Button type="button" variant="outline" size="sm" onClick={reload}>
                <RefreshCw className="h-3.5 w-3.5" /> {ACCOUNT_OTHER_SOURCES_COPY.retry}
              </Button>
            }
          />
        ) : candidates.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={Inbox}
            title={ACCOUNT_OTHER_SOURCES_COPY.emptyTitle}
            description={ACCOUNT_OTHER_SOURCES_COPY.emptyBody}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {group(ACCOUNT_OTHER_SOURCES_COPY.pendingGroup, groups.pending)}
            {group(ACCOUNT_OTHER_SOURCES_COPY.duplicatesGroup, groups.duplicates)}
          </div>
        )}
      </DrawerSection>

      <ConfirmDialog
        open={mergeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !merging) setMergeTarget(null);
        }}
        icon={GitMerge}
        title={ACCOUNT_OTHER_SOURCES_COPY.mergeTitle(mergeTarget?.contactName ?? null)}
        description={
          mergeTarget
            ? ACCOUNT_OTHER_SOURCES_COPY.mergeBody(mergeTarget.candidate.full_name, mergeTarget.contactName)
            : undefined
        }
        confirmLabel={ACCOUNT_OTHER_SOURCES_COPY.mergeConfirm}
        loading={merging}
        onConfirm={() => void handleConfirmMerge()}
      />

      {openCandidateId && state.status === 'ok' && (
        <React.Suspense fallback={null}>
          <ContactCandidateDetailSheet
            candidateId={openCandidateId}
            open
            onClose={() => {
              setOpenCandidateId(null);
              // En la ficha se pudo aprobar, fusionar, rechazar o reasignar la empresa.
              refreshAll();
            }}
            {...state.flags}
          />
        </React.Suspense>
      )}
    </>
  );
}
