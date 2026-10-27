# Vitality Gym UX contract
Visual reference and token mapping: DESIGN.md. Data policies: docs/API-CONTRACT.md and docs/DOMAIN-FIELDS.md. The current brief authorizes practical choices for one gym with a configurable three-day overdue grace. Staff-only web version; student portal and external gateway/hardware integrations remain explicit future integrations.

## Canonical UI Map
| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | components/ui.tsx Select | UX contract | native operating-system popup intentionally accepted | browser keyboard/select |
| Date | shared Input type date/datetime-local | pt-BR display America/Sao_Paulo; ISO transmission | native OS calendar intentionally accepted | integration and browser |
| Form | Field/Input/Select/Textarea + server Zod schemas | domain fields + UX | create/edit | valid and invalid API tests |
| Scrollbar | app/globals.css | DESIGN.md | table overflow geometry | browser visual |
| Toast | lib/api.ts notify + App Toasts | UX contract | success/error/info | browser live region |
| CRUD | ModulePage / API services | domain contract | edit returns owning list, details remain in drawer | HTTP gates + real browser flow |
| Dialog | Modal/ConfirmDialog in components/ui.tsx | UX contract | ordinary edit/critical confirm | native dialog focus and keyboard |

## Navigation and dataset state
Real Portuguese URLs; main module owner App, list filters list_q/list_status/list_page/list_size in query. Browser back restores module/list context. Sensitive form drafts are not stored in localStorage. Paginated server lists, 20 records default, maximum 100. Search debounces 300ms, offers clear, ignores obsolete responses via abort controller. There is no all-record selection or bulk mutation in this version.

## Operations
Create/edit -> modal form -> pending button -> confirmed API response -> close dialog -> reload owning list -> shared toast. Failure keeps inputs visible with inline messages. Changing financial state requires named confirmation and justification for reversals. No hard deletes for business histories. Version conflicts retain edits and offer an explicit comparison. Personalization can load the published version or combine only locally changed fields into a new unsaved draft; conflicts in the same field are explained before another explicit save. Never silently overwrite. Unsaved form closure gets app-owned confirmation; actual unload uses beforeunload. Settings show a local preview and require Save customization before changing shared theme.

## Security and sessions
HttpOnly stateful cookie, CSRF token only in memory, origin validation, server authorization per operation, immediate revocation when account privilege changes. Login uses requested identifier, generic credential errors, throttling, optional TOTP. Logout and password change invalidate sessions. No student portal. Trainers/personals are scoped by assigned student ID on the server. Permissions hide unavailable nav and actions; API still rejects direct unauthorized requests. Personal/finance data separation must be tested.

## Shared state model
Every data surface: loading, populated, empty, filtered-no-results, recoverable error. Dialog saves: idle, submitting, success, field/server error, conflict. Feedback is never the sole location for critical failure. All prices integer cents; formatting pt-BR. Date-only values stay date-only; instants formatted in America/Sao_Paulo. Money/refunds/payments/stock never optimistic. Positive save only after committed response.

## Accessibility and resilience
Native semantic buttons and links, label/control relationships, masked passwords with toggle, noValidate on forms, no alert/confirm/prompt. Visible focus, accessible dialog title, native showModal focus containment/restoration, aria-live status. Native selects/date pickers intentionally platform-owned. Reduced motion disables decorative transitions. Global scrollbars remain operable; mobile tables scroll without breaking page width. Use charts plus textual figures. Connection failures retain form values; expired sessions require login before writes resume. Wallpaper is decorative with empty alt and opacity limit; text surfaces remain readable.

## Personalization (1.2.0)

Business and API evidence: docs/API-CONTRACT.md, docs/PERMISSOES.md and docs/PERSONALIZACAO.md. Global appearance requires settings.write; every authenticated account can edit only its own preferences. Precedence is academy default, role default, personal override. Removing an override restores inheritance. Navigation preferences never grant permission.

Academy and personal forms retain separate unsaved drafts when switching settings sections. Save waits for confirmed SQL persistence; failures retain fields. Internal navigation and browser history use app-owned discard confirmation; actual page unload uses beforeunload. Explicitly saving a named draft/theme stores it on the server without applying it to the academy. Loading one stages a preview; publishing still requires Save personalization.

Restoring a history entry confirms the selected version and appearance difference, creates a new version and preserves accessGraceDays, role defaults and all personal overrides. Current and previous snapshots and audit are committed atomically. Discard reverts only the local draft; uploaded assets remain reusable. Lists of versions, themes and assets are paginated. No asset deletion or arbitrary CSS/script/font URL input is exposed.

The live app and preview share theme tokens and branding. Theme preview labels all figures as illustrative. Font, text scale, theme, sidebar, table density, starting page, favorites, reduced motion and reduced transparency are stored per account. The old browser-global density key is no longer read. Account changes cannot inherit an earlier user's in-flight response: API auth generation, request cancellation and monotonic versions guard state updates.

Cross-tab changes use BroadcastChannel invalidation and refresh on focus/visibility return. Unsaved fields are never silently replaced. There is no periodic authenticated polling that would keep an idle session alive. Authentication itself is unchanged by login appearance.
