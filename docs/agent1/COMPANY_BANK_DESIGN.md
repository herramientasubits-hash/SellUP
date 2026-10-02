# Agente 1 — Banco de empresas (diseño y plan por fases)

**Estado:** diseño APROBADO por la dueña (2026-10-01). Fase 1 construida y probada en PostgreSQL real; **sin conectar a nada** y **sin aplicar en Producción**.
**Track:** AGENT1. **Migración:** 142 (recurso global: re-verificar el número al integrar; ver `docs/PARALLEL_DEVELOPMENT_PROTOCOL.md` § 7).

## Qué es

La empresa que un proveedor de pago (o una fuente) ya encontró y que **no se entregó a ningún vendedor** queda en un banco **sin dueño**, por **país × macro industria**. La siguiente búsqueda del mismo par toma del banco **antes** de volver a pagar. Se muestran de 5 a 10 al vendedor; el resto se guarda.

Motivos medidos (30-09 / 01-10): una corrida pedía 5 y dejaba hasta 154 empresas reservadas para un solo vendedor (México × Tecnología); Colombia × Tecnología ya no tenía qué sacar de Apollo; Lusha compra y **tira** el sobrante (`targetOverflowDiscarded`).

## Por qué una tabla aparte (y no un estado en `prospect_candidates`)

* Un candidato `needs_review` es visible para todos (listas, KPIs, cola de revisión) **y bloquea a los demás** (reclamo global, novedad, exclusión de Apollo, memoria negativa). Un banco dentro de esa tabla se bloquearía a sí mismo y se filtraría a pantalla.
* `prospect_candidates.batch_id` es `NOT NULL`; la macro industria no es una columna tipada del candidato.
* Precedente: `provider_seen_entities` (123) — tabla aparte, sólo `service_role`.

## Modelo (migración 142)

`agent1_company_bank`: país, macro, **tier** (`ready` | `to_complete`), **status** (`banked` → `reserved` → `assigned` | vuelve a `banked` | `invalidated`; `expired`), fuente (`apollo|lusha|tavily|free_source`), las **cuatro claves de reclamo EXACTAS** (`fiscal`, `domain`, `provider_entity`, `linkedin`; las mismas de `agent1_company_identity_claims`), `payload` (≤ 16 KiB), `missing_fields`, `banked_at`, `expires_at`, reserva (`draw_id`, `reserved_until`) y asignación.

Garantías (todas verificadas contra PostgreSQL real, `company-bank-postgres.test.ts`):

| Garantía | Cómo |
|---|---|
| La misma empresa no está dos veces en el banco | un índice único PARCIAL por señal entre filas activas (`banked`/`reserved`) |
| Una empresa ya reclamada por un vendedor no entra | `agent1_bank_deposit` consulta los reclamos activos de las 4 señales |
| Sin dueño ⇒ sin reclamo | el reclamo se hace **al asignar**, con el candidato ya en el lote del vendedor |
| Dos vendedores a la vez no reciben la misma fila | `FOR UPDATE SKIP LOCKED` |
| Si el proceso muere, la fila no queda atrapada | reserva con plazo; vencida ⇒ elegible otra vez |
| Nada se entrega caducado | filtro en la lectura + caducidad perezosa (sin cron: Vercel sólo admite 2) |
| Estados finales intactos y transiciones legales | disparador `agent1_company_bank_guard_update` |
| Sólo `service_role` | RLS + REVOKE de tabla y funciones |
| Una clave de fila final queda libre | los índices únicos sólo cubren `banked`/`reserved` |

Funciones: `agent1_bank_deposit(items)`, `agent1_bank_draw(país, macro, límite, draw_id, segundos, tiers)`, `agent1_bank_settle(draw_id, resultados)`.

## Escala y vida larga

* Camino caliente indexado: `(country_code, macro_industry_key, tier, banked_at, id) WHERE status='banked'`.
* Extracción acotada a 50; depósito en trozos de 50; fila acotada a 16 KiB.
* Caducidad por defecto 60 días (1–180). Las filas finales (`assigned/expired/invalidated`) no ocupan claves; una limpieza de historial (p. ej. > 180 días) es una fase posterior y no urgente.
* Primero las más antiguas (se usan antes de caducar), listas antes que «por completar».

## Fases (un PR a la vez, merge sólo con «MERGE APROBADO»)

1. **Fundación (este PR):** migración 142 + almacén TypeScript (`src/server/prospect-batches/company-bank/`) + pruebas. Oscuro: nada lo llama.
2. **Depósito:** el sobrante de Lusha (`targetOverflowDiscarded`, hoy pagado y tirado) y, si la dueña lo decide, el sobrante de Apollo. Tras bandera `ENABLE_AGENT1_COMPANY_BANK_DEPOSIT` (apagada). **Bloqueada por la pregunta de términos del proveedor (abajo).**
3. **Extracción:** antes de la capa gratuita del asistente (`wizard-execution-actions.ts` ~1313), como un aportante gratuito más: sacar ≤ 5, **revalidar sin créditos** (guard de activos, novedad, duplicado SellUp/HubSpot, propiedad), insertar en el lote del vendedor por los escritores vallados, **reclamar** (`claimGlobalIdentitiesForPersistedCandidates`, cliente admin) y cerrar (`assigned`/`invalidated`/`released`). Si el reclamo se pierde, se salta y se toma otra. Tras bandera `ENABLE_AGENT1_COMPANY_BANK_DRAW` (apagada). La prueba admin de Tavily NO extrae.
4. **Presentación:** copia «N del banco», visibilidad para administradores, tarjeta de resultados, limpieza de historial.

## Decisiones tomadas (defaults) y pendientes

* Decidido: banco aparte; dos niveles (`ready`, `to_complete`); caducidad 60 días; se reclama al asignar; un descarte del vendedor **no** devuelve la empresa al banco (queda liberada para los proveedores).
* **Pendiente antes de activar el depósito en Producción:** ¿los términos de Apollo y Lusha permiten **guardar el perfil comprado y repartirlo entre vendedores de UBITS**? La 123 guarda sólo identidad a propósito. Si no, el banco guarda sólo identidad + qué faltaba y re-obtiene el perfil al asignar (cuesta crédito).
* Pendiente de decisión: si el sobrante de Apollo (hoy entregado entero al vendedor desde X6.13: «el objetivo es un mínimo») pasa al banco.

## Riesgos conocidos

* Un `payload` con perfil comprado es dato de proveedor (ver arriba).
* El banco no cubre a la empresa que otro proveedor devuelve fresca mientras está en el banco: el reclamo al asignar y el índice único evitan el doble, pero un vendedor puede recibirla fresca y la copia del banco se invalida al extraer (`claimed_elsewhere`).
* `wizard-execution-actions.ts` (≈ 2.760 líneas) y `candidate-writer.ts` (≈ 4.730) son puntos calientes de conflicto para las fases 2–3.
