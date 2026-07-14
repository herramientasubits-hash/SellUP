// Agente 2A — Read-only Contact Enrichment Run Viewer (Hito 17B.4X.7C.3E.2)
//
// Read-only route to open a historical contact_enrichment_runs row by id.
// No Apollo/Lusha execution, no provider selector, no approve/discard — see
// contact-enrichment-run-viewer.tsx for the rendering contract.

import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { ContactEnrichmentRunViewer } from '@/components/contact-enrichment/contact-enrichment-run-viewer';
import {
  getContactCandidatesByRunId,
  getContactEnrichmentRunById,
  getContactEnrichmentRunProviderUsage,
} from '@/modules/contact-enrichment/run-viewer-actions';

export const metadata = {
  title: 'Run de enriquecimiento de contactos — SellUp',
};

interface ContactEnrichmentRunPageProps {
  params: Promise<{ runId: string }>;
}

export default async function ContactEnrichmentRunPage({ params }: ContactEnrichmentRunPageProps) {
  const { runId } = await params;

  const run = await getContactEnrichmentRunById(runId);
  if (!run) notFound();

  const [candidates, providerUsage] = await Promise.all([
    getContactCandidatesByRunId(runId),
    getContactEnrichmentRunProviderUsage(run.agentRunId),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Run de enriquecimiento de contactos"
        description={`${run.companyName || 'Empresa sin nombre'} — vista de solo lectura`}
        backHref="/contact-enrichment"
      />
      <ContactEnrichmentRunViewer run={run} candidates={candidates} providerUsage={providerUsage} />
    </div>
  );
}
