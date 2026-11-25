import { requireAccessScreen } from '@/modules/access/access-screen.server';
import { Archive, RotateCcw } from "@/icons";
import { Button } from '@/components/ui/button';
import { AccessStatusScreen } from '@/components/shared/access-status-screen';
import { requestReaccess } from './actions';

export default async function AccessArchivedPage() {
  const { user } = await requireAccessScreen('archived');

  return (
    <AccessStatusScreen
      icon={Archive}
      tone="neutral"
      title="Usuario archivado"
      description="Tu cuenta ha sido archivada y ya no tiene acceso a SellUp. Si deseas volver a usar la plataforma, puedes solicitar reingreso. Un administrador revisará tu solicitud."
      email={user.email}
      primaryAction={
        <form action={requestReaccess} className="w-full">
          <Button type="submit" className="w-full">
            <RotateCcw className="size-4" aria-hidden="true" />
            Solicitar reingreso
          </Button>
        </form>
      }
    />
  );
}
