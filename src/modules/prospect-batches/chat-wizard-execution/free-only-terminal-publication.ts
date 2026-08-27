/**
 * free-only-terminal-publication.ts — la ÚNICA publicación durable de una
 * corrida en la que el proveedor de pago no llegó a existir.
 *
 * AGENT1-LOCAL-CUT8B-FREE-ONLY-ACCEPTANCE-DURABLE-PUBLICATION.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * CUT-8 llevó la aceptación hacia el objetivo a las dos superficies que la deben
 * decir, pero por una costura que sólo existe en la ruta de PAGO: el writer de
 * candidatos resuelve `resolveExtraBatchMetadata(...)` y esparce lo devuelto en
 * la única escritura de metadata que ya hacía. En la rama sólo-gratuita ese
 * writer NO corre, así que el bloque canónico no se publicaba en ninguna parte:
 *
 *   free-only → aceptación correcta → UI correcta → lote durable correcto
 *             → `metadata.accepted_for_target` AUSENTE
 *
 * ── Por qué el sellado terminal y no un writer nuevo ─────────────────────────
 *
 * Las dos salidas obvias eran peores:
 *
 *   · un UPDATE extra desde el mago — una publicación INDEPENDIENTE más por
 *     ejecución, exactamente lo que este corte prohíbe;
 *   · publicar desde el writer de fuentes estructuradas — que al ADOPTAR el lote
 *     canónico no escribe ni una vez en `prospect_batches`, así que darle la
 *     costura significaría abrirle una escritura que hoy no tiene. Y su único
 *     punto de publicación —la creación del lote— ocurre ANTES de saber qué se
 *     persistió, que es justo el dato del que depende el bloque.
 *
 * La rama sólo-gratuita YA tiene una escritura terminal sobre la fila: el
 * sellado de estado de CUT-5 § 11 / CUT-6 § 13. Es post-outcome, es la última, y
 * es la única. Llevar la metadata EN ELLA deja la rama libre con la misma forma
 * que la mixta —una escritura terminal que carga `status` y `metadata` a la vez,
 * literalmente lo que hace `candidate-writer`— sin añadir ni una escritura.
 *
 * ── 🔴 Lo que este módulo NO hace ────────────────────────────────────────────
 *
 * No calcula aceptación. No sabe de objetivos, de huecos ni de proveedores. La
 * cifra llega ya resuelta por `resolveAcceptedForTarget` y ya serializada por
 * `toAcceptedForTargetMetadata`; aquí sólo se decide cómo convive con lo que la
 * fila ya tenía.
 *
 * Puro: sin I/O, sin env, sin Supabase, sin reloj.
 */

/**
 * Compone la metadata terminal de la rama sólo-gratuita.
 *
 * 🔴 Es una SUSTITUCIÓN de claves, no un `metadata || ...` de Postgres ni un
 * merge profundo. La diferencia importa: un merge recursivo podría fusionar dos
 * versiones del MISMO bloque y publicar un híbrido que ninguna corrida produjo.
 * Aquí la clave que el corte publica gana entera y las demás se conservan
 * intactas, que es el mismo criterio con el que el writer de pago compone su
 * `finalMetadata`.
 *
 * 🔴 `current` se relee de la fila y NO se reconstruye desde la petición. La
 * reserva escribe procedencia que esta capa no conoce —selección de proveedor,
 * taxonomía, criterios— y reconstruirla aquí la publicaría a medias en cuanto
 * alguien añadiera una clave allí sin acordarse de este archivo.
 *
 * Una `current` ilegible (nula, array, escalar) se trata como AUSENCIA y no como
 * error: el bloque de aceptación es verdad de esta corrida y no puede perderse
 * porque la fila traiga una forma inesperada.
 */
export function composeFreeOnlyTerminalBatchMetadata(
  current: unknown,
  published: Record<string, unknown> | null,
): Record<string, unknown> {
  const base =
    typeof current === 'object' && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  if (published === null) return { ...base };
  return { ...base, ...published };
}
