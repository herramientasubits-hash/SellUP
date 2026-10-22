// ACCOUNT-OWNER-HUBSPOT-NOTICE-1 — aviso en la ficha cuando el responsable de SellUp no es el
// dueño de la empresa en HubSpot. Sólo informa: no cambia responsables.

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatAppDate } from '@/lib/format-date';
import { describeOwnerVsHubSpot, ownerVsHubSpotCopy } from '@/modules/accounts/account-owner-hubspot';

interface AccountOwnerHubSpotNoticeProps {
  ownerId: string | null;
  metadata: unknown;
}

export function AccountOwnerHubSpotNotice({ ownerId, metadata }: AccountOwnerHubSpotNoticeProps) {
  const notice = describeOwnerVsHubSpot({ ownerId, metadata });
  if (!notice) return null;
  const copy = ownerVsHubSpotCopy(notice);
  return (
    <Alert variant="warning">
      <AlertTitle className="text-sm">{copy.title}</AlertTitle>
      <AlertDescription className="text-xs leading-relaxed text-warning">
        {copy.description} Visto en HubSpot el {formatAppDate(notice.readAt)}.
      </AlertDescription>
    </Alert>
  );
}
