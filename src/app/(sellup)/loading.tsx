import { Skeleton } from '@/components/ui/skeleton';

/**
 * Lo que se ve mientras el servidor prepara una pantalla de SellUp.
 *
 * Antes no había nada: al pulsar un enlace la pantalla anterior se quedaba
 * quieta hasta que llegaba la nueva y parecía que el clic no había hecho
 * efecto. Las pantallas con su propio esqueleto (Pipeline, listas) lo pintan
 * enseguida dentro; esto cubre el resto con la forma general de una página.
 */
export default function SellUpLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Cargando la pantalla" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56 rounded-md" />
        <Skeleton className="h-4 w-96 max-w-full rounded-md" />
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-80 w-full rounded-2xl" />
    </div>
  );
}
