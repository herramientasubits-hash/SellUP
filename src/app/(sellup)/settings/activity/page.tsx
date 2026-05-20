import { redirect } from 'next/navigation';
import { hasActiveAccess } from '@/modules/access/actions';
import {
  getActivityViewerContext,
  getPlatformActivity,
} from '@/modules/system-status/activity-actions';
import { ActivityFeedClient } from './activity-feed-client';

export default async function ActivityPage() {
  const isActive = await hasActiveAccess();
  if (!isActive) redirect('/settings');

  const [context, initialData] = await Promise.all([
    getActivityViewerContext(),
    getPlatformActivity({ limit: 30 }),
  ]);

  if (!context) redirect('/settings');

  return (
    <ActivityFeedClient
      context={context}
      initialEvents={initialData.events}
      initialHasMore={initialData.hasMore}
    />
  );
}
