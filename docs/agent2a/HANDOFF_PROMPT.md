# Agente 2A — Prompt de handoff

> Copia **todo** el bloque de abajo en un chat nuevo para retomar el Agente 2A sin perder
> contexto. Está escrito para que un agente o una persona que no ha visto nunca este subsistema
> pueda operar con seguridad desde el primer mensaje.

---

```
Vas a trabajar sobre el AGENTE 2A del repositorio SellUp
(herramientasubits-hash/SellUP), en /Users/<usuario>/Documents/SellUp.

═══════════════════════════════════════════════════════════════════
0. LEE ESTO ANTES DE TOCAR NADA
═══════════════════════════════════════════════════════════════════

La documentación completa y verificada vive en docs/agent2a/:

  README.md                        índice + resumen ejecutivo + snapshot de Producción
  ARCHITECTURE.md                  diagrama end-to-end, capas, call graphs
  DATA_MODEL.md                    tablas reales, relaciones, lifecycle
  PHONE_REVEAL_AND_SEARCH_MORE.md  reveal, waterfall, multi-teléfono, Ver más, Buscar más
  PRIVACY_AND_SUPPRESSION.md       supresión nativa, DSAR, DNC, fail-closed
  BUDGET_AND_BILLING.md            presupuesto por proveedor, reservas, liquidación
  OPERATIONS_RUNBOOK.md            diagnóstico operativo + auditoría de feature flags
  HISTORY_AND_INCIDENTS.md         migraciones, PRs, incidentes con causa raíz
  QA_ACCEPTANCE.md                 casos reales verificados contra Producción
  FUTURE_WORK.md                   lo NO implementado + los 18 ratchets obligatorios

Lee README.md y FUTURE_WORK.md § 4 ANTES de proponer cualquier cambio.

═══════════════════════════════════════════════════════════════════
1. QUÉ ES EL AGENTE 2A
═══════════════════════════════════════════════════════════════════

Subsistema de enriquecimiento de contactos decisores de RR.HH.

  ACCOUNT → ENRICHMENT RUN → APOLLO/LUSHA → CANDIDATE (pending_review)
    → REVISIÓN HUMANA → PHONE REVEAL → COLECCIÓN DE TELÉFONOS
    → SEARCH MORE → APROBACIÓN HUMANA → CONTACTO OFICIAL

Apollo es el proveedor PRIMARIO. Lusha es el SECUNDARIO / challenger.
Nada se aprueba solo. Nada se escribe en HubSpot automáticamente.

Código: src/modules/contact-enrichment/ (≈120 ficheros, más sus tests)
Migraciones: supabase/migrations/ (100–122 son el rango de este agente)
UI principal: src/components/contact-enrichment/contact-candidate-detail-sheet.tsx

═══════════════════════════════════════════════════════════════════
2. LAS TRES OPERACIONES DE TELÉFONO — NO LAS CONFUNDAS
═══════════════════════════════════════════════════════════════════

  «Revelar teléfono»   el candidato NO tiene teléfono. Apollo → Lusha. Hasta 13 créditos.
  «Ver más números»    SOLO LECTURA. 0 proveedores, 0 créditos, 0 escrituras.
  «Buscar más números» el candidato SÍ tiene teléfono. SOLO LUSHA. Hasta 5 créditos.

Topes reales en código (NO los supongas, están en constantes):
  PHONE_REVEAL_WATERFALL_APOLLO_MAX_CREDITS      = 8
  PHONE_REVEAL_WATERFALL_LUSHA_MAX_CREDITS       = 5
  PHONE_REVEAL_WATERFALL_MAX_CREDITS_WITH_LUSHA  = 13
  PHONE_REVEAL_WATERFALL_LEGACY_MAX_CREDITS      = 5
  SEARCH_MORE_MAX_CREDITS                        = 5

POR QUÉ Search More es Lusha-only: Apollo devuelve su colección COMPLETA en el
payload terminal y SellUp ya la persiste entera desde 4O-C. Apollo no expone
ninguna operación de «más teléfonos» ni pagina. Repetir Apollo cobraría otra vez
por el payload ya guardado. Lo que Search More compra es consultar al OTRO
proveedor cuya identidad nativa el candidato ya lleva — y ése es siempre Lusha.

═══════════════════════════════════════════════════════════════════
3. LA ARQUITECTURA EN UNA FRASE POR CAPA
═══════════════════════════════════════════════════════════════════

  CORES PUROS   sin I/O, sin env, sin reloj, sin Supabase. Deciden.
                Probables offline con 0 proveedores y 0 créditos.
  DEPS/STORES   el único sitio con acceso a Supabase. Traducen.
  RUNTIMES      componen la secuencia. Son lo único que gasta dinero.
  UI            conveniencia, NUNCA autoridad.
  FUNCIONES SQL lo que tiene que ser atómico, porque PostgREST no expone BEGIN/COMMIT.

El planificador de Search More vive separado del JSX Y del runtime porque el botón
y el servidor tienen que decidir con LA MISMA función. La primera divergencia sería
un botón que ofrece una compra que el servidor rechaza — y eso ocurrió de verdad (#309).

═══════════════════════════════════════════════════════════════════
4. LAS REGLAS QUE NO SE NEGOCIAN (los 18 ratchets, resumidos)
═══════════════════════════════════════════════════════════════════

DINERO
  · Ninguna llamada a proveedor antes de que exista una RESERVA atómica.
  · Ningún costo desconocido se trata como 0. Ausencia de dato = 'unknown'.
  · Ningún reintento pagado automático.
  · Ninguna llamada duplicada. Tres barreras: authorization_key, índice único
    parcial de corrida activa, y claim atómico sobre lusha_attempted_at.
    NO se añade una cuarta ni se sustituye ninguna.
  · Ninguna modificación de budget_rules sin autorización explícita.

PRIVACIDAD
  · Ninguna llamada a proveedor antes de la puerta de privacidad.
  · NUNCA traduzcas 'check_unavailable' a 'clear'. Fue el P0 de #289.
  · 'suppressed', 'do_not_contact' y 'suppression_check_unavailable' bloquean
    igual pero NO son lo mismo: la tercera no afirma NINGÚN hecho.
  · Nunca borres ni reescribas procedencia. Se retira o se añade.
  · Nunca infieras identidad entre proveedores (LinkedIn, email, nombre, fuzzy).

PRODUCTO
  · Ninguna aprobación automática de candidatos.
  · Ninguna escritura automática en HubSpot.
  · Ninguna ruta a la búsqueda GENERAL de personas de Lusha desde Search More.
  · «Ver más números» NO importa ningún cliente de proveedor. Hay un test estático.

ESQUEMA Y DESPLIEGUE
  · Ninguna migración sin autorización explícita de Producción.
  · Ningún módulo 'use server' exporta algo que no sea una función async.
    El ratchet recorre los 52 módulos del repo con el AST de TypeScript.
    Esta clase de error tumbó /contacts con 500 en Producción (#285) y ya
    había ocurrido antes.

═══════════════════════════════════════════════════════════════════
5. ESTADO EN PRODUCCIÓN (verificado 2026-08-19, READ-ONLY)
═══════════════════════════════════════════════════════════════════

Proyecto Supabase: lrdruowtadwbdulndlph (ACTIVE_HEALTHY).
ATENCIÓN: es el ÚNICO proyecto de la organización. NO hay staging.
Todo deployment de Preview de Vercel apunta a la base de PRODUCCIÓN.

  Migraciones 100–122          TODAS aplicadas (la 122 el 2026-08-19)
  Corridas de teléfono          4, todas terminales. 0 vivas.
                                1 full_waterfall, 1 legacy_lusha_only, 2 search_more
  Reservas activas              0 (4 confirmed, 1 released)
  Teléfonos de candidato        6 vivos, 0 suprimidos
  Teléfonos de contacto oficial 1
  provider_suppressions         0 filas (la DSAR nunca se ha ejercido en Prod)
  budget_rules apollo           4 reglas, NINGUNA activa
  budget_rules lusha            1 regla ACTIVA (user, mensual, créditos, block)

CONSECUENCIA OPERATIVA IMPORTANTE: sin regla de Apollo activa, un full_waterfall
resuelve hoy 'budget_not_configured' y NO arranca. «Buscar más números» y
legacy_lusha_only SÍ pueden arrancar porque sólo exigen el pozo de Lusha.
Si alguien reporta «el reveal no funciona pero buscar más sí», ESA es la razón.

═══════════════════════════════════════════════════════════════════
6. DISCREPANCIAS CONOCIDAS ENTRE DOCUMENTACIÓN Y REALIDAD
═══════════════════════════════════════════════════════════════════

NO las "arregles" sin autorización. Están registradas a propósito.

  · Diez migraciones (109,110,111,113,114,115,116,117,120,121) declaran en su
    cabecera «NOT APPLIED» o «APPLIED IN PRODUCTION: NO». TODAS están aplicadas.
  · Las cabeceras de 101–104 dicen «LOCAL DRAFT ONLY». También están aplicadas.
  · lusha-phone-fallback-copy.ts dice que el fallback está «OFF in every
    environment today». El propio feature-flags.server.ts ya corrige eso.
  · El cuerpo del PR #309 dice que no hay regla de crédito activa para Lusha en
    Producción. HOY SÍ LA HAY (se configuró después, y es lo que permitió la QA).

Regla: el CÓDIGO ACTUAL + el esquema actual + Producción read-only son la fuente
de verdad. Los comentarios están congelados en el momento en que se escribieron.

═══════════════════════════════════════════════════════════════════
7. FEATURE FLAGS
═══════════════════════════════════════════════════════════════════

  ENABLE_LUSHA_CONTACT_ENRICHMENT    Lusha como proveedor de ENRIQUECIMIENTO
  ENABLE_PHONE_REVEAL_WATERFALL      el waterfall Apollo→Lusha de UN clic
  ENABLE_LUSHA_PHONE_REVEAL_FALLBACK autoriza CUALQUIER reveal de Lusha
  ENABLE_SEARCH_MORE_PHONES          gobierna EXCLUSIVAMENTE «Buscar más números»
  ENABLE_APOLLO_PHONE_REVEAL         autoriza crear un reveal de Apollo
  ENABLE_APOLLO_PHONE_CACHE          reutilización de un reveal ya pagado

Todos son fail-closed y por defecto false. Sólo el valor EXACTO "true" enciende.
En Vercel son type: sensitive, así que su VALOR es ilegible desde fuera del
runtime — `vercel env ls` sólo prueba PRESENCIA.

Para saber el estado REAL:
  GET /api/debug/agent2a-phone-waterfall-config    (admin-only, read-only)

Publica por separado `<flag>_configured` y `<flag>_enabled_resolved`, que juntos
distinguen los tres casos: ausente, presente-pero-no-"true", y presente-y-activa.

DEPENDENCIA CLAVE: la pata Lusha del waterfall exige ENABLE_PHONE_REVEAL_WATERFALL
Y ENABLE_LUSHA_PHONE_REVEAL_FALLBACK. Los DOS.
INDEPENDENCIA CLAVE: desde 1H, ENABLE_SEARCH_MORE_PHONES NO depende de
ENABLE_LUSHA_PHONE_REVEAL_FALLBACK, y ninguno activa al otro. Hay un test estático
de independencia que lo impone.

NO cambies ningún flag sin autorización explícita.

═══════════════════════════════════════════════════════════════════
8. CÓMO DIAGNOSTICAR (lo mínimo)
═══════════════════════════════════════════════════════════════════

Cinco causas distintas producen «el botón no está disponible». Distínguelas SIEMPRE:

  privacidad — suprimido        tombstone confirmado
  privacidad — no evaluable     NO SE SABE. Nunca lo reportes como suprimido.
  sin presupuesto               budget_not_configured / insufficient_credits /
                                credit_balance_unavailable — los tres son distintos
  proveedor agotado             ya hubo una corrida search_more TERMINAL
                                (incluida una que terminó en error)
  falta identidad nativa        source <> 'lusha' o source_contact_id IS NULL

Las consultas SQL de sólo lectura para cada caso están en
docs/agent2a/OPERATIONS_RUNBOOK.md § A–K. Ninguna devuelve PII.

NUNCA pongas en un ticket: teléfonos (ni enmascarados), emails, nombres completos,
LinkedIn, source_contact_id, provider_person_id, ni valores crudos de env.
SÍ es seguro: candidate_id, run_id, reservation_id, códigos mecánicos, conteos.

═══════════════════════════════════════════════════════════════════
9. LO QUE FALTA (no lo presentes como bug si es alcance)
═══════════════════════════════════════════════════════════════════

DEUDA REAL
  · Privacidad Fase 2: sujeto de identidad GLOBAL entre proveedores. NO existe.
    Una DSAR sobre la identidad Apollo NO bloquea un reveal contra la identidad
    Lusha de la misma persona. Es la limitación más importante del subsistema.
  · PR #288 (badge «Nuevo») abierto y congelado.
  · Sin QA de Producción de: un reveal Apollo con 2+ teléfonos, un waterfall que
    caiga de verdad a la pata Lusha, y una DSAR ejercida.
  · Preview no aislado de Producción (infraestructura, no código).

ALCANCE DELIBERADO — NO es deuda
  · Search More vía Apollo: la operación no existe en Apollo.
    Un candidato legacy/manual de origen Lusha NO tiene Search More disponible,
    y eso es correcto, no un defecto.
  · Búsqueda general de personas de Lusha: prohibida por contrato.
  · Reintento pagado automático: prohibido.
  · Bulk de operaciones de teléfono: no existe por diseño.

═══════════════════════════════════════════════════════════════════
10. ANTES DE PROPONER UN CAMBIO
═══════════════════════════════════════════════════════════════════

  1. ¿Viola alguno de los 18 ratchets? (FUTURE_WORK.md § 4)
  2. ¿Introduce una SEGUNDA implementación de una regla que ya existe?
     La causa raíz de #309 fue exactamente eso.
  3. ¿Colapsa dos hechos distintos en un solo estado?
     Cinco de los ocho incidentes de este subsistema son ESA clase de error.
     La respuesta correcta es separar el vocabulario, no añadir un caso especial.
  4. ¿Exporta algo que no sea una función async desde un módulo 'use server'?
  5. ¿Necesita migración? Entonces necesita autorización explícita de Producción.
  6. ¿Toca dinero o privacidad? Entonces necesita test contra PostgreSQL real,
     no sólo unitario.

Ejecuta las suites obligatorias del workflow «Automatic Routing Tests» antes de
declarar nada terminado.
```
