import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/ai-config/actions';
import { PageHeader } from '@/components/shared/page-header';
import { LegacyCompatBanner } from '../legacy-compat-banner';
import { AiSettingsSection } from './ai-settings-section';

export default async function AIConfigPage() {
  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    redirect('/settings');
  }

  return (
    <div className="space-y-6">
      <LegacyCompatBanner
        message="Esta vista sigue disponible por compatibilidad. La configuración de IA ahora también vive dentro de Proveedores y consumo."
        ctaLabel="Ir a Proveedores y consumo"
        ctaHref="/settings/providers?tab=ia"
      />
      <PageHeader
        title="Proveedores y tarifas de IA"
        description="Administra los proveedores, modelos y tarifas base que SellUp utilizará para calcular y gobernar el consumo de inteligencia artificial."
        backHref="/settings"
      />
      <AiSettingsSection />
    </div>
  );
}