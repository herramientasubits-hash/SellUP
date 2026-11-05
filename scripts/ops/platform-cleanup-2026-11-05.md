# Limpieza de entrega a líderes — 05-11-2026 (registro)

SellUp se entregó a los líderes de ventas «como si empezara de cero». Autorización de la dueña en el chat del 05-11: empresas encontradas al banco gratis, contactos al banco gratis, borrar lo de QA (usuarios, grupos), dejar sólo los usuarios reales, y que métricas y créditos de antes no se vean (pero queden guardados por debajo).

## Qué se hizo en Producción (`lrdruowtadwbdulndlph`)

| Paso | Cómo | Resultado |
|---|---|---|
| Respaldo | `platform-cleanup-2026-11-05.mts --export` (sólo lectura) | 34 tablas completas en `~/Documents/SellUp-data/cleanup-2026-11-05/export/` |
| Plan | `--plan` (sólo lectura) | 114 empresas para el banco (73 listas, 41 por completar); 74 fuera (ya en HubSpot, descartadas, convertidas, 11 de la importación DO sin industria) |
| Depósito | `--deposit` (cuenta de servicio, `agent1_bank_deposit`) | 201 reclamos liberados; **105 nuevas al banco** + 9 que ya estaban |
| Limpieza | `platform-cleanup-2026-11-05.sql` por el MCP, rol postgres, un solo bloque (ensayado antes con `RAISE EXCEPTION`) | ver abajo |

Resultado de la limpieza:

- Búsquedas del Agente 1: 12 borradas (cascada: empresas, Descartadas, auditoría, trabajos). La de brcastro (Chile · Retail) tiene una reserva de presupuesto enlazada: **se archivó** (sus 15 empresas se borraron) para no tocar la reserva.
- Reclamos de identidad: 269 borrados. Prospección masiva (Growth): 2 búsquedas y sus rondas borradas.
- Banco: 26 filas apartadas por sorteos vencidos volvieron a `banked`; 1 fila final (`assigned`) borrada; 100 filas desenlazadas de su lote (el guardia `agent1_company_bank_guard_update_trg` se apagó sólo durante ese UPDATE y se volvió a encender — verificado `O`). **Banco activo: 2.046.**
- Empresas (fichas): **134 archivadas** (`archived_at`, `pipeline_status='archived'`, actor egarcia). Sus 133 contactos quedan **sin archivar**: el banco de contactos (`contact-bank-stage.server.ts`) reutiliza los contactos y los pendientes del Agente 2 de fichas archivadas.
- Agente 2: 81 búsquedas sin ficha y 56 pedidos borrados; las ligadas a una ficha se conservan (son el banco de contactos). 1 corrida masiva borrada.
- Corridas de agentes: 17 borradas (las referenciadas por el registro de créditos o el banco de contactos se quedan). `result_quality_events`, auditorías de empresas y contactos, y notificaciones: borradas.
- Usuarios: 17 borrados (herramientasubits y los 16 `*.qa`), también de `auth.users`. 5 preaprobaciones de prueba / canceladas borradas. 6 grupos «(QA)» borrados. Quedan **43 usuarios** y **13 grupos**.

## Se conservan a propósito

- **`provider_usage_logs` completo (1.350 filas).** El presupuesto de créditos lo lee: borrarlo haría parecer que hay más créditos de los reales. Lo que se ve se oculta en el código (abajo).
- La reserva de presupuesto (1) y todas las tablas `wizard_*`.
- `provider_seen_entities` (memoria de «ya visto» de los proveedores), catálogos de fuentes, configuración.

## Lo que no se ve (código, mismo PR)

- `src/lib/visible-since.ts`: corte de visibilidad `2026-11-05T21:00Z` (`SELLUP_VISIBLE_SINCE` lo cambia o `off` lo apaga). Lo usan Uso de IA (todas sus pestañas), Configuración › Uso, los logs del detalle de proveedor, la efectividad de proveedores y del Agente 1, los resultados del Agente 3, la lista de Contactos y las colas del Agente 2. El presupuesto y el banco de contactos NO lo usan.
- El panel de presupuesto de Proveedores sigue mostrando el consumo real del mes en curso (noviembre: Apollo 33, Lusha 2): es el presupuesto vivo.

## Cómo restaurar

Respaldo JSON por tabla en `export/`. Restaurar = desarchivar fichas (`archived_at`/`pipeline_status` de `accounts.json`), reinsertar usuarios (primero `auth.users` vía API de administración), grupos, lotes → empresas → Descartadas/auditoría/trabajos → reclamos → corridas. Antes, invalidar en el banco las 105 filas depositadas el 05-11 entre 20:5x y 21:00 UTC (`banked_at`) para no duplicar empresas.

## Correr el script

`node --env-file=.env.local --import ./ws-stub.mjs --import tsx scripts/ops/platform-cleanup-2026-11-05.mts --export | --plan | --deposit` (stub de WebSocket para Node 20: ver `egarcia-cleanup-2026-10-15.md`). **No volver a correr `--deposit` ni el SQL**: el alcance ya no existe.
