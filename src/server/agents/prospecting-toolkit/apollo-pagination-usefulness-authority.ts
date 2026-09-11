/**
 * AGENT1-APOLLO-PAGINATION-USEFULNESS-AUTHORITY-1
 *
 * ── EL DEFECTO QUE CIERRA ESTE MÓDULO ────────────────────────────────────────
 *
 * `apollo-organizations-search-provider.ts` pagina de verdad dentro de UNA
 * invocación cuando recibe `netNewTarget` + `evaluateCandidateAcceptance` (los
 * DOS). El motor (`apollo-organizations-paginated-search.ts`) llama al evaluador
 * una vez por organización NUEVA y acumula `acceptedForTargetCount`; cuando ese
 * contador alcanza `netNewTarget`,
 * `apollo-organizations-pagination-budget.ts` corta con
 * `stopReason: 'candidate_target_reached'` y no compra más páginas.
 *
 * Hasta este corte los DOS cableados vivos —`apollo-two-round/
 * production-runner.server.ts` e `incremental-search.ts`— alimentaban ese
 * contador con NOVEDAD HISTÓRICA a secas, cada uno con su propia copia del
 * cuerpo, y los dos abrían igual:
 *
 *     const normalizedDomain = organization.primaryDomain;
 *     if (normalizedDomain === null) return true;   // ← consume sin demostrar nada
 *
 * Resultado: una organización SIN dominio —y una con dominio que después moriría
 * por ownership, país o identidad— consumía el objetivo de paginación. Apollo
 * dejaba de comprar páginas aunque el rendimiento ÚTIL fuera 0. Es la
 * explicación directa del «Apollo = 0 útiles»: cinco novedades inservibles
 * cerraban la paginación en la página 1, con el objetivo declarado «alcanzado».
 *
 * Este módulo es la ÚNICA autoridad que decide qué organización consume el
 * objetivo de paginación. Los dos cableados la construyen desde aquí; ninguno
 * vuelve a escribir el cuerpo.
 *
 * ── QUÉ NO ES ────────────────────────────────────────────────────────────────
 *
 * 🔴 NO es un filtro de resultados. Las filas de una página YA PAGADA siguen
 * entrando COMPLETAS al pipeline: el motor hace `collected.push(organization)`
 * ANTES de consultar al evaluador, y este veredicto no puede quitar ninguna.
 * Lo único que decide es si se COMPRA la página siguiente.
 *
 * 🔴 NO relaja ningún gate, no mueve el objetivo de 5 (`targetEligibleCompanies`),
 * no toca `per_page = 100` / `maxPages = 5` / `maxRounds = 2`, no introduce
 * ningún tope crudo (`raw_result_cap_reached` sigue fuera del vocabulario) y no
 * abre I/O propio: el lector histórico se INYECTA.
 *
 * 🔴 NO es la aceptación FINAL. El writer sigue siendo la única autoridad de
 * `accepted_for_target`, después de enrichment, validación y persistencia. Una
 * organización que aquí consume el objetivo y luego muere en el writer no se
 * re-cuenta retroactivamente: eso lo decide el loop de rondas.
 *
 * ── CLASIFICACIÓN DE GATES (A/B/C/D) ─────────────────────────────────────────
 *
 * A = puro, gratis y evaluable con lo que Apollo devuelve EN ESE INSTANTE
 *     (`NormalizedApolloOrganization`) ⇒ PUEDE decidir la compra de páginas.
 * B = necesita información que sólo existe DESPUÉS (enrichment, construcción del
 *     candidato, writer, persistencia) ⇒ NO entra.
 * C = caro, con efecto de lado, o llamada a API ⇒ NO entra.
 * D = no pertenece al concepto de «utilidad de paginación» ⇒ NO entra.
 *
 * ┌──────────────────────────────┬───┬────────────────────────────────────────┐
 * │ gate                         │ . │ razón                                  │
 * ├──────────────────────────────┼───┼────────────────────────────────────────┤
 * │ dominio presente             │ A │ `primaryDomain`. Sin él no hay eje     │
 * │                              │   │ fuerte NI ownership NI país: no se     │
 * │                              │   │ puede AFIRMAR utilidad ⇒ no consume.   │
 * │ duplicado histórico          │ A │ `evaluatePrepaidHistoricalDuplicate`.  │
 * │  (`loadPrepaidHistoricalIndex`)  │   La lectura que YA se hacía aquí, con │
 * │                              │   │ caché por dominio y ámbito de ronda.   │
 * │ ownership                    │ A │ `resolveOwnershipEvaluationName` +     │
 * │                              │   │ `evaluateCompanyOwnership` +           │
 * │                              │   │ `isBlockedByCompanyOwnership`. Nombre  │
 * │                              │   │ y dominio bastan; puro y gratis.       │
 * │ país                         │ A │ `evaluateCountryCompatibility` sobre   │
 * │                              │   │ website/dominio. Determinista, sin red.│
 * │ identidad canónica           │ A │ `buildCanonicalCompanyIdentity`:       │
 * │                              │   │ frase que no es empresa. Sólo nombre.  │
 * │ dominio de directorio        │ A │ `isDirectorySourceDomain`, puro.       │
 * │ página de contenido          │ A │ `isContentPageUrl` / `isContentPageName`│
 * ├──────────────────────────────┼───┼────────────────────────────────────────┤
 * │ tamaño ICP (`icp-size-gate`) │ B │ 🔴 DECISIÓN EXPLÍCITA: FAIL-OPEN, NO   │
 * │                              │   │ se usa. Apollo NO devuelve empleados   │
 * │                              │   │ en organizations search, así que el    │
 * │                              │   │ dato no es evaluable aquí. Además el   │
 * │                              │   │ gate real con tamaño desconocido       │
 * │                              │   │ resuelve `needs_validation` ⇒          │
 * │                              │   │ `needs_review`, que NO es un rechazo:  │
 * │                              │   │ incluirlo sería un no-op hoy y una     │
 * │                              │   │ trampa mañana. No se inventa un        │
 * │                              │   │ incumplimiento indetectable.           │
 * │ business fit                 │ B │ Necesita `sourceSnippet`/`sourceTitle` │
 * │ política de evidencia de país│ B │ Depende de business fit (R2 de          │
 * │                              │   │ `evidence-persistence-policy`): con     │
 * │                              │   │ nulos daría un veredicto DISTINTO del   │
 * │                              │   │ del writer, y más estricto ⇒ compraría  │
 * │                              │   │ páginas de más. Prohibido.              │
 * │ intermediario/contenido      │ B │ Necesita título y snippet del candidato.│
 * │ duplicado HubSpot / guard de │ B │ Sólo existe tras construir el candidato│
 * │  candidato activo            │   │ y su `duplicateCheck`.                 │
 * │ evidencia sectorial          │ B │ Se resuelve con enrichment.            │
 * ├──────────────────────────────┼───┼────────────────────────────────────────┤
 * │ enrichment de Apollo         │ C │ Créditos.                              │
 * │ prefetch de admisión         │ C │ Lectura por lote, no por candidato:     │
 * │                              │   │ añadiría I/O nuevo y caro por fila.     │
 * ├──────────────────────────────┼───┼────────────────────────────────────────┤
 * │ cupo COMPLETE-FIRST          │ D │ Ordena el lote; no dice si UNA empresa  │
 * │                              │   │ puede ser útil.                         │
 * │ presupuesto / reserva        │ D │ Ya lo decide la valla de presupuesto.   │
 * │ valla durable de página      │ D │ Idempotencia, no utilidad.              │
 * └──────────────────────────────┴───┴────────────────────────────────────────┘
 *
 * ── DIRECCIÓN DEL ERROR ──────────────────────────────────────────────────────
 *
 * Cada gate A que se suma sólo puede hacer que MENOS organizaciones consuman el
 * objetivo, es decir que la paginación siga comprando páginas. El gasto queda
 * acotado por los techos que este corte NO mueve (`maxPages = 5`, la reserva de
 * presupuesto y la valla defensiva del runner). Un gate que NO se puede evaluar
 * queda FAIL-OPEN y fuera, porque lo contrario —declarar un incumplimiento sin
 * dato— gastaría créditos reales contra una afirmación falsa.
 */

import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
  resolveOwnershipEvaluationName,
} from './company-ownership-gate';
import { evaluateCountryCompatibility } from './country-compatibility';
import { buildCanonicalCompanyIdentity } from './canonical-company-identity';
import {
  isContentPageName,
  isContentPageUrl,
  isDirectorySourceDomain,
} from './candidate-writer-pure-gates';
import {
  evaluatePrepaidHistoricalDuplicate,
  type HistoricalCandidateRow,
} from './apollo-prepaid-historical-parity';
import type { NormalizedApolloOrganization } from './apollo-organizations-response-normalizer';

/**
 * Motivo por el que una organización NO consume el objetivo de paginación.
 *
 * Estático a propósito: es un vocabulario cerrado y auditable, no una cadena
 * libre. `null` sólo cuando la organización SÍ consume el objetivo.
 */
export type ApolloPaginationUsefulnessReason =
  | 'domain_absent'
  | 'name_absent'
  | 'non_company_phrase'
  | 'directory_source_domain'
  | 'country_code_absent'
  | 'country_incompatible'
  | 'content_page'
  | 'ownership_mismatch'
  | 'historical_duplicate';

export type ApolloPaginationUsefulnessVerdict = {
  /** `true` ⇒ esta organización cuenta hacia `acceptedForTargetCount`. */
  readonly consumesPaginationTarget: boolean;
  /** Causa concreta cuando no consume. `null` cuando consume. */
  readonly reason: ApolloPaginationUsefulnessReason | null;
};

export type ApolloPaginationUsefulnessInput = {
  readonly organization: NormalizedApolloOrganization;
  /** País declarado por la corrida. Ausente ⇒ el writer descarta; aquí no cuenta. */
  readonly targetCountryCode: string | null;
};

/**
 * Filas históricas de un dominio, tal como las trae `buildNoveltyIndex` /
 * `loadPrepaidHistoricalIndex`. Se INYECTA: este módulo no abre base de datos.
 *
 * `degraded: true` ⇒ la lectura no se pudo hacer. Fail-open: no se afirma
 * duplicidad sin evidencia.
 */
export type ApolloPaginationHistoricalRowsLoader = (
  domain: string,
) => Promise<{ rows: readonly HistoricalCandidateRow[]; degraded: boolean }>;

const CONSUMES: ApolloPaginationUsefulnessVerdict = {
  consumesPaginationTarget: true,
  reason: null,
};

function blocked(
  reason: ApolloPaginationUsefulnessReason,
): ApolloPaginationUsefulnessVerdict {
  return { consumesPaginationTarget: false, reason };
}

/**
 * LOS GATES A, PUROS Y GRATIS — la parte de la decisión que no necesita I/O.
 *
 * Orden tomado del Pass 1 de `candidate-writer.ts` (identidad canónica →
 * dominio de directorio → país → página de contenido → ownership). El orden sólo
 * decide QUÉ causa se reporta, nunca el veredicto: cualquiera bloquea por sí
 * solo.
 *
 * Ninguno se reimplementa: cada uno invoca la MISMA función que el writer
 * invoca, con los mismos umbrales. Por eso no puede relajar nada.
 */
export function evaluateApolloPaginationUsefulness(
  input: ApolloPaginationUsefulnessInput,
): ApolloPaginationUsefulnessVerdict {
  const { organization, targetCountryCode } = input;

  // Sin dominio no hay eje fuerte de identidad, ni ownership, ni señal de país:
  // NO se puede AFIRMAR que esta organización pueda llegar a ser útil, así que
  // no consume el objetivo.
  //
  // 🔴 Esto NO la descarta del pipeline: la fila ya pagada sigue entrando
  // completa (el motor la recogió antes de preguntar). Lo único que se le niega
  // es el derecho a cerrar la compra de páginas.
  const domain = organization.primaryDomain;
  if (domain === null) return blocked('domain_absent');

  const rawName = organization.name;
  if (rawName === null || rawName.trim() === '') return blocked('name_absent');

  const website = organization.websiteUrl;
  const urlOrDomain = website ?? `https://${domain}`;

  if (buildCanonicalCompanyIdentity(rawName).isNonCompanyPhrase) {
    return blocked('non_company_phrase');
  }

  if (isDirectorySourceDomain(domain)) return blocked('directory_source_domain');

  // El writer descarta con `missing_country_code` cuando la corrida no declaró
  // país. Aquí la lectura conservadora es la misma que hace el pre-writer
  // (`pending`): no consume objetivo, y no se afirma un rechazo del candidato.
  if (targetCountryCode === null || targetCountryCode.trim() === '') {
    return blocked('country_code_absent');
  }
  if (!evaluateCountryCompatibility(urlOrDomain, targetCountryCode).compatible) {
    return blocked('country_incompatible');
  }

  if (isContentPageUrl(website) || isContentPageName(rawName)) {
    return blocked('content_page');
  }

  // AGENT1-HARDENING-CUT-1 — el MISMO nombre que juzgará el writer: una razón
  // social escondida tras una frase SEO se recupera desde el dominio ANTES de
  // juzgar. Con el nombre crudo, el ownership fallaría por un defecto de
  // redacción y la organización perdería el objetivo sin merecerlo.
  const evaluationName = resolveOwnershipEvaluationName(rawName, website, domain);
  const ownership = evaluateCompanyOwnership(evaluationName.name, website, domain);
  if (isBlockedByCompanyOwnership(ownership)) return blocked('ownership_mismatch');

  return CONSUMES;
}

/**
 * EL ÚNICO CONSTRUCTOR del evaluador que el provider de Apollo recibe como
 * `evaluateCandidateAcceptance`.
 *
 * Que exista un solo sitio donde se decide es el punto de este corte: los dos
 * cableados vivos llaman aquí y sólo inyectan su lector histórico. «Contar
 * novedad en vez de utilidad» deja de ser expresable, porque el callback no se
 * puede armar a mano desde la superficie pública de este módulo.
 *
 * Los gates puros corren PRIMERO y la lectura histórica sólo después, si la
 * organización sobrevivió. No es una lectura nueva: es la que ya se hacía,
 * ahora estrictamente MENOS veces (caché por dominio + gates puros delante).
 */
export function createApolloPaginationAcceptanceEvaluator(deps: {
  readonly targetCountryCode: string | null;
  readonly loadHistoricalRowsForDomain: ApolloPaginationHistoricalRowsLoader;
}): (organization: NormalizedApolloOrganization) => Promise<boolean> {
  // Ámbito de ESTA ronda: el mismo dominio no se lee dos veces.
  const rowsByDomain = new Map<string, readonly HistoricalCandidateRow[]>();
  const degradedDomains = new Set<string>();

  return async (organization: NormalizedApolloOrganization): Promise<boolean> => {
    const pure = evaluateApolloPaginationUsefulness({
      organization,
      targetCountryCode: deps.targetCountryCode,
    });
    if (!pure.consumesPaginationTarget) return false;

    // Sobrevivió a los gates puros: `primaryDomain` es no-nulo por construcción
    // (`domain_absent` ya habría cortado).
    const domain = organization.primaryDomain!;

    let rows = rowsByDomain.get(domain);
    let degraded = degradedDomains.has(domain);
    if (rows === undefined && !degraded) {
      const loaded = await deps
        .loadHistoricalRowsForDomain(domain)
        .catch(() => ({ rows: [] as readonly HistoricalCandidateRow[], degraded: true }));
      if (loaded.degraded) {
        degraded = true;
        degradedDomains.add(domain);
      } else {
        rows = loaded.rows;
        rowsByDomain.set(domain, rows);
      }
    }

    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain: domain,
        name: organization.name,
        // Apollo no trae identificador fiscal en la búsqueda: el eje existe y se
        // evalúa, pero no se inventa ningún valor para rellenarlo.
        taxIdentifier: null,
        countryCode: deps.targetCountryCode,
      },
      rows: rows ?? [],
      // Fail-open: una lectura degradada nunca detiene la paginación por sí
      // sola, sólo deja de poder afirmar que ESE candidato es duplicado.
      evidenceUnavailable: degraded,
    });
    return !verdict.alreadyKnown;
  };
}
