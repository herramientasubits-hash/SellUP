import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FileSearch } from '@/icons';

/**
 * Lo que se ve cuando un enlace lleva a algo que ya no existe o que no es de
 * quien lo abre (una empresa, un contacto, una búsqueda ajena). Reemplaza el
 * «404 · This page could not be found.» de Next, en inglés.
 */
export default function SellUpNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl items-center p-6">
      <EmptyState
        icon={FileSearch}
        title="No encontramos lo que buscas"
        description="Puede que ya no exista o que no tengas acceso. Vuelve al inicio o búscalo desde el buscador de arriba."
        action={
          <Button asChild>
            <Link href="/pipeline">Volver al inicio</Link>
          </Button>
        }
      />
    </main>
  );
}
