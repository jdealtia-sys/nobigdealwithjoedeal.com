'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  MapPin,
  KanbanSquare,
  FileText,
  Shield,
  Briefcase,
  Receipt,
  MessageSquare,
  CheckSquare,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Building2,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ModeToggle } from './mode-toggle'
import { Button } from '@/components/ui/button'

const NAV_ITEMS = [
  {
    group: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    group: 'Pipeline',
    items: [
      { href: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
      { href: '/contacts', label: 'Contacts', icon: Users },
      { href: '/properties', label: 'Properties', icon: MapPin },
    ],
  },
  {
    group: 'Work',
    items: [
      { href: '/estimates', label: 'Estimates', icon: FileText },
      { href: '/claims', label: 'Claims', icon: Shield },
      { href: '/jobs', label: 'Jobs', icon: Briefcase },
      { href: '/invoices', label: 'Invoices', icon: Receipt },
    ],
  },
  {
    group: 'Communication',
    items: [
      { href: '/inbox', label: 'Inbox', icon: MessageSquare },
      { href: '/tasks', label: 'Tasks', icon: CheckSquare },
    ],
  },
  {
    group: 'AI',
    items: [
      { href: '/ask-joe', label: 'Ask Joe', icon: Sparkles },
    ],
  },
]

interface SidebarProps {
  tenantName?: string
}

export function Sidebar({ tenantName = 'My Company' }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        'flex flex-col h-full border-r transition-all duration-200',
        collapsed ? 'w-16' : 'w-64'
      )}
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        minHeight: '100vh',
      }}
    >
      {/* Top: Logo + Tenant name */}
      <div
        className="flex items-center gap-3 px-4 h-14 border-b shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div
          className="flex items-center justify-center w-8 h-8 rounded-md font-bold text-sm shrink-0"
          style={{
            background: 'var(--color-brand-navy)',
            color: 'white',
          }}
        >
          N
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <span
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {tenantName}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              NBD Pro
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {NAV_ITEMS.map((group) => (
          <div key={group.group}>
            {!collapsed && (
              <p
                className="text-xs font-semibold uppercase tracking-wider px-2 mb-1"
                style={{ color: 'var(--color-text-disabled)' }}
              >
                {group.group}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={cn(
                        'flex items-center gap-3 px-2 py-1.5 rounded-md text-sm transition-colors',
                        collapsed ? 'justify-center' : '',
                        isActive
                          ? 'font-medium'
                          : 'hover:bg-[var(--color-bg-subtle)]'
                      )}
                      style={{
                        color: isActive
                          ? 'var(--color-accent)'
                          : 'var(--color-text-secondary)',
                        background: isActive ? 'var(--color-accent-subtle)' : undefined,
                      }}
                      title={collapsed ? label : undefined}
                    >
                      <Icon className="size-4 shrink-0" />
                      {!collapsed && <span>{label}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom: Mode toggle + Settings + Collapse */}
      <div
        className="flex flex-col gap-1 px-2 py-3 border-t shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <ModeToggle collapsed={collapsed} />

        <Link
          href="/settings"
          className="flex items-center gap-3 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-[var(--color-bg-subtle)]"
          style={{ color: 'var(--color-text-secondary)' }}
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings className="size-4 shrink-0" />
          {!collapsed && <span>Settings</span>}
        </Link>

        <Button
          variant="ghost"
          size="icon"
          className={cn('mt-1', collapsed ? 'self-center' : 'self-end')}
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="size-4" />
          ) : (
            <ChevronLeft className="size-4" />
          )}
        </Button>
      </div>
    </aside>
  )
}

// Unused import guard
void Building2
