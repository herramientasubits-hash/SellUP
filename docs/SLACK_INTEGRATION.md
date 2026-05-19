# Integración Slack — Nota Técnica

## Estado actual

Integración Slack implementada en el MVP. Permite:
- Conectar un workspace de Slack vía OAuth v2 (bot token).
- Probar la conexión (`auth.test`).
- Crear el canal oficial de SellUp (`conversations.create`).
- Enviar un mensaje de prueba (`chat.postMessage`).
- Desconectar (revoca el token de Vault, preserva metadata histórica).

## Configurar una Slack App

1. Ir a [https://api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. Nombre sugerido: `SellUp`.
3. En **OAuth & Permissions → Bot Token Scopes**, agregar los 6 scopes requeridos:
   - `channels:manage` — crear el canal oficial de SellUp.
   - `chat:write` — enviar mensajes como bot.
   - `app_mentions:read` — leer menciones directas a la app en canales donde esté presente.
   - `channels:history` — leer historial de canales públicos donde el bot esté agregado.
   - `im:write` — abrir mensajes directos hacia usuarios.
   - `im:history` — leer historial de DMs donde el bot participe.
4. En **OAuth & Permissions → Redirect URLs**, agregar la URL de callback:
   - Producción: `https://tu-dominio.com/api/integrations/slack/oauth/callback`
   - Local con túnel: `https://abc123.ngrok.io/api/integrations/slack/oauth/callback`
   - **Slack exige HTTPS**. No acepta `http://localhost`.
5. Copiar **Client ID** y **Client Secret** desde **Basic Information**.

## Variables de entorno

| Variable | Valor |
|---|---|
| `SLACK_CLIENT_ID` | Client ID de la Slack App |
| `SLACK_CLIENT_SECRET` | Client Secret de la Slack App |
| `SLACK_REDIRECT_URI` | URL de callback con HTTPS |
| `NEXT_PUBLIC_APP_URL` | URL base de la app (para redirects post-OAuth) |

## Flujo OAuth v2

```
Browser → GET /api/integrations/slack/oauth/start
  → Valida admin
  → Genera state (random 16 bytes)
  → Persiste state en cookie HTTP-only (5 min)
  → Redirige a https://slack.com/oauth/v2/authorize

Slack → GET /api/integrations/slack/oauth/callback?code=...&state=...
  → Valida state contra cookie (CSRF)
  → Valida admin
  → POST oauth.v2.access → obtiene bot token
  → Guarda bot token en Supabase Vault (sellup_integration_slack_bot_token)
  → Persiste metadata segura en external_integration_connections
  → Registra auditoría (oauth_connected)
  → Redirige a /settings/integrations/slack?connected=1
```

## Almacenamiento de credenciales

- **Bot token**: solo en Supabase Vault (`sellup_integration_slack_bot_token`). Nunca en tablas relacionales, nunca en frontend, nunca en logs.
- **Vault secret ID**: referenciado en `external_integration_connections.vault_secret_id`.
- **Metadata no sensible** (team_id, team_name, bot_user_id, scopes, channel_id, channel_name): almacenada en `external_integration_connections.metadata` (JSONB).

## Prueba local con HTTPS

Slack no permite `redirect_uri` con HTTP. Para pruebas locales:

```bash
# Opción 1: ngrok
ngrok http 3000
# Usar: https://abc123.ngrok.io/api/integrations/slack/oauth/callback

# Opción 2: cloudflared
cloudflared tunnel --url http://localhost:3000
```

Configurar `SLACK_REDIRECT_URI` y agregar la URL en la Slack App → OAuth & Permissions → Redirect URLs.

## Auditoría

Eventos registrados en `integration_audit` con `integration_key = 'slack'`:

| Evento | Cuándo |
|---|---|
| `oauth_started` | Al iniciar el flujo OAuth |
| `oauth_connected` | Al completar OAuth exitosamente |
| `oauth_failed` | Si Slack retorna error en el intercambio de token |
| `connection_tested` | Al probar la conexión |
| `connection_succeeded` | Si `auth.test` es exitoso |
| `connection_failed` | Si `auth.test` falla |
| `channel_created` | Al crear el canal oficial |
| `test_message_sent` | Al enviar el mensaje de prueba |
| `disconnected` | Al desconectar Slack |

## Scopes OAuth solicitados

| Scope | Propósito |
|---|---|
| `channels:manage` | Crear el canal oficial de SellUp |
| `chat:write` | Enviar mensajes como bot |
| `app_mentions:read` | Leer menciones directas a la app en canales donde esté presente |
| `channels:history` | Leer historial de canales públicos donde el bot esté agregado |
| `im:write` | Abrir mensajes directos hacia usuarios |
| `im:history` | Leer historial de DMs donde el bot participe |

> **Nota de alcance:** SellUp todavía no implementa interacción conversacional ni Events API.
> Los scopes `app_mentions:read`, `channels:history`, `im:write` e `im:history` se solicitan
> para dejar la integración preparada para fases futuras sin necesidad de reinstalar la app.
> Las capacidades actualmente activas del MVP son: conectar Slack, crear canal oficial y
> enviar mensaje de prueba.

## Reinstalación al cambiar scopes

Cuando se modifican los Bot Token Scopes en la Slack App, **es obligatorio reconectar o
reinstalar la app** en el workspace para que los nuevos permisos queden autorizados.
El bot token previo no incluirá los scopes añadidos hasta que el administrador complete
un nuevo flujo OAuth desde Settings → Integraciones → Slack → Conectar Slack.

## Pendiente para fases futuras

- Alertas automáticas disparadas por eventos de negocio.
- Mensajes a canales por pipeline o etapa de negociación.
- DM a usuarios individuales (`im:write` / `im:history` ya solicitados).
- Slash commands o interactividad de botones.
- Events API (webhooks entrantes de Slack) con `app_mentions:read`.
- Workflows conversacionales con Samu IA.
