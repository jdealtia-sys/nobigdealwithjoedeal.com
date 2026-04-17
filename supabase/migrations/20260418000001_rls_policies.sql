-- ============================================================
-- NBD Pro V3.0 — Row-Level Security Policies
-- 20260418000001_rls_policies.sql
--
-- Strategy:
--   1. Enable RLS on every tenant-scoped table
--   2. Use auth.uid() + user_tenants join to verify membership
--   3. Role-based visibility: owner/admin see all; sales_rep/canvasser see assigned-only
--   4. Customer role is isolated — separate policy path, no access to internal tables
--
-- Helper function: current_tenant_id()
--   Returns the tenant_id for the current request, injected via
--   set_config('app.current_tenant_id', ...) in the API middleware.
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Returns the current user's role within the current tenant
create or replace function current_user_role()
returns text
language sql
stable
security definer
as $$
  select ut.role
  from user_tenants ut
  where ut.user_id = auth.uid()
    and ut.tenant_id = (current_setting('app.current_tenant_id', true))::uuid
  limit 1;
$$;

-- Returns true if the current user is owner or admin in the current tenant
create or replace function is_tenant_admin()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from user_tenants ut
    where ut.user_id = auth.uid()
      and ut.tenant_id = (current_setting('app.current_tenant_id', true))::uuid
      and ut.role in ('owner', 'admin')
  );
$$;

-- Returns true if the current user belongs to the current tenant (any role)
create or replace function is_tenant_member()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from user_tenants ut
    where ut.user_id = auth.uid()
      and ut.tenant_id = (current_setting('app.current_tenant_id', true))::uuid
  );
$$;

-- ============================================================
-- TENANTS
-- Users can only read their own tenant.
-- Only owner can update. Nobody can delete (soft-delete only).
-- ============================================================
alter table tenants enable row level security;

create policy "tenants_select"
  on tenants for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = tenants.id
    )
  );

create policy "tenants_update"
  on tenants for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = tenants.id
        and ut.role = 'owner'
    )
  );

-- Insert allowed during signup only (handled by server function, not direct client insert)
create policy "tenants_insert"
  on tenants for insert
  with check (false);  -- All inserts go through the create_tenant() server function

-- ============================================================
-- USERS
-- Users can read/update their own profile.
-- Tenant members can read each other's basic info (for assignment dropdowns).
-- ============================================================
alter table users enable row level security;

create policy "users_select_self"
  on users for select
  using (id = auth.uid());

create policy "users_select_tenant_members"
  on users for select
  using (
    exists (
      select 1 from user_tenants ut1
      join user_tenants ut2 on ut2.tenant_id = ut1.tenant_id
      where ut1.user_id = auth.uid()
        and ut2.user_id = users.id
    )
  );

create policy "users_update_self"
  on users for update
  using (id = auth.uid());

create policy "users_insert_self"
  on users for insert
  with check (id = auth.uid());

-- ============================================================
-- USER_TENANTS
-- Users can see their own memberships.
-- Admins/owners can see and manage all memberships in their tenant.
-- ============================================================
alter table user_tenants enable row level security;

create policy "user_tenants_select_own"
  on user_tenants for select
  using (user_id = auth.uid());

create policy "user_tenants_select_admin"
  on user_tenants for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = user_tenants.tenant_id
        and ut.role in ('owner', 'admin')
    )
  );

create policy "user_tenants_insert_admin"
  on user_tenants for insert
  with check (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = user_tenants.tenant_id
        and ut.role in ('owner', 'admin')
    )
  );

create policy "user_tenants_update_admin"
  on user_tenants for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = user_tenants.tenant_id
        and ut.role in ('owner', 'admin')
    )
  );

create policy "user_tenants_delete_admin"
  on user_tenants for delete
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = user_tenants.tenant_id
        and ut.role in ('owner', 'admin')
    )
    and user_tenants.role != 'owner'  -- Cannot remove the owner
  );

-- ============================================================
-- PIPELINE_STAGES
-- All tenant members can read. Only admins can manage.
-- ============================================================
alter table pipeline_stages enable row level security;

create policy "pipeline_stages_select"
  on pipeline_stages for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = pipeline_stages.tenant_id
        and ut.role != 'customer'
    )
  );

create policy "pipeline_stages_mutate_admin"
  on pipeline_stages for all
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = pipeline_stages.tenant_id
        and ut.role in ('owner', 'admin')
    )
  );

-- ============================================================
-- CONTACTS
-- Admin/Owner: see all in tenant
-- Estimator: see all in tenant
-- Sales Rep: see only assigned + unassigned
-- Canvasser: see only assigned + unassigned
-- Crew/Accountant: no direct contact access
-- Customer: no access
-- ============================================================
alter table contacts enable row level security;

create policy "contacts_select_admin_estimator"
  on contacts for select
  using (
    contacts.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = contacts.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

create policy "contacts_select_sales_canvasser"
  on contacts for select
  using (
    contacts.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = contacts.tenant_id
        and ut.role in ('sales_rep', 'canvasser')
    )
    and (contacts.assigned_to = auth.uid() or contacts.assigned_to is null)
  );

create policy "contacts_insert"
  on contacts for insert
  with check (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = contacts.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep', 'canvasser')
    )
    and contacts.created_by = auth.uid()
  );

create policy "contacts_update_admin_estimator"
  on contacts for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = contacts.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

create policy "contacts_update_sales_canvasser_assigned"
  on contacts for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = contacts.tenant_id
        and ut.role in ('sales_rep', 'canvasser')
    )
    and contacts.assigned_to = auth.uid()
  );

-- ============================================================
-- PROPERTIES
-- Same visibility rules as contacts (follows the contact's assignee)
-- ============================================================
alter table properties enable row level security;

create policy "properties_select_admin_estimator"
  on properties for select
  using (
    properties.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = properties.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

create policy "properties_select_sales_canvasser"
  on properties for select
  using (
    properties.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = properties.tenant_id
        and ut.role in ('sales_rep', 'canvasser')
    )
    -- Property visible if the parent contact is assigned to them or unassigned
    and exists (
      select 1 from contacts c
      where c.id = properties.contact_id
        and (c.assigned_to = auth.uid() or c.assigned_to is null)
    )
  );

create policy "properties_insert"
  on properties for insert
  with check (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = properties.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep', 'canvasser')
    )
    and properties.created_by = auth.uid()
  );

create policy "properties_update_admin_estimator"
  on properties for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = properties.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

-- ============================================================
-- OPPORTUNITIES
-- Admin/Owner/Estimator: see all
-- Sales Rep: see assigned only
-- Canvasser: no access
-- Crew/Accountant: read-only on their assigned jobs (handled via jobs table)
-- ============================================================
alter table opportunities enable row level security;

create policy "opportunities_select_admin_estimator"
  on opportunities for select
  using (
    opportunities.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = opportunities.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

create policy "opportunities_select_sales_rep"
  on opportunities for select
  using (
    opportunities.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = opportunities.tenant_id
        and ut.role = 'sales_rep'
    )
    and (opportunities.assigned_to = auth.uid() or opportunities.assigned_to is null)
  );

create policy "opportunities_insert"
  on opportunities for insert
  with check (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = opportunities.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep')
    )
    and opportunities.created_by = auth.uid()
  );

create policy "opportunities_update_admin_estimator"
  on opportunities for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = opportunities.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

create policy "opportunities_update_sales_rep_assigned"
  on opportunities for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = opportunities.tenant_id
        and ut.role = 'sales_rep'
    )
    and opportunities.assigned_to = auth.uid()
  );

-- ============================================================
-- ESTIMATES, CLAIMS, INSPECTIONS, JOBS, INVOICES, CHANGE_ORDERS
-- Admin/Owner/Estimator: full access
-- Sales Rep: read-only on their assigned opportunities
-- Crew: read-only on their assigned jobs (jobs + documents only)
-- Accountant: read-only on invoices and jobs
-- Customer: no access to internal tables
-- ============================================================

-- ESTIMATES
alter table estimates enable row level security;

create policy "estimates_select_internal"
  on estimates for select
  using (
    exists (
      select 1 from user_tenants ut
      join opportunities o on o.id = estimates.opportunity_id and o.tenant_id = ut.tenant_id
      where ut.user_id = auth.uid()
        and ut.tenant_id = estimates.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep')
        and (
          ut.role in ('owner', 'admin', 'estimator')
          or o.assigned_to = auth.uid()
        )
    )
  );

create policy "estimates_mutate_admin_estimator"
  on estimates for all
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = estimates.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

-- CLAIMS
alter table claims enable row level security;

create policy "claims_select_internal"
  on claims for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = claims.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep')
    )
  );

create policy "claims_mutate_admin_estimator"
  on claims for all
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = claims.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

-- INSPECTIONS
alter table inspections enable row level security;

create policy "inspections_select_internal"
  on inspections for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = inspections.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep')
    )
  );

create policy "inspections_mutate_admin_estimator"
  on inspections for all
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = inspections.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

-- JOBS
alter table jobs enable row level security;

create policy "jobs_select_admin_estimator"
  on jobs for select
  using (
    jobs.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = jobs.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

create policy "jobs_select_crew_assigned"
  on jobs for select
  using (
    jobs.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = jobs.tenant_id
        and ut.role = 'crew'
    )
    and (jobs.crew_lead_id = auth.uid() or auth.uid() = any(jobs.crew_ids))
  );

create policy "jobs_select_accountant"
  on jobs for select
  using (
    jobs.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = jobs.tenant_id
        and ut.role = 'accountant'
    )
  );

create policy "jobs_mutate_admin_estimator"
  on jobs for all
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = jobs.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

-- Crew can update status and upload completion notes on their assigned jobs
create policy "jobs_update_crew_assigned"
  on jobs for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = jobs.tenant_id
        and ut.role = 'crew'
    )
    and (jobs.crew_lead_id = auth.uid() or auth.uid() = any(jobs.crew_ids))
  );

-- INVOICES
alter table invoices enable row level security;

create policy "invoices_select_admin_accountant"
  on invoices for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = invoices.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'accountant')
    )
  );

create policy "invoices_mutate_admin_estimator"
  on invoices for all
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = invoices.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

-- CHANGE_ORDERS
alter table change_orders enable row level security;

create policy "change_orders_select_internal"
  on change_orders for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = change_orders.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'accountant')
    )
  );

create policy "change_orders_mutate_admin_estimator"
  on change_orders for all
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = change_orders.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

-- ============================================================
-- COMMUNICATIONS
-- Admin/Estimator/Sales Rep: see all in tenant (filtered by UI)
-- Crew/Canvasser: no access
-- Accountant: no access
-- ============================================================
alter table communications enable row level security;

create policy "communications_select_internal"
  on communications for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = communications.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep')
    )
  );

create policy "communications_insert_internal"
  on communications for insert
  with check (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = communications.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep')
    )
  );

create policy "communications_update_internal"
  on communications for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = communications.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep')
    )
  );

-- ============================================================
-- TASKS
-- All internal roles can see tasks assigned to them.
-- Admins see all.
-- ============================================================
alter table tasks enable row level security;

create policy "tasks_select_admin"
  on tasks for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = tasks.tenant_id
        and ut.role in ('owner', 'admin')
    )
  );

create policy "tasks_select_assigned"
  on tasks for select
  using (
    tasks.assigned_to = auth.uid()
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = tasks.tenant_id
        and ut.role != 'customer'
    )
  );

create policy "tasks_select_created"
  on tasks for select
  using (
    tasks.created_by = auth.uid()
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = tasks.tenant_id
    )
  );

create policy "tasks_insert"
  on tasks for insert
  with check (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = tasks.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep')
    )
    and tasks.created_by = auth.uid()
  );

create policy "tasks_update"
  on tasks for update
  using (
    (tasks.assigned_to = auth.uid() or tasks.created_by = auth.uid())
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = tasks.tenant_id
        and ut.role != 'customer'
    )
  );

-- ============================================================
-- DOCUMENTS
-- Crew: can insert (upload) on their assigned jobs; can read docs for their jobs
-- All internal roles: see documents linked to entities they can access
-- ============================================================
alter table documents enable row level security;

create policy "documents_select_internal"
  on documents for select
  using (
    documents.deleted_at is null
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = documents.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep', 'accountant')
    )
  );

create policy "documents_select_crew_assigned"
  on documents for select
  using (
    documents.deleted_at is null
    and documents.entity_type = 'job'
    and exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = documents.tenant_id
        and ut.role = 'crew'
    )
    and exists (
      select 1 from jobs j
      where j.id = documents.entity_id
        and (j.crew_lead_id = auth.uid() or auth.uid() = any(j.crew_ids))
    )
  );

create policy "documents_insert"
  on documents for insert
  with check (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = documents.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep', 'canvasser', 'crew')
    )
    and documents.uploaded_by = auth.uid()
  );

create policy "documents_update_admin"
  on documents for update
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = documents.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

-- ============================================================
-- LINE_ITEM_LIBRARY
-- All tenant members except crew/customer can read.
-- Admin/estimator can mutate.
-- ============================================================
alter table line_item_library enable row level security;

create policy "line_item_library_select"
  on line_item_library for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = line_item_library.tenant_id
        and ut.role in ('owner', 'admin', 'estimator', 'sales_rep', 'accountant')
    )
  );

create policy "line_item_library_mutate"
  on line_item_library for all
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = line_item_library.tenant_id
        and ut.role in ('owner', 'admin', 'estimator')
    )
  );

-- ============================================================
-- AUDIT_LOG
-- Read-only for admins/owners. Immutable — no update/delete.
-- ============================================================
alter table audit_log enable row level security;

create policy "audit_log_select_admin"
  on audit_log for select
  using (
    exists (
      select 1 from user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = audit_log.tenant_id
        and ut.role in ('owner', 'admin')
    )
  );

-- Insert only via server functions (bypasses RLS with security definer)
create policy "audit_log_insert_system"
  on audit_log for insert
  with check (false);  -- All inserts via security definer server functions only
