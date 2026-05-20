# Apollo.io Integration

## Propósito

Apollo.io es el primer proveedor real de Prospección y Enriquecimiento en SellUp.
Permite futuros flujos de búsqueda de empresas, decisores y enriquecimiento de cuentas
con datos firmográficos y tecnográficos de una base de +270M de contactos.

Esta fase establece la **conexión administrativa** real: guardar credencial, probar
conexión y desconectar. Los flujos operativos de búsqueda y enriquecimiento se
activarán en fases futuras.

---

## Cómo conectar Apollo.io

1. Ir a **Configuración → Prospección y enriquecimiento** (requiere rol Admin).
2. En la tarjeta de Apollo.io, hacer clic en **Conectar Apollo**.
3. Ingresar la API Key obtenida desde el panel de Apollo
   ([Create API Keys](https://app.apollo.io/#/settings/integrations/api)).
4. Hacer clic en **Guardar credencial**.
5. Hacer clic en **Probar conexión** para verificar que la key sea válida.

---

## API Key y Vault

- La API Key **nunca** se almacena en texto plano en la base de datos.
- Se guarda en **Supabase Vault** bajo el nombre:
  ```
  sellup_prospecting_apollo_api_key
  ```
- La tabla `prospecting_provider_connections` solo guarda el `vault_secret_id`
  (UUID de referencia lógica al secreto), nunca el valor.
- Solo código server-side (Server Actions con service role) puede leer el secreto.
- El secreto **nunca** se retorna al frontend ni se imprime en logs.

### RPCs de Vault utilizadas

| RPC | Propósito |
|-----|-----------|
| `upsert_vault_secret` | Crear o actualizar la API Key en Vault |
| `get_vault_secret_decrypted` | Leer la key para llamadas a la API (server-side only) |
| `has_vault_secret` | Verificar si existe una credencial guardada |
| `delete_vault_secret` | Eliminar la key al desconectar |

---

## Prueba de conexión

La prueba de conexión usa el endpoint de health check de Apollo, que **no consume
búsquedas ni créditos** del plan configurado.

```
GET https://api.apollo.io/v1/auth/health
Header: X-Api-Key: {api_key}
```

**Respuesta exitosa:**
```json
{ "is_logged_in": true }
```

**Interpretación:**
- `200 OK` + `is_logged_in: true` → estado `connected`
- `401 Unauthorized` → API Key inválida o sin permisos
- Cualquier otro error → estado `error` con mensaje descriptivo

Al conectar exitosamente:
- `prospecting_provider_connections.connection_status` → `connected`
- `prospecting_providers.lifecycle_status` → `connected`
- `prospecting_providers.is_available_for_selection` → `true`

Al desconectar o fallar:
- Lifecycle regresa a `prepared`
- `is_available_for_selection` → `false`

---

## Modelo de datos

### `prospecting_providers` (catálogo existente)

Registro Apollo: `provider_key = 'apollo'`

| Campo | Valor tras conectar |
|-------|---------------------|
| `lifecycle_status` | `connected` |
| `is_available_for_selection` | `true` |

### `prospecting_provider_connections` (nuevo en migración 032)

| Campo | Propósito |
|-------|-----------|
| `provider_id` | FK a `prospecting_providers.id` |
| `vault_secret_id` | UUID del secreto en Vault (nunca el valor) |
| `credentials_status` | `missing` / `stored` |
| `connection_status` | `not_connected` / `not_tested` / `connected` / `error` / `disconnected` |
| `last_tested_at` | Timestamp de la última prueba |
| `last_connected_at` | Timestamp del último health check exitoso |
| `last_connection_error` | Mensaje de error de la última prueba fallida |
| `configured_by` | ID del admin que configuró la credencial |

**Constraint:** `UNIQUE (provider_id)` — una conexión activa por proveedor.

---

## Auditoría

Los eventos de Apollo se registran en `integration_audit` con
`integration_key = 'apollo'` y los siguientes `event_type`:

| Evento | Cuándo |
|--------|--------|
| `credential_stored` | Al guardar API Key por primera vez |
| `credential_updated` | Al actualizar una API Key existente |
| `connection_tested` | Al iniciar prueba de conexión |
| `connection_succeeded` | Cuando el health check pasa |
| `connection_failed` | Cuando el health check falla |
| `disconnected` | Al desconectar el proveedor |

---

## Endpoints futuros preparados

Los siguientes endpoints están implementados en
`src/server/integrations/apollo-client.ts` pero **no están expuestos en UI
ni se disparan automáticamente**.

| Función | Endpoint | Notas |
|---------|----------|-------|
| `searchApolloOrganizations` | `POST /api/v1/mixed_companies/search` | Consume créditos del plan |
| `enrichApolloOrganization` | `GET /api/v1/organizations/enrich` | Consume créditos del plan |
| `searchApolloPeople` | `POST /api/v1/mixed_people/api_search` | Puede requerir Master Key |
| `matchApolloPerson` | `POST /api/v1/people/match` | Consume créditos del plan |

### Nota sobre créditos y Master Key

- **Organization Search y Enrichment**: consumen créditos según el plan de Apollo.
- **People Search** (`mixed_people/api_search`): puede requerir una Master Key
  dependiendo del plan. Verificar configuración antes de activar.
- **Health check** (`/v1/auth/health`): **no consume créditos**. Es el único
  endpoint que se usa en esta fase.

---

## Archivos relevantes

| Archivo | Propósito |
|---------|-----------|
| `supabase/migrations/032_apollo_prospecting_connection.sql` | Migración: tabla `prospecting_provider_connections` |
| `src/server/services/apollo-connection.ts` | Vault CRUD + health check |
| `src/server/integrations/apollo-client.ts` | Cliente API con endpoints futuros |
| `src/modules/prospecting-config/actions.ts` | Server Actions: connect, test, update, disconnect |
| `src/modules/prospecting-config/types.ts` | Tipos: `ProspectingProviderConnection` |
| `src/app/(sellup)/settings/prospecting/page.tsx` | Página de configuración |
| `src/app/(sellup)/settings/prospecting/apollo-provider-card.tsx` | Tarjeta interactiva de Apollo |
| `src/modules/system-status/actions.ts` | Salud del sistema incluye Apollo |

---

## Seguridad

- Solo usuarios con rol `admin` y `access_status = 'active'` pueden:
  - Conectar, actualizar API Key, probar conexión, desconectar.
- La UI nunca expone el valor de la API Key.
- La API Key solo se lee server-side mediante `get_vault_secret_decrypted`.
- RLS en `prospecting_provider_connections`: solo admins pueden leer.
  Las escrituras van por service role desde Server Actions.
