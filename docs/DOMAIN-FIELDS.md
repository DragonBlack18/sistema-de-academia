# Domain fields — authoritative UI/API mapping
All record IDs are opaque strings. Monetary fields integer BRL cents. All entities return id, created_at, updated_at, version (except append-only audit/access/payment rows). Status enums are English, display translated in UI. Empty optional FK = null. API GET lists `{data,total,page,pageSize}`. PATCH requires `version`.

| Entity | Create/edit fields | States / notes |
|---|---|---|
| students | name*, email?, phone?, cpf?, birth_date?, address?, emergency_name?, emergency_phone?, notes?, trainer_id?, status | active/inactive; trainer_id references user account, not staff. Responses include trainer_name, plan_name, membership_status, last_attendance. |
| staff | name*, email?, phone?, position*, specialty?, user_id?, status | active/inactive. position string (Professor, Recepção, etc). |
| plans | name*, description?, price_cents*, duration_months* (1..36), modalities?, access_start? (HH:mm), access_end?, status | active/inactive; modalities comma-separated string. |
| memberships | student_id*, plan_id*, start_date* (YYYY-MM-DD), discount_cents? (0 default), notes? | auto computes end_date, due_date, contracted_price_cents from plan, status active. PATCH notes only; actions suspend/cancel/renew require version; suspension/ cancellation reason. Include student_name, plan_name, contracted_price_cents, discount_cents, start_date,end_date,status, invoice details. States active/suspended/cancelled/expired; automatic date expiry in access checks. Renewal updates same record dates + new invoice & history, not a second active membership. |
| invoices | student_id*, membership_id?, description*, amount_cents*, due_date* | state open/paid/refunded/cancelled; status derived overdue on response via is_overdue; PATCH only open description/due_date (amount immutable); pay/refund/cancel actions. payment_method, paid_at in response. |
| expenses | description*, category* (text), amount_cents*, due_date*, status (open/paid/cancelled), paid_at? | edit fields versioned; category examples Infraestrutura, Equipe, Insumos, Outros. |
| exercises | name*, muscle_group*, equipment?, instructions?, video_url?, status | active/inactive; video https only; muscle_group text. |
| workouts | student_id*, name*, objective?, notes?, valid_until? (date), items* (1..100) | items [{exercise_id*,day* (A/B/C...),sets*(1..20),reps* string,load? string,rest_seconds* integer,notes?}]. status draft/active/archived, starts draft; activate via action; editing active creates snapshot in history. Include student_name, trainer_name, item_count, items and history on detail. |
| assessments | student_id*, assessed_at* (YYYY-MM-DD), weight_kg*, height_cm*, body_fat_pct?, waist_cm?, chest_cm?, hip_cm?, notes? | numbers optional ranges validated; created_by auto; BMI computed in response, notes no diagnostic recommendations. |
| classes | name*, modality*, instructor_id?, starts_at* (ISO datetime), duration_minutes*, capacity*, location?, status | scheduled/cancelled/completed; response instructor_name,booked_count,bookings on detail. booking/unbooking action student_id; capacity guard DB. |
| products | name*, sku?, category?, price_cents*, cost_cents? (0 default), min_stock? (0), status | active/inactive; stock starts 0, use /adjust {quantity,reason,version}. Response stock. |
| suppliers | name*, contact_name?, email?, phone?, document?, notes?, status | active/inactive. |
| purchases | supplier_id*, notes?, items* [{product_id,quantity,unit_cost_cents}] | draft/received/cancelled; read-only items after creation, action receive atomic. response supplier_name,total_cents,received_at,items. |
| sales | student_id?, method* (pix/cash/card/transfer), notes?, items* [{product_id,quantity,unit_price_cents?}] | completed/refunded. Unit price enforced by server from product catalog; no sale-price override in this release. Creation immediately commits stock. response student_name,total_cents,items; refund reason+version. |
| leads | name*, email?, phone?, source?, interest?, notes?, status | new/contacted/trial/converted/lost; converted only via action, created student reference. |
| notifications | title*, message*, severity? (info/success/warning), recipient_id? | Only managers create/broadcast. Each user sees global + self notifications; per-user read state. GET fields is_read,recipient_name. Action /read. |
| attendance | — | read only id,student_id,student_name,check_in,check_out,created_by,override_reason. POST /attendance/check-in student_id + optional override_reason (requires attendance.override), POST /attendance/:id/check-out. |
| access-events | — | read only student_name,decision (allowed/denied),reason,created_at,user_name. |
| audit | — | read only action,entity,entity_id,summary,user_name,created_at. |

`GET /options` gives selection arrays students,plans,users,exercises,products,suppliers,classes,staff with fields described in API-CONTRACT; datasets obey role visibility. Inactive records excluded from new selections. Return at most 1000 per set; list query supports q/search.

Dashboard fields in API-CONTRACT. `GET /reports?days=30` = `{period:{days,from,to},totals:{received_cents,refunded_cents,expenses_cents,net_cents,open_cents,overdue_cents,sales_cents,attendance_count,new_students},revenue,attendance,planDistribution}`. CSV type students|financial|attendance; permission checks by type.

Do not offer generic hard delete. Students/staff/plans/exercises/products/suppliers archive via status inactive with PATCH; data is retained. States with financial consequences are action-only. All fields max length and types validated by Zod on server.

## Additional lifecycle details

- `POST /memberships/:id/resume {version}` reactivates a suspended contract without changing its dates. Renewal during the current period keeps the original effective start date so access continues; it extends the end date and emits a separately dated next-period invoice. Renewal after a lapse starts today.
- `POST /workouts/:id/archive {version}` archives a prescription; `POST /workouts/:id/complete {notes?}` records a completed supervised workout session. Archived prescriptions cannot be edited.
- `POST /sales` accepts `idempotencyKey` (8–120 chars). The same key and body return the existing sale; other data with the same key conflict.
- `PATCH /expenses/:id` accepts `reason`. It is required for changes to an already paid expense or a transition to cancelled; the justification and old/new cents are written to the append-only audit log.
- Notifications are visible to their recipient, their author, or everyone when recipient is null. Reading is stored separately for each account.
- `POST /purchases/:id/cancel {version}` cancels an unreceived purchase; received purchases remain immutable.
- Mutating JSON endpoints enforce `application/json` and a 256 KiB streaming body cap.
- Report `revenue` series combines recorded payments and product sales minus invoice and sale refunds, each on its actual event date. Sales refunds from earlier-period sales are deducted in the refund period, not erased from the original period; `sales_cents` is gross sales and `refunded_cents` includes both kinds of refunds. Finance accounts can see aggregated sales without stock access. The `expenses` series contains paid operating expenses. These are manual internal records, not bank reconciliation. CSV exports are capped at 10,000 records per file and escape formula-leading cells with a tab inside quotes.
- Access uses the current plan's allowed time window and configurable grace period. Payments and prices already contracted are preserved when the plan catalog price is edited.
