'use server';

import { createClient } from '@/lib/supabase/server';
import { exploratorySearchSchema } from './schema';
import { loadActiveDiscoveryCatalog } from './discovery-catalog-loader';
import { validateExploratorySearchAgainstCatalog } from './exploratory-search-validation-core';
import type { ExploratorySearchFormInput, ExploratorySearchValidationResult } from './types';

// ── Server action: validate exploratory search ────────────────────────────────
// Validates the form without creating any batch, candidate, or AI call.
// Re-queries the catalog to confirm version consistency and referential integrity.
//
// AGENT1-MACRO-CATALOG-PRE119-LEGACY-READERS-1 §§ 3 y 4 — el catálogo se lee por
// el cargador que conoce las DOS taxonomías, no con un `select` propio sobre
// `active_industry_catalog`. Esa vista hace INNER JOIN con `subindustries`: bajo
// el catálogo v2 devuelve cero filas, y esta acción leía ese cero como «no se
// pudo verificar el catálogo», dejando al wizard sin poder validar una búsqueda
// perfectamente válida. La disponibilidad la decide la CAPACIDAD de la versión
// publicada, nunca el número de filas de la vista de subindustrias.
//
// La decisión vive en `exploratory-search-validation-core` (puro, sin I/O). Aquí
// queda sólo el transporte: identidad, parseo y lectura del catálogo.

export async function validateExploratorySearch(
  input: ExploratorySearchFormInput,
): Promise<ExploratorySearchValidationResult> {
  // 1. Verify authenticated user
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      valid: false,
      preview: null,
      warnings: [],
      fieldErrors: { _auth: ['Debes iniciar sesión para continuar.'] },
    };
  }

  // 2. Parse and validate form input
  const parsed = exploratorySearchSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_root';
      if (!fieldErrors[key]) fieldErrors[key] = [];
      fieldErrors[key].push(issue.message);
    }
    return { valid: false, preview: null, warnings: [], fieldErrors };
  }

  // 3. Re-read the published catalog under whichever taxonomy governs it.
  //
  // Un fallo de lectura NO se confunde con «el catálogo está vacío»: el cargador
  // distingue las dos cosas y las dos llegan aquí como excepción, con la misma
  // respuesta que esta acción daba antes. Lo que ya no ocurre es que un catálogo
  // macro sano se cuente como fallo.
  let catalog;
  try {
    catalog = await loadActiveDiscoveryCatalog();
  } catch {
    return {
      valid: false,
      preview: null,
      warnings: [],
      fieldErrors: { _catalog: ['No se pudo verificar el catálogo. Intenta nuevamente.'] },
    };
  }

  // 4. Validate against the catalog — pure, capability-aware
  return validateExploratorySearchAgainstCatalog(parsed.data, catalog);
}
