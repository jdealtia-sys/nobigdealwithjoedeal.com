import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-border-focus)] focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)]',
        secondary:
          'border-transparent bg-[var(--color-accent-subtle)] text-[var(--color-accent)]',
        outline: 'border-[var(--color-border)] text-[var(--color-text-primary)]',
        success:
          'border-transparent bg-[var(--color-success-subtle)] text-[var(--color-success)]',
        warning:
          'border-transparent bg-[var(--color-warning-subtle)] text-[var(--color-warning)]',
        danger:
          'border-transparent bg-[var(--color-danger-subtle)] text-[var(--color-danger)]',
        // Pipeline stage badges
        'stage-new': 'border-transparent bg-indigo-100 text-indigo-800',
        'stage-contacted': 'border-transparent bg-violet-100 text-violet-800',
        'stage-inspected': 'border-transparent bg-cyan-100 text-cyan-800',
        'stage-estimate-sent': 'border-transparent bg-amber-100 text-amber-800',
        'stage-approved': 'border-transparent bg-emerald-100 text-emerald-800',
        'stage-in-production': 'border-transparent bg-blue-100 text-blue-800',
        'stage-complete': 'border-transparent bg-green-100 text-green-800',
        'stage-won': 'border-transparent bg-green-100 text-green-900',
        'stage-lost': 'border-transparent bg-red-100 text-red-800',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
