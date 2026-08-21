/**
 * AGENT2A-PHONE-REVEAL-4O-H3-B-R1 — reconocer las señales de control de flujo de Next.
 *
 * `redirect()` y `notFound()` no devuelven: señalizan LANZANDO un Error con un `digest`
 * convenido. Un `catch` que las trate como fallos rompe DOS cosas a la vez: cancela la
 * navegación que el framework iba a hacer, y reporta al usuario un error que no ocurrió
 * («no se pudo cargar el candidato» cuando en realidad su sesión caducó).
 *
 * Se detecta por el `digest`, que es el contrato observable y estable, en lugar de importar
 * `isRedirectError` desde `next/dist/client/components/redirect-error` — una ruta interna que
 * no es API pública y que cambia entre versiones de Next.
 */

/** Prefijo del digest de `redirect()` / `permanentRedirect()`. */
const REDIRECT_DIGEST_PREFIX = 'NEXT_REDIRECT';

/** Prefijo del digest de `notFound()` y del resto de los HTTP access fallbacks. */
const HTTP_ERROR_FALLBACK_DIGEST_PREFIX = 'NEXT_HTTP_ERROR_FALLBACK';

/**
 * `true` cuando el valor capturado es una señal de control de flujo de Next y por tanto debe
 * RE-LANZARSE intacta, no tratarse como un fallo.
 */
export function isNextControlFlowSignal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { digest } = error as { digest?: unknown };
  if (typeof digest !== 'string') return false;

  return (
    digest === REDIRECT_DIGEST_PREFIX ||
    digest.startsWith(`${REDIRECT_DIGEST_PREFIX};`) ||
    digest === HTTP_ERROR_FALLBACK_DIGEST_PREFIX ||
    digest.startsWith(`${HTTP_ERROR_FALLBACK_DIGEST_PREFIX};`)
  );
}
