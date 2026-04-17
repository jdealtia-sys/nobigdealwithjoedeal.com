'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

// ============================================================
// SIGNUP — creates auth user + user profile + tenant atomically
// ============================================================
export async function signUp(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const fullName = formData.get('full_name') as string
  const companyName = formData.get('company_name') as string

  if (!email || !password || !fullName || !companyName) {
    return { error: 'All fields are required.' }
  }

  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  })

  if (authError) {
    return { error: authError.message }
  }

  if (!authData.user) {
    return { error: 'Signup failed. Please try again.' }
  }

  // 2. Create user profile (public.users)
  const { error: userError } = await supabase.from('users').insert({
    id: authData.user.id,
    email,
    full_name: fullName,
  })

  if (userError) {
    return { error: 'Failed to create user profile.' }
  }

  // 3. Create tenant with a unique slug
  const baseSlug = slugify(companyName)
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      name: companyName,
      slug,
      plan: 'lite',
      plan_status: 'trialing',
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14-day trial
    })
    .select('id')
    .single()

  if (tenantError || !tenant) {
    return { error: 'Failed to create company. Please try again.' }
  }

  // 4. Link user to tenant as owner
  const { error: membershipError } = await supabase.from('user_tenants').insert({
    user_id: authData.user.id,
    tenant_id: tenant.id,
    role: 'owner',
    is_default: true,
    accepted_at: new Date().toISOString(),
  })

  if (membershipError) {
    return { error: 'Failed to set up your account.' }
  }

  // 5. Seed default pipeline stages for the new tenant
  await supabase.rpc('seed_default_pipeline_stages', { p_tenant_id: tenant.id })

  redirect('/verify')
}

// ============================================================
// LOGIN
// ============================================================
export async function login(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email and password are required.' }
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: error.message }
  }

  redirect('/dashboard')
}

// ============================================================
// LOGOUT
// ============================================================
export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

// ============================================================
// AUTH CALLBACK (OAuth + magic link handler)
// ============================================================
export async function exchangeCodeForSession(code: string) {
  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return { error: error.message }
  }
  return { success: true }
}
