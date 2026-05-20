# Lusha Integration — SellUp

## Propósito

Lusha es el segundo proveedor de prospección y enriquecimiento B2B integrado en SellUp.
Permite enriquecer contactos y empresas con datos de contacto verificados (emails, teléfonos,
perfiles LinkedIn) y, dependiendo del plan, buscar nuevos prospectos que coincidan con
el ICP del equipo comercial.

Esta fase cubre exclusivamente la **conexión administrativa**: guardar la API Key, probar la
conexión, actualizar o desconectar. Los flujos operativos de enriquecimiento quedan preparados
técnicamente pero no se activan hasta fases posteriores.

---

## Autenticación

**Método oficial:** Header HTTP `api_key`

```http
GET https://api.lusha.com/account/usage
api_key: {tu_api_key}
Content-Type: application/json
```

Fuente verificada: [docs.lusha.com/apis/openapi/section/authentication](https://docs.lusha.com/apis/openapi/section/authentication)

- La API Key es única por cuenta y se genera en `https://dashboard.lusha.com/enrich/api`.
- Solo debe usarse en entornos server-side. Nunca exponerla al frontend.
- Todas las requests deben usar HTTPS.

---

## Cómo conectar Lusha en SellUp

1. Ir a **Configuración → Prospección y enriquecimiento**.
2. En la tarjeta de Lusha, hacer clic en **Conectar Lusha**.
3. Pegar la API Key obtenida desde el dashboard de Lusha.
4. Hacer clic en **Guardar credencial** — la key se almacena cifrada en Supabase Vault.
5. Hacer clic en **Probar conexión** para validar que Lusha responde correctamente.

---

## Vault

| Campo | Valor |
|-------|-------|
| Secret name | `sellup_prospecting_lusha_api_key` |
| Descripción | `API Key de Lusha para prospección y enriquecimiento en SellUp` |
| Almacenamiento | Supabase Vault (cifrado en reposo) |
| Acceso | Exclusivo server-side vía RPC `get_vault_secret_decrypted` |

**Reglas de seguridad:**
- La API Key NUNCA se retorna al frontend.
- NUNCA se registra en logs.
- Se elimina de Vault al desconectar.
- La tabla `prospecting_provider_connections` almacena solo el `vault_secret_id` — nunca el secreto.

---

## Endpoint de prueba de conexión

| Campo | Valor |
|-------|-------|
| Endpoint | `GET https://api.lusha.com/account/usage` |
| Header | `api_key: {value}` |
| Respuesta exitosa | `200 OK` con objeto `usage` conteniendo estadísticas de créditos |
| **Consume créditos** | **No** — es un endpoint de gestión de cuenta, no de enriquecimiento |
| Rate limit específico | 5 requests/minuto |

Este endpoint es el de menor impacto disponible en la API de Lusha para validar
autenticación sin consumir créditos de enriquecimiento.

---

## Capacidades contempladas

| Capacidad | Endpoint | Estado | Consume créditos |
|-----------|----------|--------|-----------------|
| Prueba de conexión | `GET /account/usage` | ✅ Activo | No |
| Enriquecimiento de persona | `GET /person` | 🔜 Preparado | Sí |
| Enriquecimiento de empresa | `GET /company` | 🔜 Preparado | Sí |
| Búsqueda de personas | `POST /prospecting/search/contacts` | 🔜 Preparado | Sí (plan Prospecting) |
| Búsqueda de empresas | `POST /prospecting/search/companies` | 🔜 Preparado | Sí (plan Prospecting) |

---

## Modelo de datos

No se requirió migración adicional. `prospecting_provider_connections` (creada en `032_apollo_prospecting_connection.sql`) ya soporta múltiples proveedores mediante `provider_id` FK + `UNIQUE(provider_id)`.

Lusha fue registrado en el catálogo `prospecting_providers` durante la migración inicial con `provider_key = 'lusha'`.

**Flujo de lifecycle:**
- Al guardar credencial: `connection_status = 'not_tested'`, `credentials_status = 'stored'`
- Al probar con éxito: `lifecycle_status = 'connected'`, `is_available_for_selection = true`
- Al fallar: `lifecycle_status = 'prepared'`, `is_available_for_selection = false`
- Al desconectar: `lifecycle_status = 'prepared'`, credencial eliminada de Vault

---

## Límites y dependencias del plan

- Las capacidades de enriquecimiento (`/person`, `/company`) dependen del plan de Lusha.
- Las capacidades de prospección (`/prospecting/search/*`) requieren el plan **Prospecting** de Lusha.
- El rate limit general es de **25 requests/segundo** por endpoint.
- El endpoint `/account/usage` tiene un rate limit específico de **5 requests/minuto**.
- Los créditos se descuentan por cada enriquecimiento exitoso, no por requests fallidas.

---

## Archivos implementados

| Archivo | Propósito |
|---------|-----------|
| `src/server/services/lusha-connection.ts` | Vault management + health check |
| `src/server/integrations/lusha-client.ts` | Cliente API (enriquecimiento y búsqueda, preparados) |
| `src/modules/prospecting-config/actions.ts` | Server Actions: connect, test, update, disconnect |
| `src/app/(sellup)/settings/prospecting/lusha-provider-card.tsx` | UI interactiva |
| `src/app/(sellup)/settings/prospecting/page.tsx` | Integra LushaProviderCard |
| `src/modules/system-status/types.ts` | Tipo LushaHealth |
| `src/modules/system-status/actions.ts` | Health + riesgos de Lusha |
| `src/app/(sellup)/settings/system-status/page.tsx` | Tarjeta Lusha en estado del sistema |

---

## Auditoría

Eventos registrados en `integration_audit` con `integration_key = 'lusha'`:

| Evento | Cuándo |
|--------|--------|
| `credential_stored` | Al guardar la API Key por primera vez |
| `credential_updated` | Al actualizar la API Key |
| `connection_tested` | Al iniciar la prueba de conexión |
| `connection_succeeded` | Cuando la prueba es exitosa |
| `connection_failed` | Cuando la prueba falla (+ `error_code` en metadata) |
| `disconnected` | Al desconectar |

---

## Qué queda fuera de esta fase

- Flujos operativos de enriquecimiento de contactos y empresas desde el CRM.
- Búsqueda de prospectos nuevos (requiere plan Prospecting de Lusha).
- Selección de Lusha como proveedor activo en configuración global.
- Webhooks de señales (Signals API de Lusha).
- UI para visualizar créditos restantes del plan.
