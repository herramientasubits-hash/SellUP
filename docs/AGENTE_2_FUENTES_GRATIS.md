# Agente 2 — fuentes gratis antes de pagar

Investigación y decisión del 20-10-2026. Todo va detrás de banderas **apagadas por defecto**;
encenderlas en Vercel Producción es una decisión de la dueña.

## Orden de la búsqueda de contactos

1. **HubSpot primero** (`ENABLE_CONTACT_ENRICHMENT_HUBSPOT_FIRST`, #729): los contactos que HubSpot
   ya tiene de la empresa.
2. **Banco de contactos por empresa** (`ENABLE_CONTACT_ENRICHMENT_CONTACT_BANK`): lo que SellUp ya
   conocía de **otra ficha de la misma compañía** (mismo número fiscal y país, dominio o ID de
   HubSpot), si esa ficha está archivada o es del mismo responsable. Nunca la ficha activa de otro
   vendedor.
3. **Apollo** (la búsqueda de personas es gratis; completar un perfil cuesta 1 crédito). Quien ya es
   contacto de la empresa no se completa: el nombre de pila y el apellido (aunque Apollo lo mande
   oculto, «Go***z») bastan para reconocerlo sin pagar.
4. **Sitio web de la empresa** (`ENABLE_CONTACT_ENRICHMENT_COMPANY_SITE`), sólo si Apollo no dejó
   ningún candidato. Ver abajo.
5. Si no alcanza, **Lusha**, con la misma regla de siempre.

Si 1 + 2 dejan 3 o más personas relevantes con correo, no se llama a Apollo ni a Lusha.

## Reglas del banco de contactos

- Caduca a los 180 días desde que se encontró el dato.
- Respeta «no contactar» de **todas** las fichas de la compañía y las supresiones del proveedor
  (`provider_suppressions`). Si no puede leerlas, no inserta nada.
- No copia teléfonos ni `apollo_person_id`. El candidato conserva su origen real (apollo, lusha,
  hubspot) y de dónde salió queda en `enrichment_metadata.contact_bank`.
- Medición en Producción del 20-10: 0 fichas de la misma compañía (la limpieza de Brasil borró las
  fichas en vez de archivarlas). Hoy no beneficia a nadie; queda listo para cuando una empresa
  vuelva.

## Búsqueda de personas de Apollo con el formato documentado

`ENABLE_APOLLO_PEOPLE_SEARCH_V2`. En los 60 días previos, 111 de 193 búsquedas de Apollo no
trajeron **ninguna** persona aunque Apollo había reconocido la empresa. La versión actual manda los
filtros en un cuerpo JSON e incluye filtros que la búsqueda de personas no documenta (departamento
de RR. HH., `q_organization_domains`, `q_organization_name`). La versión nueva usa sólo filtros
documentados, en la URL:

1. la empresa + cargos de RR. HH. y decisores (con variantes) + el país;
2. lo mismo sin el país;
3. la empresa + niveles de dirección, sin cargos.

### Cómo comprobarlo antes de encender la bandera

Con sesión de administrador, abrir:

```
/api/debug/agent2-apollo-people-search?domain=davivienda.com
```

Devuelve, para la búsqueda de siempre (`current`) y la nueva (`documented`), cuántas personas trajo
cada intento y una muestra de cargos. **0 créditos**: sólo usa la búsqueda de personas y el
`organization_id` que guardó una búsqueda anterior de ese dominio; nunca vuelve a buscar la empresa
en Apollo. No guarda nada ni devuelve nombres, correos o teléfonos.

Si `documented` trae gente donde `current` traía 0, se enciende `ENABLE_APOLLO_PEOPLE_SEARCH_V2`.

## Sitio web de la empresa

`ENABLE_CONTACT_ENRICHMENT_COMPANY_SITE`. Cuando Apollo no deja candidatos (141 de 193 búsquedas en
los 60 días previos al 20-10), se lee la portada y hasta cuatro páginas del sitio oficial: equipo y
dirección, «nosotros», sostenibilidad y prensa. Claude entrega quién aparece con su cargo y la
frase exacta; cada persona se verifica contra el texto (la cita tiene que estar en la página y
nombrarla) y sólo entran los cargos del perfil de UBITS (RR. HH., talento, formación, gerencia
general).

- Entran como candidatos por revisar **sin correo ni teléfono**, con la página y la cita en
  `enrichment_metadata.company_site`. El origen queda como `manual`.
- Costo: una llamada a Claude por búsqueda (unos centavos), registrada en Uso de IA como «Personas
  del sitio web de la empresa (Claude)». Sin presupuesto de IA disponible no se llama.
- No cambia cuándo se llama a Lusha.
