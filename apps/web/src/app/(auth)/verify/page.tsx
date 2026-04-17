import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function VerifyPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold" style={{ color: 'var(--color-brand-navy)' }}>
            NBD Pro
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Check your email</CardTitle>
            <CardDescription>
              We sent a confirmation link to your inbox. Click it to activate your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Didn&apos;t get the email? Check your spam folder, or{' '}
              <Link href="/signup" style={{ color: 'var(--color-accent)' }}>
                try again with a different address
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
