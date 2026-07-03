import { notFound, redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getProviderDetail } from '@/modules/budgets/provider-detail-queries';
import { PageHeader } from '@/components/shared/page-header';
import {
  getProviderOperationalType,
  OPERATIONAL_TYPE_LABEL,
  OPERATIONAL_TYPE_BADGE,
} from '@/modules/budgets/provider-operational-type';
import {
  MEASUREMENT_STATUS_LABEL,
  MEASUREMENT_STATUS_BADGE,
} from '@/modules/budgets/provider-measurement';
import { ProviderDetailTabs } from './provider-detail-tabs';
import {
  isIaProviderKey,
  getAiProviderDetail,
} from '@/modules/ai-config/provider-ai-detail-queries';

interface Props {
  params: Promise<{ providerKey: string }>;
}

export default async function ProviderDetailPage({ params }: Props) {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const { providerKey } = await params;
  const [detail, aiDetail] = await Promise.all([
    getProviderDetail(providerKey),
    isIaProviderKey(providerKey) ? getAiProviderDetail(providerKey) : Promise.resolve(null),
  ]);

  if (!detail) notFound();

  const { row, allRulesForProvider, formOptions, recentUsageLogs, recentSyncLogs } = detail;
  const opType = getProviderOperationalType(row.providerKey);
  const ms = row.measurementStatus;
  const msBadge = MEASUREMENT_STATUS_BADGE[ms];

  const displayName = row.displayName ?? row.providerKey;
  const activeRuleCount = allRulesForProvider.filter((r) => r.is_active).length;

  return (
    <div className="space-y-6 px-8 py-6">
      <PageHeader
        title={displayName}
        description={`Detalle de configuración, consumo y reglas del proveedor ${displayName}.`}
        backHref="/settings/providers"
      />

      {/* Badges de estado rápido */}
      <div className="flex items-center gap-2 flex-wrap -mt-2">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${OPERATIONAL_TYPE_BADGE[opType]}`}
        >
          {OPERATIONAL_TYPE_LABEL[opType]}
        </span>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${msBadge.className}`}
        >
          {MEASUREMENT_STATUS_LABEL[ms]}
        </span>
        {activeRuleCount > 0 && (
          <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {activeRuleCount} regla{activeRuleCount !== 1 ? 's' : ''} activa{activeRuleCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <ProviderDetailTabs
        row={row}
        allRules={allRulesForProvider}
        options={formOptions}
        usageLogs={recentUsageLogs}
        syncLogs={recentSyncLogs}
        aiDetail={aiDetail}
      />
    </div>
  );
}
