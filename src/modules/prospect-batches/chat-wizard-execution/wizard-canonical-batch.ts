/**
 * wizard-canonical-batch.ts — EL lote de una ejecución del wizard, resuelto UNA vez.
 *
 * AGENT1-LOCAL-CUT5-SINGLE-BATCH-PLUMBING §§ 4, 5, 12, 13, 14.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * Antes de este corte, UNA ejecución del wizard podía terminar en DOS lotes:
 *
 *   paso 5d  capa gratuita (country-source)  → `writeStructuredSourceCandidatesPreview`
 *                                              creaba su PROPIO lote
 *   paso 9   reserva del slot                → `reserveWizardExecutionSlot` creaba OTRO
 *   paso 11  Apollo / Tavily                 → escribían en el del paso 9
 *
 * El lote no faltaba: faltaba ANTES. La capa gratuita corre en el paso 5d y la
 * reserva ocurría en el paso 9, así que en el momento de persistir lo gratuito no
 * existía todavía ningún identificador canónico que pasarle — y el writer, que sí
 * acepta `batchId`, no tenía más remedio que crear uno.
 *
 * ── Por qué un resolutor y no simplemente subir la reserva ───────────────────
 *
 * Subir el paso 9 por encima del 5d habría creado el lote SIEMPRE, también en las
 * corridas que el presupuesto bloquea en el paso 7 — que hoy no crean nada. Cada
 * clic de una persona sin cupo dejaría un lote vacío en `draft`.
 *
 * 🔴 El orden 5d → 6 → 7 NO se toca: que todo lo gratuito ocurra antes de estimar
 * créditos y antes de reservar es el hito entero de
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1. Reordenarlo para poder compartir
 * el lote habría arreglado este corte rompiendo uno cerrado.
 *
 * Así que el lote se resuelve PEREZOSAMENTE: existe la autoridad desde el
 * principio, y la fila nace en el primer momento en que alguien de verdad la
 * necesita — la capa gratuita cuando tiene empresas que escribir, o el paso 9
 * cuando la ruta de pago va a correr. Quien bloquea antes de las dos cosas sigue
 * sin dejar lote, exactamente como antes.
 *
 * ── Qué garantiza ────────────────────────────────────────────────────────────
 *
 * · Una sola reserva EFECTIVA por ejecución. Las llamadas concurrentes comparten
 *   la MISMA promesa en vuelo, así que dos ramas que resuelvan a la vez no pueden
 *   producir dos reservas (§ 14).
 * · El resultado exitoso se memoriza: toda rama posterior recibe el mismo id.
 * · Un fallo NO se memoriza. La reserva es idempotente en la base por el índice
 *   único `(created_by, client_request_id)`, así que reintentar no puede duplicar
 *   el lote; memorizar el fallo, en cambio, dejaría que un tropiezo transitorio de
 *   la capa gratuita —que falla ABIERTO por diseño— envenenara para siempre a la
 *   ruta de pago, que hoy no depende de ella.
 *
 * ── Lo que este módulo NO es ─────────────────────────────────────────────────
 *
 * No es un "batch resolver" por proveedor (§ 4): es UNO por ejecución, y los
 * proveedores lo reciben ya resuelto. No guarda estado de módulo, ni caché
 * global, ni "último lote" (§ 13): la instancia vive dentro de una sola llamada a
 * `executeProspectWizardGeneration` y muere con ella. La identidad durable sigue
 * siendo la que ya existía —`(created_by, client_request_id)`—; aquí no se
 * inventa ninguna (§ 12).
 */

import type {
  WizardExecutionReservationInput,
  WizardExecutionReservationResult,
} from './wizard-idempotency';

/** La firma que el orquestador ya inyecta como `deps.reserveSlot`. */
export type ReserveWizardSlot = (
  input: WizardExecutionReservationInput,
) => Promise<WizardExecutionReservationResult>;

export type CanonicalWizardBatchResolver = {
  /**
   * Devuelve la reserva canónica de ESTA ejecución, creándola si aún no existe.
   *
   * Idempotente por construcción: la primera llamada reserva, las siguientes
   * devuelven exactamente el mismo resultado sin volver a tocar la base.
   */
  resolve: () => Promise<WizardExecutionReservationResult>;
  /**
   * ¿Se ha materializado ya la fila del lote en esta ejecución?
   *
   * Sólo observacional —para telemetría y para las pruebas que comprueban que una
   * corrida bloqueada por presupuesto no dejó lote—. Nunca decide nada.
   */
  isMaterialized: () => boolean;
};

/**
 * Crea el resolutor del lote canónico para UNA ejecución del wizard.
 *
 * El `input` se fija en la construcción a propósito: la petición del lote es
 * verdad de la PETICIÓN (objetivo, país, industria, taxonomía, proveedor
 * resuelto) y no puede depender de qué rama llegue primero a resolverlo. Si la
 * capa gratuita y la ruta de pago pudieran pasar cada una su propio payload, el
 * contenido del lote dependería del orden de ejecución.
 */
export function createCanonicalWizardBatchResolver(
  reserveSlot: ReserveWizardSlot,
  input: WizardExecutionReservationInput,
): CanonicalWizardBatchResolver {
  let settled: WizardExecutionReservationResult | null = null;
  let inFlight: Promise<WizardExecutionReservationResult> | null = null;

  const resolve = async (): Promise<WizardExecutionReservationResult> => {
    if (settled !== null) return settled;
    if (inFlight !== null) return inFlight;

    const attempt = (async () => {
      const result = await reserveSlot(input);
      settled = result;
      return result;
    })();

    inFlight = attempt;

    try {
      return await attempt;
    } catch (error) {
      // El fallo no se memoriza — ver la cabecera. La valla contra el lote
      // duplicado es el índice único de la base, no este cierre.
      inFlight = null;
      throw error;
    }
  };

  return {
    resolve,
    isMaterialized: () => settled !== null,
  };
}
