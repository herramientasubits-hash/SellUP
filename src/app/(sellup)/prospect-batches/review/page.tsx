import { redirect } from 'next/navigation';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';

/**
 * Q3F-5AZ.2F — Retire the internal pending-review route.
 *
 * `/prospect-batches/review` was a temporary operativa surface (Q3F-5AZ.2A).
 * Human review of prospects now lives exclusively in Empresas → Prospectos
 * (`/accounts?tab=prospectos`), where "Aprobar" creates/links the account and
 * best-effort syncs HubSpot. This legacy route must no longer compete with the
 * official surface, so it redirects there instead of rendering the old queue.
 *
 * The former queue components and the pending-review read wrapper stay in the
 * tree as internal, now-unreferenced code — the `test:prospect-review` suite
 * still imports the old client by filename — and are reported as debt. No
 * server actions, DB, HubSpot, or provider behaviour is touched here.
 */
export default function PendingReviewRedirectPage() {
  redirect(PROSPECTOS_TAB_ROUTE);
}
