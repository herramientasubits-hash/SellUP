# Plan — Agente 2A: buscar un contacto por LinkedIn (F2)

Spec: [`2026-10-26-agent2a-linkedin-contact-search-design.md`](../specs/2026-10-26-agent2a-linkedin-contact-search-design.md)
Rama: `feat/agent2a-linkedin-contact-search`, apilada sobre F1 (`fix/agent2a-search-mode-icons-and-reset`).
Integración: el PR de F2 va después de que se integre F1; entonces se reconcilia con `origin/main`.

| # | Paso | Archivos | Verificación |
|---|---|---|---|
| 1 | Normalizar y validar la URL; clave de comparación; patrones `ilike` | `src/modules/contact-enrichment/linkedin-profile-url.ts` | `linkedin-profile-url.test.ts` |
| 2 | Vista previa firmada (HMAC, 30 min, por usuario) | `linkedin-preview-token.ts` | `linkedin-preview-token.test.ts` |
| 3 | Núcleo puro: búsqueda (dedup → Apollo → Lusha → correo vs SellUp/HubSpot → vista previa) y creación (empresa → request → run con cuenta → candidato) | `linkedin-contact-search-core.ts` | `linkedin-contact-search-core.test.ts` |
| 4 | Adaptadores de Apollo (`people/match`) y Lusha (`v3/contacts/search` + `enrich` emails) | `linkedin-contact-search-providers.server.ts` | `linkedin-contact-search-providers.test.ts` |
| 5 | Acciones del servidor detrás de la bandera; lecturas globales en SellUp; registro de uso sin la URL | `linkedin-contact-search-actions.ts` | `linkedin-contact-search-privacy-static.test.ts` |
| 6 | Separar el buscador de «Reasignar empresa» para reutilizarlo | `company-search-picker.tsx`, `contact-candidate-company-reassign-dialog.tsx` | `contact-candidate-company-reassign-runtime.test.tsx`, `resolve-company-client.test.ts` |
| 7 | Diálogo «Asociar a una empresa» (Company ID / Buscar) con aviso de consistencia | `linkedin-candidate-company-dialog.tsx` | runtime |
| 8 | Modo LinkedIn del panel: chat sin URL, vista previa, «Reintentar», «Revisar contactos» | `contact-enrichment-linkedin-search.tsx` | `contact-enrichment-linkedin-search-runtime.test.tsx` |
| 9 | `hs_linkedin_url` al crear en HubSpot (ya en `main` por #651): prueba del camino completo | — | `linkedin-contact-hubspot-create.test.ts` |
| 10 | Gate `test:agent2a:linkedin-contact-search` y paso en CI | `package.json`, `.github/workflows/automatic-routing-tests.yml` | `npm run test:agent2a:linkedin-contact-search` |
| 11 | Docs | `docs/agent2a/{HISTORY_AND_INCIDENTS,QA_ACCEPTANCE,BUDGET_AND_BILLING,BACKLOG}.md` | — |

Validación de cierre: `tsc`, `eslint` en los archivos tocados, `check-design-system`, gates de
agent2a (separando los fallos que ya están en `main`).

Producción: nada se activa con el merge. Encender `CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED`
gasta créditos reales y requiere autorización explícita (protocolo § 12).
