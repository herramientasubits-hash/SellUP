// BR-SOURCE FUNCTIONAL CUT E — el puente mínimo entre el cliente Supabase-shaped y un PostgreSQL real.
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ NO BASTA EL SHIM DE CUT B
// ═══════════════════════════════════════════════════════════════════
//
// `br-receita-cut-b-postgrest-shim.ts` traduce la superficie de LECTURA (`from().select().eq()`)
// y deliberadamente NADA más, para que una prueba no pueda escribir por el atajo del lector. Esa
// restricción sigue siendo correcta para los cortes B y C, que sólo leen.
//
// CUT D introduce una operación que no es una lectura: la promoción vallada vive en una FUNCIÓN de
// PostgreSQL, y el bucle de decisión de `run-fenced-identity-promotion.ts` la alcanza por `.rpc()`,
// igual que `loadBatchIdentityRegistry` alcanza `read_batch_identity_snapshot`. Sin `.rpc` ninguno
// de los dos puede correr contra la base real:
//
//   · `loadBatchIdentityRegistry` trata un cliente SIN `.rpc` como una DEGRADACIÓN cerrada
//     (`degraded: true`, `epoch: null`) — correcto, y también inútil para probar la valla;
//   · `promoteCandidateFiscalIdentityFenced` devuelve `promotion_client_without_rpc`, que es un
//     fallo real y no `capability_absent`.
//
// Es decir: un cliente sin `.rpc` no prueba la valla, prueba su ausencia. Este shim añade
// EXACTAMENTE `.rpc()` sobre la superficie de lectura ya existente, y nada más.
//
// ── 🔴 Por qué los argumentos viajan con NOMBRE ─────────────────────────────
//
// `SELECT public.fn($1, $2, …)` ata la prueba al ORDEN de los parámetros declarados en la
// migración. PostgREST invoca por NOMBRE, así que una migración que reordenara sus parámetros
// rompería Producción y dejaría esta prueba en verde. `fn(p_batch_id => $1, …)` reproduce la
// invocación por nombre y por tanto también reproduce ese modo de fallo.
//
// ── 🔴 Por qué un 42883 se traduce y no se lanza ────────────────────────────
//
// «la función no existe» es la señal EXACTA con la que la cadena CUT-3B4/CUT-D distingue «la
// migración no está aplicada» de «la llamada falló»: `isMissingFenceCapabilityError` reconoce
// 42883 y PGRST202. Un shim que lanzara el error del driver en vez de devolverlo como `{ error }`
// convertiría esa distinción en una excepción, y el camino `CAPABILITY_ABSENT` quedaría sin probar.
//
// NO es código de producción: vive bajo `__tests__/support`, nadie lo importa desde `src`, no lee
// un flag, no crea un cliente de Supabase y no toca Producción ni ninguna base remota.

import type { SupabaseClient } from '@supabase/supabase-js';

import { createPostgrestShimClient, type ShimSqlClient } from './br-receita-cut-b-postgrest-shim';

/** Identificador de función admisible. Un shim de pruebas también valida lo que interpola. */
const SAFE_FUNCTION = /^[a-z_][a-z0-9_]*$/;

/** Nombre de argumento admisible. Mismo motivo. */
const SAFE_ARGUMENT = /^[a-z_][a-z0-9_]*$/;

export interface ShimRpcError {
  readonly code: string;
  readonly message: string;
}

/**
 * Traduce un fallo del driver a la forma `{ data, error }` que el contrato de Supabase promete.
 *
 * 🔴 El mensaje se REEMPLAZA por una constante. Un cuerpo de error de PostgreSQL sobre esta
 * llamada puede citar los argumentos, y uno de ellos es un CNPJ — la misma razón por la que
 * `promoteCandidateFiscalIdentityFenced` reenvía el código y nunca el texto.
 */
function toRpcError(error: unknown): ShimRpcError {
  const code =
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'shim_rpc_error';
  return { code, message: 'rpc failed' };
}

export interface CutESupabaseShimOptions {
  /**
   * Nombres de función que este shim debe fingir INEXISTENTES, respondiendo 42883.
   *
   * Existe para poder ejercitar el camino `CAPABILITY_ABSENT` sobre la MISMA base en la que la
   * función sí está — sin desaplicar una migración, que es una operación que PostgreSQL no ofrece.
   */
  readonly pretendMissing?: ReadonlySet<string>;
}

/**
 * Un cliente Supabase-shaped respaldado por un PostgreSQL real: lectura (heredada del shim de
 * CUT B) más `.rpc()`.
 *
 * Sigue sin exponer `insert`, `upsert` ni `delete`: lo que este corte necesita escribir se escribe
 * por el ejecutor real o por la función vallada, nunca por un atajo del cliente.
 */
export function createCutESupabaseShim(
  sql: ShimSqlClient,
  options: CutESupabaseShimOptions = {},
): SupabaseClient {
  const read = createPostgrestShimClient(sql);
  const pretendMissing = options.pretendMissing ?? new Set<string>();

  const rpc = async (
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<{ data: unknown; error: ShimRpcError | null }> => {
    if (!SAFE_FUNCTION.test(name)) {
      return { data: null, error: { code: 'shim_unsafe_function', message: 'rpc failed' } };
    }
    if (pretendMissing.has(name)) {
      // Exactamente lo que diría PostgreSQL: función inexistente.
      return { data: null, error: { code: '42883', message: 'rpc failed' } };
    }

    const names = Object.keys(args);
    for (const argument of names) {
      if (!SAFE_ARGUMENT.test(argument)) {
        return { data: null, error: { code: 'shim_unsafe_argument', message: 'rpc failed' } };
      }
    }

    const values = names.map((argument) => args[argument]);
    const bindings = names
      .map((argument, index) => `${argument} => $${index + 1}`)
      .join(', ');
    const statement = `SELECT public.${name}(${bindings}) AS payload`;

    try {
      const result = await sql.query(statement, values);
      const row = result.rows[0];
      return { data: row === undefined ? null : (row.payload ?? null), error: null };
    } catch (error) {
      return { data: null, error: toRpcError(error) };
    }
  };

  return {
    from: (table: string) => (read as unknown as { from: (name: string) => unknown }).from(table),
    rpc,
  } as unknown as SupabaseClient;
}
