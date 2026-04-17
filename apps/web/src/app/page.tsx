export default function HomePage() {
  return (
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '1rem',
        background: 'var(--color-bg)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <div
        style={{
          fontSize: '2rem',
          fontWeight: '700',
          color: 'var(--color-brand-navy)',
        }}
      >
        NBD Pro
      </div>
      <div style={{ color: 'var(--color-text-secondary)' }}>
        V3.0 — Foundation building...
      </div>
    </main>
  )
}
