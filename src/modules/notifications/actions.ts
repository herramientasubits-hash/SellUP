'use server';

import { createClient } from '@/lib/supabase/server';
import type { UserNotification, NotificationFilter } from './types';

export async function getMyNotifications(
  filter: NotificationFilter = 'all'
): Promise<UserNotification[]> {
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
  const supabase = await createClient();

  const { count, error } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  if (error) return 0;
  return count ?? 0;
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from('user_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId);
}

export async function markAllMyNotificationsAsRead(): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from('user_notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('is_read', false);
}
