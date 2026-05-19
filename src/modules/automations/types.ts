export type AutomationExecutionMode = 'manual' | 'suggested' | 'automatic';
export type AutomationCategory = 'prospecting' | 'accounts' | 'pipeline';

export interface SystemAutomation {
  id: string;
  automation_key: string;
  name: string;
  description: string | null;
  trigger_key: string;
  category: AutomationCategory;
  execution_mode: AutomationExecutionMode;
  is_available: boolean;
  requires_ai_provider: boolean;
  requires_prospecting_provider: boolean;
  requires_hubspot: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface AutomationsSummary {
  total: number;
  automatic: number;
  suggested: number;
  manual: number;
}

export const EXECUTION_MODE_LABELS: Record<AutomationExecutionMode, string> = {
  manual: 'Manual',
  suggested: 'Sugerido',
  automatic: 'Automático',
};

export const EXECUTION_MODE_DESCRIPTIONS: Record<AutomationExecutionMode, string> = {
  manual: 'SellUp no sugiere ni ejecuta por sí solo. El usuario dispara la acción cuando lo decide.',
  suggested: 'SellUp muestra una recomendación o acción sugerida, pero espera la decisión del usuario.',
  automatic: 'SellUp ejecutará automáticamente cuando ocurra el evento, siempre que las dependencias requeridas estén disponibles.',
};

export const CATEGORY_LABELS: Record<string, string> = {
  prospecting: 'Prospección',
  accounts: 'Cuentas',
  pipeline: 'Pipeline',
};
