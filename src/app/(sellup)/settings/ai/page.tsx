import { redirect } from 'next/navigation';
import { isCurrentUserAdmin } from '@/modules/ai-config/actions';
import { PageHeader } from '@/components/shared/page-header';
import { AiSettingsSection } from './ai-settings-section';

export default async function AIConfigPage() {
  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    redirect('/settings');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores y tarifas de IA"
        description="Administra los proveedores, modelos y tarifas base que SellUp utilizará para calcular y gobernar el consumo de inteligencia artificial."
        backHref="/settings"
      />
      <AiSettingsSection />
    </div>
  );
}