# Agente 2A — Backlog unificado de bugs y mejoras (oct-2026)

> **Base:** `origin/main` @ `8aae674d` (2026-10-06).
> **Fuentes unificadas:**
> * **R1** — *Resumen de pruebas – Enriquecer contactos* (2026-10-01): hallazgos H1–H3 y observaciones.
> * **R2** — *Agente 2 (búsqueda de contactos): hallazgos y mejoras* (revisión de septiembre 2026): puntos 1–8.
> * Revisión del código en `main` (hallazgos E1 y E2).
>
> **Minimización de PII:** los casos se citan por empresa, nunca por email ni teléfono.

---

## 1. Cómo se trabaja cada ítem

| Camino | Cuándo | Qué implica |
|---|---|---|
| **Fix** | El sistema no hace lo que ya debería hacer, o ajuste chico de UX | Rama `fix/agent2a-…` + PR, sin spec. Al integrar: fila en [HISTORY_AND_INCIDENTS.md](HISTORY_AND_INCIDENTS.md) § 5 y caso en [QA_ACCEPTANCE.md](QA_ACCEPTANCE.md) § 7 |
| **Spec** | Cambia comportamiento, alcance o gasto de créditos | Spec nueva fechada en `docs/superpowers/specs/` + plan, aprobada antes de implementar. Las specs existentes no se reescriben |
| **Verificar** | Puede estar resuelto por otro PR | Probar en Producción antes de tocar código |

Cada PR con su rama y su worktree desde `origin/main`, integración de a uno
([PARALLEL_DEVELOPMENT_PROTOCOL.md](../PARALLEL_DEVELOPMENT_PROTOCOL.md)).

---

## 2. Lo que ya está en `main`

| PR | Merge | Qué cambió | Cubre |
|---|---|---|---|
| #362 | `6f7a7f38` | Aprobar un contacto lo sincroniza con HubSpot (crea la empresa si falta, revisión humana si la coincidencia es ambigua). Detrás de `HUBSPOT_CONTACT_AUTO_SYNC_ENABLED` | Base de C1, C2 y E1 |
| #587 | `3cc54592` | Buscar por Company ID de HubSpot: si sólo hay un ID se lee la empresa en HubSpot por ID y la cuenta se crea o vincula antes de enriquecer | R1-H1 (A1), casi todo R1-H2 (A2) |
| #589 | `eef261bc` | Hasta 5 contactos por fuente; Apollo busca también CEO y gerente general; Lusha ordena por seniority antes de pagar | Parte de R2-#1 (B2) y R2-#2 (B3) |
| #602 | `75012626` | «Reasignar empresa» en Trazabilidad para aprobar candidatos sin cuenta, sin migración y sin cobrar de nuevo | R2-#3 (B1), salida para R2-#4 (A5) |
| #608 | `42f8d24b` | El mensaje de la búsqueda automática usa el conteo real de contactos por revisar y avisa cuando son 0 | R2-#7 (A3) |
| #612 | `7775801f` | Al vincular un contacto que ya existía en HubSpot se completan sólo sus propiedades vacías (teléfonos, cargo, nombre, LinkedIn) | E1 |
| #616 | `1447f355` | «Búsqueda por lotes con ID de HubSpot» en el panel del agente: 1 a 10 Company IDs separados por coma | R2-#8 (D1) |

---

## 3. Tabla unificada

| ID | Hallazgo | Origen | Tipo | Prioridad | Estado @ `8aae674d` | Camino |
|---|---|---|---|---|---|---|
| A1 | Un HubSpot ID que existe no se encuentra y se crea como empresa manual | R1-H1 | Bug | Alta | **Resuelto (#587)** | Verificar |
| A2 | No hay flujo distinto para ID, dominio o nombre | R1-H2 | Bug | Media | **Casi resuelto (#587).** Falta: ID inexistente con mensaje propio y bloquear nombres sólo numéricos | Verificar → Fix |
| A3 | «Candidatos listos» aunque no se creó ninguno | R2-#7 | Bug | Alta | **Resuelto (#608).** Muestra el total, no el desglose por fuente | Verificar |
| A4 | Los contactos enviados a revisión no aparecen | R1-H3 | Bug | Alta | Probablemente explicado por A1 + A3 | Verificar (Supabase) |
| A5 | Pizza Pizza bloqueado por «sin cuenta» aunque existe en HubSpot | R2-#4 | Bug | Media | **Se destraba con #602.** Causa raíz sin confirmar | Verificar |
| A6 | Avisos ambiguos y tono del asistente | R1-obs | UX | Media | **Abierto.** `contact-enrichment-chat-reducer.ts` sigue diciendo «Perfecto…» aunque HubSpot falle | Fix |
| B1 | Candidatos sin empresa: no se pueden aprobar ni reasignar | R2-#3 | Mejora | Alta | **Resuelto (#602)** | Verificar |
| B1b | Reveal, privacidad, supresión y webhook leen `run.account_id` y no ven la empresa reasignada | #602 | Bug potencial | Media | Abierto | Decisión 5 → Fix |
| B2 | Apollo y Lusha no se suman | R2-#1 | Mejora | Media | **Parcial (#589).** El fallback sigue siendo sólo `provider_error` o `zero_reviewable_candidates` | Spec |
| B3 | Lusha sólo busca en RR. HH. | R2-#2 | Mejora | Media | **Parcial (#589).** `SELLUP_ICP_LUSHA_DEPARTMENTS` sólo trae RR. HH. | Fix (con taxonomía confirmada) |
| B4 | Roles Decisor / Champion / Primario vacíos | R1-obs | Por aclarar | Baja | Abierto | Decisión 4 |
| C1 | Duplicados y contactos existentes no asociados a la empresa | R2-#5 | Bug y mejora | Alta | **Abierto.** La deduplicación previa sólo lee los contactos de HubSpot de la empresa; #612 sólo mejora el caso «mismo email» | Spec |
| C2 | Contactos sin email no llegan a HubSpot | R2-#6 | Regla de negocio | Media | Abierto (`blocked_no_email`) | Decisión 1 → Spec |
| D1 | El lote sólo funciona con checkbox (máx. 10) | R2-#8 | Mejora | Baja | **Resuelto (#616).** Pendiente: cargar archivo y evaluar subir el tope de 10 | Verificar |
| E1 | Al vincular un contacto existente no viajaban los datos de SellUp | Código | Bug | Alta | **Resuelto (#612).** Pendiente: backfill de los ya vinculados y enviar LinkedIn al crear | Fix |
| E2 | `docs/agent2a/` no reflejaba #362, #587, #602, #608, #612 ni #616 | Código | Docs | Media | **Este PR** | PR `docs:` |

---

## 4. Detalle de lo abierto

### A2 + A6 — Mensajes de resolución de empresa (siguiente fix)
* `classifyCompanyQuery()` ya reconoce el ID (`/^\d{6,}$/`). Con un ID inexistente, la UI cae en
  «No encontré coincidencias claras…» y ofrece seguir como empresa manual.
* **Esperado:** «No encontramos este ID en HubSpot», sin opción de empresa manual; «Confirmar
  empresa» no acepta un nombre sólo numérico; separar «No pudimos consultar HubSpot (Reintentar)»
  de «No encontramos la empresa en HubSpot» (el resolver ya los distingue); quitar «Perfecto»
  cuando la búsqueda falló.
* **Aceptación:** con `999999999999` no se crea ninguna empresa ni se gastan créditos.

### A4 / A5 — Verificación
* Con la hora del 2026-10-01, revisar en Supabase `contact_enrichment_runs` (`account_id`,
  `hubspot_company_id`, estado) y contar los `contact_enrichment_candidates` del run.
* Pizza Pizza: reintentar la aprobación o usar «Reasignar empresa». Si no se explica por A1, A3
  o B1, abrir un fix aparte con pasos de reproducción.

### B1b — Teléfono con empresa reasignada
* Decidir si entra. Si entra: reveal, privacy gate, supresión y webhook leen la cuenta efectiva
  del candidato (con el override de `enrichment_metadata.company_reassignment`).
* El reporte del lote (#616) también cuenta los pendientes en la cuenta original del run.

### B2 — Lusha complementa a Apollo (spec)
* Nuevo motivo `below_target`: si Apollo trae menos del objetivo, Lusha busca la diferencia sin
  repetir personas. Extiende `2026-10-05-agent2a-coverage-decision-makers-design.md`.
* Debe incluir impacto en créditos y actualizar [BUDGET_AND_BILLING.md](BUDGET_AND_BILLING.md).
  Depende de la decisión 3.

### B3 — Lusha y decisores
* Confirmar con una llamada real el valor de dirección general en la taxonomía de Lusha
  («C-Suite», «Executive» o seniority equivalente) y agregarlo.

### C1 — Deduplicación global en HubSpot (spec)
* Antes de gastar créditos: buscar en todo HubSpot por email y LinkedIn; alertar «posible
  duplicado» por nombre + empresa (hay un caso real con 2 registros y LinkedIn distinto).
* Si ya existe: ofrecer asociarlo a la empresa revisada, con confirmación (decisión 2).
* Parte de #362 + #612 y debe actualizar [FUTURE_WORK.md](FUTURE_WORK.md) § 1.5.

### C2 — Sincronización sin email (spec)
* Permitir el envío con teléfono o LinkedIn tras revisar duplicados. Hay tests que hoy exigen
  `blocked_no_email`. Depende de C1 y de la decisión 1.

### D1 — Lote por Company IDs, siguientes pasos
* Cargar IDs desde archivo y evaluar subir `CONTACT_ENRICHMENT_BULK_MAX_ACCOUNTS` (hoy 10).
  Subir el tope cambia el gasto: va por spec.

### E1 — Backfill
* Script o acción que recorra los `linked_existing` anteriores a #612 y aplique el mismo
  `fill_empty`. Enviar `hs_linkedin_url` también al **crear** un contacto.

---

## 5. Decisiones pendientes

| # | Decisión | Bloquea | Quién decide |
|---|---|---|---|
| 1 | ¿El email sigue siendo obligatorio para enviar a HubSpot, o basta teléfono o LinkedIn? | C2 | Sales Ops / dueña del CRM |
| 2 | ¿El agente puede **asociar** un contacto existente a otra empresa en HubSpot (con confirmación)? | C1 | Dueña del proyecto |
| 3 | ¿El objetivo por fuente se queda en 5 o sube a 10? ¿Con cuánto presupuesto? | B2 | Dueña del proyecto + presupuesto |
| 4 | ¿El rol (Decisor / Champion / Primario) es manual o se sugiere por seniority? | B4 | Ventas |
| 5 | ¿Entra B1b? | B1b | Dueña del proyecto |

---

## 6. Orden de trabajo

| # | Rama sugerida | Cubre | Necesita antes |
|---|---|---|---|
| 0 | (sin código) | Verificar A1, A3, A4, A5, B1 y D1 en Producción | Datos del 2026-10-01 |
| 1 | `fix/agent2a-company-resolution-messages` | A2 + A6 | — |
| 2 | `fix/agent2a-hubspot-fill-empty-backfill` | E1 | — |
| 3 | `fix/agent2a-lusha-decision-maker-departments` | B3 | Valor confirmado en Lusha |
| 4 | Spec `…-agent2a-lusha-complements-apollo-design.md` | B2 | Decisión 3 |
| 5 | Fix | B1b | Decisión 5 |
| 6 | Spec de deduplicación global en HubSpot | C1 | Decisión 2 |
| 7 | Spec de sincronización sin email | C2 | C1 + decisión 1 |
| — | Decisión de roles | B4 | Decisión 4 |

Al cerrar cada ítem: actualizar su fila en este documento, [HISTORY_AND_INCIDENTS.md](HISTORY_AND_INCIDENTS.md) § 5
y [QA_ACCEPTANCE.md](QA_ACCEPTANCE.md) § 7.
