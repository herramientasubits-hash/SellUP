import { CheckCircle2, GitMerge, Upload } from "@/icons";
import type { QuickFilterDefinition } from '@/components/filters/quick-filter-strip';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

// ── Indicadores de «Por revisar» que filtran ───────────────────
// Eran cuatro tarjetas de métricas contadas en el servidor
// (`getGlobalProspectsKPIs`). Ahora se cuentan sobre las mismas filas que pinta
// la tabla —con las MISMAS reglas que aquella consulta— y son botones: el
// número de cada uno es exactamente lo que queda al pulsarlo. «Pendientes de
// revisión» es el total de la franja; los otros tres son los indicadores.
//
// Viven aparte de la tabla para poder probar las reglas sin montarla.

const PENDING_REVIEW_STATUSES: readonly string[] = ['needs_review', 'generated', 'normalized'];
const UNBLOCKED_DUPLICATE_STATUSES: readonly string[] = ['no_match', 'related_company', 'possible_duplicate'];
const RECENT_IMPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param now El instante contra el que se mide «esta semana» (ms). Se pasa
 * desde fuera para que el recuento no cambie de un render a otro.
 */
export function buildProspectQuickFilters(
  now: number,
): QuickFilterDefinition<ProspectCandidateWithReviewer>[] {
  return [
    {
      id: 'unblocked',
      // «Detectados» importa: no promete que se pueda aprobar, solo que no se
      // encontró nada que lo impida. Nunca «Listos para aprobar».
      label: 'Sin bloqueos detectados',
      icon: CheckCircle2,
      tone: 'positive',
      // Candidatos sin señales bloqueantes: en revisión, sin veto de revisión y
      // sin duplicado exacto, sin verificar ni datos insuficientes.
      predicate: (row) =>
        PENDING_REVIEW_STATUSES.includes(row.status) &&
        (row.review_status === null ||
          row.review_status === undefined ||
          row.review_status === 'ready_for_approval') &&
        UNBLOCKED_DUPLICATE_STATUSES.includes(row.duplicate_status),
    },
    {
      id: 'possible_duplicates',
      label: 'Posibles duplicados',
      icon: GitMerge,
      tone: 'warning',
      predicate: (row) =>
        PENDING_REVIEW_STATUSES.includes(row.status) && row.duplicate_status === 'possible_duplicate',
    },
    {
      id: 'imported_recently',
      label: 'Importados esta semana',
      icon: Upload,
      tone: 'neutral',
      predicate: (row) =>
        row.source_primary === 'external_import' &&
        Boolean(row.created_at) &&
        now - new Date(row.created_at).getTime() <= RECENT_IMPORT_WINDOW_MS,
    },
  ];
}
