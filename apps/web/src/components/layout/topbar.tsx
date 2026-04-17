'use client'

import { Bell, Search, ChevronDown } from 'lucide-react'
import { logout } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'

interface TopbarProps {
  userEmail?: string
  userName?: string
}

export function Topbar({ userEmail = '', userName = '' }: TopbarProps) {
  const displayName = userName || userEmail.split('@')[0] || 'Account'
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <header
      className="flex items-center justify-between px-4 h-14 border-b shrink-0"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      {/* Search */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="gap-2 text-sm"
          style={{ color: 'var(--color-text-tertiary)' }}>
          <Search className="size-4" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-disabled)' }}>
            ⌘K
          </kbd>
        </Button>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <Button variant="ghost" size="icon">
          <Bell className="size-4" />
        </Button>

        {/* User menu */}
        <form action={logout}>
          <button
            type="submit"
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors hover:bg-[var(--color-bg-subtle)]"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {/* Avatar */}
            <div
              className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-accent-fg)',
              }}
            >
              {initials}
            </div>
            <span className="hidden sm:inline max-w-[120px] truncate">{displayName}</span>
            <ChevronDown className="size-3 hidden sm:inline" />
          </button>
        </form>
      </div>
    </header>
  )
}
