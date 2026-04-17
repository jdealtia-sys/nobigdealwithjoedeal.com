// Auto-generated types would go here after running:
//   supabase gen types typescript --project-id <project-id> > src/lib/supabase/types.ts
//
// For now, we define a minimal stub that matches our schema.
// Run the generation command once the Supabase project is provisioned.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type TenantPlan = 'lite' | 'pro' | 'team' | 'enterprise'
export type TenantPlanStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused'
export type UserRole = 'owner' | 'admin' | 'estimator' | 'sales_rep' | 'canvasser' | 'crew' | 'accountant' | 'customer'
export type UiMode = 'field' | 'office'
export type UiTheme = 'nbd-navy' | 'midnight-pro' | 'field-sun' | 'custom'
export type OpportunityTrack = 'active' | 'nurture' | 'dead'
export type JobStatus = 'scheduled' | 'materials_ordered' | 'in_progress' | 'quality_check' | 'complete' | 'warranty'
export type ClaimStatus = 'pending' | 'filed' | 'adjuster_scheduled' | 'approved' | 'denied' | 'supplementing' | 'closed'
export type EstimateStatus = 'draft' | 'sent' | 'viewed' | 'signed' | 'expired' | 'declined'
export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'void'

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string
          name: string
          slug: string
          subdomain: string | null
          custom_domain: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          plan: TenantPlan
          plan_status: TenantPlanStatus
          trial_ends_at: string | null
          logo_url: string | null
          theme: UiTheme
          brand_color: string | null
          ai_credits_used: number
          ai_credits_limit: number
          ai_credits_reset_at: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          name: string
          slug: string
          subdomain?: string | null
          custom_domain?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          plan?: TenantPlan
          plan_status?: TenantPlanStatus
          trial_ends_at?: string | null
          logo_url?: string | null
          theme?: UiTheme
          brand_color?: string | null
          ai_credits_used?: number
          ai_credits_limit?: number
          ai_credits_reset_at?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['tenants']['Insert']>
      }
      users: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          phone: string | null
          preferred_theme: string | null
          preferred_mode: UiMode
          notification_preferences: Json
          last_seen_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          avatar_url?: string | null
          phone?: string | null
          preferred_theme?: string | null
          preferred_mode?: UiMode
          notification_preferences?: Json
          last_seen_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['users']['Insert']>
      }
      user_tenants: {
        Row: {
          id: string
          user_id: string
          tenant_id: string
          role: UserRole
          is_default: boolean
          invited_by: string | null
          invited_at: string | null
          accepted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          tenant_id: string
          role: UserRole
          is_default?: boolean
          invited_by?: string | null
          invited_at?: string | null
          accepted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['user_tenants']['Insert']>
      }
      contacts: {
        Row: {
          id: string
          tenant_id: string
          first_name: string
          last_name: string | null
          email: string | null
          phone: string | null
          phone_alt: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          zip: string | null
          country: string
          source: string | null
          tags: string[]
          notes: string | null
          assigned_to: string | null
          created_by: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          first_name: string
          last_name?: string | null
          email?: string | null
          phone?: string | null
          phone_alt?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          country?: string
          source?: string | null
          tags?: string[]
          notes?: string | null
          assigned_to?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['contacts']['Insert']>
      }
      opportunities: {
        Row: {
          id: string
          tenant_id: string
          contact_id: string
          property_id: string
          stage_id: string
          title: string
          description: string | null
          job_type: 'insurance' | 'retail' | 'commercial'
          estimated_value: number | null
          actual_value: number | null
          loss_reason: string | null
          loss_notes: string | null
          track: OpportunityTrack
          follow_up_at: string | null
          revive_trigger: string | null
          assigned_to: string | null
          created_by: string
          closed_at: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          contact_id: string
          property_id: string
          stage_id: string
          title: string
          description?: string | null
          job_type?: 'insurance' | 'retail' | 'commercial'
          estimated_value?: number | null
          actual_value?: number | null
          loss_reason?: string | null
          loss_notes?: string | null
          track?: OpportunityTrack
          follow_up_at?: string | null
          revive_trigger?: string | null
          assigned_to?: string | null
          created_by: string
          closed_at?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['opportunities']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: {
      seed_default_pipeline_stages: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
    }
    Enums: Record<string, never>
  }
}
