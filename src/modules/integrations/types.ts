export type IntegrationCategory =
  | 'commercial_crm'
  | 'communication'
  | 'storage'
  | 'ai'
  | 'other';

export type CredentialsStatus = 'missing' | 'stored';

export type ConnectionStatus =
  | 'not_tested'
  | 'connected'
  | 'error'
  | 'disconnected';

export type AuthType = 'private_app_access_token' | 'oauth2' | 'api_key';

export interface SamuMetadata extends Record<string, unknown> {
  user_count?: number;
}

export interface ExternalIntegration {
  id: string;
  integration_key: string;
  name: string;
  description: string | null;
  category: IntegrationCategory;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExternalIntegrationConnection {
  id: string;
  integration_id: string;
  auth_type: AuthType;
  credentials_status: CredentialsStatus;
  connection_status: ConnectionStatus;
  last_tested_at: string | null;
  last_tested_by: string | null;
  last_connection_error: string | null;
  connected_at: string | null;
  connected_by: string | null;
  disconnected_at: string | null;
  disconnected_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationWithConnection extends ExternalIntegration {
  connection: ExternalIntegrationConnection | null;
}

export interface HubSpotMetadata {
  hub_id?: number;
  app_id?: number;
  scopes?: string[];
}

export interface SlackMetadata {
  team_id?: string;
  team_name?: string;
  bot_user_id?: string;
  app_id?: string;
  scopes?: string[];
  channel_id?: string;
  channel_name?: string;
  // OAuth App config (non-sensitive; secret goes to Vault)
  oauth_client_id?: string;
  oauth_redirect_uri?: string;
}

export interface TavilyMetadata extends Record<string, unknown> {
  response_time_ms?: number;
  results_count?: number;
  search_depth?: string;
}

export interface GoogleCSEMetadata extends Record<string, unknown> {
  response_time_ms?: number;
  results_count?: number;
}

export interface IntegrationAuditEntry {
  id: string;
  integration_key: string;
  event_type:
    | 'credential_stored'
    | 'credential_updated'
    | 'connection_tested'
    | 'connection_succeeded'
    | 'connection_failed'
    | 'disconnected'
    | 'oauth_started'
    | 'oauth_connected'
    | 'oauth_failed'
    | 'channel_created'
    | 'test_message_sent'
    | 'samu_api_key_stored'
    | 'samu_api_key_updated'
    | 'samu_connection_tested'
    | 'samu_connection_succeeded'
    | 'samu_connection_failed'
    | 'samu_disconnected'
    | 'tavily_api_key_stored'
    | 'tavily_api_key_updated'
    | 'tavily_connection_tested'
    | 'tavily_connection_succeeded'
    | 'tavily_connection_failed'
    | 'tavily_disconnected'
    | 'google_cse_credentials_stored'
    | 'google_cse_credentials_updated'
    | 'google_cse_connection_tested'
    | 'google_cse_connection_succeeded'
    | 'google_cse_connection_failed'
    | 'google_cse_disconnected';
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
