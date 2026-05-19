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
    | 'test_message_sent';
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
