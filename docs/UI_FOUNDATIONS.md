# Fundaciones UI de SellUp

## Enfoque Visual

El proyecto usa un sistema visual profesional basado en **Tailwind CSS** con **shadcn/ui** como biblioteca de componentes base. El objetivo es mantener una interfaz limpia, profesional y funcional sin invertir tiempo en branding visual definitivo.

## Sistema de Componentes

### shadcn/ui

SellUp utiliza **shadcn/ui** como biblioteca de componentes base. Los componentes instalados son:

- `button` - Botones primarios, secundarios, ghost
- `card` - Contenedores de contenido
- `badge` - Etiquetas de estado
- `input` - Campos de texto
- `label` - Etiquetas de formulario
- `textarea` - Campos de texto multilínea
- `select` - Menú desplegable
- `dialog` - Modales
- `sheet` - Paneles laterales
- `dropdown-menu` - Menús contextuales
- `tabs` - Pestañas
- `table` - Tablas de datos
- `separator` - Divisores
- `skeleton` - Estados de carga
- `tooltip` - Tooltips
- `avatar` - Imágenes de perfil
- `scroll-area` - Áreas con scroll

### Personalización

Los componentes pueden personalizarse en `src/components/ui/` pero se recomienda:

- Mantener la apariencia base durante el MVP
- Personalizar solo colores y spacing si es necesario
- No crear variantes visuales excesivas

## Modo Light / Dark

### Implementación

El proyecto implementa modo Light/Dark usando **next-themes**:

```typescript
// src/components/theme/theme-provider.tsx
<ThemeProvider
  attribute="class"
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
>
```

### Toggle

El toggle de tema está disponible en el header:

```typescript
// src/components/theme/theme-toggle.tsx
<ThemeToggle />
```

### Variables CSS

El theming usa variables CSS compatibles con shadcn/ui:

```css
/* Light mode */
--background: 0 0% 100% --foreground: 222.2 84% 4.9% --card: 0 0% 100%
  --card-foreground: 222.2 84% 4.9% --primary: 222.2 47.4% 11.2%
  --primary-foreground: 210 40% 98% /* ... */;
```

```css
/* Dark mode */
--background: 222.2 84% 4.9% --foreground: 210 40% 98% --card: 222.2 84% 4.9%
  --card-foreground: 210 40% 98% --primary: 210 40% 98%
  --primary-foreground: 222.2 47.4% 11.2% /* ... */;
```

### Uso en Componentes

Usar clases de Tailwind con soporte para dark mode:

```tsx
<Button className="bg-primary text-primary-foreground hover:bg-primary/90" />
<div className="bg-background text-foreground" />
```

### Persistencia

- El tema se guarda en localStorage
- Soporta tema del sistema (`defaultTheme="system"`)
- Se mantiene al cambiar de página

## Variables CSS del Proyecto

Las variables están definidas en `src/app/globals.css` y cubren:

- **Colores:** background, foreground, primary, secondary, accent, muted, card, border, input, ring, destructive
- **Radios:** border-radius
- **Tipografía:** fonts
- **Animaciones:** transitions

## Tipografía

El proyecto usa **Inter** como tipografía principal:

```typescript
// src/app/layout.tsx
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});
```

## Layout Base

### Estructura General

- **Header:** sticky, con logo y toggle de tema
- **Sidebar:** navegación lateral (oculta en móvil)
- **Main:** área de contenido con padding

### Responsive

El diseño es responsive por defecto gracias a Tailwind:

- Mobile-first
- Clases como `md:`, `lg:` para diferentes breakpoints

## Próximos Pasos

El sistema visual está preparado. Lo que **NO está definido** todavía:

1. **Colores de marca** - El color primario actual es el default de shadcn/ui
2. **Logotipo** - Por definir
3. **Diseño final de componentes** - Placeholder con estructura profesional
4. **Layouts específicos de cada módulo** - Se definirán en desarrollo

## Cómo Extender

Para personalizar el tema:

1. Modificar `src/app/globals.css` para variables adicionales
2. Ajustar en `tailwind.config.ts` si es necesario
3. Los componentes shadcn/ui heredan automáticamente

Para agregar nuevos componentes shadcn:

```bash
npx shadcn@latest add [component-name]
```

---

Para ver la arquitectura, ir a `docs/ARCHITECTURE.md`.
Para ver la estructura, ir a `docs/PROJECT_STRUCTURE.md`.
Para ver guidelines, ir a `docs/DEVELOPMENT_GUIDELINES.md`.
