'use client'

import { Laptop, HardHat } from 'lucide-react'
import { useUiMode } from '@/hooks/use-ui-mode'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ModeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const { mode, toggleMode, mounted } = useUiMode()

  if (!mounted) return null

  const isField = mode === 'field'

  return (
    <Button
      variant="ghost"
      size={collapsed ? 'icon' : 'sm'}
      onClick={toggleMode}
      className={cn('gap-2 transition-all', collapsed ? 'w-10 h-10' : 'w-full justify-start')}
      title={`Switch to ${isField ? 'Office' : 'Field'} Mode`}
    >
      {isField ? (
        <HardHat className="size-4 shrink-0" style={{ color: 'var(--color-cta)' }} />
      ) : (
        <Laptop className="size-4 shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
      )}
      {!collapsed && (
        <span className="text-sm truncate">
          {isField ? 'Field Mode' : 'Office Mode'}
        </span>
      )}
    </Button>
  )
}
