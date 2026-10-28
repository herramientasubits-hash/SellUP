import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Sesión prestada por el servidor (GROWTH-BULK-SEARCH-SERVER-1).
 *
 * Una ronda de búsqueda masiva que corre sola en el servidor no trae las cookies
 * de quien la lanzó. El conductor abre una sesión legítima a nombre de esa
 * persona y ejecuta la ronda dentro de `runWithSessionCookies`: mientras dura,
 * `createClient()` (`./server.ts`) lee y escribe las cookies de ESTE frasco en
 * vez de las de la petición. Fuera del bloque no existe y todo sigue igual.
 *
 * Sólo lo usa código de servidor que ya comprobó quién es la persona; no se
 * expone en ninguna ruta.
 */
export interface SessionCookie {
  name: string;
  value: string;
}

export interface SessionCookieJar {
  getAll(): SessionCookie[];
  setAll(cookies: ReadonlyArray<SessionCookie>): void;
}

const storage = new AsyncLocalStorage<SessionCookieJar>();

/** Un frasco de cookies en memoria, para una sola ronda. */
export function createMemoryCookieJar(): SessionCookieJar {
  const cookies = new Map<string, string>();
  return {
    getAll: () => [...cookies.entries()].map(([name, value]) => ({ name, value })),
    setAll: (next) => {
      for (const { name, value } of next) {
        if (value) cookies.set(name, value);
        else cookies.delete(name);
      }
    },
  };
}

export function runWithSessionCookies<T>(jar: SessionCookieJar, fn: () => Promise<T>): Promise<T> {
  return storage.run(jar, fn);
}

/** El frasco prestado de este contexto, o `null` (lo normal: la petición). */
export function currentSessionCookieJar(): SessionCookieJar | null {
  return storage.getStore() ?? null;
}
