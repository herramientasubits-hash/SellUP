export type NotificationType =
  | 'user_pending_approval'
  | string;

export type NotificationFilter = 'all' | 'unread';

export interface UserNotification {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  action_label: string | null;
  action_url: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}
