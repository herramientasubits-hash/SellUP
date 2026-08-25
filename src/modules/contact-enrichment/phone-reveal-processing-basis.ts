// Agente 2A — LA base de tratamiento del reveal de teléfono, en un solo sitio
// (AGENT2A-POST-APPROVAL-OFFICIAL-CONTACT-PHONE-REVEAL-1)
//
// POR QUÉ EXISTE: la base (habeas data) es OBLIGATORIA en el arranque del reveal y el flujo la
// fija —no la pregunta— porque el producto sólo contempla un supuesto: interés legítimo B2B. Ese
// valor vivía como una constante LOCAL de `contact-candidate-detail-sheet.tsx`, así que la ficha
// del contacto oficial habría tenido que escribir una segunda copia. Dos copias de una base legal
// es exactamente el tipo de dato que se queda desincronizado sin que nadie lo note: el candidato
// registraría un supuesto y el contacto otro para la MISMA llamada al mismo proveedor.
//
// Módulo diminuto y SIN dependencias de runtime a propósito, igual que
// `phone-reveal-authorized-roles.ts`: lo importan componentes cliente y server actions, así que
// no puede arrastrar nada de servidor.

import type { PhoneProcessingBasis } from './types';

/**
 * Base de tratamiento con la que se dispara TODO reveal de teléfono en SellUp. No es un default
 * que la UI pueda cambiar: es el único supuesto que el producto contempla, y el servidor la
 * revalida contra el vocabulario aprobado de la migración 095.
 */
export const PHONE_REVEAL_PROCESSING_BASIS: PhoneProcessingBasis = 'legitimate_interest_b2b';
