/**
 * ¿El error viene de una página abierta antes de un deploy que llamó al servidor nuevo?
 * (dueña 19-10: al terminar una preparación, «This page couldn't load»). Se arregla
 * recargando la página.
 */
export function isVersionSkewError(error: { message?: string; name?: string } | null | undefined): boolean {
  const text = `${error?.name ?? ''} ${error?.message ?? ''}`;
  return /Failed to find Server Action|Server Action "?[\w-]*"? was not found|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(text);
}
