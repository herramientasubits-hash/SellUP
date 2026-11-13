'use server';

import { createClient } from '@/lib/supabase/server';
import { hasActiveAccess } from '@/modules/access/actions';
import type { UserNotification, NotificationFilter } from './types';

// La campanita es sólo para personas con acceso activo (pendientes y
// suspendidas no leen ni marcan avisos).

export async function getMyNotifications(
  filter: NotificationFilter = 'all'
): Promise<UserNotification[]> {
  if (!(await hasActiveAccess())) return [];
  const supabase = await createClient();

  let query = supabase
    .from('user_notifications')
    .select(
      'id, notification_type, title, message, action_label, action_url, entity_type, entity_id, is_read, read_at, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(50);

  if (filter === 'unread') {
    query = query.eq('is_read', false);
  }

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as UserNotification[];
}

export async function getMyUnreadCount(): Promise<number> {
  if (!(await hasActiveAccess())) return 0;
  const supabase = await createClient();

  const { count, error } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  if (error) return 0;
  return count ?? 0;
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  if (!(await hasActiveAccess())) return;
  const supabase = await createClient();
  await supabase
    .from('user_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId);
}

export async function markAllMyNotificationsAsRead(): Promise<void> {
  if (!(await hasActiveAccess())) return;
  const supabase = await createClient();
  await supabase
    .from('user_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('is_read', false);
}
