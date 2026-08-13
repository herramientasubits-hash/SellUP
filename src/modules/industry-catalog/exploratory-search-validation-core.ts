/**
 * exploratory-search-validation-core.ts — La validación de una búsqueda
 * exploratoria contra el catálogo publicado, sea cual sea la taxonomía que lo
 * gobierne.
 *
 * AGENT1-MACRO-CATALOG-PRE119-LEGACY-READERS-1 · §§ 2, 3, 4, 12, 13 y 16.
 *
 * ── Por qué este módulo existe ────────────────────────────────────────────────
 *
 * `validateExploratorySearch` consultaba `active_industry_catalog` directamente.
 * Esa vista hace INNER JOIN con `subindustries`, así que bajo el catálogo v2
 * —12 macro industrias, cero subindustrias— devuelve CERO filas. La acción leía
 * ese cero como «no se pudo verificar el catálogo» y devolvía `_catalog`, de modo
 * que las dos superficies del wizard (`prospect-chat-wizard` y
 * `exploratory-search-form-v2`) quedaban sin poder validar nada: un catálogo
 * perfectamente publicado se veía como un catálogo caído.
 *
 * La corrección NO es tratar el cero como un caso especial. El cero de esa vista
 * es CORRECTO —no hay subindustrias que enseñar— y seguirá siendo cero. Lo que
 * estaba mal era preguntarle a la vista de subindustrias por la disponibilidad
 * del catálogo. Aquí la pregunta se hace donde corresponde: a la CAPACIDAD de la
 * versión publicada (`resolveDiscoveryTaxonomyCapability`), el mismo contrato
 * canónico que #281 introdujo y que `resolveWizardCatalog` ya usa.
 *
 * ── Por qué es un núcleo puro y no vive en la acción ──────────────────────────
 *
 * `action.ts` es un módulo `'use server'`: cada export es un endpoint invocable
 * desde el navegador con argumentos serializados. No se le puede añadir un
 * parámetro inyectable para pruebas sin convertir ese parámetro en superficie
 * pública. Separando la decisión del transporte, la suite atraviesa toda la
 * matriz —v1, v2, versión desconocida, hija obsoleta— sin base de datos y sin
 * tocar el contrato de la acción.
 *
 * Puro: sin I/O, sin env, sin reloj.
 */

import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import { detectPromptInjection, normalizeCriteria } from './schema';
import { isSubindustryApplicable } from './catalog-utils';
import type { ExploratorySearchValidationResult } from './types';
import type { ExploratorySearchFormInputParsed } from './schema';
import type { ActiveDiscoveryCatalog } from './discovery-catalog-loader';

// ── Umbral de tamaño — siempre derivado en el servidor ────────────────────────

export const EMPLOYEE_SIZE_CRITERIA = {
  minEmployeeCountExclusive: 200 as const,
  enforcement: 'hard_filter' as const,
  scope: 'local_legal_entity' as const,
};

// ── Núcleo ────────────────────────────────────────────────────────────────────

/**
 * Valida una búsqueda exploratoria ya parseada contra el catálogo publicado.
 *
 * El catálogo llega resuelto por el llamador (`loadActiveDiscoveryCatalog`), que
 * es quien decide qué vistas hace falta leer: la de macro industrias siempre, y
 * la de subindustrias SÓLO cuando la capacidad de la versión las selecciona.
 * Aquí no se consulta nada, así que esta función no puede volver a introducir una
 * dependencia con la vista legacy.
 *
 * Cero escrituras, cero llamadas a proveedor, cero créditos: sigue siendo la
 * misma vista previa que antes.
 */
export function validateExploratorySearchAgainstCatalog(
  parsed: ExploratorySearchFormInputParsed,
  catalog: ActiveDiscoveryCatalog,
): ExploratorySearchValidationResult {
  const {
    countryCode,
    industryId,
    subindustryIds,
    additionalCriteriaRaw,
    requestedCount,
    catalogVersion,
  } = parsed;

  const warnings: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  // 1. La versión enviada tiene que ser la publicada.
  //
  // Se compara contra la versión que el cargador leyó, no contra la primera fila
  // de una consulta: el cargador ya rechazó una mezcla de versiones.
  if (catalogVersion !== catalog.version) {
    return {
      valid: false,
      preview: null,
      warnings: [],
      fieldErrors: {
        catalogVersion: [
          'El catálogo ha sido actualizado. Por favor recarga la página e intenta nuevamente.',
        ],
      },
    };
  }

  // 2. La industria tiene que existir en el catálogo publicado.
  //
  // Bajo v1 son las 8 industrias padre; bajo v2, las 12 macro industrias. La
  // comprobación es la MISMA —existencia por UUID en la versión publicada—; lo
  // único que cambia es qué versión responde.
  const industry = catalog.industries.find((i) => i.id === industryId);
  if (!industry) {
    fieldErrors.industryId = ['La industria seleccionada no existe en el catálogo activo.'];
    return { valid: false, preview: null, warnings, fieldErrors };
  }

  // 3. Subindustrias — gobernadas por la CAPACIDAD, no por cuántas filas haya.
  //
  // § 7 de #281, aplicado también aquí: bajo v2 el paso de subindustrias no
  // existe, así que recibir ids sólo puede significar estado obsoleto de una
  // sesión anterior o una petición manipulada. Se RECHAZA en vez de ignorarse:
  // aceptarlos en silencio dejaría que una búsqueda nueva arrastrara criterios
  // que la persona nunca vio, y la vista previa mentiría sobre lo que se va a
  // buscar.
  if (!catalog.capability.subindustrySelectionEnabled) {
    if (subindustryIds.length > 0) {
      fieldErrors.subindustryIds = [
        'La selección de subindustrias no está disponible en este catálogo.',
      ];
      return { valid: false, preview: null, warnings, fieldErrors };
    }
  }

  const validatedSubindustries: Array<{ id: string; name: string }> = [];

  if (catalog.capability.subindustrySelectionEnabled) {
    // Ruta legacy, idéntica a la de siempre: pertenencia a la industria elegida
    // y aplicabilidad al país. El mapa se construye SÓLO con las subindustrias
    // de esta industria, así que una hija de otra industria falla igual que antes.
    const subMap = new Map(
      catalog.subindustries
        .filter((s) => s.industryId === industryId)
        .map((s) => [s.id, s]),
    );

    for (const subId of subindustryIds) {
      const sub = subMap.get(subId);
      if (!sub) {
        if (!fieldErrors.subindustryIds) fieldErrors.subindustryIds = [];
        fieldErrors.subindustryIds.push(
          `Una subindustria seleccionada no pertenece a la industria elegida o no existe.`,
        );
        break;
      }
      if (!isSubindustryApplicable({ applicableCountries: sub.applicableCountries }, countryCode)) {
        if (!fieldErrors.subindustryIds) fieldErrors.subindustryIds = [];
        fieldErrors.subindustryIds.push(
          `La subindustria "${sub.name}" no está disponible para el país seleccionado.`,
        );
        break;
      }
      validatedSubindustries.push({ id: subId, name: sub.name });
    }

    if (Object.keys(fieldErrors).length > 0) {
      return { valid: false, preview: null, warnings, fieldErrors };
    }
  }

  // 4. Inyección de prompt en el criterio adicional — advierte, no bloquea.
  const normalizedCriteria = normalizeCriteria(additionalCriteriaRaw);
  if (normalizedCriteria && detectPromptInjection(normalizedCriteria)) {
    warnings.push(
      'El criterio específico contiene instrucciones que no se procesarán. Solo se usará como contexto descriptivo.',
    );
  }

  // 5. País.
  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === countryCode);
  const countryName = countryEntry?.name ?? countryCode;

  // 6. Vista previa — cero escrituras.
  return {
    valid: true,
    preview: {
      catalogVersion: catalog.version,
      countryCode,
      countryName,
      industryId,
      industryName: industry.name,
      subindustries: validatedSubindustries,
      additionalCriteriaRaw: additionalCriteriaRaw ?? null,
      additionalCriteriaNormalized: normalizedCriteria,
      employeeSizeCriteria: EMPLOYEE_SIZE_CRITERIA,
      requestedCount,
    },
    warnings,
    fieldErrors: {},
  };
}
