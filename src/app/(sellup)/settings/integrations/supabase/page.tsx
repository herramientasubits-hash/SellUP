import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getSupabaseOverview } from '@/modules/storage-usage/storage-usage.server';
import { SupabaseOverviewView } from './supabase-overview-view';

export const dynamic = 'force-dynamic';

export default async function SupabaseIntegrationPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const overview = await getSupabaseOverview();
  return <SupabaseOverviewView overview={overview} />;
}
