import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KanbanSquare, Users, FileText, Briefcase } from 'lucide-react'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          Command Center
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Welcome back. Here&apos;s what&apos;s happening today.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Open Opportunities"
          value="—"
          description="Active pipeline"
          icon={<KanbanSquare className="size-4" />}
        />
        <KpiCard
          title="Contacts"
          value="—"
          description="Total in CRM"
          icon={<Users className="size-4" />}
        />
        <KpiCard
          title="Estimates Sent"
          value="—"
          description="Last 30 days"
          icon={<FileText className="size-4" />}
        />
        <KpiCard
          title="Active Jobs"
          value="—"
          description="In production"
          icon={<Briefcase className="size-4" />}
        />
      </div>

      {/* Placeholder for Week 2+ widgets */}
      <div
        className="rounded-lg border border-dashed flex items-center justify-center h-48 text-sm"
        style={{
          borderColor: 'var(--color-border)',
          color: 'var(--color-text-disabled)',
        }}
      >
        Pipeline kanban loads in Week 2
      </div>
    </div>
  )
}

function KpiCard({
  title,
  value,
  description,
  icon,
}: {
  title: string
  value: string
  description: string
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {title}
          </CardTitle>
          <span style={{ color: 'var(--color-text-tertiary)' }}>{icon}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {value}
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          {description}
        </p>
      </CardContent>
    </Card>
  )
}
