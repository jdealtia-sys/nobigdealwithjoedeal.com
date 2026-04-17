import { signUp } from '@/app/actions/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Link from 'next/link'

export default function SignupPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-3xl font-bold" style={{ color: 'var(--color-brand-navy)' }}>
            NBD Pro
          </div>
          <div className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            14-day free trial. No credit card required.
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create your account</CardTitle>
            <CardDescription>
              Set up your team in under 2 minutes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={signUp} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="full_name" className="text-sm font-medium"
                  style={{ color: 'var(--color-text-primary)' }}>
                  Your name
                </label>
                <Input
                  id="full_name"
                  name="full_name"
                  type="text"
                  placeholder="Joe Deal"
                  autoComplete="name"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="company_name" className="text-sm font-medium"
                  style={{ color: 'var(--color-text-primary)' }}>
                  Company name
                </label>
                <Input
                  id="company_name"
                  name="company_name"
                  type="text"
                  placeholder="Acme Roofing"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-sm font-medium"
                  style={{ color: 'var(--color-text-primary)' }}>
                  Work email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-sm font-medium"
                  style={{ color: 'var(--color-text-primary)' }}>
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <Button type="submit" variant="cta" className="w-full mt-2">
                Start free trial
              </Button>
            </form>

            <p className="mt-4 text-xs text-center" style={{ color: 'var(--color-text-tertiary)' }}>
              By signing up, you agree to our{' '}
              <Link href="/terms" style={{ color: 'var(--color-accent)' }}>Terms</Link>
              {' '}and{' '}
              <Link href="/privacy" style={{ color: 'var(--color-accent)' }}>Privacy Policy</Link>.
            </p>

            <div className="mt-4 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Already have an account?{' '}
              <Link href="/login" className="font-medium" style={{ color: 'var(--color-accent)' }}>
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
