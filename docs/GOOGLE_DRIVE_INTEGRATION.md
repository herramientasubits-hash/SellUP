# Google Drive Integration — Documentación técnica

**Fecha:** 2026-05-19  
**Tipo:** Integración personal por usuario  
**Scope:** `https://www.googleapis.com/auth/drive.file`

---

## 1. Decisión funcional

Google Drive en SellUp es una **integración personal por usuario**, no una integración global administrada por un Administrador (como HubSpot o Slack).

> Cada usuario activo conecta su propio Google Drive desde SellUp. La plataforma almacena el refresh token de forma segura en Supabase Vault y utiliza esa conexión para crear y gestionar archivos generados por ese usuario dentro de una carpeta raíz `SellUp` en su Drive.

### Comparación con integraciones globales

| Integración  | Tipo      | Quién conecta | Vault                              |
|-------------|-----------|---------------|------------------------------------|
| HubSpot     | Global    | Admin         | `sellup_integration_hubspot_token` |
| Slack       | Global    | Admin         | `sellup_integration_slack_bot_token` |
| Google Drive | Personal | Cada usuario  | `sellup_user_drive_refresh_token_{user_id}` |

---

## 2. Scope elegido

```
https://www.googleapis.com/auth/drive.file
```

**Razón:** Este scope permite crear archivos nuevos y modificar archivos que la app crea o que el usuario comparte explícitamente con la app. Es el scope de menor privilegio adecuado para el caso de uso de SellUp.

**No se usan:**
- `drive` — acceso total de lectura/escritura
- `drive.readonly` — lectura de todo el Drive
- `drive.metadata.readonly` — lectura de metadata de todo el Drive

---

## 3. Variables de entorno

| Variable | Uso |
|---------|-----|
| `GOOGLE_DRIVE_CLIENT_ID` | Client ID de la OAuth App en Google Cloud Console |
| `GOOGLE_DRIVE_CLIENT_SECRET` | Client Secret (server-side exclusivamente, nunca frontend) |
| `GOOGLE_DRIVE_REDIRECT_URI` | URI de callback registrada en Google Cloud Console |
| `NEXT_PUBLIC_APP_URL` | URL base para construir redirect URIs dinámicas (fallback) |

Si `GOOGLE_DRIVE_REDIRECT_URI` no está configurada, se usa:
```
{NEXT_PUBLIC_APP_URL}/api/integrations/google-drive/oauth/callback
```

---

## 4. Flujo OAuth

### 4.1. Start — `GET /api/integrations/google-drive/oauth/start`

1. Valida que el usuario esté autenticado y tenga `access_status = 'active'` en `internal_users`.
2. Genera un `state` CSRF-safe (16 bytes hexadecimales).
3. Persiste el state en `user_drive_audit` con `event_type = 'drive_oauth_started'` y `metadata.oauth_state`.
4. Construye la URL de autorización de Google:
   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id={CLIENT_ID}
     &redirect_uri={REDIRECT_URI}
     &response_type=code
     &scope=https://www.googleapis.com/auth/drive.file
     &access_type=offline
     &prompt=consent
     &include_granted_scopes=true
     &state={STATE}
   ```
5. Redirige al consentimiento de Google.

**Por qué `prompt=consent`:**  
Google solo retorna un `refresh_token` la primera vez que el usuario otorga acceso. En reconexiones (revocar y volver a conectar), Google no retornaría refresh_token sin `prompt=consent`. Para garantizar que SellUp siempre reciba un refresh token válido en cualquier flujo de conexión, se incluye `prompt=consent`.

### 4.2. Callback — `GET /api/integrations/google-drive/oauth/callback`

1. Valida parámetros `code` y `state`.
2. Valida `state` contra `user_drive_audit` (ventana de 10 minutos, event_type = `drive_oauth_started`).
3. Verifica que el usuario autenticado coincida con el usuario que generó el state (seguridad cross-user).
4. Intercambia `code` por `access_token` + `refresh_token` via `POST https://oauth2.googleapis.com/token`.
5. Valida que exista `refresh_token` antes de continuar.
6. Guarda `refresh_token` en Supabase Vault (no el `access_token`).
7. Si no existe `drive_folder_id` previo, crea la carpeta raíz `SellUp` en el Drive del usuario.
8. Persiste metadata no sensible en `user_drive_connections`.
9. Registra eventos en `user_drive_audit`.
10. Redirige a `/settings/my-drive?connected=1`.

**Access token:** efímero, usado únicamente en-request para crear la carpeta. No se persiste.

---

## 5. Supabase Vault

### Naming del secreto
```
sellup_user_drive_refresh_token_{internal_user_id}
```

Ejemplo: `sellup_user_drive_refresh_token_a1b2c3d4-...`

### RPCs utilizadas (ya existentes desde migration 017)

| RPC | Uso |
|-----|-----|
| `upsert_vault_secret(p_name, p_secret, p_description)` | Crear o actualizar refresh token |
| `get_vault_secret_decrypted(p_name)` | Recuperar refresh token (server-side only) |
| `has_vault_secret(p_name)` | Verificar existencia sin exponer valor |
| `delete_vault_secret(p_name)` | Eliminar al desconectar |

### Cuándo se llama cada operación

| Operación | RPC |
|-----------|-----|
| Completar OAuth | `upsert_vault_secret` |
| Probar conexión | `get_vault_secret_decrypted` → refresh access token |
| Crear archivo (futuro) | `get_vault_secret_decrypted` → refresh access token |
| Desconectar | `delete_vault_secret` |

---

## 6. Modelo de datos

### `user_drive_connections`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `internal_user_id` | UUID | FK a `internal_users` (UNIQUE — un registro por usuario) |
| `vault_secret_id` | UUID | Referencia al secret en Vault |
| `credentials_status` | TEXT | `missing` \| `stored` |
| `connection_status` | TEXT | `not_connected` \| `connected` \| `error` \| `disconnected` |
| `drive_folder_id` | TEXT | ID de la carpeta raíz SellUp en el Drive del usuario |
| `drive_folder_name` | TEXT | Nombre de la carpeta (siempre "SellUp") |
| `connected_at` | TIMESTAMPTZ | Última vez que completó OAuth |
| `last_tested_at` | TIMESTAMPTZ | Última prueba de conexión |
| `last_connection_error` | TEXT | Error de la última prueba fallida |
| `disconnected_at` | TIMESTAMPTZ | Fecha de desconexión |
| `created_at` | TIMESTAMPTZ | Creación del registro |
| `updated_at` | TIMESTAMPTZ | Última modificación |

### `user_drive_audit`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | PK |
| `internal_user_id` | UUID | FK a `internal_users` |
| `event_type` | TEXT | Tipo de evento (ver abajo) |
| `metadata` | JSONB | Contexto del evento (sin tokens) |
| `created_at` | TIMESTAMPTZ | Timestamp del evento |

**Tipos de evento:**
- `drive_oauth_started`
- `drive_oauth_connected`
- `drive_oauth_failed`
- `drive_connection_tested`
- `drive_connection_succeeded`
- `drive_connection_failed`
- `drive_folder_created`
- `drive_disconnected`

---

## 7. Carpeta raíz SellUp

### Cómo se crea
```http
POST https://www.googleapis.com/drive/v3/files
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json

{
  "name": "SellUp",
  "mimeType": "application/vnd.google-apps.folder"
}
```

### Cuándo se crea
Al completar el OAuth callback, si `drive_folder_id` no existe en `user_drive_connections`.

### Cómo se evitan duplicados
1. Antes de crear, se consulta `user_drive_connections.drive_folder_id`.
2. Si ya existe un `folder_id` registrado (de una conexión anterior), se reutiliza sin crear uno nuevo.
3. Si no existe, se crea la carpeta y se guarda el ID.

**Limitación del scope `drive.file`:** No se puede listar carpetas existentes del usuario para verificar si "SellUp" ya existe. Solo se pueden listar/modificar archivos creados por la app. Por eso la deduplicación se basa en el registro en DB, no en consultar Drive.

---

## 8. Flujos funcionales

### Conectar Drive
1. Usuario hace clic en "Conectar Google Drive" → redirige a `/api/integrations/google-drive/oauth/start`.
2. SellUp redirige a consentimiento de Google.
3. Usuario acepta → Google redirige a `/api/integrations/google-drive/oauth/callback?code=...&state=...`.
4. SellUp completa OAuth, guarda refresh token en Vault, crea carpeta SellUp.
5. Redirige a `/settings/my-drive?connected=1`.

### Probar conexión
1. Usuario hace clic en "Probar conexión".
2. Server action recupera refresh token de Vault.
3. Obtiene access token fresco via refresh flow.
4. Llama `GET /drive/v3/about?fields=user` para verificar acceso.
5. Actualiza `connection_status` y `last_tested_at`.
6. Retorna resultado al usuario.

### Abrir carpeta SellUp
- Enlace directo a `https://drive.google.com/drive/folders/{drive_folder_id}`.
- Se abre en nueva pestaña.

### Desconectar
1. Usuario confirma en AlertDialog.
2. Server action elimina refresh token de Vault.
3. Actualiza `user_drive_connections` con `connection_status = 'disconnected'`.
4. Registra evento `drive_disconnected` en auditoría.

---

## 9. Helpers para módulos futuros

### Ubicación
`src/server/services/google-drive-api.ts`  
`src/modules/drive/actions.ts`

### Helpers disponibles

| Helper | Archivo | Descripción |
|--------|---------|-------------|
| `getGoogleDriveAccessToken(refreshToken)` | `google-drive-api.ts` | Genera access token desde refresh token |
| `testDriveConnection(accessToken)` | `google-drive-api.ts` | Valida acceso con `/about?fields=user` |
| `createSellUpDriveFolder(accessToken)` | `google-drive-api.ts` | Crea carpeta raíz SellUp |
| `createSellUpDriveFile(accessToken, folderId, name, mimeType, content?)` | `google-drive-api.ts` | Crea archivo en carpeta SellUp |
| `getAuthorizedDriveClientForUser(userId)` | `drive/actions.ts` | Devuelve access token + folderId para un usuario |

### Uso típico en módulo futuro (server-side)
```typescript
// En una server action que genera una propuesta
const clientResult = await getAuthorizedDriveClientForUser(internalUserId);
if (!clientResult.success) throw new Error(clientResult.error);

const fileResult = await createSellUpDriveFile(
  clientResult.accessToken,
  clientResult.folderId!,
  'Propuesta - Cliente XYZ.docx',
  'application/vnd.google-apps.document',
  contenidoTexto,
  'text/plain'
);
```

---

## 10. Seguridad y RLS

### Lectura (RLS)
- Cada usuario activo solo puede leer su propia fila en `user_drive_connections` y `user_drive_audit`.
- La política verifica `auth_user_id = auth.uid()` y `access_status = 'active'`.

### Escritura
- No hay política de escritura pública. Todas las escrituras se hacen via admin client server-side.

### Admins
- Pueden ver métricas agregadas via `get_drive_connection_stats()` en System Status.
- No pueden ver ni gestionar el token o conexión privada de otro usuario.

### Secretos
- `GOOGLE_DRIVE_CLIENT_SECRET`: solo en variables de entorno del servidor.
- `refresh_token`: solo en Supabase Vault, nunca en tablas relacionales.
- `access_token`: efímero, solo en memoria durante la request, nunca persistido.
- Nada sensible en logs, frontend ni responses de API.

---

## 11. Qué NO se implementa en esta fase

- Google Docs API
- Google Slides API
- Google Sheets API
- Generación de propuestas o business cases
- Lectura de archivos existentes del usuario
- Sincronización de archivos
- Shared Drives
- Google Picker
- Edición de archivos no creados por SellUp

---

## 12. Configuración en Google Cloud Console

Para activar la integración, el administrador de la cuenta GCP debe:

1. Ir a [Google Cloud Console](https://console.cloud.google.com/).
2. Crear o seleccionar un proyecto.
3. Habilitar **Google Drive API** en "APIs y Servicios".
4. Crear credenciales OAuth 2.0 de tipo "Aplicación web":
   - Orígenes JavaScript autorizados: `https://tu-dominio.com`
   - URIs de redirección autorizadas: `https://tu-dominio.com/api/integrations/google-drive/oauth/callback`
5. Copiar `Client ID` y `Client Secret` a las variables de entorno.
6. Si la app está en modo "Testing", agregar el email del usuario como Test User.
7. Para producción, completar la pantalla de consentimiento OAuth y solicitar verificación de Google si se usan scopes sensibles (aunque `drive.file` no lo requiere para uso interno).

---

## 13. Migración aplicada

**Archivo:** `supabase/migrations/022_google_drive_integration.sql`

**Contiene:**
- `CREATE TABLE user_drive_connections`
- `CREATE TABLE user_drive_audit`
- RLS: `drive_connections_select_own`, `drive_audit_select_own`
- `CREATE FUNCTION get_drive_connection_stats()` — SECURITY DEFINER
