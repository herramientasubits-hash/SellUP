/**
 * CLI/server-only WebSocket shim for Node 20.
 *
 * Node < 22 ships no global `WebSocket`, which @supabase/supabase-js
 * (realtime-js) touches at client construction. Browser runtimes and the
 * Next.js server already provide a global `WebSocket`, so this helper is only
 * ever called from CLI entrypoints (the SUNAT snapshot importer, the coverage
 * diagnostic report). It is never imported by app/client code.
 *
 * Guarantees:
 *   - No-op when a global `WebSocket` already exists (browser / Node 22+ / Next).
 *   - Makes no network calls of its own.
 *   - Reads or exposes no environment variables or secrets.
 *   - Does not change any importer/business logic — it only enables the
 *     Supabase client to construct under Node 20.
 */
import { WebSocket as UndiciWebSocket } from 'undici';

/**
 * Installs undici's `WebSocket` as the global constructor only when the runtime
 * does not already provide one. Idempotent and side-effect-free beyond that.
 */
export function ensureNode20WebSocketShim(): void {
  const globalScope = globalThis as { WebSocket?: unknown };
  if (!globalScope.WebSocket) {
    globalScope.WebSocket = UndiciWebSocket;
  }
}
