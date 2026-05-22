# Tavily — Integración Configurable (Hito 7A)

## Objetivo

Configurar Tavily como proveedor de búsqueda web administrable dentro del módulo de
Configuración / Integraciones de SellUp, antes de realizar pruebas reales con el Agente 1.

## Por qué configuramos Tavily antes de probarlo

Hardcodear la API Key en `.env.local` crea tres problemas:
1. La key no se puede rotar desde la UI sin un redeploy
2. No hay trazabilidad de quién la configuró ni cuándo
3. Puede filtrarse accidentalmente en logs o errores

La integración administrable soluciona los tres: la key vive en Supabase Vault,
el admin puede actualizarla desde la UI, y el sistema registra todos los eventos.

## Dónde se guarda la API Key

**Supabase Vault** — nunca en tablas relacionales, nunca en texto plano.

| Elemento | Valor |
|---|---|
| Vault secret name | `sellup_tavily_api_key` |
| RPC escritura | `upsert_vault_secret` |
| RPC lectura | `get_vault_secret_decrypted` |
| RPC existencia | `has_vault_secret` |
| RPC eliminación | `delete_vault_secret` |

El registro de estado vive en:
- `external_integrations` (catálogo, `integration_key = 'tavily'`)
- `external_integration_connections` (estado: connected / disconnected / error / not_tested)

## Cómo se prueba la conexión

Tavily **no tiene** un endpoint de health check gratuito. Cualquier test consume créditos.

El test de conexión hace:
```
POST https://api.tavily.com/search
Authorization: Bearer {api_key}
{
  "query": "UBITS Colombia educacion corporativa",
  "max_results": 1,
  "search_depth": "basic"
}
```

**Consumo: 1 crédito de Tavily por ejecución.**

La UI muestra una advertencia y requiere confirmación explícita antes de ejecutar el test.

## Cómo lo usa el web_search_tool

El `runTavilyWebSearch()` en `web-search-providers/tavily-web-search-provider.ts`
ahora busca la API Key en este orden:

1. **Supabase Vault** vía `getTavilyApiKey()` del servicio `tavily-connection.ts`
2. **`process.env.TAVILY_API_KEY`** solo si el entorno NO es producción (fallback local)
3. Si no hay key → retorna `{ skipped: true, skipReason: 'tavily_api_key_missing' }`

El `web-search-tool.ts` sigue usando `mock` como provider por defecto:
```typescript
const DEFAULT_PROVIDER: WebSearchProviderKey = 'mock';
```

Para usar Tavily hay que invocarlo explícitamente:
```typescript
await runWebSearch({ query: '...', provider: 'tavily' });
```

## Seguridad

- La API Key **nunca** aparece completa en la UI (campo tipo password)
- **Nunca** se retorna al frontend — solo se usa en server-side
- **Nunca** se imprime en console ni en metadata de audit
- Solo administradores activos pueden configurar la integración
- Tavily **no es** el provider por defecto del web_search_tool
- No hay llamadas automáticas ni masivas

## Costos y créditos

| Acción | Créditos consumidos |
|---|---|
| Test de conexión | 1 |
| Búsqueda básica (`search_depth: 'basic'`) | 1 |
| Búsqueda avanzada (`search_depth: 'advanced'`) | ~2-5 |
| Plan gratuito | ~1,000/mes |

**Recomendación:** Mantener Tavily desactivado para usuarios finales hasta validar
calidad de resultados y costo por búsqueda en el contexto de prospección B2B Colombia.

## Archivos involucrados

| Archivo | Propósito |
|---|---|
| `supabase/migrations/041_tavily_integration.sql` | Seed en catálogo + conexión inicial + constraint audit |
| `src/server/services/tavily-connection.ts` | Vault management + test de conexión |
| `src/modules/integrations/actions.ts` | Server actions: connect, update, test, disconnect |
| `src/modules/integrations/types.ts` | TavilyMetadata + audit event types |
| `src/app/(sellup)/settings/integrations/tavily/page.tsx` | UI de configuración (server component) |
| `src/app/(sellup)/settings/integrations/tavily/tavily-actions-client.tsx` | Modales y botones (client component) |
| `src/app/(sellup)/settings/integrations/page.tsx` | Card en el listado de integraciones |
| `src/server/agents/prospecting-toolkit/web-search-providers/tavily-web-search-provider.ts` | Adapter actualizado (Vault primero) |

## Próximo paso: validación controlada real

Una vez que la integración esté configurada con una API Key válida:

1. Navegar a Configuración → Integraciones → Tavily
2. Guardar la API Key (`tvly-...`)
3. Clic en "Probar conexión" → confirmar consumo de 1 crédito
4. Verificar estado: `connected`
5. Ejecutar máximo 3 búsquedas de prueba con `provider: 'tavily'` desde el Agente 1
6. Evaluar calidad de resultados para prospección B2B Colombia
7. Decidir si Tavily se activa como provider real o se mantiene en mock
