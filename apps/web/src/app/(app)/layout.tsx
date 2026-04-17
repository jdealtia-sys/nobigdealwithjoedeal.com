import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Load user profile + default tenant
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', user.id)
    .single()

  const { data: membership } = await supabase
    .from('user_tenants')
    .select('role, tenant:tenants(name)')
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single()

  const tenantName =
    (membership?.tenant as { name?: string } | null)?.name ?? 'My Company'

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* Sidebar — hidden in Field Mode on mobile via CSS, always shown on desktop */}
      <div className="hidden md:flex">
        <Sidebar tenantName={tenantName} />
      </div>

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar
          userEmail={user.email ?? ''}
          userName={profile?.full_name ?? ''}
        />

        <main
          className="flex-1 overflow-y-auto p-6"
          style={{ background: 'var(--color-bg)' }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
