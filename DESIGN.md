---
version: alpha
colors:
  primary: '#b9f36b'
  background: '#101211'
  surface: '#181b19'
  raised: '#1e221f'
  text: '#eef2eb'
  muted: '#b1bcb0'
  border: '#374139'
  danger: '#ffaaaa'
  warning: '#f7ce81'
typography:
  display:
    fontFamily: 'Manrope, system-ui, sans-serif'
  body:
    fontFamily: 'Manrope, system-ui, sans-serif'
  utility:
    fontFamily: 'Inter, system-ui, sans-serif'
rounded:
  control: '8px'
  panel: '14px'
spacing:
  page: '32px'
  gap: '20px'
components:
  button:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.background}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
  panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.panel}'
  dialog:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.text}'
  caption:
    textColor: '{colors.muted}'
    typography: '{typography.utility}'
  divider:
    backgroundColor: '{colors.border}'
    height: '1px'
  error:
    textColor: '{colors.danger}'
  warning:
    textColor: '{colors.warning}'
---

# Vitality Gym design system

## Overview
A product/admin interface for a Brazilian independent gym. Clear daily operations and financial accountability take priority. The existing Vitality identity is near black with green accents; preserve it. The visual reference is a well-organized contemporary training studio: graphite equipment, precise labels, calm spacing. The signature is a restrained rising V monogram paired with a lime activity line. Authentication uses a real gym photograph; administration stays quiet and legible.

## Colors
`lib/theme.ts` is the runtime owner for resolved theme tokens (model B), with defaults in `lib/personalization.ts`. `app/globals.css` supplies startup values and consumers; it does not independently resolve a user theme. DESIGN.md mirrors accepted dark defaults. `buildTheme()` maps academy identity + role defaults + account preferences + device color scheme to CSS variables. `--accent` is the chosen brand color; `--accent-text` contrasts against brand buttons; `--accent-visible` adjusts the same color toward black or white for readable links/icons on all six supported surfaces. The adjustment never substitutes a different brand hue. Light mode maps surface/raised/input/text/muted/borders/status tokens as a complete system. Red/yellow remain error and warning semantics. The contrast matrix is verified independently against WCAG relative luminance in `tests/personalization-hardening.mjs`.

## Typography
Local Manrope for headings and body; local Inter for optional theme and utility data. No font network requests in product flows. Headings 28–34px, body 14px, data 13px, captions 11px. Tabular numerals on values. Portuguese Brazilian labels and BRL formatting. User selectable Manrope, Inter or system, persisted in SQL. Account text scale is 100%, 110% or 120%, consumed by shared CSS through `--text-scale`; browser zoom remains available. Brand taglines render the saved message, wrap safely and retain their full text in accessible markup.

## Layout
Sidebar 248px, topbar 76px, content padding 32px desktop. At 1100px sidebars shrink to 226px; under 900px navigation becomes an accessible drawer. Main content owns document scrolling; tables scroll inside their own panel on narrow screens. No arbitrary viewport heights on CRUD forms. Sidebar left or right is a layout token, without reordering data or API behavior. A persisted compact sidebar uses 80px on desktop, with named links and an explicit expand action. Account favorites precede existing groups and always respect current permissions. Mobile uses the existing navigation drawer.

## Elevation & Depth
Flat graphite surfaces, 1px borders. Shadows limited to menus, floating feedback and modal dialogs. One overlay layer for wallpaper with pointer-events:none, capped opacity 0.35, beneath stable readable surfaces. Selected canvas colors are mixed 85% with the stable base for the chosen theme. Wallpaper uses `--wallpaper-shield` (dark #101211d9, light #f3f5f4e8) beneath opaque content panels; the preview consumes the same tokens. Reduced transparency removes decorative wallpaper and translucent panel treatment. Light/dark/system modes preserve the existing default identity.

## Shapes
Soft corners use 8px controls, 14px panels, 18px dialogs; the optional square style uses 3px, 5px and 6px via shared radius variables. Circular avatars and small status dots are semantic exceptions. Avoid excessive pills, decorative cards or rainbow charts.

## Components
Shared owners in components/ui.tsx: Button, Field, Input, Select, Textarea, Modal, ConfirmDialog, DataTable, Badge, loading/error/empty states. Icons are Lucide; customization selects finite icon names, never markup. Charts Recharts with accessible text summaries and real server aggregates. Modal dialog has native focus containment and Escape; confirmation focus goes to cancel. Toast event owner lib/api.ts -> App toast listener. Wallpaper/logo are R2 asset references, validated server-side PNG/JPEG/WebP uploads. The brand kit supports default/dark/light images, horizontal or symbol treatment, name visibility and favicon. Login uses the same authentication with configurable image, focal position, copy and split/centered composition. Images referenced only by a saved draft or history remain restricted to administrators. Personalization preview uses real Brand and the same theme adapter; figures are explicitly illustrative.

| Role | Runtime owner | Consumers |
|---|---|---|
| Theme and contrast | lib/theme.ts | App, ThemePreview, shared CSS, charts |
| Defaults and inheritance | lib/personalization.ts | server schemas, settings editor, App |
| Branding | components/Brand.tsx | sidebar, login, preview |
| Navigation labels/icons | lib/navigation.ts + Shell DynamicIcon | menu, page search, editor, preview |
| Account density | PreferenceContext + /api/preferences | module tables, preference editor |
| Draft comparison and unsaved protection | components/personalization/shared.tsx | academy and personal editors |

### Drift resolved in 1.2.0

The hardcoded brand tagline, fixed dark component colors and browser-global table density were inconsistent with the saved customization contract. They now use shared branding/theme/account owners. The preview previously omitted icon overrides and contrast rules; it now renders them from the same adapters. The version counter previously prevented conflicts but was not restorable history; immutable snapshots now support an explicit restore flow.

## Do's and Don'ts
Do keep content in pt-BR and confirm saves from API responses. Do preserve semantic contrast under customization. Do allow defaults to be restored. Do use actual persisted metrics. Do not invent KPI growth or successful API writes. Do not change red/yellow semantics for branding. Do not place operational technical details in normal user workflows.
