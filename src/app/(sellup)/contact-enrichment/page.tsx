import { PageHeader } from '@/components/shared/page-header';
import { ContactEnrichmentWizard } from '@/components/contact-enrichment/contact-enrichment-wizard';

export const metadata = {
  title: 'Enriquecer contactos — SellUp',
};

export default function ContactEnrichmentPage() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Enriquecer contactos"
        description="Busca una empresa de SellUp o HubSpot y prepara un run de enriquecimiento de contactos."
      />
      <ContactEnrichmentWizard />
    </div>
  );
}
