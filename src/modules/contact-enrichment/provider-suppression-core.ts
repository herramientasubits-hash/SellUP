// Agente 2A — SUPRESIÓN NATIVA DEL PROVEEDOR, independiente de la cuenta
// (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4, Fase 1)
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE ESTE MÓDULO
// ═══════════════════════════════════════════════════════════════════
//
// Hasta la Fase 1 la privacidad del teléfono se evaluaba con la clave de la CACHÉ:
//
//     (provider = 'apollo', provider_person_id, account_id)
//
// Esa clave nunca se diseñó para privacidad. Es la clave de REUTILIZACIÓN: la cuenta
// está dentro porque un teléfono pagado por una cuenta no debe servirse a otra, y el
// proveedor está fijado a `apollo` por un CHECK porque la caché sólo guardó reveals de
// Apollo. La privacidad heredó esa forma por historia, no por diseño, y con ella heredó
// tres consecuencias equivocadas:
//
//   * sin cuenta no había clave ⇒ desde #289 el reveal se bloquea fail-closed y desde
//     #291 el botón se deshabilita con honestidad. Correcto, pero convierte en
//     inalcanzable todo el producto de pre-aprobación;
//   * un candidato de origen Lusha no podía llevar clave alguna ⇒ la supresión de un
//     titular de Lusha no era "no soportada": era INEXPRESABLE;
//   * la supresión moría con la cuenta (`ON DELETE CASCADE`), así que borrar una cuenta
//     borraba la propia constancia del borrado.
//
// Este módulo es la identidad y la decisión del NUEVO modelo. Es PURO: sin I/O, sin
// env, sin reloj, sin Supabase, seguro en el bundle del cliente y ejecutable offline.
// El acceso a la tabla vive en `provider-suppression-store.ts`; la composición con el
// modelo LEGADO vive en `phone-reveal-suppression-guard.ts`.
//
// ═══════════════════════════════════════════════════════════════════
// LÍMITE QUE NO SE PUEDE MAQUILLAR (Fase 1)
// ═══════════════════════════════════════════════════════════════════
//
// Esto NO es un sujeto de privacidad GLOBAL entre proveedores. Una supresión de Apollo
// garantiza bloqueo en Apollo; una de Lusha, en Lusha. NADA aquí deduce que la persona
// Apollo X y el contacto Lusha Y sean el mismo humano: no se mira LinkedIn, ni email,
// ni nombre, ni empresa, ni dominio, ni se hace matching difuso. Ese sujeto compartido
// —`privacy_subjects` + alias por proveedor + hash de LinkedIn— es Fase 2 y está
// deliberadamente AUSENTE. Afirmar lo contrario sería el peor error posible en un
// subsistema de privacidad: prometer una garantía que el esquema no puede cumplir.

import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import type { PhoneSuppressionNotEvaluableReason } from './phone-reveal-suppression-audit';

// ── Vocabulario ────────────────────────────────────────────────

/**
 * Proveedores que hoy pueden devolver un teléfono, y por tanto los únicos que pueden
 * tener supresión propia. Allowlist CERRADA en espejo exacto del CHECK de la migración
 * 120: un tercer proveedor llega con su propia migración y su propio validador de
 * identidad, nunca escribiendo un string nuevo.
 */
export const PROVIDER_SUPPRESSION_PROVIDERS = ['apollo', 'lusha'] as const;

export type SuppressionProvider = (typeof PROVIDER_SUPPRESSION_PROVIDERS)[number];

export function isSuppressionProvider(value: unknown): value is SuppressionProvider {
  return (
    typeof value === 'string' &&
    (PROVIDER_SUPPRESSION_PROVIDERS as readonly string[]).includes(value)
  );
}

/**
 * Identidad NATIVA del proveedor. Las dos partes van SIEMPRE juntas porque
 * `providerPersonId` no significa nada por sí solo: sólo tiene sentido dentro del
 * espacio de nombres de su proveedor. Un id de Apollo y un id de Lusha nunca se
 * comparan entre sí, ni se traducen, ni se normalizan a una forma común.
 */
export interface ProviderSuppressionIdentity {
  provider: SuppressionProvider;
  providerPersonId: string;
}

/**
 * Proyección MÍNIMA de la fila de `provider_suppressions`. No incluye teléfono —la
 * tabla no tiene columna de teléfono— ni cuenta: la ausencia de cuenta en este tipo es
 * parte del contrato, no una omisión.
 */
export interface ProviderSuppressionRecord {
  suppressedAt: string | null;
}

export type ProviderSuppressionStatus = 'suppressed' | 'not_suppressed';

/**
 * Desenlace del chequeo. Tres estados y NINGUNO significa "no se pudo evaluar por falta
 * de cuenta": ese caso desaparece en la Fase 1.
 *
 *   * `clear`             — se consultó y no hay supresión;
 *   * `suppressed`        — existe supresión para esa identidad nativa;
 *   * `check_unavailable` — no se pudo consultar (dep no cableada o lectura fallida).
 *
 * `check_unavailable` NUNCA se degrada a `clear`: "no pude confirmar que NO está
 * suprimido" no equivale a "no está suprimido".
 */
export type ProviderSuppressionOutcome = 'clear' | 'suppressed' | 'check_unavailable';

export type ProviderSuppressionLookup = (
  key: ProviderSuppressionIdentity,
) => Promise<ProviderSuppressionRecord | null>;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ── Resolución de identidad ────────────────────────────────────

/**
 * Entrada de la resolución: exactamente las columnas del candidato que la deciden.
 * `accountId` NO aparece a propósito y no debe añadirse: en el momento en que la
 * identidad dependa de la cuenta, "sin cuenta" vuelve a significar "sin privacidad".
 */
export interface ProviderIdentityInput {
  /** Columna `contact_enrichment_candidates.apollo_person_id` (mig. 098). */
  apolloPersonId?: string | null;
  /** Origen del candidato (`contact_enrichment_candidates.source`). */
  source?: string | null;
  /** Columna `contact_enrichment_candidates.source_contact_id`. */
  sourceContactId?: string | null;
  /**
   * Id de persona que el propio payload del proveedor acaba de confirmar (webhook /
   * recovery de Apollo). Tiene prioridad porque es el id que Apollo afirma AHORA para
   * esta persona. Pasa por el mismo validador que los demás.
   */
  payloadApolloPersonId?: string | null;
}

/**
 * Resuelve la identidad nativa con la que se evalúa la supresión. Devuelve `null`
 * cuando ninguna es resoluble; ese caso es fail-closed en los llamadores y NUNCA se
 * resuelve por inferencia.
 *
 * PRECEDENCIA — Apollo primero, Lusha como alternativa:
 *
 *   1. `payloadApolloPersonId` válido           ⇒ apollo
 *   2. `apolloPersonId` válido                  ⇒ apollo
 *   3. `source === 'apollo'` + `source_contact_id` válido ⇒ apollo
 *   4. `source === 'lusha'` + `source_contact_id` no vacío ⇒ lusha
 *   5. nada                                     ⇒ null
 *
 * Los pasos 1–3 son EXACTAMENTE el orden que ya aplicaban
 * `resolvePhoneCachePersonId` (START, caché, UI de #291) y
 * `resolveInFlightSuppressionPersonId` (webhook / recovery / puerta Lusha), con el
 * MISMO validador de 24 hex. La validación de Apollo no se relaja en ningún punto: un
 * id de otro proveedor —un `v1.*` de Lusha, por ejemplo— sigue siendo descartado como
 * id de Apollo. Lo único nuevo es el paso 4.
 *
 * Que Apollo tenga precedencia NO es una preferencia estética: preserva literalmente la
 * clave con la que las supresiones históricas se escribieron, así que ningún candidato
 * que hoy se evalúa contra un tombstone de Apollo empieza a evaluarse contra otra cosa.
 *
 * El id de Lusha se usa TAL CUAL está almacenado. No se normaliza, no se recorta más
 * allá del espacio en blanco y no se valida contra un formato: el proveedor es el dueño
 * de la forma de su identificador, y una expresión regular inventada aquí sólo podría
 * RECHAZAR identidades legítimas y devolver el caso al fail-closed que este hito abre.
 */
export function resolvePhoneRevealProviderIdentity(
  input: ProviderIdentityInput,
): ProviderSuppressionIdentity | null {
  const fromPayload = normalizeApolloPersonId(input.payloadApolloPersonId);
  if (fromPayload) return { provider: 'apollo', providerPersonId: fromPayload };

  const fromColumn = normalizeApolloPersonId(input.apolloPersonId);
  if (fromColumn) return { provider: 'apollo', providerPersonId: fromColumn };

  const source = cleanText(input.source)?.toLowerCase() ?? null;
  const rawSourceContactId = cleanText(input.sourceContactId);

  if (source === 'apollo') {
    const fromSource = normalizeApolloPersonId(rawSourceContactId);
    return fromSource ? { provider: 'apollo', providerPersonId: fromSource } : null;
  }

  if (source === 'lusha' && rawSourceContactId) {
    return { provider: 'lusha', providerPersonId: rawSourceContactId };
  }

  return null;
}

/**
 * TODAS las identidades nativas que ESTE MISMO registro de candidato lleva de forma
 * determinista. Se usa SÓLO en el camino de ESCRITURA de la supresión, para que una
 * DSAR sobre un candidato que carga las dos identidades bloquee las dos en lugar de
 * sólo la que gana la precedencia.
 *
 * No es inferencia entre proveedores: las dos identidades están escritas en la MISMA
 * fila del MISMO candidato, que representa a UNA persona. No se mira nombre, email,
 * LinkedIn, empresa ni dominio, y no se cruza con ningún otro registro. Un candidato
 * distinto con "el mismo aspecto" no aporta ni una identidad a esta lista.
 *
 * Consecuencia declarada: esto NO convierte la Fase 1 en supresión global entre
 * proveedores. Sólo alcanza a los pares que un candidato concreto ya declaraba juntos;
 * dos identidades del mismo humano que nunca coincidieron en una fila siguen siendo
 * Fase 2.
 */
export function resolveAllPhoneRevealProviderIdentities(
  input: ProviderIdentityInput,
): ProviderSuppressionIdentity[] {
  const found: ProviderSuppressionIdentity[] = [];
  const seen = new Set<string>();
  const push = (identity: ProviderSuppressionIdentity | null) => {
    if (!identity) return;
    const key = `${identity.provider}::${identity.providerPersonId}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(identity);
  };

  push(resolvePhoneRevealProviderIdentity(input));

  // La identidad de Lusha del MISMO registro, que la precedencia de Apollo habría
  // tapado. Se pide explícitamente en vez de reordenar la precedencia, porque el orden
  // de lectura tiene que seguir siendo idéntico al histórico.
  const source = cleanText(input.source)?.toLowerCase() ?? null;
  const rawSourceContactId = cleanText(input.sourceContactId);
  if (source === 'lusha' && rawSourceContactId) {
    push({ provider: 'lusha', providerPersonId: rawSourceContactId });
  }

  return found;
}

// ── Decisión ───────────────────────────────────────────────────

/**
 * ¿Existe supresión? Sin fila ⇒ nunca se suprimió. Con fila y `suppressed_at` ⇒
 * suprimida. Un FALLO de lectura no se representa aquí: lo traduce
 * `checkProviderSuppression` a `check_unavailable`.
 *
 * La columna `suppressed_at` es `NOT NULL` en la migración 120, así que la mera
 * existencia de la fila ya implica supresión; se comprueba el valor igualmente para que
 * este predicado no dependa de una restricción que vive en otro archivo.
 */
export function evaluateProviderSuppressionRecord(
  record: ProviderSuppressionRecord | null,
): ProviderSuppressionStatus {
  if (!record) return 'not_suppressed';
  return cleanText(record.suppressedAt) ? 'suppressed' : 'not_suppressed';
}

/**
 * LECTURA CANÓNICA del nuevo modelo. Única función que el resto del sistema usa para
 * preguntar "¿está suprimida esta identidad?".
 *
 * Fail-closed en los dos modos de fallo, por la misma razón en ambos:
 *
 *   * dep no cableada ⇒ `check_unavailable`. Un wiring incompleto no puede convertirse
 *     en "no hay supresión";
 *   * la lectura lanza (tabla ausente, permisos, timeout) ⇒ `check_unavailable`.
 *
 * NUNCA lanza y NUNCA lee `accountId`: no lo recibe, así que no puede. Esa ausencia es
 * el contenido del hito y hay un ratchet que la vigila.
 */
export async function checkProviderSuppression(args: {
  identity: ProviderSuppressionIdentity;
  lookup?: ProviderSuppressionLookup;
}): Promise<ProviderSuppressionOutcome> {
  const providerPersonId = cleanText(args.identity?.providerPersonId);
  if (!args.identity || !isSuppressionProvider(args.identity.provider) || !providerPersonId) {
    // Una identidad mal formada NO es "no hay supresión". El llamador ya distingue el
    // caso "no resoluble" antes de llegar aquí; esto es la defensa en profundidad.
    return 'check_unavailable';
  }
  if (!args.lookup) return 'check_unavailable';

  let record: ProviderSuppressionRecord | null;
  try {
    record = await args.lookup({
      provider: args.identity.provider,
      providerPersonId,
    });
  } catch {
    // Sin el mensaje del driver: PostgreSQL cita valores de la query en sus errores y
    // uno de esos valores es un identificador de persona. El llamador ya tiene su
    // propio redactor para lo que necesite registrar.
    return 'check_unavailable';
  }

  return evaluateProviderSuppressionRecord(record) === 'suppressed'
    ? 'suppressed'
    : 'clear';
}

// ── Clave y evaluación de los CUATRO gates ─────────────────────
//
// Esta sección vive AQUÍ y no en `phone-reveal-suppression-guard.ts` por una razón
// estructural, no de gusto: la guarda importa `redactDriverMessage` de
// `phone-reveal-core`, y el START —que ESTÁ en `phone-reveal-core`— tiene que poder
// llamar a la evaluación. Definirla en la guarda crearía el ciclo de imports que este
// subsistema ya evitó una vez al sacar el vocabulario de auditoría a su propio módulo.
//
// Este archivo es HOJA (sólo depende del validador de id de Apollo y del vocabulario de
// auditoría, que también es hoja), así que puede ser importado por los cuatro gates sin
// ciclo. El redactor de mensajes del driver entra por INYECCIÓN.

/**
 * Clave con la que los cuatro gates preguntan por la supresión.
 *
 * `provider` + `providerPersonId` son la identidad NATIVA: obligatorios, y el único
 * requisito del modelo nuevo.
 *
 * `accountId` es OPCIONAL y existe EXCLUSIVAMENTE para la mitad LEGADO (el tombstone
 * acotado por cuenta de `phone_reveal_cache`). Su ausencia OMITE ese chequeo; nunca lo
 * convierte en bloqueo y nunca impide el chequeo nativo. Esa asimetría ES la Fase 1: la
 * cuenta puede AÑADIR un motivo de bloqueo, pero ya no puede quitar la capacidad de
 * evaluar.
 */
export interface PhoneRevealSuppressionLookupKey extends ProviderSuppressionIdentity {
  accountId?: string | null;
}

export type PhoneRevealSuppressionLookup = (
  key: PhoneRevealSuppressionLookupKey,
) => Promise<ProviderSuppressionRecord | null>;

/**
 * Desenlace de la evaluación de los gates. Cuatro variantes, ESTRUCTURALMENTE
 * IDÉNTICAS a `InFlightSuppressionEvaluation` (la del modelo legado) a propósito: así
 * las ramas de decisión del START, del webhook, del recovery y de la puerta previa a
 * Lusha —y con ellas toda la política terminal de 4O-E1— no cambian ni una línea.
 *
 * `not_evaluable` sobrevive con un significado ESTRICTAMENTE más estrecho que antes:
 * ninguna identidad nativa resoluble. Ya NO incluye "sin cuenta". Sigue siendo
 * fail-closed en los cuatro llamadores y sigue sin resolverse por inferencia.
 */
export type PhoneRevealSuppressionEvaluation =
  | { kind: 'allowed' }
  | { kind: 'not_evaluable'; reason: PhoneSuppressionNotEvaluableReason }
  | { kind: 'blocked_suppressed' }
  | { kind: 'check_unavailable'; message: string };

/**
 * Resuelve la identidad nativa de un reveal EN VUELO. Espejo de
 * `resolveInFlightSuppressionPersonId` (que sigue existiendo, intacto, para el modelo
 * legado): MISMA precedencia de Apollo, MISMO validador de 24 hex, más la alternativa
 * de Lusha.
 */
export function resolveInFlightProviderIdentity(args: {
  payloadPersonId?: string | null;
  candidateApolloPersonId?: string | null;
  candidateSource?: string | null;
  candidateSourceContactId?: string | null;
}): ProviderSuppressionIdentity | null {
  return resolvePhoneRevealProviderIdentity({
    payloadApolloPersonId: args.payloadPersonId ?? null,
    apolloPersonId: args.candidateApolloPersonId ?? null,
    source: args.candidateSource ?? null,
    sourceContactId: args.candidateSourceContactId ?? null,
  });
}

/**
 * Comprueba la supresión de una identidad nativa ANTES de llamar a un proveedor o de
 * persistir un teléfono. Fail-closed en los tres modos de fallo:
 *
 *   * identidad no resoluble ⇒ `not_evaluable` (el llamador bloquea, como desde #289);
 *   * dep no cableada        ⇒ `check_unavailable`;
 *   * la lectura lanza       ⇒ `check_unavailable`, con el mensaje pasado por el
 *     redactor INYECTADO (Postgres cita valores de la query en sus errores, así que el
 *     crudo podría llevar identificadores de persona).
 *
 * NUNCA lanza. La cuenta es OPCIONAL y su ausencia no produce ningún estado de bloqueo
 * propio: sólo hace que la mitad legada de la lectura compuesta no se consulte. No hay
 * ninguna rama en esta función que devuelva algo distinto por el hecho de que
 * `accountId` sea null — y hay un ratchet que lo comprueba.
 */
export async function evaluatePhoneRevealSuppression(args: {
  identity: ProviderSuppressionIdentity | null;
  /** Sólo para la mitad LEGADO de la lectura compuesta. Opcional por contrato. */
  accountId?: string | null;
  lookup?: PhoneRevealSuppressionLookup;
  /**
   * Redactor del mensaje del driver. Por inyección para mantener este módulo hoja; el
   * default no revela nada, así que un llamador que lo olvide falla hacia lo seguro.
   */
  redactError?: (raw: unknown) => string;
}): Promise<PhoneRevealSuppressionEvaluation> {
  const providerPersonId = cleanText(args.identity?.providerPersonId);
  if (!args.identity || !isSuppressionProvider(args.identity.provider) || !providerPersonId) {
    return { kind: 'not_evaluable', reason: 'missing_provider_person_id' };
  }

  if (!args.lookup) {
    return { kind: 'check_unavailable', message: 'suppression lookup not wired' };
  }

  let record: ProviderSuppressionRecord | null;
  try {
    record = await args.lookup({
      provider: args.identity.provider,
      providerPersonId,
      accountId: cleanText(args.accountId),
    });
  } catch (err) {
    const redact = args.redactError ?? (() => 'suppression lookup failed');
    return { kind: 'check_unavailable', message: redact(err) };
  }

  return evaluateProviderSuppressionRecord(record) === 'suppressed'
    ? { kind: 'blocked_suppressed' }
    : { kind: 'allowed' };
}

// ── Qué NO hay en este módulo, y por qué está escrito ──────────
//
// No hay `accountId` en `ProviderIdentityInput`, ni en `ProviderSuppressionIdentity`, ni
// en la firma de `checkProviderSuppression`. Esa ausencia es la Fase 1 entera y hay
// ratchets que la vigilan, porque es exactamente el tipo de cosa que una refactorización
// bienintencionada vuelve a añadir "para poder filtrar mejor".
//
// No hay email, LinkedIn, nombre, empresa ni dominio. No hay hashing de identidades para
// compararlas entre proveedores. No hay tabla de alias ni sujeto compartido. Todo eso es
// Fase 2 y su ausencia aquí es deliberada: la Fase 1 garantiza que una supresión de
// Apollo bloquea Apollo y una de Lusha bloquea Lusha, y NO garantiza que suprimir a una
// persona en un proveedor la suprima en el otro. Escribir esa garantía sin el sujeto
// compartido sería mentir en el único sitio del sistema donde mentir es inaceptable.
