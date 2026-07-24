'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  UserSearch,
  User,
  Briefcase,
  Building2,
  Globe,
  Tag,
  Calendar,
  Mail,
  Link2,
  Phone,
  PhoneCall,
  Gauge,
  ShieldCheck,
  Copy,
  Hash,
  Info,
  Check,
  X,
  Loader2,
  Ban,
  AlertTriangle,
} from 'lucide-react';
import { DrawerShell } from '@/components/shared/drawer-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  getPendingContactCandidateById,
  approveContactCandidate,
  discardContactCandidate,
} from '@/modules/contact-enrichment/actions';
import { revealCandidatePhoneAction } from '@/modules/contact-enrichment/phone-reveal-actions';
import type {
  PendingContactCandidate,
  ContactRelevanceStatus,
  ContactDuplicateStatus,
  ContactSource,
  ContactCandidateCompanyConsistency,
  LushaPersonIdentityEvidenceV1,
  PhoneType,
  PhoneSource,
  PhoneProcessingBasis,
} from '@/modules/contact-enrichment/types';
import {
  IDENTITY_TONE_STYLES,
  resolveIdentityDisplay,
} from './contact-candidate-identity-display';

// Motivos de rechazo sugeridos (Hito 17A.4B). "Otro" habilita un comentario
// opcional; el resto se guarda tal cual en review_notes + metadata.review.
const REJECTION_REASONS = [
  'Cargo no relevante',
  'Datos insuficientes',
  'No pertenece a la empresa',
  'Duplicado',
  'No es decisor / sponsor útil',
  'Otro',
] as const;

// ── Label & style maps (espejo de contact-candidates-data-table-client) ──────

const SOURCE_LABELS: Record<ContactSource, string> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  manual: 'Manual',
  mock: 'Mock',
};

const RELEVANCE_LABELS: Record<ContactRelevanceStatus, string> = {
  high_relevance: 'Alta',
  medium_relevance: 'Media',
  low_relevance: 'Baja',
  not_relevant: 'No relevante',
  insufficient_data: 'Datos insuficientes',
};

const RELEVANCE_STYLES: Record<ContactRelevanceStatus, string> = {
  high_relevance: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  medium_relevance: 'bg-su-brand-soft text-su-brand',
  low_relevance: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  not_relevant: 'bg-muted text-muted-foreground',
  insufficient_data: 'bg-muted text-muted-foreground',
};

const DUPLICATE_LABELS: Record<ContactDuplicateStatus, string> = {
  unchecked: 'Sin verificar',
  no_match: 'Sin coincidencias',
  possible_duplicate: 'Posible duplicado',
  exact_duplicate: 'Duplicado exacto',
};

// ── Teléfono: tipo y fuente (PHONE-3B) ───────────────────────────────────────
// Etiquetas de solo lectura para visualizar el tipo/fuente del teléfono que
// PHONE-3A conservó en `enrichment_metadata.phone`. Copy PRUDENTE: `personal_mobile`
// se rotula como "posible personal" a propósito, sin prometer certeza sobre la
// titularidad del número. Este hito NO revela teléfonos ni activa reveal alguno.

const PHONE_TYPE_UNKNOWN_LABEL = 'Tipo desconocido';
const PHONE_SOURCE_UNKNOWN_LABEL = 'Fuente desconocida';

const PHONE_TYPE_LABELS: Record<PhoneType, string> = {
  personal_mobile: 'Móvil / posible personal',
  mobile: 'Móvil',
  direct_dial: 'Directo corporativo',
  work: 'Trabajo',
  hq: 'Central / HQ',
  other: 'Otro',
  unknown: PHONE_TYPE_UNKNOWN_LABEL,
};

const PHONE_SOURCE_LABELS: Record<PhoneSource, string> = {
  apollo_search: 'Apollo búsqueda',
  apollo_reveal: 'Apollo reveal',
  lusha_reveal: 'Lusha reveal',
  provider_payload: 'Proveedor',
  manual: 'Manual',
  unknown: PHONE_SOURCE_UNKNOWN_LABEL,
};

/**
 * Etiqueta del tipo de teléfono. Cualquier valor ausente, vacío, `unknown` o no
 * reconocido cae a "Tipo desconocido" (estado explícito cuando hay teléfono
 * pero no hay tipo claro).
 */
function resolvePhoneTypeLabel(type: string | null | undefined): string {
  if (typeof type === 'string' && Object.prototype.hasOwnProperty.call(PHONE_TYPE_LABELS, type)) {
    return PHONE_TYPE_LABELS[type as PhoneType];
  }
  return PHONE_TYPE_UNKNOWN_LABEL;
}

/**
 * Etiqueta de la fuente del teléfono. Devuelve `null` cuando no hay fuente
 * (para omitir el badge). Valores no reconocidos → "Fuente desconocida".
 */
function resolvePhoneSourceLabel(source: string | null | undefined): string | null {
  if (typeof source !== 'string' || source.trim().length === 0) return null;
  if (Object.prototype.hasOwnProperty.call(PHONE_SOURCE_LABELS, source)) {
    return PHONE_SOURCE_LABELS[source as PhoneSource];
  }
  return PHONE_SOURCE_UNKNOWN_LABEL;
}

// ── Reveal de teléfono (PHONE-3D.4) ──────────────────────────────────────────
// UI explícita, individual y auditada para revelar el teléfono de UN candidato
// vía el server action `revealCandidatePhoneAction` (PHONE-3D.3). Detrás de
// ENABLE_APOLLO_PHONE_REVEAL: el flag se resuelve SIEMPRE en el servidor y llega
// como booleano plano (`phoneRevealEnabled`); este componente cliente NUNCA lee
// process.env ni ninguna variable NEXT_PUBLIC_*. Con el flag OFF (default de
// producción) el botón no se renderiza, así que no hay forma de gastar créditos.

/**
 * Tope de créditos Apollo mostrado al operador. Espejo de copy del contrato
 * legal/producto (APOLLO_CONTACT_ENRICHMENT_GUARDRAILS.phoneRevealCredits = 8);
 * se declara aquí como constante de UI para no importar módulos de servidor en
 * el bundle cliente. El costo real lo revalida el server action.
 */
const PHONE_REVEAL_MAX_CREDITS = 8;

/**
 * Vocabulario aprobado de base de tratamiento (espejo de `PhoneProcessingBasis`
 * y de la migración 095). Solo alimenta el selector del modal; el server action
 * revalida la base y exige nota cuando es `other_approved_basis`.
 */
const PHONE_PROCESSING_BASIS_OPTIONS: ReadonlyArray<{
  value: PhoneProcessingBasis;
  label: string;
}> = [
  { value: 'legitimate_interest_b2b', label: 'Interés legítimo B2B' },
  { value: 'consent_obtained', label: 'Consentimiento obtenido' },
  { value: 'existing_business_relationship', label: 'Relación comercial existente' },
  { value: 'customer_requested_contact', label: 'Contacto solicitado por cliente' },
  { value: 'other_approved_basis', label: 'Otra base aprobada' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const UNAVAILABLE = 'No disponible';

function formatDate(iso: string | null): string {
  if (!iso) return UNAVAILABLE;
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Convierte un score 0–1 (o 0–100) en porcentaje legible; null si no hay dato. */
function toPercent(score: number | undefined | null): string | null {
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  const normalized = score > 1 ? score : score * 100;
  return `${Math.round(normalized)}%`;
}

function normalizeLinkedinUrl(url: string): string {
  return url.startsWith('http') ? url : `https://${url}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ContactCandidateDetailSheetProps {
  candidateId: string | null;
  open: boolean;
  onClose: () => void;
  /**
   * ENABLE_APOLLO_PHONE_REVEAL resuelto server-side y pasado como booleano
   * plano (PHONE-3D.4). Con `false` (default de producción) el botón "Revelar
   * teléfono" no se renderiza. El componente cliente NUNCA lee process.env ni un
   * flag NEXT_PUBLIC_*.
   */
  phoneRevealEnabled?: boolean;
  /**
   * `true` solo si el rol del actor autenticado (Administrador / Manager
   * comercial) está autorizado a revelar. Resuelto server-side. Con `false` el
   * botón se oculta; el server action revalida el rol de todas formas.
   */
  phoneRevealAuthorized?: boolean;
}

/**
 * Side panel de revisión humana de un candidato del Agente 2A. Reutiliza el
 * shell compartido `DrawerShell` + `SurfaceCard`, el mismo patrón que el detalle
 * de Cuentas/Prospectos (fetch por id con loading, `null` ⇒ "no disponible").
 * Hito 17A.4B: incluye aprobar (crea contacto oficial en `contacts`) y rechazar
 * (marca `discarded` con motivo). NO escribe en HubSpot ni ejecuta Apollo.
 */
export function ContactCandidateDetailSheet({
  candidateId,
  open,
  onClose,
  phoneRevealEnabled = false,
  phoneRevealAuthorized = false,
}: ContactCandidateDetailSheetProps) {
  const router = useRouter();
  const [candidate, setCandidate] = React.useState<PendingContactCandidate | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [notFound, setNotFound] = React.useState(false);

  // Estado de revisión humana (Hito 17A.4B)
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [showRejectForm, setShowRejectForm] = React.useState(false);
  const [reason, setReason] = React.useState<string>(REJECTION_REASONS[0]);
  const [otherComment, setOtherComment] = React.useState('');

  // Override de discrepancia de identidad (Hito 17B.4W.8) — solo aplica cuando
  // identity_consistency === 'mismatch'. El servidor sigue siendo la autoridad;
  // este estado solo controla el diálogo de confirmación humana.
  const [showIdentityOverrideDialog, setShowIdentityOverrideDialog] = React.useState(false);
  const [overrideAcknowledged, setOverrideAcknowledged] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState('');
  const [overrideValidationError, setOverrideValidationError] = React.useState<string | null>(null);

  // Reveal de teléfono (PHONE-3D.4) — modal de confirmación de costo + base de
  // tratamiento. Todo el estado es local; la autoridad real (flag, rol, costo,
  // do_not_contact, re-reveal) vive en el server action.
  const [showPhoneRevealDialog, setShowPhoneRevealDialog] = React.useState(false);
  const [phoneRevealBasis, setPhoneRevealBasis] = React.useState<PhoneProcessingBasis | ''>('');
  const [phoneRevealNote, setPhoneRevealNote] = React.useState('');
  const [revealingPhone, setRevealingPhone] = React.useState(false);
  const [phoneRevealError, setPhoneRevealError] = React.useState<string | null>(null);
  const [phoneRevealNoteError, setPhoneRevealNoteError] = React.useState<string | null>(null);
  const [phoneRevealNotice, setPhoneRevealNotice] = React.useState<string | null>(null);

  const busy = approving || rejecting;

  React.useEffect(() => {
    if (open && candidateId) {
      let cancelled = false;
      (async () => {
        setLoading(true);
        setNotFound(false);
        try {
          const result = await getPendingContactCandidateById(candidateId);
          if (cancelled) return;
          if (!result) {
            setNotFound(true);
            setCandidate(null);
          } else {
            setCandidate(result);
          }
        } catch {
          if (!cancelled) {
            setNotFound(true);
            setCandidate(null);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    } else if (!open) {
      queueMicrotask(() => {
        setCandidate(null);
        setNotFound(false);
        setApproving(false);
        setRejecting(false);
        setShowRejectForm(false);
        setReason(REJECTION_REASONS[0]);
        setOtherComment('');
        setShowIdentityOverrideDialog(false);
        setOverrideAcknowledged(false);
        setOverrideReason('');
        setOverrideValidationError(null);
        setShowPhoneRevealDialog(false);
        setPhoneRevealBasis('');
        setPhoneRevealNote('');
        setRevealingPhone(false);
        setPhoneRevealError(null);
        setPhoneRevealNoteError(null);
        setPhoneRevealNotice(null);
      });
    }
  }, [open, candidateId]);

  /**
   * Refetch silencioso del candidato tras un reveal (no muestra el skeleton del
   * drawer). Reutiliza la misma proyección de solo lectura; si falla, conserva
   * la vista actual. Sirve para reflejar el teléfono recién revelado + su badge.
   */
  const reloadCandidate = React.useCallback(async () => {
    if (!candidateId) return;
    try {
      const fresh = await getPendingContactCandidateById(candidateId);
      if (fresh) setCandidate(fresh);
    } catch {
      // Silencioso: mantenemos la vista actual si el refetch falla.
    }
  }, [candidateId]);

  async function handleApprove(identityOverride?: { acknowledged: boolean; reason: string }) {
    if (!candidate || busy) return;
    setApproving(true);
    if (identityOverride) setOverrideValidationError(null);
    try {
      const result = await approveContactCandidate(candidate.id, identityOverride);
      if (result.ok) {
        toast.success(result.message ?? 'Contacto aprobado y creado en SellUp.');
        setShowIdentityOverrideDialog(false);
        router.refresh();
        onClose();
      } else if (result.duplicate) {
        // El candidato pasó a `duplicate` y sale de revisión: refrescamos y cerramos.
        toast.warning(result.error ?? 'Este candidato parece estar duplicado.');
        router.refresh();
        onClose();
      } else if (result.code === 'IDENTITY_MISMATCH_REQUIRES_REVIEW') {
        // El estado en pantalla quedó obsoleto respecto al servidor (autoridad
        // real): abrimos el diálogo de revisión en vez de mostrar un error genérico.
        setShowIdentityOverrideDialog(true);
        toast.warning(
          result.error ?? 'Este candidato requiere revisar la discrepancia de identidad antes de aprobar.',
        );
      } else if (result.code === 'IDENTITY_OVERRIDE_REASON_REQUIRED') {
        setShowIdentityOverrideDialog(true);
        setOverrideValidationError(
          result.error ?? 'Debes confirmar que revisaste la discrepancia e indicar un motivo.',
        );
      } else {
        toast.error(result.error ?? 'No fue posible aprobar el candidato.');
      }
    } catch {
      toast.error('No fue posible aprobar el candidato.');
    } finally {
      setApproving(false);
    }
  }

  function handleConfirmIdentityOverride() {
    const trimmedReason = overrideReason.trim();
    if (!overrideAcknowledged || trimmedReason.length === 0) {
      setOverrideValidationError('Debes confirmar que revisaste la discrepancia e indicar un motivo.');
      return;
    }
    void handleApprove({ acknowledged: overrideAcknowledged, reason: trimmedReason });
  }

  async function handleReject() {
    if (!candidate || busy) return;
    const finalReason =
      reason === 'Otro' && otherComment.trim()
        ? `Otro: ${otherComment.trim()}`
        : reason;
    setRejecting(true);
    try {
      const result = await discardContactCandidate(candidate.id, finalReason);
      if (result.ok) {
        toast.success(result.message ?? 'Candidato rechazado.');
        router.refresh();
        onClose();
      } else {
        toast.error(result.error ?? 'No fue posible rechazar el candidato.');
      }
    } catch {
      toast.error('No fue posible rechazar el candidato.');
    } finally {
      setRejecting(false);
    }
  }

  // ── Reveal de teléfono (PHONE-3D.4) ──────────────────────────────────────
  function closePhoneRevealDialog() {
    setShowPhoneRevealDialog(false);
    setPhoneRevealBasis('');
    setPhoneRevealNote('');
    setPhoneRevealError(null);
    setPhoneRevealNoteError(null);
  }

  function openPhoneRevealDialog() {
    setPhoneRevealNotice(null);
    setPhoneRevealError(null);
    setPhoneRevealNoteError(null);
    setPhoneRevealBasis('');
    setPhoneRevealNote('');
    setShowPhoneRevealDialog(true);
  }

  /**
   * Traduce el resultado seguro del server action a estados de UI. El teléfono
   * revelado NUNCA vuelve en el resultado (queda persistido en el candidato); un
   * refetch silencioso lo trae a pantalla. No se hace console.log del resultado.
   */
  function applyPhoneRevealResult(
    result: Awaited<ReturnType<typeof revealCandidatePhoneAction>>,
  ) {
    switch (result.status) {
      case 'revealed':
        toast.success('Teléfono revelado.');
        setPhoneRevealNotice(null);
        closePhoneRevealDialog();
        void reloadCandidate();
        return;
      case 'no_phone_found':
        setPhoneRevealNotice('Teléfono no disponible tras reveal.');
        closePhoneRevealDialog();
        void reloadCandidate();
        return;
      case 'already_revealed':
        toast.warning('Este teléfono ya fue revelado.');
        closePhoneRevealDialog();
        void reloadCandidate();
        return;
      case 'do_not_contact':
        toast.warning('Este candidato/contacto está marcado como no contactar.');
        closePhoneRevealDialog();
        return;
      case 'disabled':
        setPhoneRevealError('La revelación de teléfono no está activada.');
        return;
      case 'unauthorized_role':
        setPhoneRevealError('No tienes permisos para revelar teléfonos.');
        return;
      case 'cost_confirmation_required':
        setPhoneRevealError('Debes confirmar el costo para continuar.');
        return;
      case 'processing_basis_required':
      case 'invalid_processing_basis':
        setPhoneRevealError('Selecciona una base de tratamiento válida.');
        return;
      case 'processing_basis_note_required':
        setPhoneRevealNoteError('La justificación de la base aprobada es obligatoria.');
        return;
      case 'insufficient_identity':
        setPhoneRevealError('No hay identidad suficiente para revelar teléfono.');
        return;
      default:
        // error, candidate_not_found, candidate_account_invalid, invalid_candidate
        setPhoneRevealError('No fue posible revelar el teléfono.');
    }
  }

  async function handlePhoneReveal() {
    if (!candidate || revealingPhone) return;
    setPhoneRevealError(null);
    setPhoneRevealNoteError(null);

    // Validación cliente inmediata (el server action revalida igual).
    if (!phoneRevealBasis) {
      setPhoneRevealError('Selecciona la base de tratamiento aplicable.');
      return;
    }
    const trimmedNote = phoneRevealNote.trim();
    if (phoneRevealBasis === 'other_approved_basis' && trimmedNote.length === 0) {
      setPhoneRevealNoteError('La justificación de la base aprobada es obligatoria.');
      return;
    }

    setRevealingPhone(true);
    try {
      // Payload mínimo: solo el id del candidato + la confirmación de costo y la
      // base. NUNCA se envía teléfono, email, LinkedIn, nombre ni payload crudo.
      const result = await revealCandidatePhoneAction({
        candidateId: candidate.id,
        confirmCost: true,
        expectedMaxCredits: PHONE_REVEAL_MAX_CREDITS,
        phoneProcessingBasis: phoneRevealBasis,
        phoneProcessingBasisNote:
          phoneRevealBasis === 'other_approved_basis' ? trimmedNote : undefined,
      });
      applyPhoneRevealResult(result);
    } catch {
      setPhoneRevealError('No fue posible revelar el teléfono.');
    } finally {
      setRevealingPhone(false);
    }
  }

  const relevance = candidate?.enrichment_metadata?.relevance;
  const relevanceScore = toPercent(relevance?.score);
  const qualityScore = toPercent(relevance?.quality_score);
  const confidenceLabel = toPercent(candidate?.confidence);
  const apolloAttempt = candidate?.enrichment_metadata?.apollo_search_attempt ?? null;
  const matchedKeywords = relevance?.matched_keywords?.filter(Boolean) ?? [];

  // Teléfono (PHONE-3B): solo VISUALIZA lo que PHONE-3A conservó. El número
  // escalar sigue siendo la autoridad; la metadata solo aporta tipo/fuente.
  const phoneMeta = candidate?.enrichment_metadata?.phone ?? null;
  const phoneNumber = candidate?.phone ?? phoneMeta?.number ?? null;
  const hasPhone = typeof phoneNumber === 'string' && phoneNumber.trim().length > 0;
  const phoneTypeLabel = resolvePhoneTypeLabel(phoneMeta?.type);
  const phoneSourceLabel = resolvePhoneSourceLabel(phoneMeta?.source);

  // Elegibilidad del botón "Revelar teléfono" (PHONE-3D.4). Fail-closed:
  //  - flag OFF (o rol no autorizado) → no se renderiza (no gasta créditos).
  //  - ya revelado (status `revealed` o fuente `apollo_reveal`) → oculto.
  //  - `no_phone_found` → oculto (sin reintento).
  //  - sin cuenta SellUp → oculto (el reveal exige cuenta).
  // El server action revalida todos estos gates de todas formas.
  const phoneAlreadyRevealed =
    candidate?.phone_reveal_status === 'revealed' ||
    phoneMeta?.source === 'apollo_reveal';
  const phoneRevealExhausted = candidate?.phone_reveal_status === 'no_phone_found';
  const canOfferPhoneReveal =
    !!candidate &&
    phoneRevealEnabled === true &&
    phoneRevealAuthorized === true &&
    !!candidate.account_id &&
    !phoneAlreadyRevealed &&
    !phoneRevealExhausted;
  const companyConsistency =
    (candidate?.enrichment_metadata?.company_consistency as
      | ContactCandidateCompanyConsistency
      | null
      | undefined) ?? null;
  const showConsistencyWarning =
    companyConsistency?.status === 'possible_mismatch' ||
    companyConsistency?.status === 'possible_related_domain';

  // Consistencia de identidad de persona (17B.4W.6). null ⇒ candidato legacy.
  const personIdentity =
    (candidate?.enrichment_metadata?.person_identity as
      | LushaPersonIdentityEvidenceV1
      | null
      | undefined) ?? null;
  const identityDisplay = resolveIdentityDisplay(personIdentity);
  const showIdentityEvidence =
    personIdentity?.identity_consistency === 'mismatch';
  // Gate de aprobación (Hito 17B.4W.8): mismatch exige override humano explícito
  // antes de aprobar. El servidor sigue siendo la autoridad real de esta regla.
  const isIdentityMismatch = showIdentityEvidence;

  return (
    <>
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && onClose()}
      side="right"
      className="w-full sm:w-[60vw] sm:min-w-[620px] sm:max-w-[820px]"
      loading={loading}
      icon={<UserSearch className="h-5 w-5 text-su-brand" />}
      title={
        candidate ? (
          <div className="flex items-center justify-between gap-4 mr-6">
            <span className="truncate">{candidate.full_name || 'Sin nombre'}</span>
            <Badge
              variant="outline"
              className="shrink-0 border-transparent bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold"
            >
              Por revisar
            </Badge>
          </div>
        ) : notFound ? (
          'Candidato no disponible'
        ) : (
          'Cargando candidato…'
        )
      }
      description={
        candidate
          ? [candidate.title ?? 'Sin cargo', candidate.company_name ?? 'Sin empresa']
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      actions={
        candidate ? (
          !showRejectForm ? (
            <>
              <p className="flex-1 text-[11px] text-muted-foreground/70">
                {candidate.account_id
                  ? 'Al aprobar se creará un contacto oficial en SellUp.'
                  : candidate.hubspot_company_id
                    ? 'Al aprobar, SellUp creará o vinculará la cuenta automáticamente.'
                    : 'Sin cuenta SellUp asociada: no se puede aprobar.'}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setShowRejectForm(true)}
                >
                  <Ban className="h-4 w-4" />
                  Rechazar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || (!candidate.account_id && !candidate.hubspot_company_id)}
                  onClick={() =>
                    isIdentityMismatch ? setShowIdentityOverrideDialog(true) : handleApprove()
                  }
                >
                  {approving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Aprobando…
                    </>
                  ) : isIdentityMismatch ? (
                    <>
                      <AlertTriangle className="h-4 w-4" />
                      Revisar y aprobar de todas formas
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Aprobar candidato
                    </>
                  )}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="flex-1 text-[11px] text-muted-foreground/70">
                Indica el motivo del rechazo.
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setShowRejectForm(false)}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={handleReject}
                >
                  {rejecting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Rechazando…
                    </>
                  ) : (
                    <>
                      <X className="h-4 w-4" />
                      Confirmar rechazo
                    </>
                  )}
                </Button>
              </div>
            </>
          )
        ) : undefined
      }
    >
      {notFound ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60">
            <Info className="h-5 w-5 text-muted-foreground/40" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            No fue posible cargar el detalle del candidato.
          </p>
        </div>
      ) : !candidate ? null : (
        <div className="space-y-4">
          {/* 1. Información principal */}
          <SurfaceCard>
            <SurfaceCardHeader title="Información principal" />
            <dl className="space-y-3">
              <DetailRow icon={User} label="Nombre completo">
                {candidate.full_name || <Fallback />}
              </DetailRow>
              <DetailRow icon={Briefcase} label="Cargo">
                {candidate.title || <Fallback />}
              </DetailRow>
              <DetailRow icon={Building2} label="Empresa">
                {candidate.company_name || <Fallback />}
              </DetailRow>
              <DetailRow icon={Globe} label="Dominio empresa">
                {candidate.company_domain || <Fallback />}
              </DetailRow>
              <DetailRow icon={Tag} label="Fuente">
                <Badge variant="outline" className="text-[10px]">
                  {SOURCE_LABELS[candidate.source] ?? candidate.source}
                </Badge>
              </DetailRow>
              <DetailRow icon={Calendar} label="Fecha de creación">
                {formatDate(candidate.created_at)}
              </DetailRow>
            </dl>
          </SurfaceCard>

          {/* 2. Canales de contacto */}
          <SurfaceCard>
            <SurfaceCardHeader title="Canales de contacto" />
            <dl className="space-y-3">
              <DetailRow icon={Mail} label="Email">
                {candidate.email || <Fallback />}
              </DetailRow>
              <DetailRow icon={Link2} label="LinkedIn">
                {candidate.linkedin_url ? (
                  <a
                    href={normalizeLinkedinUrl(candidate.linkedin_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-su-brand hover:underline break-all"
                  >
                    {candidate.linkedin_url}
                  </a>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              <DetailRow icon={Phone} label="Teléfono">
                <div className="space-y-2">
                  {hasPhone ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="break-all">{phoneNumber}</span>
                      <Badge className="border-0 bg-su-brand-soft text-su-brand text-[10px] font-semibold">
                        {phoneTypeLabel}
                      </Badge>
                      {phoneSourceLabel && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-normal text-muted-foreground"
                        >
                          {phoneSourceLabel}
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <Fallback />
                  )}
                  {phoneRevealNotice && (
                    <p className="text-[11px] text-muted-foreground">{phoneRevealNotice}</p>
                  )}
                  {canOfferPhoneReveal && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      disabled={busy || revealingPhone}
                      onClick={openPhoneRevealDialog}
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                      Revelar teléfono
                    </Button>
                  )}
                </div>
              </DetailRow>
            </dl>
          </SurfaceCard>

          {/* 3. Evaluación del candidato */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Evaluación del candidato"
              description="Veredicto del filtro de relevancia del Agente de contactos."
            />
            <dl className="space-y-3">
              <DetailRow icon={Gauge} label="Relevancia">
                {relevance?.status ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Badge
                      className={`${RELEVANCE_STYLES[relevance.status]} border-0 text-[10px] font-semibold`}
                    >
                      {RELEVANCE_LABELS[relevance.status] ?? relevance.status}
                    </Badge>
                    {relevanceScore && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        Score {relevanceScore}
                      </span>
                    )}
                  </span>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              <DetailRow icon={ShieldCheck} label="Calidad">
                {qualityScore ? (
                  <span className="tabular-nums">{qualityScore}</span>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              <DetailRow icon={Copy} label="Estado de duplicado">
                {DUPLICATE_LABELS[candidate.duplicate_status] ?? candidate.duplicate_status}
              </DetailRow>
              <DetailRow icon={Gauge} label="Confianza">
                {confidenceLabel ? (
                  <span className="tabular-nums">{confidenceLabel}</span>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              {matchedKeywords.length > 0 && (
                <DetailRow icon={Tag} label="Señales detectadas">
                  <span className="flex flex-wrap gap-1">
                    {matchedKeywords.map((kw) => (
                      <Badge
                        key={kw}
                        variant="outline"
                        className="text-[10px] font-normal"
                      >
                        {kw}
                      </Badge>
                    ))}
                  </span>
                </DetailRow>
              )}
            </dl>
          </SurfaceCard>

          {/* 3a. Consistencia de identidad (Hito 17B.4W.6) — observacional */}
          <SurfaceCard>
            <SurfaceCardHeader
              title="Consistencia de identidad"
              description="Compara la persona encontrada en Lusha con la identidad devuelta por el enriquecimiento."
            />
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                {identityDisplay.tone === 'consistent' ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : identityDisplay.tone === 'mismatch' ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                ) : (
                  <Info className="h-3.5 w-3.5 text-muted-foreground/50" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Badge
                  className={`${IDENTITY_TONE_STYLES[identityDisplay.tone]} border-0 text-[10px] font-semibold`}
                >
                  {identityDisplay.label}
                </Badge>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {identityDisplay.description}
                </p>
                {showIdentityEvidence && (
                  <div className="space-y-0.5 pt-1 text-[11px] text-muted-foreground/80">
                    <p>
                      Persona encontrada:{' '}
                      <span className="text-foreground">
                        {personIdentity?.prospect_full_name || UNAVAILABLE}
                      </span>
                    </p>
                    <p>
                      Identidad enriquecida:{' '}
                      <span className="text-foreground">
                        {personIdentity?.enrich_full_name || UNAVAILABLE}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </div>
          </SurfaceCard>

          {/* 3b. Consistencia con la empresa (Hito 17A.9G) */}
          {showConsistencyWarning && companyConsistency && (
            <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    {companyConsistency.status === 'possible_related_domain'
                      ? 'Posible empresa relacionada'
                      : 'Revisar pertenencia a empresa'}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {companyConsistency.explanation}
                  </p>
                  {companyConsistency.email_domain &&
                    companyConsistency.expected_domain &&
                    companyConsistency.email_domain !== companyConsistency.expected_domain && (
                      <p className="text-[11px] text-muted-foreground/70 tabular-nums">
                        Correo: @{companyConsistency.email_domain} · Empresa: {companyConsistency.expected_domain}
                      </p>
                    )}
                </div>
              </div>
            </div>
          )}

          {/* 4. Trazabilidad */}
          <SurfaceCard>
            <SurfaceCardHeader title="Trazabilidad" />
            <dl className="space-y-3">
              <DetailRow icon={Hash} label="Candidate ID">
                <span className="font-mono text-[11px] break-all">{candidate.id}</span>
              </DetailRow>
              <DetailRow icon={Hash} label="Enrichment run ID">
                {candidate.enrichment_run_id ? (
                  <span className="font-mono text-[11px] break-all">
                    {candidate.enrichment_run_id}
                  </span>
                ) : (
                  <Fallback />
                )}
              </DetailRow>
              <DetailRow icon={Tag} label="Fuente">
                {SOURCE_LABELS[candidate.source] ?? candidate.source}
              </DetailRow>
              {apolloAttempt && (
                <DetailRow icon={UserSearch} label="Intento de búsqueda Apollo">
                  <span className="text-xs">{apolloAttempt}</span>
                </DetailRow>
              )}
              {candidate.account_id && (
                <DetailRow icon={Building2} label="SellUp Account ID">
                  <span className="font-mono text-[11px] break-all">{candidate.account_id}</span>
                </DetailRow>
              )}
              {candidate.hubspot_company_id && (
                <DetailRow icon={Globe} label="HubSpot Company ID">
                  <span className="font-mono text-[11px] break-all">
                    {candidate.hubspot_company_id}
                  </span>
                </DetailRow>
              )}
            </dl>
          </SurfaceCard>

          {/* 5. Revisión humana (Hito 17A.4B) */}
          {showRejectForm ? (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Motivo de rechazo"
                description="Quedará registrado en la trazabilidad del candidato."
              />
              <div className="space-y-3">
                <Select value={reason} onValueChange={(v) => setReason(v ?? REJECTION_REASONS[0])}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecciona un motivo" />
                  </SelectTrigger>
                  <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                    {REJECTION_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {reason === 'Otro' && (
                  <Textarea
                    value={otherComment}
                    onChange={(e) => setOtherComment(e.target.value)}
                    rows={3}
                    placeholder="Comentario opcional…"
                    className="text-sm"
                  />
                )}
              </div>
            </SurfaceCard>
          ) : !candidate.account_id && candidate.hubspot_company_id ? (
            <div className="rounded-xl border border-dashed border-su-brand/30 bg-su-brand-soft/40 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    Empresa vinculada vía HubSpot
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Al aprobar, SellUp creará o vinculará la cuenta automáticamente y asociará
                    este contacto. No se realizarán acciones hasta hacer clic en Aprobar.
                  </p>
                </div>
              </div>
            </div>
          ) : !candidate.account_id ? (
            <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    Sin cuenta SellUp asociada
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    No se puede aprobar porque la empresa no existe en SellUp ni está vinculada a
                    HubSpot. Puedes rechazarlo indicando un motivo.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Revisión humana</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Aprueba para crear el contacto oficial en SellUp, o recházalo indicando un
                    motivo.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </DrawerShell>

    <Dialog
      open={showIdentityOverrideDialog}
      onOpenChange={(v) => {
        if (busy) return;
        setShowIdentityOverrideDialog(v);
        if (!v) {
          setOverrideAcknowledged(false);
          setOverrideReason('');
          setOverrideValidationError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revisar discrepancia de identidad</DialogTitle>
          <DialogDescription>
            La identidad encontrada inicialmente y la identidad devuelta por el enriquecimiento
            no coinciden completamente. Esto no demuestra que el correo sea incorrecto, pero
            debes revisar la información antes de crear el contacto.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              checked={overrideAcknowledged}
              onCheckedChange={(v) => {
                setOverrideAcknowledged(v === true);
                setOverrideValidationError(null);
              }}
              disabled={busy}
              className="mt-0.5"
            />
            <span className="text-foreground">
              He revisado la discrepancia de identidad y decido continuar.
            </span>
          </label>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Motivo de aprobación</label>
            <Textarea
              value={overrideReason}
              onChange={(e) => {
                setOverrideReason(e.target.value);
                setOverrideValidationError(null);
              }}
              rows={3}
              placeholder="Describe brevemente qué verificaste antes de continuar."
              disabled={busy}
              className="text-sm"
            />
          </div>
          {overrideValidationError && (
            <p className="text-xs text-destructive">{overrideValidationError}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setShowIdentityOverrideDialog(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !overrideAcknowledged || overrideReason.trim().length === 0}
            onClick={handleConfirmIdentityOverride}
          >
            {approving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Aprobando…
              </>
            ) : (
              'Aprobar de todas formas'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Reveal de teléfono (PHONE-3D.4) — confirmación de costo + base de tratamiento */}
    <Dialog
      open={showPhoneRevealDialog}
      onOpenChange={(v) => {
        if (revealingPhone) return;
        if (v) setShowPhoneRevealDialog(true);
        else closePhoneRevealDialog();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revelar teléfono del candidato</DialogTitle>
          <DialogDescription>
            Esta acción puede consumir hasta {PHONE_REVEAL_MAX_CREDITS} créditos Apollo por
            candidato y trata un dato personal. Selecciona la base de tratamiento aplicable.
            Es una acción individual; no se garantiza que el proveedor entregue un número.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-foreground">Base de tratamiento</p>
            <div role="radiogroup" aria-label="Base de tratamiento" className="grid gap-2">
              {PHONE_PROCESSING_BASIS_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2.5 rounded-lg border border-input px-3 py-2 text-sm transition-colors hover:bg-accent has-[:checked]:border-su-brand has-[:checked]:bg-su-brand-soft/50"
                >
                  <input
                    type="radio"
                    name="phone-reveal-basis"
                    value={option.value}
                    checked={phoneRevealBasis === option.value}
                    disabled={revealingPhone}
                    onChange={() => {
                      setPhoneRevealBasis(option.value);
                      setPhoneRevealError(null);
                    }}
                    className="h-4 w-4 accent-su-brand"
                  />
                  <span className="flex-1 text-foreground">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          {phoneRevealBasis === 'other_approved_basis' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Justificación de la base aprobada
              </label>
              <Textarea
                value={phoneRevealNote}
                onChange={(e) => {
                  setPhoneRevealNote(e.target.value);
                  setPhoneRevealNoteError(null);
                }}
                rows={3}
                placeholder="Describe la base aprobada aplicable."
                disabled={revealingPhone}
                className="text-sm"
              />
              {phoneRevealNoteError && (
                <p className="text-xs text-destructive">{phoneRevealNoteError}</p>
              )}
            </div>
          )}
          {phoneRevealError && (
            <p className="text-xs text-destructive">{phoneRevealError}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={revealingPhone}
            onClick={closePhoneRevealDialog}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={revealingPhone}
            onClick={handlePhoneReveal}
          >
            {revealingPhone ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Revelando…
              </>
            ) : (
              `Revelar teléfono (hasta ${PHONE_REVEAL_MAX_CREDITS} créditos)`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function Fallback() {
  return <span className="text-muted-foreground/50">{UNAVAILABLE}</span>;
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
