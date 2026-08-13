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
  getReviewableContactCandidateById,
  getDuplicateCandidateMergeOffer,
  approveContactCandidate,
  mergeContactCandidateIntoExistingContactAction,
  discardContactCandidate,
} from '@/modules/contact-enrichment/actions';
import type { ExistingContactMergeOffer } from '@/modules/contact-enrichment/candidate-review-core';
import { revealCandidatePhoneAction } from '@/modules/contact-enrichment/phone-reveal-actions';
import { recoverCandidatePhoneRevealNowAction } from '@/modules/contact-enrichment/phone-reveal-manual-recovery-actions';
// Fallback manual Lusha (LUSHA-PHONE-FALLBACK-1): SOLO tras `no_phone_found` de
// Apollo, admin-only, un candidato, con confirmación explícita del costo. Este
// componente nunca llama al cliente Lusha ni evalúa elegibilidad directamente —
// solo invoca el server action, que revalida todo en el core.
import { revealCandidatePhoneViaLushaFallbackAction } from '@/modules/contact-enrichment/lusha-phone-fallback-actions';
import {
  getLushaPhoneFallbackCopy,
  LUSHA_PHONE_FALLBACK_MAX_CREDITS,
} from './lusha-phone-fallback-copy';
// Waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1 · 4D). UN solo botón y NINGÚN
// modal: el clic ejecuta, y SellUp intenta Apollo y, si Apollo no encuentra teléfono,
// Lusha automáticamente por debajo (server-side). Este componente NO orquesta el
// waterfall: solo dispara el mismo server action del reveal Apollo y LEE la auditoría
// de la corrida.
import { getPhoneRevealWaterfallAuditAction } from '@/modules/contact-enrichment/phone-reveal-waterfall-actions';
// «Ver más números» (AGENT2A-PHONE-REVEAL-4O-G). SOLO lectura de teléfonos YA
// almacenados por 4O-C/4O-D: 0 llamadas a proveedor, 0 corridas, 0 reservas,
// 0 créditos y 0 escrituras. El resumen es un entero y decide si el CTA existe;
// los números no viajan al navegador hasta que el operador abre el disclosure.
import { getCandidateStoredPhoneSummaryAction } from '@/modules/contact-enrichment/candidate-stored-phones-actions';
import { CandidateStoredPhonesDisclosure } from './candidate-stored-phones-disclosure';
import { resolvePhoneSourceLabel, resolvePhoneTypeLabel } from './phone-display-labels';
// Compatibilidad legacy (AGENT2A-PHONE-WATERFALL-2): con el waterfall encendido el
// botón manual separado de Lusha desaparece, así que un candidato cuyo Apollo YA
// terminó `no_phone_found` antes de que existiera la corrida se quedaría sin ninguna
// vía. Esta acción autoriza SOLO la pata Lusha (tope 5) reutilizando el MISMO botón
// único. El servidor revalida flag, rol admin y evidencia persistida.
import { startLegacyPhoneRevealWaterfallAction } from '@/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions';
// El core del waterfall es PURO por contrato (sin I/O, sin Supabase, sin fetch, sin
// process.env), así que importar de él una función de clasificación es seguro en el
// bundle cliente — y es preferible a duplicar la regla de reautorización en la UI.
import {
  classifyPhoneRevealWaterfallLegacyHistory,
  type PhoneRevealWaterfallAuditView,
} from '@/modules/contact-enrichment/phone-reveal-waterfall-core';
import {
  CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY,
  CANDIDATE_DETAIL_LOAD_ERROR_TITLE_COPY,
  CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY,
  CANDIDATE_DETAIL_NOT_FOUND_TITLE_COPY,
  type CandidateDetailLoadOutcome,
} from './contact-candidate-detail-load-copy';
import {
  formatWaterfallLegCredits,
  getPhoneRevealWaterfallAuthorizationCopy,
  resolveWaterfallFinalProviderLabel,
  resolveWaterfallLushaSkippedLabel,
  resolveWaterfallOutcomeLabel,
  PHONE_REVEAL_WATERFALL_APOLLO_RUNNING_COPY,
  PHONE_REVEAL_WATERFALL_APPROVE_BLOCKED_COPY,
  PHONE_REVEAL_WATERFALL_BLOCKED_COPY,
  PHONE_REVEAL_WATERFALL_BUDGET_NOT_CONFIGURED_COPY,
  PHONE_REVEAL_WATERFALL_CREDIT_BALANCE_UNAVAILABLE_COPY,
  PHONE_REVEAL_WATERFALL_ERROR_COPY,
  PHONE_REVEAL_WATERFALL_EXHAUSTED_COPY,
  PHONE_REVEAL_WATERFALL_INFRASTRUCTURE_UNAVAILABLE_COPY,
  PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_AUDIT_COPY,
  PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_COST_COPY,
  PHONE_REVEAL_WATERFALL_LUSHA_RUNNING_COPY,
  PHONE_REVEAL_WATERFALL_REQUESTING_COPY,
  PHONE_REVEAL_WATERFALL_REVEALED_COPY,
  PHONE_REVEAL_WATERFALL_SUPPRESSION_UNVERIFIED_COPY,
} from './phone-reveal-waterfall-copy';
// Núcleo PURO de la ventana L3 (sin imports en tiempo de ejecución, por eso es
// seguro en el bundle cliente): cliente y servidor comparten LA MISMA definición
// de "ya pasaron 2 min desde la solicitud" y no pueden desincronizarse.
import { isManualRecoveryRequestWindowOpen } from '@/modules/contact-enrichment/phone-reveal-manual-recovery-core';
import { isCandidateCreatedToday } from '@/modules/contact-enrichment/candidate-date-utils';
import type {
  PendingContactCandidate,
  ContactRelevanceStatus,
  ContactDuplicateStatus,
  ContactSource,
  ContactCandidateCompanyConsistency,
  LushaPersonIdentityEvidenceV1,
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
import {
  shouldClearLocalPhoneRevealState,
  PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY,
} from './phone-reveal-drawer-sync-core';
import { usePhoneRevealWindowRefresh } from './use-phone-reveal-window-refresh';

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

/**
 * Etiqueta de `candidate.source` (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 8.1).
 *
 * Antes era sólo «Fuente», y esa ambigüedad hacía leer «Fuente: Lusha» como
 * "Lusha consiguió este teléfono" incluso cuando el reveal lo había ejecutado
 * Apollo. `candidate.source` y `phone_reveal_provider` son ejes INDEPENDIENTES:
 * quién descubrió a la persona no dice nada de quién reveló (o intentó revelar)
 * su teléfono.
 */
const CANDIDATE_SOURCE_LABEL = 'Fuente del candidato';

/**
 * Etiqueta de `phone_reveal_provider` (§ 8.2). Vive en la sección de Teléfono,
 * separada de la fuente del candidato, y sólo se muestra cuando existe un intento
 * real: sin intento no se infiere desde `candidate.source`, porque inferirlo es
 * precisamente el error que este hito corrige.
 */
const PHONE_REVEAL_PROVIDER_LABEL = 'Proveedor de revelación';

/**
 * Nombres visibles de los proveedores de revelación. Deliberadamente separado de
 * `SOURCE_LABELS` (aunque hoy coincida en Apollo/Lusha) para que ampliar el
 * vocabulario de uno no arrastre al otro: son dos dominios distintos.
 */
const PHONE_REVEAL_PROVIDER_LABELS: Record<string, string> = {
  apollo: 'Apollo',
  lusha: 'Lusha',
};

/**
 * Traduce `phone_reveal_provider` a su nombre visible, o `null` cuando NO hay
 * intento de revelación registrado.
 *
 * Fail-closed: ausente, vacío o desconocido ⇒ `null` ⇒ la línea no se renderiza.
 * Un código desconocido no se muestra crudo: preferimos omitir el dato antes que
 * mostrar un valor que el operador no pueda interpretar.
 */
function resolvePhoneRevealProviderLabel(
  provider: string | null | undefined,
): string | null {
  if (typeof provider !== 'string') return null;
  const normalized = provider.trim().toLowerCase();
  if (!normalized) return null;
  return PHONE_REVEAL_PROVIDER_LABELS[normalized] ?? null;
}

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
//
// AGENT2A-PHONE-REVEAL-4O-G: los mapas y sus resolvers viven ahora en
// `phone-display-labels.ts`, sin cambiar un solo valor. El disclosure «Ver más
// números» muestra teléfonos en otra superficie y tiene que rotularlos EXACTAMENTE
// igual; dos copias del mismo mapa habrían divergido en el primer renombrado.

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
  /**
   * ENABLE_PHONE_REVEAL_WATERFALL resuelto server-side
   * (AGENT2A-PHONE-WATERFALL-1). Con `false` (default de producción) la UI es
   * EXACTAMENTE la anterior al waterfall: reveal Apollo one-click + botón manual
   * de Lusha cuando aplica.
   */
  phoneRevealWaterfallEnabled?: boolean;
  /**
   * `true` solo si el rol del actor autenticado es Administrador — el waterfall
   * completo es admin-only. Un `commercial_manager` conserva el flujo Apollo-only.
   * Resuelto server-side; el server revalida el rol de todas formas.
   */
  phoneRevealWaterfallAuthorized?: boolean;
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
  phoneRevealWaterfallEnabled = false,
  phoneRevealWaterfallAuthorized = false,
}: ContactCandidateDetailSheetProps) {
  const router = useRouter();
  const [candidate, setCandidate] = React.useState<PendingContactCandidate | null>(null);
  const [loading, setLoading] = React.useState(false);
  /**
   * AGENT2A-PROD-INCIDENT: antes era un `notFound` booleano que mezclaba «ya no
   * está en revisión» con «la lectura falló». Ahora el estado dice CUÁL de los
   * dos fue, que es lo que separa un aviso informativo de un fallo accionable.
   */
  const [loadOutcome, setLoadOutcome] =
    React.useState<CandidateDetailLoadOutcome | null>(null);

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

  // Duplicado con contacto existente (AGENT2A-PHONE-REVEAL-4O-H3-B). El veredicto no cambia —
  // el candidato pasa a `duplicate` igual que antes de este hito —, pero cuando la identidad del
  // contacto existente es exacta e inequívoca el humano puede además AGREGARLE la información en
  // vez de limitarse a descartar. Este estado sólo controla el diálogo: la decisión de si la
  // acción es siquiera ofrecible la toma el servidor, y volverá a tomarla al ejecutarla.
  const [duplicateDecision, setDuplicateDecision] = React.useState<{
    contactId: string;
    signal: 'email' | 'linkedin';
  } | null>(null);
  const [mergingIntoExisting, setMergingIntoExisting] = React.useState(false);
  const mergeInFlightRef = React.useRef(false);

  /**
   * 4O-H3-B-R1 — la oferta DURADERA, releída del servidor cada vez que se abre un candidato ya
   * marcado como `duplicate`.
   *
   * `duplicateDecision` (arriba) sólo vive el instante posterior a la detección; si el operador
   * cerraba el drawer, la decisión desaparecía. Esta es la que sobrevive a un refresh y a navegar
   * a otra parte: el servidor vuelve a resolver la identidad con las mismas reglas exactas y la
   * UI sólo pinta lo que él autoriza.
   */
  const [durableMergeOffer, setDurableMergeOffer] =
    React.useState<ExistingContactMergeOffer | null>(null);

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

  // Actualización manual DESDE LA BASE (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 6). No
  // confundir con "Revisar resultado ahora": esto SOLO relee el candidato en
  // SellUp. Contrato: 0 llamadas a Apollo, 0 a Lusha, 0 usage logs, 0 créditos, 0
  // escrituras. Es la salida honesta cuando la actualización automática ya terminó.
  const [refreshingFromDatabase, setRefreshingFromDatabase] = React.useState(false);

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

  // Waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1). `waterfallAudit` es la
  // proyección PII-free de la corrida (qué intentó cada proveedor, qué costó cada
  // pata, cuál fue el final). Es la ÚNICA fuente de la que la UI puede saber que
  // Lusha está corriendo: el candidato sigue en `no_phone_found` mientras la 2ª
  // pata trabaja, porque un resultado sin teléfono no debe pisar su estado.
  // 4D: ya no hay estado de modal. El clic ejecuta, así que lo único que queda es la
  // auditoría de la corrida.
  const [waterfallAudit, setWaterfallAudit] =
    React.useState<PhoneRevealWaterfallAuditView | null>(null);

  // Teléfonos adicionales YA almacenados (AGENT2A-PHONE-REVEAL-4O-G). Sólo el
  // CONTEO: los números se piden aparte, y sólo si el operador abre el disclosure.
  const [storedPhoneAdditionalCount, setStoredPhoneAdditionalCount] =
    React.useState<number>(0);

  // Ruta legacy solo-Lusha (AGENT2A-PHONE-WATERFALL-2). SÍNCRONA como el fallback
  // manual de Lusha (sin webhook: Lusha responde en la misma llamada), pero se
  // dispara desde el MISMO botón único que el waterfall.
  const [revealingLegacyPhone, setRevealingLegacyPhone] = React.useState(false);
  const [legacyWaterfallError, setLegacyWaterfallError] = React.useState<
    string | null
  >(null);
  const [legacyWaterfallNotice, setLegacyWaterfallNotice] = React.useState<
    string | null
  >(null);
  const legacyWaterfallInFlightRef = React.useRef(false);

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

  /**
   * ¿El waterfall está realmente activo para este operador? Flag ON **y** rol
   * admin, ambos resueltos server-side. Un `commercial_manager` conserva el flujo
   * Apollo-only aunque el flag esté encendido.
   */
  const waterfallActive =
    phoneRevealWaterfallEnabled === true && phoneRevealWaterfallAuthorized === true;

  /**
   * Lee la auditoría de la corrida del waterfall. Solo cuando el waterfall está
   * activo: con el flag apagado no se hace ninguna llamada extra. Silencioso — la
   * auditoría es informativa y nunca puede romper la revisión del candidato.
   */
  const reloadWaterfallAudit = React.useCallback(
    async (targetCandidateId: string): Promise<void> => {
      if (!waterfallActive) return;
      try {
        const audit = await getPhoneRevealWaterfallAuditAction({
          candidateId: targetCandidateId,
        });
        if (currentCandidateIdRef.current === targetCandidateId) {
          setWaterfallAudit(audit);
        }
      } catch {
        // Silencioso: sin auditoría simplemente no se muestra el bloque.
      }
    },
    [waterfallActive],
  );

  /**
   * Cuántos teléfonos ADICIONALES tiene guardados el candidato
   * (AGENT2A-PHONE-REVEAL-4O-G). Es lo único que hace falta para decidir si el CTA
   * «Ver más números» existe, y es un entero: mientras el operador no lo pida, no
   * viaja al navegador ningún número extra.
   *
   * NO depende de `waterfallActive` ni de ningún flag de proveedor. Estos números
   * ya están guardados y ya se pagaron; que Apollo o Lusha estén hoy apagados
   * gobierna si SellUp puede GASTAR, no si el operador puede VER lo que ya tiene.
   *
   * Se relee junto al candidato, así que una supresión (DSAR) posterior retira el
   * CTA en el siguiente refetch sin necesidad de tiempo real. Silencioso y
   * fail-closed: ante cualquier fallo se queda en 0 y el CTA no aparece.
   */
  const reloadStoredPhoneSummary = React.useCallback(
    async (targetCandidateId: string): Promise<void> => {
      try {
        const summary = await getCandidateStoredPhoneSummaryAction({
          candidateId: targetCandidateId,
        });
        if (currentCandidateIdRef.current === targetCandidateId) {
          setStoredPhoneAdditionalCount(summary.additionalCount);
        }
      } catch {
        if (currentCandidateIdRef.current === targetCandidateId) {
          setStoredPhoneAdditionalCount(0);
        }
      }
    },
    [],
  );

  /**
   * 4O-H3-B-R1 — relee la oferta de merge de un candidato DUPLICADO.
   *
   * Igual que la auditoría del waterfall y el conteo de teléfonos: en paralelo, sin bloquear el
   * render del candidato, y su ausencia sólo oculta el CTA. Si falla, se deja `null` — el estado
   * seguro es NO ofrecer la fusión, nunca ofrecerla de más.
   */
  const reloadDurableMergeOffer = React.useCallback(
    async (targetCandidateId: string): Promise<void> => {
      try {
        const offer = await getDuplicateCandidateMergeOffer(targetCandidateId);
        if (currentCandidateIdRef.current === targetCandidateId) {
          setDurableMergeOffer(offer);
        }
      } catch {
        if (currentCandidateIdRef.current === targetCandidateId) {
          setDurableMergeOffer(null);
        }
      }
    },
    [],
  );

  /**
   * Descarta TODO el estado local temporal del candidato en pantalla
   * (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 4.2 / § 4.3).
   *
   * Se usa en los tres momentos en que el estado anterior deja de ser válido: al
   * cerrar el drawer, al cambiar de candidato con el drawer abierto, y cuando el
   * servidor confirma que el reveal ya terminó. Antes vivía en línea dentro de la
   * rama `!open`, así que un cambio de `candidateId` con el drawer montado
   * arrastraba avisos, errores y spinners del candidato anterior al siguiente.
   *
   * Incluye los estados del fallback manual de Lusha, que la versión anterior
   * omitía por completo: su aviso y su error sobrevivían incluso al cierre.
   *
   * SOLO estado de React, deliberadamente: así puede invocarse durante el render
   * (§ 4.3) sin tocar refs, que no pueden leerse ni escribirse en esa fase. Los
   * guards contra doble clic viven en refs y se limpian en `resetInFlightGuards`,
   * que corre fuera del render. Separarlos no pierde nada: cada guard ya se apaga
   * en el `finally` de su propio handler, así que no puede quedarse encendido.
   */
  const resetTransientCandidateState = React.useCallback(() => {
    setApproving(false);
    setRejecting(false);
    setShowRejectForm(false);
    setReason(REJECTION_REASONS[0]);
    setOtherComment('');
    setShowIdentityOverrideDialog(false);
    setOverrideAcknowledged(false);
    setOverrideReason('');
    setOverrideValidationError(null);
    // 4O-H3-B: la decisión de duplicado pertenece al candidato que la produjo. Arrastrarla al
    // siguiente sería ofrecerle al operador fusionar a OTRA persona en el mismo contacto.
    setDuplicateDecision(null);
    setMergingIntoExisting(false);
    // 4O-H3-B-R1: por la misma razón, la oferta duradera tampoco se hereda. Se vuelve a pedir al
    // servidor para el candidato que se está abriendo.
    setDurableMergeOffer(null);
    setRevealingPhone(false);
    setPhoneRevealError(null);
    setPhoneRevealNotice(null);
    setRecoveringPhone(false);
    setPhoneRecoveryNotice(null);
    setPhoneRecoveryError(null);
    setShowLushaPhoneFallbackConfirm(false);
    setRevealingPhoneViaLusha(false);
    setLushaPhoneFallbackError(null);
    setLushaPhoneFallbackNotice(null);
    setWaterfallAudit(null);
    setRevealingLegacyPhone(false);
    setLegacyWaterfallError(null);
    setLegacyWaterfallNotice(null);
    // 4O-G: el conteo pertenece al candidato anterior. Dejarlo puesto haría
    // aparecer «Ver 2 números más» sobre un candidato que quizá no tiene ninguno.
    setStoredPhoneAdditionalCount(0);
  }, []);

  /**
   * Apaga los guards contra doble clic. Viven en refs, así que esto NUNCA puede
   * llamarse durante el render — solo al cerrar el drawer.
   */
  const resetInFlightGuards = React.useCallback(() => {
    revealInFlightRef.current = false;
    recoverInFlightRef.current = false;
    lushaFallbackInFlightRef.current = false;
    legacyWaterfallInFlightRef.current = false;
  }, []);

  /**
   * § 4.3 — el estado local temporal PERTENECE a un candidato concreto.
   *
   * Cuando el drawer sigue montado y cambia `candidateId`, nada del candidato
   * anterior es válido: ni avisos, ni errores, ni estados de recovery. Antes la
   * limpieza vivía solo en la rama `!open`, así que un
   * «Apollo aún está procesando el resultado» del candidato A aparecía sobre el
   * candidato B, que podía estar ya terminal.
   *
   * Se ajusta DURANTE EL RENDER (patrón documentado de React para "adaptar estado
   * cuando cambia una prop"), no en un efecto: así el estado del candidato anterior
   * no llega a pintarse ni un solo render sobre el nuevo, que es justamente el
   * parpadeo que un efecto no puede evitar.
   */
  const [transientStateOwnerId, setTransientStateOwnerId] = React.useState<string | null>(
    candidateId,
  );
  if (open && candidateId && transientStateOwnerId !== candidateId) {
    setTransientStateOwnerId(candidateId);
    resetTransientCandidateState();
  }

  React.useEffect(() => {
    if (open && candidateId) {
      let cancelled = false;
      (async () => {
        setLoading(true);
        setLoadOutcome(null);
        try {
          // § 4.1: SIEMPRE se relee el candidato desde SellUp al abrir. No se
          // confía en el snapshot de la tabla padre, que puede ser anterior al
          // webhook. Lectura de solo lectura: 0 llamadas a proveedor, 0 créditos.
          const result = await getReviewableContactCandidateById(candidateId);
          if (cancelled) return;
          if (!result) {
            // La lectura SÍ funcionó: el candidato ya no está en un estado revisable.
            setLoadOutcome('not_found');
            setCandidate(null);
          } else {
            setCandidate(result);
            // Auditoría de la corrida del waterfall (no bloquea el render del
            // candidato: se pide en paralelo y su ausencia solo oculta el bloque).
            void reloadWaterfallAudit(candidateId);
            // 4O-G: conteo de teléfonos adicionales ya almacenados. Igual que la
            // auditoría, en paralelo y sin bloquear; su ausencia sólo oculta el CTA.
            void reloadStoredPhoneSummary(candidateId);
            // 4O-H3-B-R1: si el candidato ya está marcado como duplicado, se le vuelve a
            // preguntar al servidor si la fusión sigue siendo ofrecible. Esto es lo que hace que
            // la decisión humana sobreviva a cerrar el drawer, refrescar o navegar a otra parte.
            if (result.status === 'duplicate') {
              void reloadDurableMergeOffer(candidateId);
            }
          }
        } catch {
          if (!cancelled) {
            // La lectura FALLÓ: es un fallo real, no un candidato ausente. La
            // distinción es justo lo que faltaba — antes los dos casos caían en
            // el mismo estado y en el mismo copy.
            //
            // AGENT2A-PROD-INCIDENT: el rastro para diagnosticar NO se emite
            // aquí. Este componente maneja teléfonos revelados y tiene una
            // prohibición deliberada de escribir en consola (PHONE-3D.4 /
            // 3D.6B), así que el fallo se registra en el servidor, dentro de
            // `getReviewableContactCandidateById`, que es además donde queda
            // recogido en los logs de Producción.
            setLoadOutcome('load_error');
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
        setLoadOutcome(null);
        resetTransientCandidateState();
        resetInFlightGuards();
      });
    }
  }, [
    open,
    candidateId,
    reloadWaterfallAudit,
    reloadStoredPhoneSummary,
    reloadDurableMergeOffer,
    resetTransientCandidateState,
    resetInFlightGuards,
  ]);

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
        const fresh = await getReviewableContactCandidateById(candidateId);
        if (fresh && currentCandidateIdRef.current === candidateId) setCandidate(fresh);
      } catch {
        // Silencioso: mantenemos la vista actual si el refetch falla.
      }
      // La corrida se relee junto al candidato: es lo que hace visible el paso
      // "Apollo no encontró teléfono, consultando Lusha" sin timers propios.
      await reloadWaterfallAudit(candidateId);
      // 4O-G: el conteo se relee con el candidato. Es lo que hace que un reveal
      // que trajo un segundo número muestre el CTA sin recargar la página — y,
      // en el otro sentido, que una supresión posterior lo retire.
      await reloadStoredPhoneSummary(candidateId);
    })();
    reloadInFlightRef.current = request;
    try {
      await request;
    } finally {
      if (reloadInFlightRef.current === request) reloadInFlightRef.current = null;
    }
  }, [candidateId, reloadWaterfallAudit, reloadStoredPhoneSummary]);

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
        // El candidato pasó a `duplicate` y sale de revisión — eso no ha cambiado. Lo que cambia
        // (4O-H3-B) es que, si el servidor confirma que el contacto existente es la MISMA persona
        // por una señal exacta, no cerramos sin preguntar: se le muestra la decisión. Sin oferta,
        // el comportamiento es exactamente el de antes.
        if (result.mergeOffer?.offered && result.contactId) {
          setDuplicateDecision({
            contactId: result.contactId,
            signal: result.mergeOffer.signal,
          });
          router.refresh();
          return;
        }
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

  /**
   * 4O-H3-B — «Descartar como duplicado». No escribe NADA: el veredicto duplicado ya
   * terminalizó al candidato cuando se detectó. Cerrar es exactamente el comportamiento que
   * existía antes de este hito, y por eso este camino no llama a ninguna acción.
   */
  function handleDiscardDuplicate() {
    if (mergingIntoExisting) return;
    setDuplicateDecision(null);
    toast.warning('Candidato marcado como duplicado.');
    router.refresh();
    onClose();
  }

  /**
   * 4O-H3-B — «Agregar información al contacto existente». La decisión humana explícita.
   *
   * El id del contacto viaja como CONFIRMACIÓN, no como instrucción: el servidor lo revalida
   * contra el `matched_contacts_id` que él mismo escribió y la transacción lo vuelve a
   * comprobar bajo el lock. Un doble clic queda cortado aquí por el ref y, si aun así llegaran
   * dos peticiones, la transacción devuelve `already_merged` sin escribir por segunda vez.
   */
  async function handleMergeIntoExistingContact(targetContactId?: string) {
    // 4O-H3-B-R1: el destino puede venir de la decisión recién detectada (el diálogo) o de la
    // oferta DURADERA releída al reabrir un duplicado. Son dos caminos hacia la misma acción, y
    // el servidor revalida el id en los dos casos por igual.
    const contactId = targetContactId ?? duplicateDecision?.contactId;
    if (!candidate || !contactId) return;
    if (mergeInFlightRef.current) return;
    mergeInFlightRef.current = true;
    setMergingIntoExisting(true);
    try {
      const result = await mergeContactCandidateIntoExistingContactAction(
        candidate.id,
        contactId,
      );
      if (result.ok) {
        toast.success(result.message ?? 'Información agregada al contacto existente.');
        setDuplicateDecision(null);
        setDurableMergeOffer(null);
        router.refresh();
        onClose();
      } else {
        toast.error(
          result.error ?? 'No fue posible agregar la información al contacto existente.',
        );
      }
    } catch {
      toast.error('No fue posible agregar la información al contacto existente.');
    } finally {
      mergeInFlightRef.current = false;
      setMergingIntoExisting(false);
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
      // AGENT2A-PHONE-WATERFALL-2A: la corrida de auditoría del waterfall no se
      // pudo crear, así que el servidor NO ejecutó ningún proveedor. No es un
      // error de Apollo y no es "no se encontró teléfono": no se buscó. El
      // candidato NO se recarga (no se persistió nada) y el mensaje se muestra al
      // operador — el detalle mecánico queda solo en el log del servidor.
      case 'waterfall_infrastructure_unavailable':
        toast.error(PHONE_REVEAL_WATERFALL_INFRASTRUCTURE_UNAVAILABLE_COPY);
        setPhoneRevealError(PHONE_REVEAL_WATERFALL_INFRASTRUCTURE_UNAVAILABLE_COPY);
        return;
      // AGENT2A-PHONE-WATERFALL-4D: el saldo no cubría el tope autorizado. El
      // servidor lo comprobó ANTES de crear la corrida, así que no hay corrida, no
      // corrió ningún proveedor y no se consumió ningún crédito. El candidato NO se
      // recarga: no se persistió nada.
      case 'insufficient_credits':
        toast.error(PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY);
        setPhoneRevealError(PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY);
        return;
      // AGENT2A-PHONE-WATERFALL-4E: no hay regla de crédito para alguno de los
      // proveedores que la autorización puede llegar a llamar, así que no hubo
      // disponibilidad que reservar. Mismas garantías de cero efectos, pero el copy NO
      // puede decir que falten créditos: lo que falta es la configuración.
      case 'budget_not_configured':
        toast.error(PHONE_REVEAL_WATERFALL_BUDGET_NOT_CONFIGURED_COPY);
        setPhoneRevealError(PHONE_REVEAL_WATERFALL_BUDGET_NOT_CONFIGURED_COPY);
        return;
      // El saldo no se pudo VERIFICAR. Mismas garantías de cero efectos, pero el
      // copy no puede afirmar que falten créditos: eso no se comprobó.
      case 'credit_balance_unavailable':
        toast.error(PHONE_REVEAL_WATERFALL_CREDIT_BALANCE_UNAVAILABLE_COPY);
        setPhoneRevealError(PHONE_REVEAL_WATERFALL_CREDIT_BALANCE_UNAVAILABLE_COPY);
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
  async function handlePhoneReveal(expectedMaxCredits: number = PHONE_REVEAL_MAX_CREDITS) {
    if (!candidate || revealInFlightRef.current) return;
    revealInFlightRef.current = true;
    setPhoneRevealError(null);
    setPhoneRevealNotice(null);
    setRevealingPhone(true);
    try {
      const result = await revealCandidatePhoneAction({
        candidateId: candidate.id,
        confirmCost: true,
        expectedMaxCredits,
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

  // ── Waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1 · 4D) ──────────────
  /**
   * Dispara el waterfall DIRECTAMENTE desde el botón. Es EL MISMO server action del
   * reveal Apollo: el waterfall no es una acción nueva del cliente, es la misma
   * acción que el servidor extiende con una 2ª pata. Lo único que cambia aquí es el
   * tope de créditos que el operador está aceptando (13 con Lusha posible, 8 sin
   * ella), que el servidor revalida — y que además revalida contra el saldo antes de
   * crear la corrida.
   *
   * No hay modal, no hay confirmación y no hay segundo clic: la pata Lusha la decide
   * y la ejecuta el servidor cuando Apollo termina en `no_phone_found`.
   */
  async function handleStartPhoneWaterfallRun(maxCredits: number) {
    await handlePhoneReveal(maxCredits);
  }

  // ── Ruta legacy solo-Lusha (AGENT2A-PHONE-WATERFALL-2) ─────────────────────
  /**
   * Traduce el resultado seguro de la acción legacy a copy en español. El teléfono
   * NUNCA vuelve en el resultado: en `revealed` se recarga el candidato, que es quien
   * lo muestra. Los códigos de bloqueo no deberían alcanzarse desde esta UI (el botón
   * los pre-filtra), pero el servidor revalida todo, así que se traducen igual.
   */
  function applyLegacyPhoneWaterfallResult(
    result: Awaited<ReturnType<typeof startLegacyPhoneRevealWaterfallAction>>,
  ) {
    switch (result.status) {
      case 'revealed':
        toast.success('Teléfono revelado con Lusha.');
        setLegacyWaterfallNotice(null);
        void reloadCandidate();
        return;
      case 'no_phone_found':
        setLegacyWaterfallNotice(
          'Lusha tampoco encontró un teléfono para este candidato.',
        );
        void reloadCandidate();
        return;
      // Cierre SIN llamar a Lusha: supresión registrada, no contactar, o
      // verificación de supresión no disponible. El motivo mecánico distingue el
      // último caso, que NO afirma que el candidato esté suprimido.
      case 'closed_without_lusha':
        if (result.reason === 'suppression_check_unavailable') {
          setLegacyWaterfallNotice(
            PHONE_REVEAL_WATERFALL_SUPPRESSION_UNVERIFIED_COPY,
          );
        } else {
          setLegacyWaterfallNotice(PHONE_REVEAL_WATERFALL_BLOCKED_COPY);
        }
        void reloadCandidate();
        return;
      case 'already_attempted':
        setLegacyWaterfallNotice(
          'Esta revelación ya se había intentado. No se hizo ningún cargo nuevo.',
        );
        void reloadCandidate();
        return;
      case 'not_eligible':
        setLegacyWaterfallError(
          'Este candidato ya no puede autorizarse por esta vía. Recarga la vista para ver su estado actual.',
        );
        void reloadCandidate();
        return;
      // AGENT2A-PHONE-WATERFALL-4D: el saldo no cubría los 5 créditos de la pata
      // Lusha. Se comprobó ANTES de crear la corrida: 0 corridas, 0 llamadas a
      // Lusha, 0 créditos. No se recarga nada porque no se escribió nada.
      case 'insufficient_credits':
        setLegacyWaterfallError(PHONE_REVEAL_WATERFALL_INSUFFICIENT_CREDITS_COPY);
        return;
      // AGENT2A-PHONE-WATERFALL-4E: Lusha no tiene regla de crédito, así que no había
      // disponibilidad que reservar. Cero efectos, y el motivo es la configuración.
      case 'budget_not_configured':
        setLegacyWaterfallError(PHONE_REVEAL_WATERFALL_BUDGET_NOT_CONFIGURED_COPY);
        return;
      case 'credit_balance_unavailable':
        setLegacyWaterfallError(
          PHONE_REVEAL_WATERFALL_CREDIT_BALANCE_UNAVAILABLE_COPY,
        );
        return;
      // AGENT2A-PHONE-WATERFALL-4F: el saldo estaba bien; la corrida no se pudo
      // registrar. Cero efectos, así que no se recarga nada, y el copy no afirma que
      // falten créditos ni que el candidato no aplique.
      case 'infrastructure_unavailable':
        setLegacyWaterfallError(PHONE_REVEAL_WATERFALL_ERROR_COPY);
        return;
      case 'error':
      default:
        setLegacyWaterfallError(PHONE_REVEAL_WATERFALL_ERROR_COPY);
        void reloadCandidate();
    }
  }

  /**
   * Ejecuta la autorización legacy directamente desde el botón: SOLO la pata Lusha,
   * hasta 5 créditos. Un candidato por clic; el ref corta un segundo clic en el mismo
   * tick — dos clics concurrentes crean UNA sola corrida — y el servidor aplica además
   * el claim atómico, así que Lusha se llama como máximo una vez por autorización. NO
   * llama a Apollo.
   */
  async function handleStartLegacyPhoneWaterfallRun() {
    if (!candidate || legacyWaterfallInFlightRef.current) return;
    legacyWaterfallInFlightRef.current = true;
    setLegacyWaterfallError(null);
    setLegacyWaterfallNotice(null);
    setRevealingLegacyPhone(true);
    try {
      const result = await startLegacyPhoneRevealWaterfallAction({
        candidateId: candidate.id,
      });
      applyLegacyPhoneWaterfallResult(result);
      // La corrida ya existe (terminal o no): recargar la auditoría es lo que retira
      // el botón y muestra la trazabilidad por proveedor.
      await reloadWaterfallAudit(candidate.id);
    } catch {
      setLegacyWaterfallError(PHONE_REVEAL_WATERFALL_ERROR_COPY);
    } finally {
      legacyWaterfallInFlightRef.current = false;
      setRevealingLegacyPhone(false);
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
   * Relee el candidato desde SellUp por acto humano (§ 6).
   *
   * Contrato DELIBERADAMENTE distinto del de «Revisar resultado ahora»:
   *   * aquí: una lectura de la base de SellUp. Ni Apollo, ni Lusha, ni usage
   *     logs, ni créditos, ni escrituras. Siempre disponible mientras haya
   *     candidato, porque leer nunca puede hacer daño;
   *   * allí: un recovery Apollo explícito — un GET al resultado ya solicitado,
   *     solo para un estado en vuelo elegible y con ventana anti-abuso.
   *
   * Reutiliza `reloadCandidate`, que ya cumple exactamente este contrato: no se
   * añade una acción de servidor nueva para algo que la proyección de lectura
   * existente ya hace.
   */
  async function handleRefreshFromDatabase() {
    if (!candidateId || refreshingFromDatabase) return;
    setRefreshingFromDatabase(true);
    try {
      await reloadCandidate();
    } finally {
      setRefreshingFromDatabase(false);
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
        // Tope que el operador acabó de aceptar en el diálogo (5 créditos,
        // confirmados por soporte de Lusha). El server revalida el tope contra
        // LUSHA_PHONE_FALLBACK_DEFAULT_MAX_CREDITS y bloquea cualquier valor
        // menor como `missing_cost_confirmation`.
        expectedMaxCredits: LUSHA_PHONE_FALLBACK_MAX_CREDITS,
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

  // ── El SERVIDOR manda (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 4.2) ───────────────
  // En cuanto el candidato leído deja de estar en vuelo — `revealed`,
  // `no_phone_found`, `error`, `not_requested` o `null` — el estado local que
  // describía una espera queda INVÁLIDO. Este es el bug central del hito: el caso
  // ya estaba cerrado en base (`webhook_received_at` = `completed_at`) y la UI
  // seguía anunciando «Apollo aún está procesando el resultado» porque nada
  // retiraba ese aviso una vez fijado en React.
  //
  // Se resuelve DERIVANDO en vez de con un efecto que limpie estado. Es mejor por
  // dos razones, no solo por evitar renders en cascada: el aviso obsoleto no puede
  // ni parpadear (no hay un render intermedio en el que siga visible), y no hay dos
  // fuentes de verdad que puedan desincronizarse. Los spinners no necesitan
  // derivación: `revealingPhone` y `recoveringPhone` se apagan en el `finally` de
  // sus propios handlers, así que no pueden quedarse encendidos.
  const phoneRevealSettledOnServer = shouldClearLocalPhoneRevealState(
    candidate?.phone_reveal_status,
  );
  // Aviso de la revisión manual, ya filtrado: si el servidor cerró el caso, no se
  // muestra aunque siga en el estado local.
  const visiblePhoneRecoveryNotice = phoneRevealSettledOnServer
    ? null
    : phoneRecoveryNotice;

  // Proveedor que reveló (o intentó revelar) el teléfono
  // (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 8.2). Se deriva EXCLUSIVAMENTE de
  // `phone_reveal_provider`: nunca de `candidate.source` ni de `phone.source`. Son
  // tres propiedades distintas y mezclarlas es lo que hacía leer un reveal de
  // Apollo como si lo hubiera hecho Lusha. `null` ⇒ no hubo intento ⇒ no se
  // muestra nada (no se infiere).
  const phoneRevealProviderLabel = resolvePhoneRevealProviderLabel(
    candidate?.phone_reveal_provider,
  );

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
  const { active: liveRefreshActive, budgetExhausted: liveRefreshExhausted } =
    usePhoneRevealLiveRefresh({
      enabled: open && !!candidate && liveRefreshEligible,
      candidateId,
      reload: reloadCandidate,
    });

  // § 7: volver a la pestaña relee el candidato UNA vez. Cubre el hueco que deja
  // el presupuesto acotado de arriba: quien deja el drawer abierto y vuelve más
  // tarde ya no se queda mirando un estado congelado. Solo lee la base de SellUp
  // — 0 llamadas a Apollo, 0 a Lusha, 0 usage logs, 0 créditos — y su ventana
  // mínima impide que un cambio de pestaña produzca una ráfaga.
  usePhoneRevealWindowRefresh({
    open,
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
    hasLushaContactId &&
    // Con el waterfall activo NO hay botón separado de Lusha en el flujo normal:
    // la 2ª pata es automática y server-side, así que ofrecer además un disparo
    // manual reintroduciría justo el segundo clic que este hito elimina — y
    // permitiría gastar créditos Lusha fuera de la corrida que los contabiliza.
    !waterfallActive;
  const lushaPhoneFallbackCopy = getLushaPhoneFallbackCopy();

  // ── Estado visible del waterfall (AGENT2A-PHONE-WATERFALL-1) ───────────────
  // El tope que se muestra y se envía depende de si Lusha es una 2ª pata posible.
  // Es el MISMO criterio que aplica el servidor (`source === 'lusha'` + id propio),
  // así que el modal no puede prometer 13 créditos donde el servidor solo autoriza 8.
  const waterfallLushaEligible = hasLushaContactId;

  // ── Ruta legacy solo-Lusha (AGENT2A-PHONE-WATERFALL-2) ─────────────────────
  // Pre-filtro VISUAL para candidatos cuyo Apollo ya terminó `no_phone_found` antes
  // de que existiera la corrida. El servidor revalida la evidencia contra las
  // columnas canónicas (`phone_reveal_status` + `phone_reveal_provider` +
  // `phone_reveal_completed_at`) y rechaza cualquier rol no admin, así que esto solo
  // decide si se OFRECE el botón, nunca si se permite el gasto.
  //
  // Se exige `phone_reveal_provider === 'apollo'`: un `no_phone_found` que ya produjo
  // LUSHA no habilita volver a llamar a Lusha. Y se exige id Lusha propio, porque sin
  // él la pata no existe y pedir 5 créditos sería pedir permiso para nada.
  //
  // La clasificación del historial se delega al core PURO (sin I/O, sin imports de
  // servidor, seguro en el bundle cliente) para no duplicar la regla: duplicarla es lo
  // que permitiría que el botón y el servidor discreparan.
  const legacyWaterfallHistory =
    classifyPhoneRevealWaterfallLegacyHistory(waterfallAudit);
  const canOfferLegacyPhoneWaterfall =
    !!candidate &&
    waterfallActive &&
    phoneRevealExhausted &&
    candidate?.phone_reveal_provider === 'apollo' &&
    !phoneRevealInFlight &&
    !hasPhone &&
    hasLushaContactId &&
    // El historial se CLASIFICA con la MISMA función pura que aplica el servidor
    // (AGENT2A-PHONE-WATERFALL-2C), sobre la MISMA fila — las dos leen la corrida más
    // reciente — así que el botón nunca ofrece lo que el servidor va a rechazar:
    //   * corrida viva                     ⇒ no se ofrece (autorización en curso);
    //   * corrida `full_waterfall`         ⇒ no se ofrece (candidato del flujo completo);
    //   * corrida legacy que YA reveló     ⇒ no se ofrece (nada que reautorizar);
    //   * corrida legacy terminal sin teléfono ⇒ SÍ se ofrece: el operador puede
    //     autorizar de nuevo, y sigue costándole un clic y una confirmación nuevos.
    //     No hay reapertura ni reintento automáticos en ninguna parte de este flujo.
    legacyWaterfallHistory.reauthorizable;

  // Copy de la autorización DIRECTA (4D): se lee debajo del botón, ANTES del clic.
  const waterfallAuthorizationCopy = getPhoneRevealWaterfallAuthorizationCopy({
    lushaEligible: waterfallLushaEligible,
    legacyLushaOnly: canOfferLegacyPhoneWaterfall,
  });
  // La 2ª pata está reclamada o corriendo: el candidato sigue en `no_phone_found`
  // (un resultado sin teléfono no pisa su estado), así que esto solo lo sabe la
  // corrida.
  const waterfallLushaRunning =
    waterfallActive &&
    (waterfallAudit?.status === 'lusha_pending' ||
      waterfallAudit?.status === 'lusha_running');
  // La comprobación de supresión/DNC no se pudo completar, así que Lusha NO se
  // ejecutó. Se lee del motivo de omisión de la corrida (no de `error_code`) y
  // tiene prioridad sobre el copy genérico de error: al operador hay que decirle
  // que la verificación no estuvo disponible, NUNCA que el candidato está
  // suprimido — eso no se comprobó.
  const waterfallSuppressionUnverified =
    waterfallActive &&
    waterfallAudit?.lushaSkippedReason === 'suppression_check_unavailable';
  const waterfallInProgress =
    waterfallActive && !!waterfallAudit && !waterfallAudit.isTerminal;
  // Gate de aprobación: mientras la revelación siga viva, aprobar crearía el
  // contacto oficial SIN el teléfono que se está pagando por conseguir.
  const waterfallBlocksApproval = waterfallInProgress;
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
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Parity with Agent 1's "Nuevo": independent of workflow status,
                  same calendar-day (America/Bogota) freshness check. */}
              {candidate.created_at && isCandidateCreatedToday(candidate.created_at) && (
                <Badge className="border-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-semibold px-1.5 py-0.5 shrink-0">
                  Nuevo
                </Badge>
              )}
              {/* 4O-H3-B-R1: el badge dice el estado REAL. Un duplicado ya no se presenta como si
                  siguiera siendo una aprobación normal pendiente. */}
              {candidate.status === 'duplicate' ? (
                <Badge
                  variant="outline"
                  className="shrink-0 border-transparent bg-muted text-muted-foreground text-xs font-semibold"
                >
                  Duplicado
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="shrink-0 border-transparent bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold"
                >
                  Por revisar
                </Badge>
              )}
            </div>
          </div>
        ) : loadOutcome === 'not_found' ? (
          CANDIDATE_DETAIL_NOT_FOUND_TITLE_COPY
        ) : loadOutcome === 'load_error' ? (
          CANDIDATE_DETAIL_LOAD_ERROR_TITLE_COPY
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
        // 4O-H3-B-R1: un candidato ya marcado como duplicado NO ofrece «Aprobar» / «Rechazar».
        // Su veredicto ya está tomado; lo único que queda es la decisión de duplicado, que vive
        // en el cuerpo del drawer. Presentarlo con la barra de aprobación normal era justamente
        // mezclarlo con una aprobación pendiente.
        candidate && candidate.status !== 'duplicate' ? (
          !showRejectForm ? (
            <>
              <p className="flex-1 text-[11px] text-muted-foreground/70">
                {waterfallBlocksApproval
                  ? PHONE_REVEAL_WATERFALL_APPROVE_BLOCKED_COPY
                  : candidate.account_id
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
                  disabled={
                    busy ||
                    (!candidate.account_id && !candidate.hubspot_company_id) ||
                    // Waterfall en curso: aprobar ahora crearía el contacto oficial
                    // sin el teléfono que se está pagando por conseguir.
                    waterfallBlocksApproval
                  }
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
      {loadOutcome ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          {/* El icono acompaña al copy: informativo cuando el candidato salió de
              revisión, de advertencia cuando la lectura falló. */}
          <div
            className={
              loadOutcome === 'load_error'
                ? 'flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10'
                : 'flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60'
            }
          >
            {loadOutcome === 'load_error' ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : (
              <Info className="h-5 w-5 text-muted-foreground/40" />
            )}
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            {loadOutcome === 'load_error'
              ? CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY
              : CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY}
          </p>
        </div>
      ) : !candidate ? null : (
        <div className="space-y-4">
          {/* 4O-H3-B-R1 — aviso DURADERO de duplicado.
              Vive en el cuerpo del drawer, no en un diálogo, y por eso sigue ahí después de
              cerrar, refrescar o navegar. Con una identidad exacta confirmada por el servidor
              ofrece la fusión; sin ella lo dice con claridad y NO ofrece ningún CTA. No expone
              internals: ni ids, ni nombres de columnas, ni evidencia cruda. */}
          {candidate.status === 'duplicate' ? (
            <SurfaceCard>
              <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                <div className="space-y-2.5">
                  <p className="text-sm font-medium text-foreground">
                    Este candidato coincide con un contacto existente.
                  </p>
                  {durableMergeOffer?.offered ? (
                    <>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {durableMergeOffer.signal === 'email'
                          ? 'Tiene el mismo correo electrónico que un contacto que ya está en SellUp.'
                          : 'Tiene el mismo perfil de LinkedIn que un contacto que ya está en SellUp.'}{' '}
                        Puedes agregarle la información de este candidato. No se reemplaza nada de
                        lo que ya tiene: su teléfono principal y los datos cargados a mano se
                        conservan tal como están.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        disabled={mergingIntoExisting}
                        onClick={() =>
                          void handleMergeIntoExistingContact(
                            durableMergeOffer.offered ? durableMergeOffer.contactId : undefined,
                          )
                        }
                      >
                        {mergingIntoExisting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Agregando…
                          </>
                        ) : (
                          'Agregar información al contacto existente'
                        )}
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      No podemos confirmar que sea la misma persona con suficiente certeza, así que
                      no ofrecemos asociarlo automáticamente. Queda registrado como duplicado para
                      que puedas revisarlo cuando quieras.
                    </p>
                  )}
                </div>
              </div>
            </SurfaceCard>
          ) : null}

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
              <DetailRow icon={Tag} label={CANDIDATE_SOURCE_LABEL}>
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
                  {/* «Ver más números» (AGENT2A-PHONE-REVEAL-4O-G). Aparece SOLO si
                      hay al menos un número adicional YA almacenado, y lista
                      únicamente los ADICIONALES: el principal ya se lee justo
                      arriba y repetirlo sería ruido.

                      Es una LECTURA. No busca, no revela y no gasta: 0 llamadas a
                      Apollo, 0 a Lusha, 0 corridas, 0 reservas, 0 créditos. Por eso
                      no está detrás de ningún flag de proveedor — un número ya
                      pagado y ya guardado no puede desaparecer porque el proveedor
                      que lo trajo esté hoy apagado. */}
                  {candidate && storedPhoneAdditionalCount > 0 && (
                    <CandidateStoredPhonesDisclosure
                      candidateId={candidate.id}
                      additionalCount={storedPhoneAdditionalCount}
                    />
                  )}
                  {/* § 8.2: línea SEPARADA para el proveedor de revelación. Vive en
                      la sección de Teléfono porque es un hecho del teléfono, no del
                      candidato, y así «Fuente del candidato: Lusha» +
                      «Proveedor de revelación: Apollo» se leen sin contradicción.
                      Ausente cuando todavía no hubo ningún intento. */}
                  {phoneRevealProviderLabel && (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="uppercase tracking-wide text-muted-foreground/70">
                        {PHONE_REVEAL_PROVIDER_LABEL}:
                      </span>{' '}
                      <span className="text-foreground">{phoneRevealProviderLabel}</span>
                    </p>
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
                      {/* § 5: el presupuesto se agotó y el caso sigue abierto. Antes
                          el copy de arriba simplemente desaparecía y quedaba el
                          spinner de "Revelación en proceso" solo, dando a entender
                          que SellUp seguía revisando. Ahora se dice que la
                          actualización automática TERMINÓ, y las dos afirmaciones son
                          mutuamente excluyentes por construcción (el hook nunca
                          reporta `active` y `budgetExhausted` a la vez). No inicia
                          ninguna revelación nueva ni consume créditos. */}
                      {liveRefreshExhausted && (
                        <p className="text-[11px] text-muted-foreground/70">
                          {PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY}
                        </p>
                      )}
                      {/* § 6: actualizar desde SellUp. Es una LECTURA de la base —
                          nada de proveedores, créditos ni escrituras — y por eso
                          está siempre disponible mientras el reveal siga en vuelo,
                          sin ventana anti-abuso. Su copy dice explícitamente que no
                          consulta a Apollo, para que no se confunda con el CTA de
                          revisión manual que aparece más abajo. */}
                      <div className="space-y-1.5 pt-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          disabled={busy || refreshingFromDatabase}
                          onClick={handleRefreshFromDatabase}
                        >
                          {refreshingFromDatabase ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Actualizando…
                            </>
                          ) : (
                            <>
                              <RefreshCw className="h-3.5 w-3.5" />
                              Actualizar desde SellUp
                            </>
                          )}
                        </Button>
                        <p className="text-[11px] text-muted-foreground/70">
                          Relee el estado guardado en SellUp. No consulta a Apollo ni
                          a Lusha y no consume créditos.
                        </p>
                      </div>
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
                  {/* Con el waterfall activo y una corrida viva este copy se omite:
                      diría "no disponible tras Apollo" mientras Lusha aún está
                      consultando, que es exactamente la contradicción que el
                      waterfall existe para evitar. Los estados del waterfall
                      (más abajo) son la fuente en ese caso. */}
                  {phoneRevealExhausted &&
                    !phoneRevealInFlight &&
                    !(waterfallActive && waterfallAudit) && (
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
                  {visiblePhoneRecoveryNotice && (
                    <p className="text-[11px] text-muted-foreground">
                      {visiblePhoneRecoveryNotice}
                    </p>
                  )}
                  {phoneRecoveryError && (
                    <p className="text-[11px] text-destructive">{phoneRecoveryError}</p>
                  )}
                  {/* Botón ÚNICO. Cubre los TRES casos con el mismo label y, con el
                      waterfall activo, SIN modal (AGENT2A-PHONE-WATERFALL-4D):
                        * flag OFF                 → one-click Apollo (sin cambios);
                        * flag ON + candidato normal → waterfall completo (hasta 13);
                        * flag ON + candidato legacy → solo Lusha (hasta 5).
                      No se añade un segundo botón para el caso legacy ni un botón de
                      confirmación: el clic ejecuta, y lo que el operador necesita
                      saber para autorizar se lee justo debajo, antes de hacer clic. */}
                  {(canOfferPhoneReveal || canOfferLegacyPhoneWaterfall) && (
                    <div className="space-y-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        disabled={busy || revealingPhone || revealingLegacyPhone}
                        // Un clic = una corrida. Con el waterfall activo se dispara la
                        // modalidad que corresponde (legacy solo-Lusha o waterfall
                        // completo); sin él conserva el one-click validado del reveal
                        // Apollo. El guard síncrono contra doble clic vive en el ref de
                        // cada handler, así que dos clics en el mismo tick crean UNA
                        // sola corrida.
                        onClick={
                          waterfallActive
                            ? canOfferLegacyPhoneWaterfall
                              ? () => void handleStartLegacyPhoneWaterfallRun()
                              : () =>
                                  void handleStartPhoneWaterfallRun(
                                    waterfallAuthorizationCopy.maxCredits,
                                  )
                            : () => handlePhoneReveal()
                        }
                      >
                        {revealingPhone || revealingLegacyPhone ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            {waterfallActive
                              ? PHONE_REVEAL_WATERFALL_REQUESTING_COPY
                              : revealingLegacyPhone
                                ? 'Revelando…'
                                : 'Solicitando…'}
                          </>
                        ) : (
                          <>
                            <PhoneCall className="h-3.5 w-3.5" />
                            Revelar teléfono
                          </>
                        )}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        {waterfallActive
                          ? waterfallAuthorizationCopy.helperText
                          : `Consulta individual con Apollo. Puede consumir hasta ${PHONE_REVEAL_MAX_CREDITS} créditos y tardar algunos minutos.`}
                      </p>
                      {/* Desglose por proveedor + advertencias: lo que antes vivía en
                          el modal ahora precede al clic (4D). Solo con el waterfall
                          activo — el flujo con flag OFF conserva su copy histórico. */}
                      {waterfallActive && (
                        <>
                          {waterfallAuthorizationCopy.creditBreakdown && (
                            <>
                              <ul className="space-y-0.5">
                                {waterfallAuthorizationCopy.creditBreakdown.legs.map(
                                  (leg) => (
                                    <li
                                      key={leg}
                                      className="text-[11px] text-muted-foreground"
                                    >
                                      {leg}
                                    </li>
                                  ),
                                )}
                              </ul>
                              <p className="text-[11px] font-medium text-foreground">
                                {waterfallAuthorizationCopy.creditBreakdown.total}
                              </p>
                            </>
                          )}
                          <ul className="space-y-0.5">
                            {waterfallAuthorizationCopy.warnings.map((warning) => (
                              <li
                                key={warning}
                                className="text-[11px] text-muted-foreground/70"
                              >
                                {warning}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      <p className="text-[11px] text-muted-foreground/70">
                        Base aplicada: interés legítimo B2B.
                      </p>
                      {phoneRevealError && (
                        <p className="text-[11px] text-destructive">{phoneRevealError}</p>
                      )}
                      {legacyWaterfallNotice && (
                        <p className="text-[11px] text-muted-foreground">
                          {legacyWaterfallNotice}
                        </p>
                      )}
                      {legacyWaterfallError && (
                        <p className="text-[11px] text-destructive">
                          {legacyWaterfallError}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Mensajes de la ruta legacy cuando el botón ya no se ofrece (la
                      corrida acaba de crearse, así que `canOfferLegacy…` es false).
                      Sin esto el operador perdería el resultado de lo que autorizó. */}
                  {!canOfferPhoneReveal &&
                    !canOfferLegacyPhoneWaterfall &&
                    (legacyWaterfallNotice || legacyWaterfallError) && (
                      <div className="space-y-1">
                        {legacyWaterfallNotice && (
                          <p className="text-[11px] text-muted-foreground">
                            {legacyWaterfallNotice}
                          </p>
                        )}
                        {legacyWaterfallError && (
                          <p className="text-[11px] text-destructive">
                            {legacyWaterfallError}
                          </p>
                        )}
                      </div>
                    )}

                  {/* Estados del waterfall (AGENT2A-PHONE-WATERFALL-1). Solo con el
                      flag activo y solo cuando hay corrida: describen en qué pata
                      está SellUp sin exigir ninguna acción al operador. */}
                  {waterfallActive && waterfallAudit && (
                    <div className="space-y-1">
                      {waterfallLushaRunning ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge className="border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            Lusha
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {/* Mismo copy en las dos modalidades (4D): está en
                                pasado, así que no afirma que Apollo esté corriendo
                                ahora. Que en legacy ese intento ocurrió FUERA de
                                esta autorización lo dice la fila de auditoría. */}
                            {PHONE_REVEAL_WATERFALL_LUSHA_RUNNING_COPY}
                          </span>
                        </span>
                      ) : waterfallSuppressionUnverified ? (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          {PHONE_REVEAL_WATERFALL_SUPPRESSION_UNVERIFIED_COPY}
                        </p>
                      ) : waterfallAudit.status === 'apollo_in_flight' ? (
                        <p className="text-[11px] text-muted-foreground">
                          {PHONE_REVEAL_WATERFALL_APOLLO_RUNNING_COPY}
                        </p>
                      ) : waterfallAudit.status === 'completed_apollo' ||
                        waterfallAudit.status === 'completed_lusha' ? (
                        <p className="text-[11px] text-muted-foreground">
                          {/* Un solo estado terminal con teléfono (4D). Qué pata lo
                              consiguió lo dice «Proveedor final» en la auditoría. */}
                          {PHONE_REVEAL_WATERFALL_REVEALED_COPY}
                        </p>
                      ) : waterfallAudit.status === 'exhausted' ? (
                        <p className="text-[11px] text-muted-foreground">
                          {PHONE_REVEAL_WATERFALL_EXHAUSTED_COPY}
                        </p>
                      ) : waterfallAudit.status === 'aborted' ? (
                        <p className="text-[11px] text-muted-foreground">
                          {PHONE_REVEAL_WATERFALL_BLOCKED_COPY}
                        </p>
                      ) : waterfallAudit.status === 'error' ? (
                        <p className="text-[11px] text-destructive">
                          {PHONE_REVEAL_WATERFALL_ERROR_COPY}
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </DetailRow>
            </dl>
          </SurfaceCard>

          {/* 2b. Auditoría del waterfall de teléfono (AGENT2A-PHONE-WATERFALL-1).
               Solo con el flag activo, rol admin y corrida existente. Muestra qué
               hizo CADA proveedor y cuánto costó CADA pata por separado — nunca un
               total mezclado — y no expone ningún dato personal adicional. */}
          {waterfallActive && waterfallAudit && (
            <SurfaceCard>
              <SurfaceCardHeader
                title="Revelación de teléfono por proveedor"
                description="Trazabilidad de la última revelación autorizada: qué intentó cada proveedor y cuánto costó cada consulta."
              />
              <dl className="space-y-3">
                <DetailRow icon={PhoneCall} label="Apollo">
                  <span className="flex flex-col gap-0.5">
                    <span>
                      {/* En una corrida legacy `apolloAttempted` es false porque
                          Apollo NO corrió bajo esta autorización — pero decir "No
                          intentado" sería falso: se intentó antes. La modalidad es
                          lo que resuelve la ambigüedad, y por eso viaja en la
                          proyección en vez de deducirse del timestamp. */}
                      {waterfallAudit.runMode === 'legacy_lusha_only'
                        ? PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_AUDIT_COPY
                        : waterfallAudit.apolloAttempted
                          ? 'Intentado'
                          : 'No intentado'}
                      {resolveWaterfallOutcomeLabel(waterfallAudit.apolloOutcome)
                        ? ` · ${resolveWaterfallOutcomeLabel(waterfallAudit.apolloOutcome)}`
                        : ''}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {/* El costo histórico pertenece a la autorización que lo pagó.
                          Aquí no se muestra ninguna cifra — y nunca un 0, que se
                          leería como "fue gratis". */}
                      {waterfallAudit.runMode === 'legacy_lusha_only'
                        ? PHONE_REVEAL_WATERFALL_LEGACY_APOLLO_COST_COPY
                        : formatWaterfallLegCredits(
                            waterfallAudit.apolloCostCredits,
                            waterfallAudit.apolloCostSource,
                          )}
                    </span>
                  </span>
                </DetailRow>
                <DetailRow icon={PhoneCall} label="Lusha">
                  <span className="flex flex-col gap-0.5">
                    <span>
                      {waterfallAudit.lushaAttempted
                        ? `Intentado${
                            resolveWaterfallOutcomeLabel(waterfallAudit.lushaOutcome)
                              ? ` · ${resolveWaterfallOutcomeLabel(waterfallAudit.lushaOutcome)}`
                              : ''
                          }`
                        : (resolveWaterfallLushaSkippedLabel(
                            waterfallAudit.lushaSkippedReason,
                          ) ?? 'Pendiente')}
                    </span>
                    {waterfallAudit.lushaAttempted && (
                      <span className="text-[11px] text-muted-foreground">
                        {formatWaterfallLegCredits(
                          waterfallAudit.lushaCostCredits,
                          waterfallAudit.lushaCostSource,
                        )}
                      </span>
                    )}
                  </span>
                </DetailRow>
                <DetailRow icon={ShieldCheck} label="Proveedor final">
                  {resolveWaterfallFinalProviderLabel(waterfallAudit.finalProvider) ? (
                    <span>
                      {resolveWaterfallFinalProviderLabel(waterfallAudit.finalProvider)}
                    </span>
                  ) : (
                    <Fallback />
                  )}
                </DetailRow>
                <DetailRow icon={Gauge} label="Máximo autorizado">
                  <span className="tabular-nums">
                    {waterfallAudit.maxCreditsAuthorized} créditos
                  </span>
                </DetailRow>
              </dl>
            </SurfaceCard>
          )}

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
              /* § 8.3: copy NEUTRAL respecto al proveedor. El texto anterior
                 nombraba a Lusha ("la persona encontrada en Lusha"), lo que sugería
                 que Lusha había participado en el teléfono cuando lo único que
                 indica es `candidate.source`. Este bloque compara identidades del
                 CANDIDATO y del enriquecimiento; no dice nada del proveedor
                 telefónico, así que tampoco debe nombrar a ninguno. */
              description="Compara la identidad del candidato encontrado por la fuente original con la identidad devuelta durante el enriquecimiento."
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
              <DetailRow icon={Tag} label={CANDIDATE_SOURCE_LABEL}>
                {SOURCE_LABELS[candidate.source] ?? candidate.source}
              </DetailRow>
              {/* § 8.2 en Trazabilidad: el eje del teléfono, junto al del candidato
                  pero nunca fundido con él. Solo si hubo intento real. */}
              {phoneRevealProviderLabel && (
                <DetailRow icon={PhoneCall} label={PHONE_REVEAL_PROVIDER_LABEL}>
                  {phoneRevealProviderLabel}
                </DetailRow>
              )}
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

    {/* AGENT2A-PHONE-REVEAL-4O-H3-B — decisión humana sobre un duplicado con identidad exacta.
        Sólo se abre cuando el SERVIDOR confirmó que el contacto existente es la misma persona
        por email o LinkedIn exactos; con identidad ambigua, por nombre o sin señal exacta, este
        diálogo no aparece y el flujo es el de siempre. No muestra internals: ni ids, ni el
        nombre de la columna, ni la evidencia cruda. */}
    <Dialog
      open={duplicateDecision !== null}
      onOpenChange={(v) => {
        if (mergingIntoExisting) return;
        if (!v) handleDiscardDuplicate();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Candidato duplicado</DialogTitle>
          <DialogDescription>
            Este candidato coincide con un contacto que ya existe en SellUp
            {duplicateDecision?.signal === 'email'
              ? ', con el mismo correo electrónico.'
              : ', con el mismo perfil de LinkedIn.'}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Puedes agregarle la información de este candidato al contacto existente. No se
              reemplaza nada de lo que ya tiene: su teléfono principal y los datos cargados a
              mano se conservan tal como están.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={mergingIntoExisting}
            onClick={handleDiscardDuplicate}
          >
            Descartar como duplicado
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={mergingIntoExisting}
            onClick={() => void handleMergeIntoExistingContact()}
          >
            {mergingIntoExisting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Agregando…
              </>
            ) : (
              'Agregar información al contacto existente'
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
          {lushaPhoneFallbackCopy.phoneTypeWarning}
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

    {/* AGENT2A-PHONE-WATERFALL-4D: aquí vivía el modal ÚNICO del waterfall. Ya no
        existe ningún diálogo del waterfall — ni «Confirmar y revelar», ni
        «Cancelar»: el botón ejecuta, y el flujo, el tope, el desglose por proveedor
        y las advertencias se leen debajo del botón ANTES del clic. El diálogo del
        fallback manual de Lusha (flag OFF) queda intacto arriba. */}

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
