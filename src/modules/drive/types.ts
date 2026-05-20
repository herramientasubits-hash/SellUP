// ============================================================
// Types: Google Drive personal integration
// ============================================================

export type DriveCredentialsStatus = 'missing' | 'stored';

export type DriveConnectionStatus =
  | 'not_connected'
  | 'connected'
  | 'error'
  | 'disconnected';

export type DriveAuditEventType =
  | 'drive_oauth_started'
  | 'drive_oauth_connected'
  | 'drive_oauth_failed'
  | 'drive_connection_tested'
  | 'drive_connection_succeeded'
  | 'drive_connection_failed'
  | 'drive_folder_created'
  | 'drive_disconnected';

export interface UserDriveConnection {
  id: string;
  internal_user_id: string;
  vault_secret_id: string | null;
  credentials_status: DriveCredentialsStatus;
  connection_status: DriveConnectionStatus;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
  connected_at: string | null;
  last_tested_at: string | null;
  last_connection_error: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriveConnectionStats {
  total_connected: number;
  total_disconnected: number;
  total_error: number;
}

export interface UserDriveAuditEntry {
  id: string;
  internal_user_id: string;
  event_type: DriveAuditEventType;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
