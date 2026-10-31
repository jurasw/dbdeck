import Link from 'next/link';

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen max-w-3xl px-6 py-14 md:py-20">
    <nav className="mb-14 flex flex-wrap items-center gap-6 text-sm text-muted-foreground"><Link href="/" className="font-semibold text-foreground">DBDeck</Link><a href="https://dashboard.dbdeck.dev">Dashboard</a><Link href="/terms/">Terms</Link><Link href="/privacy/">Privacy</Link></nav>
    <p className="mb-4 text-xs uppercase tracking-widest text-muted-foreground">Updated 12 October 2026</p><h1 className="font-heading mb-10 text-4xl font-semibold tracking-tight">{title}</h1>
    <div className="space-y-8 text-sm leading-7 text-muted-foreground [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:text-foreground [&_a]:text-brand [&_strong]:text-foreground">{children}</div>
  </main>;
}
