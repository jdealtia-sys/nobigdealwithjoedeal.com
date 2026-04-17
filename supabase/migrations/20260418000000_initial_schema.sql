-- ============================================================
-- NBD Pro V3.0 — Initial Schema Migration
-- 20260418000000_initial_schema.sql
--
-- Entity hierarchy:
--   Tenant → User → Contact → Property → Opportunity
--   Opportunity → Inspection, Estimate, Claim, Job
--   Job → Invoice, ChangeOrder
--   + Communication, Task, Document (polymorphic)
-- ============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- UTILITY: updated_at trigger function
-- ============================================================
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- TENANTS
-- Root of all multi-tenancy. Every row in every other table
-- carries a tenant_id referencing this table.
-- ============================================================
create table tenants (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  slug            text not null unique,        -- used for path routing (Lite tier)
  subdomain       text unique,                  -- used for subdomain routing (Pro tier)
  custom_domain   text unique,                  -- used for custom domain (Team+ tier)

  -- Subscription / billing
  stripe_customer_id  text unique,
  stripe_subscription_id text unique,
  plan            text not null default 'lite' check (plan in ('lite','pro','team','enterprise')),
  plan_status     text not null default 'trialing' check (plan_status in ('trialing','active','past_due','canceled','paused')),
  trial_ends_at   timestamptz,

  -- Branding
  logo_url        text,
  theme           text not null default 'nbd-navy' check (theme in ('nbd-navy','midnight-pro','field-sun','custom')),
  brand_color     text,                         -- override for custom theme

  -- AI credit pool
  ai_credits_used numeric(10,2) not null default 0,
  ai_credits_limit numeric(10,2) not null default 0,
  ai_credits_reset_at timestamptz,

  -- Metadata
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz                   -- soft delete
);

create trigger tenants_updated_at
  before update on tenants
  for each row execute function set_updated_at();

create index tenants_slug_idx on tenants (slug);
create index tenants_plan_idx on tenants (plan, plan_status);

-- ============================================================
-- USERS (extends Supabase auth.users)
-- One profile row per auth user. Users belong to one or more
-- tenants via user_tenants.
-- ============================================================
create table users (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text not null unique,
  full_name       text,
  avatar_url      text,
  phone           text,

  -- Preferences
  preferred_theme  text default 'nbd-navy',
  preferred_mode   text not null default 'office' check (preferred_mode in ('field','office')),
  notification_preferences jsonb not null default '{}',

  -- Metadata
  last_seen_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ============================================================
-- USER_TENANTS (many-to-many: user ↔ tenant with role)
-- ============================================================
create table user_tenants (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references users(id) on delete cascade,
  tenant_id       uuid not null references tenants(id) on delete cascade,
  role            text not null check (role in (
    'owner','admin','estimator','sales_rep','canvasser','crew','accountant','customer'
  )),
  is_default      boolean not null default false,   -- which tenant loads on login

  invited_by      uuid references users(id),
  invited_at      timestamptz,
  accepted_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (user_id, tenant_id)
);

create trigger user_tenants_updated_at
  before update on user_tenants
  for each row execute function set_updated_at();

create index user_tenants_tenant_id_idx on user_tenants (tenant_id);
create index user_tenants_user_id_idx on user_tenants (user_id);

-- ============================================================
-- CONTACTS
-- A person (homeowner, property owner, referral source).
-- Deduplicated per-tenant by email or phone.
-- ============================================================
create table contacts (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,

  first_name      text not null,
  last_name       text,
  email           text,
  phone           text,
  phone_alt       text,

  address_line1   text,
  address_line2   text,
  city            text,
  state           text,
  zip             text,
  country         text not null default 'US',

  source          text,                         -- how they came in (canvass, referral, inbound, etc.)
  tags            text[] not null default '{}',
  notes           text,

  assigned_to     uuid references users(id),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create trigger contacts_updated_at
  before update on contacts
  for each row execute function set_updated_at();

create index contacts_tenant_id_idx on contacts (tenant_id);
create index contacts_assigned_to_idx on contacts (tenant_id, assigned_to);
create index contacts_email_idx on contacts (tenant_id, email);
create index contacts_phone_idx on contacts (tenant_id, phone);
-- Full-text search on contact name
create index contacts_fullname_search_idx on contacts
  using gin (to_tsvector('english', coalesce(first_name,'') || ' ' || coalesce(last_name,'')));

-- ============================================================
-- PROPERTIES
-- A physical address. Belongs to a Contact.
-- May have multiple Opportunities over time.
-- ============================================================
create table properties (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,

  address_line1   text not null,
  address_line2   text,
  city            text not null,
  state           text not null,
  zip             text not null,
  country         text not null default 'US',

  -- Geo
  latitude        numeric(9,6),
  longitude       numeric(9,6),

  -- Property details
  property_type   text default 'residential' check (property_type in ('residential','commercial','multi-family')),
  year_built      smallint,
  square_footage  integer,
  roof_type       text,
  roof_age_years  smallint,
  stories         smallint,

  notes           text,
  tags            text[] not null default '{}',

  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create trigger properties_updated_at
  before update on properties
  for each row execute function set_updated_at();

create index properties_tenant_id_idx on properties (tenant_id);
create index properties_contact_id_idx on properties (contact_id);
create index properties_zip_idx on properties (tenant_id, zip);

-- ============================================================
-- PIPELINE_STAGES
-- Default 11 stages per tenant. Tenants may rename/reorder.
-- ============================================================
create table pipeline_stages (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name            text not null,
  position        smallint not null,
  color           text,                         -- hex color for kanban column
  is_terminal     boolean not null default false,
  terminal_type   text check (terminal_type in ('won','lost')),
  is_default      boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (tenant_id, position)
);

create trigger pipeline_stages_updated_at
  before update on pipeline_stages
  for each row execute function set_updated_at();

-- Seed default stages for new tenants via function (called from app on tenant creation)
create or replace function seed_default_pipeline_stages(p_tenant_id uuid)
returns void
language plpgsql
as $$
begin
  insert into pipeline_stages (tenant_id, name, position, color, is_terminal, terminal_type, is_default)
  values
    (p_tenant_id, 'New Lead',        1,  '#6366f1', false, null,  true),
    (p_tenant_id, 'Contacted',       2,  '#8b5cf6', false, null,  true),
    (p_tenant_id, 'Inspection Set',  3,  '#0ea5e9', false, null,  true),
    (p_tenant_id, 'Inspected',       4,  '#06b6d4', false, null,  true),
    (p_tenant_id, 'Estimate Sent',   5,  '#f59e0b', false, null,  true),
    (p_tenant_id, 'Claim Filed',     6,  '#f97316', false, null,  true),
    (p_tenant_id, 'Approved',        7,  '#10b981', false, null,  true),
    (p_tenant_id, 'Scheduled',       8,  '#14b8a6', false, null,  true),
    (p_tenant_id, 'In Production',   9,  '#3b82f6', false, null,  true),
    (p_tenant_id, 'Complete',        10, '#22c55e', false, null,  true),
    (p_tenant_id, 'Won',             11, '#16a34a', true,  'won', true),
    (p_tenant_id, 'Lost',            12, '#ef4444', true,  'lost',true);
end;
$$;

-- ============================================================
-- OPPORTUNITIES
-- A potential job tied to a Property.
-- Moves through the pipeline stages.
-- ============================================================
create table opportunities (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  contact_id      uuid not null references contacts(id),
  property_id     uuid not null references properties(id),
  stage_id        uuid not null references pipeline_stages(id),

  title           text not null,
  description     text,
  job_type        text default 'insurance' check (job_type in ('insurance','retail','commercial')),

  -- Financial
  estimated_value numeric(10,2),
  actual_value    numeric(10,2),

  -- Loss reason (when stage is terminal/lost)
  loss_reason     text,
  loss_notes      text,

  -- Nurture / dead track
  track           text not null default 'active' check (track in ('active','nurture','dead')),
  follow_up_at    timestamptz,
  revive_trigger  text,

  assigned_to     uuid references users(id),
  created_by      uuid not null references users(id),
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create trigger opportunities_updated_at
  before update on opportunities
  for each row execute function set_updated_at();

create index opportunities_tenant_id_idx on opportunities (tenant_id);
create index opportunities_stage_id_idx on opportunities (tenant_id, stage_id);
create index opportunities_assigned_to_idx on opportunities (tenant_id, assigned_to);
create index opportunities_contact_id_idx on opportunities (contact_id);
create index opportunities_track_idx on opportunities (tenant_id, track);

-- ============================================================
-- INSPECTIONS
-- A damage assessment event linked to an Opportunity.
-- ============================================================
create table inspections (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,

  scheduled_at    timestamptz,
  completed_at    timestamptz,

  inspector_id    uuid references users(id),
  notes           text,

  -- Measurements (roofing specific)
  total_squares   numeric(8,2),
  ridge_lf        numeric(8,2),
  hip_lf          numeric(8,2),
  valley_lf       numeric(8,2),
  rake_lf         numeric(8,2),
  eave_lf         numeric(8,2),

  -- Damage assessment
  damage_type     text[],
  damage_severity text check (damage_severity in ('minor','moderate','severe','total_loss')),

  raw_data        jsonb not null default '{}',   -- flexible field for additional measurements

  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger inspections_updated_at
  before update on inspections
  for each row execute function set_updated_at();

create index inspections_opportunity_id_idx on inspections (opportunity_id);

-- ============================================================
-- ESTIMATES
-- Good/Better/Best pricing document.
-- One Opportunity may have multiple Estimate versions.
-- ============================================================
create table estimates (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,

  version         smallint not null default 1,
  status          text not null default 'draft' check (status in ('draft','sent','viewed','signed','expired','declined')),

  -- Package tiers
  packages        jsonb not null default '[]',  -- [{tier: 'good'|'better'|'best', line_items: [...], total: ...}]
  selected_tier   text check (selected_tier in ('good','better','best')),

  -- E-signature
  esig_request_id text unique,                  -- HelloSign/Dropbox Sign request ID
  esig_url        text,
  signed_at       timestamptz,
  signed_by_name  text,
  signed_by_email text,

  -- PDF
  pdf_url         text,
  pdf_generated_at timestamptz,

  -- Validity
  valid_until     date,
  notes           text,

  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger estimates_updated_at
  before update on estimates
  for each row execute function set_updated_at();

create index estimates_opportunity_id_idx on estimates (opportunity_id);
create index estimates_status_idx on estimates (tenant_id, status);

-- ============================================================
-- CLAIMS
-- Insurance claim record linked to an Opportunity.
-- ============================================================
create table claims (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id) on delete cascade,

  claim_number    text,
  insurance_carrier text,
  policy_number   text,

  -- Adjuster info
  adjuster_name   text,
  adjuster_phone  text,
  adjuster_email  text,
  adjuster_company text,

  -- Key dates
  date_of_loss    date,
  filed_at        timestamptz,
  adjuster_appt_at timestamptz,
  approved_at     timestamptz,
  reinspection_at timestamptz,

  -- Financials
  rcv             numeric(10,2),                -- Replacement Cost Value
  acv             numeric(10,2),                -- Actual Cash Value
  depreciation    numeric(10,2),
  deductible      numeric(10,2),
  supplement_amount numeric(10,2),

  status          text not null default 'pending' check (status in (
    'pending','filed','adjuster_scheduled','approved','denied','supplementing','closed'
  )),

  notes           text,
  raw_data        jsonb not null default '{}',

  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger claims_updated_at
  before update on claims
  for each row execute function set_updated_at();

create index claims_opportunity_id_idx on claims (opportunity_id);
create index claims_tenant_id_idx on claims (tenant_id, status);

-- ============================================================
-- JOBS
-- A signed, scheduled piece of work.
-- Created when an Opportunity reaches Won.
-- ============================================================
create table jobs (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  opportunity_id  uuid not null references opportunities(id),
  estimate_id     uuid references estimates(id),

  job_number      text,                         -- human-readable, e.g. J-2026-0001
  status          text not null default 'scheduled' check (status in (
    'scheduled','materials_ordered','in_progress','quality_check','complete','warranty'
  )),

  scheduled_start date,
  scheduled_end   date,
  actual_start    date,
  actual_end      date,

  crew_lead_id    uuid references users(id),
  crew_ids        uuid[] not null default '{}',

  scope_notes     text,
  completion_notes text,

  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create trigger jobs_updated_at
  before update on jobs
  for each row execute function set_updated_at();

create index jobs_tenant_id_idx on jobs (tenant_id, status);
create index jobs_opportunity_id_idx on jobs (opportunity_id);
create index jobs_scheduled_start_idx on jobs (tenant_id, scheduled_start);

-- ============================================================
-- INVOICES
-- A billable document tied to a Job.
-- ============================================================
create table invoices (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  job_id          uuid not null references jobs(id) on delete cascade,

  invoice_number  text,
  status          text not null default 'draft' check (status in ('draft','sent','partially_paid','paid','overdue','void')),

  line_items      jsonb not null default '[]',
  subtotal        numeric(10,2) not null default 0,
  tax_rate        numeric(5,4) not null default 0,
  tax_amount      numeric(10,2) not null default 0,
  total           numeric(10,2) not null default 0,
  amount_paid     numeric(10,2) not null default 0,
  amount_due      numeric(10,2) generated always as (total - amount_paid) stored,

  due_date        date,
  paid_at         timestamptz,

  pdf_url         text,
  notes           text,

  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger invoices_updated_at
  before update on invoices
  for each row execute function set_updated_at();

create index invoices_job_id_idx on invoices (job_id);
create index invoices_tenant_status_idx on invoices (tenant_id, status);

-- ============================================================
-- CHANGE_ORDERS
-- Post-contract modifications to a Job.
-- ============================================================
create table change_orders (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  job_id          uuid not null references jobs(id) on delete cascade,

  title           text not null,
  description     text,
  line_items      jsonb not null default '[]',
  total           numeric(10,2) not null default 0,

  status          text not null default 'pending' check (status in ('pending','approved','declined','void')),
  approved_at     timestamptz,
  approved_by_name text,

  esig_request_id text unique,
  esig_url        text,

  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger change_orders_updated_at
  before update on change_orders
  for each row execute function set_updated_at();

create index change_orders_job_id_idx on change_orders (job_id);

-- ============================================================
-- COMMUNICATIONS
-- Unified record for email, SMS, call log, or note.
-- Linked to Contact. Powers the unified inbox.
-- ============================================================
create table communications (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,

  -- Optional links to other entities
  opportunity_id  uuid references opportunities(id),
  job_id          uuid references jobs(id),

  channel         text not null check (channel in ('email','sms','call','note','system')),
  direction       text check (direction in ('inbound','outbound')),

  -- Content
  subject         text,
  body            text,
  body_html       text,

  -- External IDs for de-dup
  external_id     text unique,                  -- Gmail message ID, Twilio SID, etc.
  thread_id       text,                          -- Gmail thread ID, SMS conversation

  -- Email specifics
  from_address    text,
  to_addresses    text[],
  cc_addresses    text[],

  -- Status
  status          text not null default 'sent' check (status in ('draft','queued','sent','delivered','failed','received')),
  is_read         boolean not null default false,

  sent_by         uuid references users(id),
  sent_at         timestamptz,
  received_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger communications_updated_at
  before update on communications
  for each row execute function set_updated_at();

create index communications_tenant_id_idx on communications (tenant_id);
create index communications_contact_id_idx on communications (contact_id);
create index communications_thread_id_idx on communications (tenant_id, thread_id);
create index communications_is_read_idx on communications (tenant_id, is_read, channel);

-- ============================================================
-- TASKS
-- Assigned to-do with due date. Linked to any entity.
-- ============================================================
create table tasks (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,

  title           text not null,
  description     text,
  status          text not null default 'pending' check (status in ('pending','in_progress','complete','cancelled')),
  priority        text not null default 'normal' check (priority in ('low','normal','high','urgent')),

  -- Polymorphic link to any entity
  entity_type     text check (entity_type in ('contact','property','opportunity','job','claim','estimate')),
  entity_id       uuid,

  assigned_to     uuid references users(id),
  due_at          timestamptz,
  completed_at    timestamptz,
  completed_by    uuid references users(id),

  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger tasks_updated_at
  before update on tasks
  for each row execute function set_updated_at();

create index tasks_tenant_assigned_idx on tasks (tenant_id, assigned_to, status);
create index tasks_due_at_idx on tasks (tenant_id, due_at) where status != 'complete';
create index tasks_entity_idx on tasks (tenant_id, entity_type, entity_id);

-- ============================================================
-- DOCUMENTS
-- Any uploaded file. Linked to any entity via polymorphic
-- association.
-- ============================================================
create table documents (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,

  -- Polymorphic link
  entity_type     text check (entity_type in ('contact','property','opportunity','inspection','estimate','claim','job','change_order')),
  entity_id       uuid,

  name            text not null,
  file_path       text not null,                -- Supabase Storage path
  file_url        text,                          -- Public or signed URL (cached)
  file_size       bigint,
  mime_type       text,
  category        text check (category in ('photo','contract','estimate_pdf','adjuster_report','insurance_doc','invoice','other')),
  tags            text[] not null default '{}',
  description     text,

  uploaded_by     uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create trigger documents_updated_at
  before update on documents
  for each row execute function set_updated_at();

create index documents_tenant_id_idx on documents (tenant_id);
create index documents_entity_idx on documents (tenant_id, entity_type, entity_id);
create index documents_category_idx on documents (tenant_id, category);

-- ============================================================
-- LINE_ITEM_LIBRARY
-- Per-tenant catalog of materials and labor.
-- Used by the estimate engine.
-- ============================================================
create table line_item_library (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid not null references tenants(id) on delete cascade,

  name            text not null,
  description     text,
  category        text,                          -- roofing, gutters, siding, labor, etc.
  unit            text not null,                 -- sq, lf, ea, hr
  cost            numeric(10,2) not null default 0,
  markup_percent  numeric(5,2) not null default 0,
  price           numeric(10,2) not null default 0,
  is_active       boolean not null default true,

  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger line_item_library_updated_at
  before update on line_item_library
  for each row execute function set_updated_at();

create index line_item_library_tenant_id_idx on line_item_library (tenant_id, is_active);

-- ============================================================
-- AUDIT_LOG
-- Immutable record of every significant action.
-- 2-year retention per compliance spec.
-- ============================================================
create table audit_log (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid references tenants(id),   -- nullable for system-level events
  user_id         uuid references users(id),

  action          text not null,                 -- e.g. 'opportunity.stage_changed'
  entity_type     text,
  entity_id       uuid,

  old_values      jsonb,
  new_values      jsonb,
  metadata        jsonb not null default '{}',

  ip_address      inet,
  user_agent      text,

  created_at      timestamptz not null default now()
  -- NOTE: no updated_at — audit log rows are immutable
);

-- Partition by month for performance at scale (recommended but deferred to post-launch)
create index audit_log_tenant_idx on audit_log (tenant_id, created_at desc);
create index audit_log_entity_idx on audit_log (entity_type, entity_id, created_at desc);
create index audit_log_user_idx on audit_log (user_id, created_at desc);
