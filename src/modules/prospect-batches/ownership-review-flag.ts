/**
 * ownership-review-flag.ts — AGENT1-OWNERSHIP-REVIEW-VISIBILITY (opción C).
 *
 * La marca que hace VISIBLE, en la cola y en la ficha, que la relación entre la
 * empresa y su dominio no está verificada.
 *
 * ── 🔴 Qué problema resuelve ────────────────────────────────────────────────
 *
 * Desde X6.12 la ruta Lusha evalúa ownership y persiste su veredicto, pero el
 * veredicto vivía SÓLO en `metadata.ownership_gate`: la fila entraba en la
 * misma cola (`record_origin='production' AND status='needs_review'`) sin
 * ninguna señal, y ningún componente leía esa clave. Quien revisaba no podía
 * distinguir una empresa acreditada de una que no lo está.
 *
 * ── 🔴 Qué NO significa esta marca, y por qué importa tanto ─────────────────
 *
 * NO dice que el dominio sea incorrecto. Dice que NO SE PUDO VERIFICAR la
 * relación. Son cosas distintas y la diferencia está medida: sobre las ocho
 * filas Lusha reales del lote `bedebe9b`, el heurístico textual no acredita a
 * dos —`D1 S.A.S ↔ tiendasd1.com` y `Sodimac Colombia ↔ homecenter.com.co`— y
 * las dos son dueñas legítimas de su dominio. Las dos salen
 * `insufficient_evidence` en la capa estructural: ausencia de prueba, no prueba
 * en contra.
 *
 * Tampoco dice lo contrario: la ausencia de marca NO afirma que la relación
 * esté confirmada en una fila que nunca se evaluó. Por eso
 * `resolveOwnershipReviewFlags` distingue «no evaluada» de «evaluada y
 * acreditada», y en el primer caso no escribe nada.
 *
 * ── 🔴 Qué NO hace ──────────────────────────────────────────────────────────
 *
 * · No cambia la política de ADMISIÓN de ningún proveedor: nadie se descarta ni
 *   se deja de descartar por esta marca.
 * · No hace que la candidata CUENTE hacia el mínimo ni la vuelve completa: eso
 *   lo decide el contrato canónico de completitud y no lee este módulo.
 * · No hay backfill: las filas históricas no se tocan, y una fila sin
 *   evaluación registrada no recibe veredicto inventado.
 *
 * Puro: sin IO, sin React, sin base.
 */

/** La marca, en el vocabulario de `prospect_candidates.review_flags`. */
export const OWNERSHIP_UNVERIFIED_REVIEW_FLAG = 'ownership_unverified' as const;

/** Etiqueta corta, para la cola. */
export const OWNERSHIP_UNVERIFIED_LABEL = 'Relación empresa–dominio no verificada';

/**
 * Explicación para la ficha. Dice las dos mitades a propósito: qué no se pudo
 * comprobar, y qué NO se está afirmando.
 */
export const OWNERSHIP_UNVERIFIED_DETAIL =
  'No pudimos verificar que este dominio pertenezca a esta empresa. No significa que el dominio sea incorrecto: significa que no hay evidencia suficiente para confirmarlo. Revísalo antes de aprobar.';

/** ¿Esta fila lleva la marca? Tolera `null`, ausencia y valores ajenos. */
export function hasOwnershipUnverifiedFlag(flags: unknown): boolean {
  return Array.isArray(flags) && flags.includes(OWNERSHIP_UNVERIFIED_REVIEW_FLAG);
}

/**
 * Los hechos —y sólo los hechos— con los que se decide la marca.
 *
 * 🔴 `evaluated: false` NO es lo mismo que `admitted: true`. Una fila que nadie
 * juzgó no lleva marca y tampoco lleva confirmación; el consumidor no puede
 * deducir nada de su ausencia, y eso es correcto.
 */
export type OwnershipReviewFlagFacts = {
  /** ¿Llegó a correr el gate sobre esta candidata? */
  readonly evaluated: boolean;
  /** ¿La costura de admisión la acreditó? Sólo se lee si `evaluated`. */
  readonly admitted: boolean;
};

/**
 * Las marcas de ownership que corresponden a una fila. Vacío cuando no hay nada
 * que decir: ni evaluada, o evaluada y acreditada.
 *
 * Devuelve una lista —y no un booleano— porque es lo que se concatena con las
 * marcas que otras capas ya escriben en la misma columna.
 */
export function resolveOwnershipReviewFlags(
  facts: OwnershipReviewFlagFacts,
): readonly string[] {
  if (!facts.evaluated) return [];
  return facts.admitted ? [] : [OWNERSHIP_UNVERIFIED_REVIEW_FLAG];
}
