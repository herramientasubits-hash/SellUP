/**
 * Zona horaria del período de presupuesto del asistente. Compartida con la
 * ejecución: dos husos distintos resolverían dos períodos distintos y la UI
 * avisaría sobre una fila que la reserva no mira.
 *
 * Archivo propio y sin dependencias: lo importa código que también llega al
 * navegador (`modules/budgets`), y `wizard-budget-preflight.server.ts` lee la sesión.
 */
export const WIZARD_BUDGET_TIMEZONE = 'America/Bogota';
