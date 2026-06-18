// Error code → user-facing message map for wizard execution results.
// Kept in a separate module so tests can import it without a DOM environment.

export const EXECUTION_ERROR_MESSAGES: Readonly<
  Record<string, { message: string; retryable: boolean }>
> = {
  EXECUTION_DISABLED:              { message: 'La generación con IA no está habilitada en este momento.',                           retryable: false },
  PILOT_PAUSED:                    { message: 'La generación de prospectos está pausada temporalmente.',                            retryable: false },
  NOT_IN_PILOT:                    { message: 'Esta función todavía está disponible solo para el grupo piloto.',                    retryable: false },
  BUDGET_PERIOD_NOT_CONFIGURED:    { message: 'El presupuesto del piloto para este mes todavía no está configurado.',              retryable: false },
  BUDGET_PERIOD_CLOSED:            { message: 'El período presupuestal del piloto está cerrado.',                                  retryable: false },
  EXECUTION_CREDIT_LIMIT_EXCEEDED: { message: 'Esta búsqueda supera el máximo permitido por corrida.',                            retryable: false },
  BUDGET_EXCEEDED:                 { message: 'El presupuesto disponible para generación de prospectos se agotó.',                 retryable: false },
  CONCURRENT_EXECUTION_ACTIVE:     { message: 'Ya tienes una generación en curso. Espera a que termine antes de iniciar otra.',   retryable: false },
  BUDGET_RESERVATION_FAILED:       { message: 'No fue posible reservar el presupuesto para esta búsqueda.',                       retryable: true  },
  PROVIDER_UNAVAILABLE:            { message: 'El servicio de búsqueda no está disponible temporalmente.',                        retryable: true  },
  CATALOG_CHANGED:                 { message: 'La configuración del catálogo cambió. Revisa nuevamente la búsqueda.',             retryable: false },
  INVALID_REQUEST:                 { message: 'Revisa la información seleccionada antes de continuar.',                            retryable: false },
  GENERATION_FAILED:               { message: 'No fue posible completar la generación de prospectos.',                            retryable: true  },
};

const FALLBACK: { message: string; retryable: boolean } = {
  message: 'No fue posible completar la generación de prospectos.',
  retryable: false,
};

export function mapExecutionError(code: string): { message: string; retryable: boolean } {
  return EXECUTION_ERROR_MESSAGES[code] ?? FALLBACK;
}
