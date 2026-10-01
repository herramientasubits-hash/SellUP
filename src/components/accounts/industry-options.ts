import type { SearchableSelectOption } from '@/components/forms/searchable-select';
import { INDUSTRIES } from '@/modules/accounts/types';

/** Valor de la opción que deja la empresa sin industria. */
export const NO_INDUSTRY_VALUE = '';

/**
 * Las opciones del selector de industria de una empresa.
 *
 * Se guarda el nombre de la industria tal cual (el mismo texto que se lee). Si
 * la empresa ya trae una industria que no está en el catálogo (p. ej. la que
 * escribió un proveedor), se añade a la lista para que se siga viendo y no se
 * pierda al guardar.
 */
export function buildIndustryOptions(current: string): SearchableSelectOption[] {
  const known = INDUSTRIES.map((industry) => ({ value: industry as string, label: industry as string }));
  const isKnown = known.some((option) => option.value === current);
  return [
    { value: NO_INDUSTRY_VALUE, label: 'Sin industria' },
    ...(current && !isKnown ? [{ value: current, label: current }] : []),
    ...known,
  ];
}
