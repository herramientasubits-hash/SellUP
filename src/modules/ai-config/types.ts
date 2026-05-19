export type AIProviderStatus = 'active' | 'inactive' | 'not_configured' | 'error';
export type AIModelStatus = 'active' | 'inactive' | 'not_configured' | 'error';

export interface AIProvider {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: AIProviderStatus;
  is_available_for_selection: boolean;
  created_at: string;
  updated_at: string;
  model_count?: number;
  credentials_status?: string;
  connection_status?: string;
  last_tested_at?: string | null;
  last_connection_error?: string | null;
}

export interface AIModel {
  id: string;
  provider_id: string;
  key: string;
  name: string;
  description: string | null;
  status: AIModelStatus;
  is_selectable: boolean;
  context_window_tokens: number | null;
  created_at: string;
  updated_at: string;
  provider_name?: string;
  current_pricing?: AIModelPricing;
}

export interface AIModelPricing {
  id: string;
  model_id: string;
  input_cost_per_million_tokens: number;
  output_cost_per_million_tokens: number;
  currency: string;
  effective_from: string;
}

export interface AIActiveConfig {
  active_provider_id: string | null;
  active_model_id: string | null;
  provider_name: string | null;
  model_name: string | null;
  updated_at: string | null;
}

export interface AIProvidersWithModels {
  provider_id: string;
  provider_name: string;
  provider_key: string;
  provider_status: AIProviderStatus;
  model_id: string | null;
  model_name: string | null;
  model_key: string | null;
  model_status: AIModelStatus | null;
}

export interface AICongifSummary {
  activeProvider: string | null;
  activeModel: string | null;
  totalModels: number;
  activeModels: number;
  lastPricingUpdate: string | null;
}

export type CredentialsStatus = 'missing' | 'stored';
export type ConnectionStatus = 'not_configured' | 'not_tested' | 'connected' | 'error' | 'disconnected';

export interface AIProviderConnection {
  id: string;
  provider_id: string;
  vault_secret_id: string | null;
  credentials_status: CredentialsStatus;
  connection_status: ConnectionStatus;
  last_tested_at: string | null;
  last_tested_by: string | null;
  last_connection_error: string | null;
  connected_at: string | null;
  connected_by: string | null;
  disconnected_at: string | null;
  disconnected_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AIProviderWithConnection extends AIProvider {
  connection?: AIProviderConnection;
  canActivate: boolean;
}