# Configuración e Integraciones — Documento de Cierre

**Proyecto:** SellUp  
**Módulo:** Configuración e Integraciones  
**Estado:** Cerrado  
**Fecha de cierre:** 2026-05-21  
**Alcance:** Foundation operativa del MVP

---

## 1. Resumen ejecutivo

El módulo de Configuración e Integraciones queda cerrado como la **foundation operativa del MVP de SellUp**.

Este módulo establece la infraestructura transversal sobre la que se construirán todos los módulos funcionales posteriores. No es un módulo de usuario final — es la capa de habilitación que permite que SellUp opere como plataforma de inteligencia comercial.

El módulo completado permite:

- **Administrar usuarios** — acceso, roles, estructura organizacional, aprobaciones y auditoría de quién tiene acceso a qué.
- **Configurar proveedores de IA** — conectar modelos externos, gestionar API Keys en Vault, definir tarifas y medir costos estimados por ejecución.
- **Conectar integraciones** — HubSpot como CRM de origen, Slack para alertas, Google Drive para almacenamiento, Apollo y Lusha para enriquecimiento de prospectos, Samu IA para análisis post-reunión.
- **Auditar actividad** — trazabilidad de usuarios, integraciones y proveedores IA a nivel de evento individual.
- **Medir costos** — base de datos lista para registrar consumo de tokens, costo estimado, proveedor, modelo, usuario, agente y cuenta/prospecto.
- **Preparar automatizaciones** — modos manual, sugerido y automático configurados para activaciones futuras.
- **Recibir eventos externos** — webhook activo para Samu IA, con primer payload real almacenado.
- **Habilitar futuros agentes** — toda la infraestructura de credenciales, datos y trazabilidad está lista para que los agentes operen sobre cuentas y prospectos reales.

---

## 2. Alcance cerrado

### Usuarios y acceso

- Google OAuth como mecanismo de autenticación.
- Roles base definidos (admin, usuario estándar).
- Gestión completa del ciclo de vida de usuarios: pendientes, activos, suspendidos, rechazados, archivados.
- Alta manual mediante preautorización (invitación por email antes de primer acceso).
- Acciones masivas sobre usuarios.
- Líder inmediato configurable por usuario.
- Organigrama visual de la organización.
- Grupos organizacionales hasta 3 niveles.
- Vistas Lista / Organigrama / Grupos.

### IA y costos

- Gestión de proveedores de IA (OpenAI, Anthropic, etc.).
- API Keys almacenadas exclusivamente en Supabase Vault.
- Catálogo de modelos con nombres canónicos.
- Tarifas por modelo (input/output tokens).
- Estimación de costos por ejecución.
- Configuración activa de modelo/proveedor por función.
- Auditoría de cambios en configuración IA.

### Automatizaciones

- Configuración inicial del módulo de automatizaciones.
- Tres modos de operación: manual, suggested, automatic.
- Automatizaciones iniciales definidas para el módulo de prospectos.

### Estado y auditoría

- Página de estado del sistema con health cards por integración.
- Feed de actividad administrativa con filtros.
- Auditoría de usuarios (altas, bajas, cambios de rol, suspensiones).
- Auditoría de integraciones (conexiones, desconexiones, pruebas).
- Auditoría de proveedores IA (cambios de configuración).

### Notificaciones

- Campanita en el header de la aplicación.
- Drawer lateral de notificaciones.
- Estado leído / no leído por notificación.
- Primer evento real implementado: usuario pendiente de aprobación genera notificación para administradores.

### Integraciones

- HubSpot — conexión por Private App Token, lectura de compañías y contactos validada.
- Slack — OAuth completo, bot token, scopes ampliados, listo para alertas.
- Google Drive — OAuth por usuario, carpeta SellUp creada automáticamente, listo para guardar archivos.
- Apollo.io — API Key en Vault, health check activo, búsqueda real de empresas validada.
- Lusha — API Key en Vault, conexión implementada, prueba funcional pendiente de API Key válida.
- Samu IA — API Key en Vault, health check, webhook activo, primer evento real recibido y almacenado.

---

## 3. Estado por componente

| Componente | Estado | Validación realizada | Pendiente |
|-----------|--------|---------------------|-----------|
| Gestión de usuarios | ✅ Cerrado | Ciclo completo: alta, aprobación, suspensión, archivado. Organigrama y grupos. | — |
| Proveedores IA | ✅ Cerrado | Conexión a múltiples proveedores, API Keys en Vault, modelos y tarifas. | — |
| Costos IA | ✅ Cerrado (base de datos) | Estructura de registro lista: proveedor, modelo, tokens, costo, usuario, agente. | Dashboards de visualización — módulo futuro. |
| Automatizaciones | ✅ Cerrado (configuración) | Modos y automatizaciones iniciales definidas. | Ejecución real — depende de módulos funcionales. |
| Estado y auditoría | ✅ Cerrado | Health cards, feed de actividad, auditoría de usuarios e integraciones. | — |
| Notificaciones | ✅ Cerrado (base) | Campanita, drawer, leído/no leído, primer evento real. | Más tipos de evento — se agregan por módulo. |
| HubSpot | ✅ Cerrado | Private App Token, Vault, lectura de compañías y contactos validada en live. | Escritura inversa (desde SellUp a HubSpot) — Phase siguiente. |
| Slack | ✅ Cerrado | OAuth, bot token, scopes ampliados, canal configurado. | Envío de alertas operativas — depende de módulos funcionales. |
| Google Drive | ✅ Cerrado | OAuth por usuario, carpeta SellUp creada en Drive personal. | Guardar archivos generados — depende de módulos funcionales. |
| Apollo.io | ✅ Cerrado | API Key, Vault, health check, búsqueda real de empresas validada. | Paginación profunda y enriquecimiento masivo — módulo prospectos. |
| Lusha | ⚠️ Parcial | API Key, Vault, endpoint de conexión implementado. | Prueba funcional real — requiere API Key válida del cliente. |
| Samu IA | ✅ Cerrado (Phase 1 + 1.1) | API Key, Vault, health check, webhook, primer evento real recibido. | Phase 2: importación de reuniones, normalización de extractor, agente post-reunión. |

---

## 4. Integraciones — detalle técnico-funcional

### HubSpot

**Método de conexión:** Private App Access Token (no OAuth — decisión de arquitectura deliberada para acceso server-side sin contexto de usuario).

**Credencial:** `sellup_hubspot_private_app_token` almacenado en Supabase Vault.

**Vault:** Lectura exclusiva server-side mediante RPC `get_vault_secret_decrypted`. Nunca expuesto al frontend ni registrado en logs.

**Qué se validó:**
- Conexión y autenticación contra la API de HubSpot.
- Lectura de objetos `companies` con propiedades estándar.
- Lectura de objetos `contacts` con propiedades estándar.
- Mapping de campos HubSpot → entidades SellUp verificado en live.

**Qué queda pendiente:**
- Escritura desde SellUp hacia HubSpot (creación/actualización de compañías, contactos, deals). Se diseñará en el módulo Pipeline/Cuentas.
- Sincronización bidireccional — decisión arquitectónica pendiente de diseño.

---

### Slack

**Método de conexión:** OAuth 2.0 con Slack App dedicada. Bot token almacenado en Vault.

**Scopes configurados:** Scopes ampliados para cubrir mensajes directos, canales y notificaciones. Definidos en la Slack App registrada.

**Qué queda listo:**
- Autenticación completa y token activo.
- Canal de destino para alertas configurado.
- Infraestructura lista para enviar mensajes desde cualquier módulo futuro.

**Qué queda para alertas futuras:**
- Implementación de mensajes específicos por evento (nuevo prospecto, alerta de churn, acción requerida) — depende de módulos funcionales.
- Formato de mensajes y Slack Blocks — se diseñan módulo a módulo.

---

### Google Drive

**Conexión:** Por usuario individual mediante OAuth 2.0. Cada usuario conecta su propio Drive.

**Uso esperado:** Almacenamiento de archivos generados por SellUp (resúmenes de reunión, expedientes de cuenta, propuestas).

**Carpeta SellUp:** Se crea automáticamente en el Drive personal del usuario al conectarse.

**Qué queda listo:**
- OAuth completo, refresh token almacenado en Vault por usuario.
- Carpeta SellUp disponible para escritura.
- Infraestructura lista para guardar cualquier archivo generado.

**Qué queda pendiente:**
- Guardar archivos reales — depende de módulos que generen contenido (post-reunión, expediente de cuenta, etc.).

---

### Apollo.io

**Credencial:** API Key almacenada en Vault bajo `sellup_apollo_api_key`.

**Health check:** Endpoint de verificación de cuenta activo, confirma que la API Key es válida.

**Búsqueda de empresas validada:** Búsqueda real de organizaciones contra Apollo API confirmada en live. Mapping corregido durante desarrollo: `accounts ?? organizations` para compatibilidad con diferentes planes y versiones de respuesta.

**Limitaciones de plan detectadas:** El plan del cliente determina el volumen de resultados, campos disponibles y límites de enriquecimiento. No hay limitaciones técnicas en la integración — las limitaciones son comerciales del plan Apollo contratado.

**Qué queda pendiente:**
- Paginación profunda para búsquedas masivas.
- Enriquecimiento individual de prospectos — módulo Prospectos.
- Integración con el pipeline de generación de prospectos por IA.

---

### Lusha

**Credencial:** API Key almacenada en Vault bajo el patrón de secretos estándar de integraciones.

**Conexión implementada:** Endpoint de health check implementado contra `/account/usage`.

**Estado real:** La conexión técnica está construida. Sin embargo, **no se pudo completar una prueba funcional real** porque la API Key disponible durante el desarrollo no correspondía a una cuenta activa válida. La integración está lista en código; requiere API Key válida del cliente para validar el flujo end-to-end.

**Qué queda pendiente:**
- Prueba funcional con API Key válida del cliente.
- Validar respuesta real de `/account/usage` y ajustar mapping si es necesario.
- Implementar búsqueda y enriquecimiento de contactos — módulo Prospectos.

---

### Samu IA

**Credencial:** API Key almacenada en Vault bajo `sellup_samu_api_key`. Nunca expuesta al frontend.

**Health check:** `GET /api/users` — devuelve lista de usuarios del entorno. Validado en live.

**Cliente API ajustado a respuesta real (Phase 1.1):** El cliente `samu-client.ts` fue ajustado después de una inspección técnica directa contra la API real. Los hallazgos críticos validados:

- El endpoint `GET /api/meeting/{id}/transcription` devuelve `Array<{text, date}>` — sin `participantId`, sin speaker mapping, sin diarización.
- La transcripción oficial de Samu **no indica quién dijo qué**. No existe diarización por speaker en la API validada.
- `callType` es un objeto `{_id, name}`, no un string como declara el spec OpenAPI.
- `duration` es float en minutos, no en segundos.
- El campo `extractor` contiene 19+ sub-campos de inteligencia IA confirmados en prueba real.

**Webhook activo:** `POST /api/integrations/samu/webhook` deployado en Vercel. Protegido con validación de header `x-sellup-webhook-secret` contra variable de entorno `SAMU_WEBHOOK_SECRET`.

**Primer evento real recibido:** Payload completo de tipo `meeting` recibido y almacenado en `integration_webhook_events`. El payload incluye: `id` de reunión, `summary`, `score`, `actionItems`, `participants`, `hostEmail`, `via`, `link`. Suficiente para disparar el flujo de Phase 2.

**Extractor como fuente principal para Phase 2:** Los campos `samu_summary`, `samu_longSummary`, `samu_actionItems` y `punto_de_dolor` del extractor son la fuente primaria recomendada para el agente post-reunión. La transcripción raw `[{text, date}]` es respaldo cronológico sin atribución de speaker.

**Recomendación para Phase 2:**
- Diseñar el agente post-reunión sobre `extractor` como fuente principal.
- Si se requiere diarización ("quién dijo qué"), solicitar a Samu IA si existe un endpoint adicional no documentado públicamente, o evaluar post-procesamiento con modelo de diarización externo.
- No diseñar Phase 2 asumiendo que la transcripción raw tendrá speaker attribution.

---

## 5. Seguridad y credenciales

### Patrón oficial: Supabase Vault

Todas las credenciales de integraciones (API Keys, tokens de OAuth, bot tokens) se almacenan en **Supabase Vault** mediante RPCs de escritura/lectura server-side. Ningún secreto se almacena en texto plano en tablas de la base de datos, archivos de configuración del repositorio, ni variables de entorno de cliente.

**Operaciones Vault:**

| Operación | RPC |
|-----------|-----|
| Crear/actualizar secreto | `upsert_vault_secret(p_name, p_secret)` |
| Leer secreto (desencriptado) | `get_vault_secret_decrypted(p_name)` |
| Verificar existencia | `has_vault_secret(p_name)` |
| Eliminar secreto | `delete_vault_secret(p_name)` |

### Service role — solo server-side

El service role de Supabase se usa exclusivamente en Server Components, Server Actions y API Route Handlers de Next.js. Nunca se expone al cliente. El `SUPABASE_SERVICE_ROLE_KEY` está definido como variable de entorno server-only (sin prefijo `NEXT_PUBLIC_`).

### OAuth

Google OAuth y Slack OAuth se implementaron con flujo estándar de código de autorización. Los refresh tokens se almacenan en Vault por usuario. Los access tokens se refrescan server-side en cada operación.

### Webhook secret

El endpoint de Samu IA valida el header `x-sellup-webhook-secret` contra la variable de entorno `SAMU_WEBHOOK_SECRET` en Vercel. Si la variable existe, cualquier request sin el header correcto recibe 401. La validación ocurre en el handler antes de cualquier operación de escritura.

### Principio general

Ninguna credencial, API Key, token, ni secreto se retorna desde un Server Action al frontend, se registra en logs de aplicación, ni se incluye en respuestas de error.

---

## 6. Auditoría y trazabilidad

### Auditoría de usuarios (`access_audit`)

Registra eventos del ciclo de vida de usuarios: aprobaciones, rechazos, suspensiones, archivados, cambios de rol, asignación de líder inmediato. Cada evento incluye actor (admin que ejecutó), afectado (usuario), timestamp y metadata relevante.

### Auditoría de integraciones (`integration_audit`)

Registra eventos de todas las integraciones: conexión, desconexión, prueba de salud, error de conexión, actualización de credencial. Cada integración escribe con su `integration_key` propio. Permite auditar el historial completo de cualquier integración en cualquier momento.

### Auditoría de proveedores IA (`ai_active_config` + historial)

Cambios en configuración de proveedor IA (activación de modelo, cambio de API Key, modificación de tarifas) quedan registrados con timestamp y actor.

### Eventos webhook (`integration_webhook_events`)

Tabla dedicada para payloads entrantes de webhooks externos. Cada fila contiene: `integration_key`, `event_source`, `event_type`, headers sanitizados, payload JSON, raw body (máx. 50 KB), `received_at`, `processed_status`. RLS: inserción solo via service role, lectura solo para admins.

### Notificaciones

Los eventos operativos relevantes (primer caso implementado: usuario pendiente de aprobación) generan notificaciones en `user_notifications` para los administradores. La infraestructura está diseñada para agregar nuevos tipos de evento por módulo.

---

## 7. Costos y consumo IA

La base de datos está preparada para registrar **cada ejecución de IA** con el siguiente nivel de detalle:

| Dimensión | Descripción |
|-----------|-------------|
| Proveedor | OpenAI, Anthropic, etc. |
| Modelo | `gpt-4o`, `claude-sonnet-4-5`, etc. |
| Tokens input | Tokens consumidos en el prompt |
| Tokens output | Tokens generados en la respuesta |
| Costo estimado | Calculado con tarifas configuradas por modelo |
| Usuario | Quién ejecutó la acción |
| Agente | Qué agente realizó la llamada |
| Cuenta/prospecto | Sobre qué entidad se ejecutó |
| Estado de ejecución | Éxito, error, timeout |

Esta estructura permite agregar reporting de costos, límites por usuario o por cuenta, y análisis de eficiencia de modelos en módulos posteriores. **No existe todavía un dashboard de visualización de costos** — la infraestructura de datos está lista; la UI de reporting es trabajo futuro.

---

## 8. Pendientes conocidos

### Funcionales

- **Lusha:** Falta API Key válida del cliente para completar la prueba funcional real del endpoint de conexión. La integración técnica está construida y lista.
- **Samu IA Phase 2:** Diseñar e implementar la importación de reuniones, normalización del extractor, y construcción del agente post-reunión.
- **Samu IA — diarización:** Si se requiere atribuir intervenciones a participantes específicos, consultar a Samu IA si existe un endpoint adicional con speaker mapping. La transcripción pública actual no incluye esta información.

### Deuda técnica

- **Migración 011 duplicada:** Existe un conflicto de tracking local/remoto con `011_create_ai_provider_connections_simple.sql` que impide usar `supabase db push` directamente. Workaround en uso: ejecutar SQL via Management API + `supabase migration repair`. Requiere resolución limpia antes de siguiente migración masiva.
- **Deuda de lint preexistente:** Existen errores de ESLint en archivos no relacionados con el módulo de integraciones (`ai-controls.tsx`, `ai-config/actions.ts`, `users-groups-tabs.tsx`). No introducidos por este hito. Pendiente de resolución en ciclo de deuda técnica.
- **Archivo local no commiteado:** `scripts/test-lusha-enrichment.mjs` — script de prueba manual excluido intencionalmente del repositorio.

---

## 9. Decisiones importantes cerradas

Estas decisiones fueron tomadas, validadas y no deben reabrirse sin justificación técnica mayor:

| Decisión | Detalle |
|---------|---------|
| **HubSpot como fuente comercial** | HubSpot es el CRM de origen de datos comerciales. SellUp no reemplaza a HubSpot — opera sobre él como capa de inteligencia y trazabilidad. |
| **SellUp como capa operativa** | SellUp es la plataforma de operación, inteligencia y trazabilidad del equipo de ventas. No es un CRM alternativo. |
| **Vault como patrón oficial de secretos** | Todo secreto de integración vive en Supabase Vault. Sin excepciones. Este patrón no se negocia módulo a módulo. |
| **Samu extractor como fuente principal** | Los campos del extractor de Samu IA (`samu_summary`, `samu_longSummary`, `samu_actionItems`, `punto_de_dolor`) son la fuente primaria para el agente post-reunión. |
| **IA SellUp como fallback/híbrido** | Los modelos propios de SellUp operan como enriquecimiento y fallback cuando el extractor de Samu no está disponible o es insuficiente. |
| **Webhooks como disparadores** | Los webhooks de Samu IA (y futuros) son disparadores de flujo, no fuentes completas de datos. El detalle siempre se obtiene vía API con el `id` recibido en el webhook. |
| **Ingeniería inversa descartada** | La exploración de endpoints no documentados y el scraping de respuestas privadas no son arquitectura productiva válida. Todo flujo de datos debe basarse en APIs oficiales documentadas o contratos formales con el proveedor. |

---

## 10. Próximo bloque recomendado

### Pipeline / Cuentas / Prospectos

El módulo de Configuración e Integraciones estableció toda la infraestructura necesaria. El siguiente bloque natural es construir las **entidades comerciales centrales de SellUp**.

**Las bases ya están dadas para:**

- **Entidad Cuenta/Prospecto:** Definir el esquema de datos de cuentas y prospectos en la base de datos de SellUp, conectado al modelo organizacional ya construido.
- **Pipeline inteligente:** Diseñar las etapas del pipeline de ventas, con estados, transiciones y visibilidad por rol.
- **Creación manual:** Interfaz para crear cuentas y prospectos manualmente por el equipo de ventas.
- **Generación por IA:** Primer agente operativo — generar prospectos calificados a partir de criterios de búsqueda usando Apollo.io como fuente.
- **Enriquecimiento:** Enriquecer cuentas y prospectos con datos de Apollo y Lusha (cuando la API Key esté disponible).
- **Validación contra HubSpot:** Verificar si una cuenta ya existe en HubSpot antes de crearla; sincronizar estado.
- **Expediente de cuenta:** Vista consolidada de la cuenta con datos comerciales, reuniones Samu, interacciones, documentos en Drive y estado en pipeline.
- **Primeras ejecuciones de agentes:** Los agentes de enriquecimiento, calificación y post-reunión tienen toda la infraestructura de credenciales, costos y auditoría lista para operar.

---

*Documento generado al cierre del módulo Configuración e Integraciones — SellUp MVP.*  
*Última actualización: 2026-05-21*
