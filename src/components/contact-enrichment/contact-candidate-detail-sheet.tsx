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
  RefreshCw,
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
import { recoverCandidatePhoneRevealNowAction } from '@/modules/contact-enrichment/phone-reveal-manual-recovery-actions';
// Fallback manual Lusha (LUSHA-PHONE-FALLBACK-1): SOLO tras `no_phone_found` de
// Apollo, admin-only, un candidato, con confirmación explícita del costo. Este
// componente nunca llama al cliente Lusha ni evalúa elegibilidad directamente —
// solo invoca el server action, que revalida todo en el core.
import { revealCandidatePhoneViaLushaFallbackAction } from '@/modules/contact-enrichment/lusha-phone-fallback-actions';
import { getLushaPhoneFallbackCopy } from './lusha-phone-fallback-copy';
// Núcleo PURO de la ventana L3 (sin imports en tiempo de ejecución, por eso es
// seguro en el bundle cliente): cliente y servidor comparten LA MISMA definición
// de "ya pasaron 2 min desde la solicitud" y no pueden desincronizarse.
import { isManualRecoveryRequestWindowOpen } from '@/modules/contact-enrichment/phone-reveal-manual-recovery-core';
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
// Refresco acotado del candidato mientras el reveal está en vuelo
// (APOLLO-PHONE-REVEAL-LIVE-REFRESH-1). Política de arranque/parada en el núcleo
// puro; los timers viven en el hook. NO llama a proveedores ni a recovery.
import {
  isPhoneRevealLiveRefreshEligible,
  PHONE_REVEAL_LIVE_REFRESH_COPY,
} from './phone-reveal-live-refresh-core';
import { usePhoneRevealLiveRefresh } from './use-phone-reveal-live-refresh';

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
  // APOLLO-PHONE-CACHE-1b: el operador tiene que poder distinguir de un vistazo
  // un número reutilizado de uno recién revelado (no se cobraron créditos).
  apollo_cache: 'Apollo reveal reutilizado',
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
 * Base legal FIJA del flujo one-click (APOLLO-PHONE-ASYNC-5). Producto eliminó
 * el modal de confirmación/selección: la revelación es individual, asíncrona y
 * se solicita con interés legítimo B2B. La base sigue viajando en el
 * payload y el server action la revalida — el cambio es UX/payload del cliente,
 * NO una relajación de las validaciones backend.
 */
const PHONE_REVEAL_PROCESSING_BASIS: PhoneProcessingBasis = 'legitimate_interest_b2b';

/**
 * Copy base del estado en vuelo (RECOVERY-CRON-1). Se declara como constante porque
 * RECOVERY-L3 lo completa de dos formas según la ventana: con punto final cuando no
 * se ofrece revisión manual, y con ", o puedes revisarlo ahora." cuando sí.
 */
const PHONE_REVEAL_IN_FLIGHT_BASE_COPY =
  'Apollo puede tardar. SellUp revisará automáticamente el resultado';

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
  /**
   * ENABLE_LUSHA_PHONE_REVEAL_FALLBACK resuelto server-side
   * (LUSHA-PHONE-FALLBACK-1). Con `false` (default de producción) el botón de
   * fallback Lusha no se renderiza.
   */
  lushaPhoneFallbackEnabled?: boolean;
  /**
   * `true` solo si el rol del actor autenticado es Administrador. Resuelto
   * server-side; el server action revalida el rol de todas formas.
   */
  lushaPhoneFallbackAuthorized?: boolean;
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
  lushaPhoneFallbackEnabled = false,
  lushaPhoneFallbackAuthorized = false,
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

  // Reveal de teléfono (APOLLO-PHONE-ASYNC-5) — flujo ONE-CLICK sin modal. Al
  // hacer clic se solicita de inmediato la revelación asíncrona con base fija
  // (interés legítimo B2B). Todo el estado es local; la autoridad real (flag,
  // rol, costo, base, do_not_contact, re-reveal) vive en el server action.
  const [revealingPhone, setRevealingPhone] = React.useState(false);
  const [phoneRevealError, setPhoneRevealError] = React.useState<string | null>(null);
  const [phoneRevealNotice, setPhoneRevealNotice] = React.useState<string | null>(null);
  // Guard síncrono contra doble clic: `revealingPhone` (estado) solo deshabilita
  // el botón tras re-render; el ref corta una segunda invocación en el mismo tick.
  const revealInFlightRef = React.useRef(false);

  // Revisión manual del resultado (APOLLO-PHONE-RECOVERY-L3). NO inicia un reveal
  // nuevo: pide al servidor que consulte AHORA el resultado del reveal en vuelo.
  // Se dispara SOLO por acto humano: ningún timer la invoca (el refresco acotado de
  // LIVE-REFRESH-1 relee el candidato, nunca llama a esta acción).
  const [recoveringPhone, setRecoveringPhone] = React.useState(false);
  const [phoneRecoveryNotice, setPhoneRecoveryNotice] = React.useState<string | null>(
    null,
  );
  const [phoneRecoveryError, setPhoneRecoveryError] = React.useState<string | null>(
    null,
  );
  const recoverInFlightRef = React.useRef(false);

  // Fallback manual Lusha (LUSHA-PHONE-FALLBACK-1). SÍNCRONO (a diferencia del
  // reveal Apollo): la respuesta llega en la misma llamada, sin webhook. Exige
  // confirmación explícita antes de ejecutar (diálogo), nunca one-click.
  const [showLushaPhoneFallbackConfirm, setShowLushaPhoneFallbackConfirm] =
    React.useState(false);
  const [revealingPhoneViaLusha, setRevealingPhoneViaLusha] = React.useState(false);
  const [lushaPhoneFallbackError, setLushaPhoneFallbackError] = React.useState<
    string | null
  >(null);
  const [lushaPhoneFallbackNotice, setLushaPhoneFallbackNotice] = React.useState<
    string | null
  >(null);
  const lushaFallbackInFlightRef = React.useRef(false);

  // Refetch silencioso (LIVE-REFRESH-1). `reloadInFlightRef` evita dos refetch
  // simultáneos y `currentCandidateIdRef` corta el setState tardío cuando el
  // drawer ya se cerró o cambió de candidato mientras la lectura se resolvía.
  const reloadInFlightRef = React.useRef<Promise<void> | null>(null);
  const currentCandidateIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    currentCandidateIdRef.current = open ? candidateId : null;
    return () => {
      currentCandidateIdRef.current = null;
    };
  }, [open, candidateId]);

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
        setRevealingPhone(false);
        setPhoneRevealError(null);
        setPhoneRevealNotice(null);
        revealInFlightRef.current = false;
        setRecoveringPhone(false);
        setPhoneRecoveryNotice(null);
        setPhoneRecoveryError(null);
        recoverInFlightRef.current = false;
      });
    }
  }, [open, candidateId]);

  /**
   * Refetch silencioso del candidato tras un reveal (no muestra el skeleton del
   * drawer). Reutiliza la misma proyección de solo lectura; si falla, conserva
   * la vista actual. Sirve para reflejar el teléfono recién revelado + su badge.
   *
   * LIVE-REFRESH-1: además del reveal y la revisión manual, ahora también lo
   * dispara el refresco acotado. Por eso deduplica — un segundo llamador se
   * cuelga del refetch ya en curso en vez de abrir otro — y comprueba que el
   * drawer siga en el mismo candidato antes de escribir estado.
   */
  const reloadCandidate = React.useCallback(async (): Promise<void> => {
    if (!candidateId) return;
    const inFlight = reloadInFlightRef.current;
    if (inFlight) return inFlight;
    const request = (async () => {
      try {
        const fresh = await getPendingContactCandidateById(candidateId);
        if (fresh && currentCandidateIdRef.current === candidateId) setCandidate(fresh);
      } catch {
        // Silencioso: mantenemos la vista actual si el refetch falla.
      }
    })();
    reloadInFlightRef.current = request;
    try {
      await request;
    } finally {
      if (reloadInFlightRef.current === request) reloadInFlightRef.current = null;
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

  // ── Reveal de teléfono (APOLLO-PHONE-ASYNC-5) — one-click, sin modal ───────
  /**
   * Traduce el resultado seguro del server action a estados de UI. El reveal es
   * ASÍNCRONO: en el camino feliz el action devuelve `requested` (solicitud
   * aceptada, esperando el webhook de Apollo). El teléfono NUNCA vuelve en el
   * resultado; un refetch silencioso refleja el estado en vuelo y, más tarde, el
   * número cuando el webhook complete. No se hace console.log del resultado.
   */
  function applyPhoneRevealResult(
    result: Awaited<ReturnType<typeof revealCandidatePhoneAction>>,
  ) {
    switch (result.status) {
      case 'requested':
        toast.success('Revelación solicitada. Apollo puede tardar algunos minutos.');
        setPhoneRevealNotice('Apollo puede tardar algunos minutos.');
        void reloadCandidate();
        return;
      case 'already_pending':
        toast.info('Ya hay una revelación en proceso para este candidato.');
        setPhoneRevealNotice('Apollo puede tardar algunos minutos.');
        void reloadCandidate();
        return;
      case 'already_revealed':
        toast.warning('Este teléfono ya fue revelado.');
        void reloadCandidate();
        return;
      // APOLLO-PHONE-CACHE-1b: éxito terminal servido desde un reveal ya pagado.
      // No hay webhook que esperar y no se cobraron créditos, así que el
      // candidato se recarga de inmediato para mostrar el número.
      case 'revealed_from_cache':
        toast.success('Teléfono obtenido de una revelación previa. Sin costo adicional.');
        setPhoneRevealNotice('Reutilizado de una revelación anterior (sin costo).');
        void reloadCandidate();
        return;
      // APOLLO-PHONE-CACHE-1b: bloqueo seguro por supresión (DSAR). No es un
      // fallo genérico y NO se llamó a Apollo: el mensaje tiene que decir por qué.
      case 'blocked_suppressed':
        toast.warning('Existe una supresión registrada para este teléfono.');
        setPhoneRevealError(
          'No se puede revelar este teléfono porque existe una supresión registrada.',
        );
        return;
      // APOLLO-PHONE-CACHE-1b (FIX 2): no se pudo verificar si hay una supresión
      // registrada, así que NO se llamó a Apollo. Ocurre con el flag de caché
      // encendido o apagado: el flag gobierna la reutilización, no el
      // cumplimiento de la supresión. Sin cargo y reintentable.
      case 'suppression_check_unavailable':
        setPhoneRevealError(
          'No fue posible verificar si existe una supresión registrada para este teléfono. No se hizo ningún cargo; intenta de nuevo en unos minutos.',
        );
        return;
      // APOLLO-PHONE-CACHE-1b (FIX H4 + H4-b): no se pudo consultar la caché, o
      // no se pudo persistir el número reutilizado. En ambos casos NO se llamó a
      // Apollo y no hubo cargo, no hay teléfono nuevo que mostrar y no se recarga
      // el candidato (no se persistió nada). Reintentable. El mensaje es único a
      // propósito: el operador no gana nada distinguiendo lectura de escritura, y
      // el detalle técnico solo viaja al log del servidor, sin PII.
      case 'cache_unavailable':
        setPhoneRevealError(
          'No fue posible usar la caché de teléfonos. No se hizo ningún cargo; intenta de nuevo en unos minutos.',
        );
        return;
      case 'do_not_contact':
        toast.warning('Este candidato/contacto está marcado como no contactar.');
        setPhoneRevealError('Este candidato está marcado como no contactar.');
        return;
      case 'disabled':
        setPhoneRevealError('La revelación de teléfono no está activada.');
        return;
      case 'provider_not_configured':
        setPhoneRevealError('La revelación de teléfono no está configurada.');
        return;
      case 'unauthorized_role':
        setPhoneRevealError('No tienes permisos para revelar teléfonos.');
        return;
      case 'cost_confirmation_required':
        setPhoneRevealError('Debes confirmar el costo para continuar.');
        return;
      case 'processing_basis_required':
      case 'invalid_processing_basis':
      case 'processing_basis_note_required':
      case 'insufficient_identity':
      default:
        // error, insufficient_identity, base inválida, candidate_not_found,
        // candidate_account_invalid, invalid_candidate → mensaje seguro único.
        setPhoneRevealError('No fue posible solicitar la revelación del teléfono.');
    }
  }

  /**
   * Solicita la revelación asíncrona en UN clic (sin modal). Base FIJA (interés
   * legítimo B2B); el server action revalida flag/rol/costo/base/do_not_contact/
   * re-reveal. Payload mínimo: id + confirmCost + créditos + base. NUNCA se envía
   * teléfono, email, LinkedIn, nombre ni payload crudo. El ref corta un segundo
   * clic antes de que el botón se deshabilite por re-render.
   */
  async function handlePhoneReveal() {
    if (!candidate || revealInFlightRef.current) return;
    revealInFlightRef.current = true;
    setPhoneRevealError(null);
    setPhoneRevealNotice(null);
    setRevealingPhone(true);
    try {
      const result = await revealCandidatePhoneAction({
        candidateId: candidate.id,
        confirmCost: true,
        expectedMaxCredits: PHONE_REVEAL_MAX_CREDITS,
        phoneProcessingBasis: PHONE_REVEAL_PROCESSING_BASIS,
        phoneProcessingBasisNote: undefined,
      });
      applyPhoneRevealResult(result);
    } catch {
      setPhoneRevealError('No fue posible revelar el teléfono.');
    } finally {
      revealInFlightRef.current = false;
      setRevealingPhone(false);
    }
  }

  // ── Revisión manual del resultado (APOLLO-PHONE-RECOVERY-L3) ───────────────
  /**
   * Traduce el resultado seguro de `recoverCandidatePhoneRevealNowAction` a copy en
   * español. El action NO inicia un reveal nuevo y no devuelve el teléfono: cuando
   * el resultado es terminal, el refetch silencioso refleja el estado (y el número,
   * si Apollo lo entregó) con el mismo comportamiento que ya existía.
   */
  function applyPhoneRecoveryResult(
    result: Awaited<ReturnType<typeof recoverCandidatePhoneRevealNowAction>>,
  ) {
    switch (result.status) {
      case 'revealed':
        toast.success('Teléfono revelado.');
        void reloadCandidate();
        return;
      // El candidato pasa a terminal `no_phone_found`: al recargar, el estado ya
      // muestra "Teléfono no disponible tras consultar Apollo." No se duplica copy.
      case 'no_phone_found':
        void reloadCandidate();
        return;
      case 'still_pending':
        setPhoneRecoveryNotice(
          result.retryAfterSeconds
            ? `Apollo aún está procesando el resultado. Apollo sugirió volver a revisar en aproximadamente ${result.retryAfterSeconds} segundos.`
            : 'Apollo aún está procesando el resultado. Intenta nuevamente más tarde.',
        );
        void reloadCandidate();
        return;
      // Supresión registrada (DSAR): no es un fallo genérico y no se persistió
      // ningún teléfono. Mismo mensaje que el camino equivalente del reveal.
      case 'blocked_suppressed':
        toast.warning('Existe una supresión registrada para este teléfono.');
        setPhoneRecoveryError(
          'No se puede revelar este teléfono porque existe una supresión registrada.',
        );
        void reloadCandidate();
        return;
      // Todavía no toca (ventana de 2 min o revisión demasiado reciente) o el
      // candidato dejó de ser elegible entre el render y el clic.
      case 'not_eligible':
        setPhoneRecoveryNotice(
          result.retryAfterSeconds
            ? `El resultado aún puede estar procesándose. Vuelve a intentarlo en aproximadamente ${result.retryAfterSeconds} segundos.`
            : 'El resultado aún puede estar procesándose. Vuelve a revisar en unos minutos.',
        );
        void reloadCandidate();
        return;
      case 'error':
      default:
        setPhoneRecoveryError('No pudimos revisar el resultado. Intenta más tarde.');
    }
  }

  /**
   * Pide al servidor revisar AHORA el resultado del reveal en vuelo. Un solo
   * candidato, una sola invocación por clic: el ref corta un segundo clic en el
   * mismo tick y el backend aplica además su propia ventana anti-abuso. NO inicia
   * reveals, NO consume créditos de reveal y NO envía datos del contacto: el
   * payload es únicamente el id del candidato.
   */
  async function handleRecoverPhoneNow() {
    if (!candidate || recoverInFlightRef.current) return;
    recoverInFlightRef.current = true;
    setPhoneRecoveryError(null);
    setPhoneRecoveryNotice(null);
    setRecoveringPhone(true);
    try {
      const result = await recoverCandidatePhoneRevealNowAction({
        candidateId: candidate.id,
      });
      applyPhoneRecoveryResult(result);
    } catch {
      setPhoneRecoveryError('No pudimos revisar el resultado. Intenta más tarde.');
    } finally {
      recoverInFlightRef.current = false;
      setRecoveringPhone(false);
    }
  }

  // ── Fallback manual Lusha (LUSHA-PHONE-FALLBACK-1) ─────────────────────────
  /**
   * Traduce el resultado seguro del server action a copy en español. El
   * teléfono NUNCA vuelve en el resultado: en éxito (`revealed`) se recarga el
   * candidato para mostrarlo. La mayoría de los códigos de bloqueo no deberían
   * alcanzarse desde esta UI (el botón ya los pre-filtra), pero el server
   * revalida todo — así que se traducen igual, con un mensaje único y seguro
   * para los casos residuales.
   */
  function applyLushaPhoneFallbackResult(
    result: Awaited<ReturnType<typeof revealCandidatePhoneViaLushaFallbackAction>>,
  ) {
    switch (result.status) {
      case 'revealed':
        toast.success('Teléfono revelado con Lusha.');
        setLushaPhoneFallbackNotice(null);
        void reloadCandidate();
        return;
      case 'no_phone_found':
        setLushaPhoneFallbackNotice('Lusha tampoco encontró un teléfono para este candidato.');
        void reloadCandidate();
        return;
      case 'feature_disabled':
        setLushaPhoneFallbackError('El fallback de Lusha no está activado.');
        return;
      case 'unauthorized_role':
        setLushaPhoneFallbackError('No tienes permisos para usar el fallback de Lusha.');
        return;
      case 'missing_cost_confirmation':
        setLushaPhoneFallbackError('Debes confirmar el costo para continuar.');
        return;
      case 'existing_phone_present':
        toast.warning('Este candidato ya tiene un teléfono registrado.');
        void reloadCandidate();
        return;
      case 'apollo_not_exhausted':
      case 'missing_lusha_contact_id':
      case 'candidate_not_editable':
      case 'candidate_not_found':
      case 'invalid_candidate':
      case 'bulk_not_allowed':
      case 'waiting_lusha_ticket':
      case 'lusha_id_reuse_unconfirmed':
      case 'entitlement_unconfirmed':
      case 'error':
      default:
        setLushaPhoneFallbackError(
          'No fue posible revelar el teléfono con Lusha. Intenta más tarde.',
        );
    }
  }

  /** Abre el diálogo de confirmación (nunca ejecuta la acción directamente). */
  function handleLushaPhoneFallback() {
    setLushaPhoneFallbackError(null);
    setLushaPhoneFallbackNotice(null);
    setShowLushaPhoneFallbackConfirm(true);
  }

  /**
   * Ejecuta el fallback tras la confirmación explícita del operador. Un
   * candidato, una sola invocación por clic: el ref corta un segundo clic en
   * el mismo tick y `revealingPhoneViaLusha` deshabilita el botón tras el
   * re-render. NUNCA envía teléfono, email, LinkedIn ni payload crudo — solo
   * el id del candidato y la confirmación de costo.
   */
  async function handleConfirmLushaPhoneFallback() {
    if (!candidate || lushaFallbackInFlightRef.current) return;
    lushaFallbackInFlightRef.current = true;
    setRevealingPhoneViaLusha(true);
    try {
      const result = await revealCandidatePhoneViaLushaFallbackAction({
        candidateId: candidate.id,
        confirmCost: true,
      });
      applyLushaPhoneFallbackResult(result);
    } catch {
      setLushaPhoneFallbackError(
        'No fue posible revelar el teléfono con Lusha. Intenta más tarde.',
      );
    } finally {
      lushaFallbackInFlightRef.current = false;
      setRevealingPhoneViaLusha(false);
      setShowLushaPhoneFallbackConfirm(false);
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

  // Identidad suficiente para intentar un reveal Apollo (PHONE-3D.6B). Espejo
  // EXACTO del gate del server (`buildApolloPhoneRevealMatchParams`): basta un
  // identificador fuerte — source_contact_id del proveedor, email o LinkedIn. El
  // nombre + empresa por sí solos NO cuentan. La FUENTE del candidato (Apollo /
  // Lusha / …) es IRRELEVANTE: un candidato Lusha con email o LinkedIn tiene
  // identidad suficiente porque el reveal lo ejecuta Apollo con esos datos.
  const hasSufficientPhoneRevealIdentity =
    !!candidate?.source_contact_id?.trim() ||
    !!candidate?.email?.trim() ||
    !!candidate?.linkedin_url?.trim();

  // Elegibilidad del botón "Revelar teléfono" (PHONE-3D.4 → PHONE-3D.6B).
  // Alineada con la reachability real del server action: NO exige que el
  // candidato venga de Apollo, NI que el run tenga account_id resuelto (el
  // server revalida cuenta / rol / do_not_contact / re-reveal). Fail-closed en
  // lo esencial (créditos + re-reveal + identidad):
  //  - flag OFF (o rol no autorizado) → oculto (no gasta créditos).
  //  - ya revelado (status `revealed` o fuente `apollo_reveal`) → oculto.
  //  - `no_phone_found` → oculto (sin reintento).
  //  - identidad insuficiente (sin id/email/linkedin) → oculto.
  // El server action revalida todos estos gates de todas formas.
  // `apollo_cache` cuenta como ya revelado (APOLLO-PHONE-CACHE-1b): el número
  // reutilizado es definitivo, así que el botón no debe reaparecer y gastar
  // créditos por un dato que ya tenemos.
  const phoneAlreadyRevealed =
    candidate?.phone_reveal_status === 'revealed' ||
    phoneMeta?.source === 'apollo_reveal' ||
    phoneMeta?.source === 'apollo_cache';
  const phoneRevealExhausted = candidate?.phone_reveal_status === 'no_phone_found';
  // Reveal ASÍNCRONO en vuelo (APOLLO-PHONE-ASYNC-1): solicitud aceptada,
  // esperando el webhook de Apollo. Oculta el botón y muestra "en proceso".
  const phoneRevealInFlight =
    candidate?.phone_reveal_status === 'requested' ||
    candidate?.phone_reveal_status === 'pending';

  // Refresco acotado del candidato en vuelo (APOLLO-PHONE-REVEAL-LIVE-REFRESH-1).
  // El backend ya cierra el reveal por webhook en decenas de segundos; sin esto el
  // drawer seguía diciendo "Revelación en proceso" hasta recargar la página. Solo
  // relee el candidato YA abierto: no llama a Apollo, no llama a recovery y no
  // inicia reveals. Se apaga solo al llegar un estado terminal, al aparecer un
  // teléfono, al cerrar el drawer, al cambiar de candidato y al agotar su
  // presupuesto de tiempo (no hay bucle infinito ni setInterval).
  const liveRefreshEligible = isPhoneRevealLiveRefreshEligible({
    phoneRevealStatus: candidate?.phone_reveal_status ?? null,
    hasPhone,
    busy,
  });
  const liveRefreshActive = usePhoneRevealLiveRefresh({
    enabled: open && !!candidate && liveRefreshEligible,
    candidateId,
    reload: reloadCandidate,
  });
  // Última comprobación del recovery (RECOVERY-CRON-1). Solo informativa: se
  // muestra mientras el reveal está en vuelo para que el usuario sepa que hay algo
  // vigilando el caso. NO reactiva el botón ni cambia la elegibilidad.
  const phoneRevealLastCheckedAt = candidate?.phone_reveal_last_checked_at ?? null;
  // Revisión manual L3 (APOLLO-PHONE-RECOVERY-L3). El CTA solo aparece cuando:
  //  - el reveal sigue en vuelo (requested / pending),
  //  - el rol está autorizado (mismo criterio que el reveal; el server revalida),
  //  - existe id de correlación con el que recuperar el resultado (booleano
  //    derivado: el id nunca llega al cliente),
  //  - y ya pasaron al menos 2 min desde la solicitud.
  // La ventana se evalúa con el MISMO núcleo puro que usa el backend. Se calcula en
  // el render, sin timer propio: si el usuario abre el panel antes de los 2 min ve
  // el mensaje de espera, y el CTA aparece la próxima vez que el panel se renderice
  // (reabrirlo o refrescar el candidato). El refresco acotado de LIVE-REFRESH-1 NO
  // invoca esta acción: solo relee el candidato, y su presupuesto se agota antes de
  // los 2 min, así que no puede "abrir" el CTA por su cuenta.
  const phoneRecoveryRequestWindowOpen =
    phoneRevealInFlight &&
    isManualRecoveryRequestWindowOpen(
      candidate?.phone_reveal_requested_at ?? null,
      new Date().toISOString(),
    );
  const canOfferPhoneRecovery =
    phoneRevealInFlight &&
    phoneRevealAuthorized === true &&
    candidate?.phone_reveal_recovery_id_present === true &&
    phoneRecoveryRequestWindowOpen;
  const canOfferPhoneReveal =
    !!candidate &&
    phoneRevealEnabled === true &&
    phoneRevealAuthorized === true &&
    hasSufficientPhoneRevealIdentity &&
    !phoneAlreadyRevealed &&
    !phoneRevealExhausted &&
    !phoneRevealInFlight;

  // Elegibilidad de UI del fallback Lusha (LUSHA-PHONE-FALLBACK-1). Solo un
  // pre-filtro visual — el server action revalida todo (incluida la
  // procedencia real del id) en runLushaPhoneFallbackReveal. Requiere:
  //  - flag ON + rol admin (resueltos server-side);
  //  - Apollo ya agotado (`no_phone_found`), nunca mientras esté en vuelo;
  //  - sin teléfono ya persistido;
  //  - candidato de origen Lusha con un id propio (un candidato Apollo nunca
  //    reenvía su id a Lusha — son espacios de id distintos).
  const hasLushaContactId =
    candidate?.source === 'lusha' && !!candidate?.source_contact_id?.trim();
  const canOfferLushaPhoneFallback =
    !!candidate &&
    lushaPhoneFallbackEnabled === true &&
    lushaPhoneFallbackAuthorized === true &&
    phoneRevealExhausted &&
    !phoneRevealInFlight &&
    !hasPhone &&
    hasLushaContactId;
  const lushaPhoneFallbackCopy = getLushaPhoneFallbackCopy();
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
                  {phoneRevealInFlight && (
                    <div className="space-y-1">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge className="border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          Revelación en proceso
                        </Badge>
                        {/* Copy honesto (RECOVERY-CRON-1): el resultado NO llega
                            por esta pantalla. El webhook de Apollo puede no
                            aterrizar nunca; quien cierra el caso es el recovery
                            programado del servidor. Antes decía solo "Apollo puede
                            tardar algunos minutos", lo que hacía pensar que el
                            spinner se resolvería solo si se esperaba aquí.
                            RECOVERY-L3: cuando la ventana de 2 min ya pasó, el
                            copy además ofrece revisarlo ahora. */}
                        <span className="text-[11px] text-muted-foreground">
                          {canOfferPhoneRecovery
                            ? `${PHONE_REVEAL_IN_FLIGHT_BASE_COPY}, o puedes revisarlo ahora.`
                            : `${PHONE_REVEAL_IN_FLIGHT_BASE_COPY}.`}
                        </span>
                      </span>
                      {/* LIVE-REFRESH-1: mientras el refresco acotado está activo
                          se dice explícitamente, para que el spinner no parezca
                          congelado. Es solo informativo: no habilita ninguna
                          acción nueva ni cambia la elegibilidad del CTA L3. */}
                      {liveRefreshActive && (
                        <p className="text-[11px] text-muted-foreground/70">
                          {PHONE_REVEAL_LIVE_REFRESH_COPY}
                        </p>
                      )}
                      {phoneRevealLastCheckedAt && (
                        <p className="text-[11px] text-muted-foreground/70">
                          Última revisión: {formatDate(phoneRevealLastCheckedAt)}
                        </p>
                      )}
                      {/* Antes de la ventana de 2 min (o sin id de correlación) no
                          se ofrece revisión manual: solo se explica la espera. */}
                      {!canOfferPhoneRecovery && (
                        <>
                          <p className="text-[11px] text-muted-foreground/70">
                            El resultado aún puede estar procesándose. Vuelve a revisar
                            en unos minutos.
                          </p>
                          <p className="text-[11px] text-muted-foreground/70">
                            Vuelve a abrir el candidato más tarde para ver el resultado.
                          </p>
                        </>
                      )}
                      {/* CTA secundaria de revisión manual (APOLLO-PHONE-RECOVERY-L3).
                          NO inicia un reveal nuevo: pide al servidor consultar el
                          resultado ya producido. Un clic = una invocación (el ref y
                          `recoveringPhone` bloquean el doble clic; el backend además
                          aplica su ventana anti-abuso). Sin timers ni polling. */}
                      {canOfferPhoneRecovery && (
                        <div className="space-y-1.5 pt-0.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            disabled={busy || recoveringPhone}
                            onClick={handleRecoverPhoneNow}
                          >
                            {recoveringPhone ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Revisando…
                              </>
                            ) : (
                              <>
                                <RefreshCw className="h-3.5 w-3.5" />
                                Revisar resultado ahora
                              </>
                            )}
                          </Button>
                          <p className="text-[11px] text-muted-foreground/70">
                            Consulta el resultado ya solicitado. No inicia una
                            revelación nueva ni consume créditos de revelación.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {phoneRevealExhausted && !phoneRevealInFlight && (
                    <p className="text-[11px] text-muted-foreground">
                      Teléfono no disponible tras consultar Apollo.
                    </p>
                  )}
                  {phoneRevealNotice && !phoneRevealInFlight && (
                    <p className="text-[11px] text-muted-foreground">{phoneRevealNotice}</p>
                  )}
                  {/* Fallback manual Lusha (LUSHA-PHONE-FALLBACK-1). Solo tras
                      `no_phone_found` de Apollo, admin-only, con diálogo de
                      confirmación obligatorio (nunca one-click). */}
                  {canOfferLushaPhoneFallback && (
                    <div className="space-y-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        disabled={busy || revealingPhoneViaLusha}
                        onClick={handleLushaPhoneFallback}
                      >
                        <PhoneCall className="h-3.5 w-3.5" />
                        {lushaPhoneFallbackCopy.buttonLabel}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        {lushaPhoneFallbackCopy.phoneTypeWarning}
                      </p>
                      {lushaPhoneFallbackNotice && (
                        <p className="text-[11px] text-muted-foreground">
                          {lushaPhoneFallbackNotice}
                        </p>
                      )}
                      {lushaPhoneFallbackError && (
                        <p className="text-[11px] text-destructive">{lushaPhoneFallbackError}</p>
                      )}
                    </div>
                  )}
                  {/* Mensajes de la revisión manual (L3). Viven FUERA del bloque en
                      vuelo para que sigan visibles cuando el resultado ya cerró el
                      caso y el candidato deja de estar en `requested`/`pending`. */}
                  {phoneRecoveryNotice && (
                    <p className="text-[11px] text-muted-foreground">
                      {phoneRecoveryNotice}
                    </p>
                  )}
                  {phoneRecoveryError && (
                    <p className="text-[11px] text-destructive">{phoneRecoveryError}</p>
                  )}
                  {canOfferPhoneReveal && (
                    <div className="space-y-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        disabled={busy || revealingPhone}
                        onClick={handlePhoneReveal}
                      >
                        {revealingPhone ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Solicitando…
                          </>
                        ) : (
                          <>
                            <PhoneCall className="h-3.5 w-3.5" />
                            Revelar teléfono
                          </>
                        )}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        Consulta individual con Apollo. Puede consumir hasta{' '}
                        {PHONE_REVEAL_MAX_CREDITS} créditos y tardar algunos minutos.
                      </p>
                      <p className="text-[11px] text-muted-foreground/70">
                        Base aplicada: interés legítimo B2B.
                      </p>
                      {phoneRevealError && (
                        <p className="text-[11px] text-destructive">{phoneRevealError}</p>
                      )}
                    </div>
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

    <Dialog
      open={showLushaPhoneFallbackConfirm}
      onOpenChange={(v) => {
        if (revealingPhoneViaLusha) return;
        setShowLushaPhoneFallbackConfirm(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lushaPhoneFallbackCopy.buttonLabel}</DialogTitle>
          <DialogDescription>{lushaPhoneFallbackCopy.costConfirmationMessage}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {lushaPhoneFallbackCopy.phoneTypeWarning} Es una acción individual, no masiva.
        </p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={revealingPhoneViaLusha}
            onClick={() => setShowLushaPhoneFallbackConfirm(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={revealingPhoneViaLusha}
            onClick={handleConfirmLushaPhoneFallback}
          >
            {revealingPhoneViaLusha ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Revelando…
              </>
            ) : (
              'Confirmar y revelar'
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
