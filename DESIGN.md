---
version: alpha
colors:
  primary: '#b9f36b'
  background: '#101211'
  surface: '#181b19'
  raised: '#1e221f'
  text: '#eef2eb'
  muted: '#a0a99f'
  border: '#2c322d'
  danger: '#f18585'
  warning: '#e8c076'
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
`app/globals.css` is the canonical runtime token owner (model B). DESIGN.md mirrors accepted defaults. `--accent` = primary; `--bg` = background; `--surface`, `--surface-raised`, `--text`, `--muted`, `--border`, `--danger`, `--warning` match frontmatter. App settings override only brand/background/font and semantic text contrast is derived; surfaces keep their own dark contrast. Red/yellow are reserved for errors, risk and attention, never default navigation.

## Typography
Local Manrope for headings and body; local Inter for optional theme and utility data. No font network requests in product flows. Headings 28–34px, body 14px, data 13px, captions 11px. Tabular numerals on values. Portuguese Brazilian labels and BRL formatting. User selectable Manrope, Inter or system, persisted in SQL.

## Layout
Sidebar 248px, topbar 76px, content padding 32px desktop. At 1100px sidebars shrink to 226px; under 900px navigation becomes an accessible drawer. Main content owns document scrolling; tables scroll inside their own panel on narrow screens. No arbitrary viewport heights on CRUD forms. Sidebar left or right is a layout token, without reordering data or API behavior.

## Elevation & Depth
Flat graphite surfaces, 1px borders. Shadows limited to menus, floating feedback and modal dialogs. One overlay layer for wallpaper with pointer-events:none, capped opacity 0.35, beneath stable readable surfaces. Custom backgrounds and wallpapers receive an 85% #101211 readability layer in the workspace and theme preview. The default theme is unchanged. External secondary labels use the muted text token under customization; even a white background keeps the calculated text contrast above 4.5:1.

## Shapes
8px controls, 14px panels, 18px dialogs. Circular avatars and small status dots are semantic exceptions. Avoid excessive pills, decorative cards or rainbow charts.

## Components
Shared owners in components/ui.tsx: Button, Field, Input, Select, Textarea, Modal, ConfirmDialog, DataTable, Badge, loading/error/empty states. Icons are Lucide; customization selects finite icon names, never markup. Charts Recharts with accessible text summaries and real server aggregates. Modal dialog has native focus containment and Escape; confirmation focus goes to cancel. Toast event owner lib/api.ts -> App toast listener. Wallpaper/logo are local R2 asset references, validated server-side PNG/JPEG/WebP uploads.

## Do's and Don'ts
Do keep content in pt-BR and confirm saves from API responses. Do preserve semantic contrast under customization. Do allow defaults to be restored. Do use actual persisted metrics. Do not invent KPI growth or successful API writes. Do not change red/yellow semantics for branding. Do not place operational technical details in normal user workflows.
