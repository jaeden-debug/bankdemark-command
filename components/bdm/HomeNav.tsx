'use client';

import { useState } from 'react';
import Link from 'next/link';

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#zylx', label: 'Zylx' },
  { href: '#security', label: 'Security' },
];

export default function HomeNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-ink focus:px-4 focus:py-2 focus:text-cream">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-gold-line bg-cream/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/command" className="text-[19px] font-extrabold tracking-brand">
            <span className="text-ink">Bank</span><span className="text-gold">DeMark</span>
            <span className="ml-2 hidden text-[11px] font-bold uppercase tracking-[0.16em] text-muted sm:inline">
              Command
            </span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-semibold text-muted hover:text-ink">
                {l.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Link href="/auth/sign-in" className="text-sm font-semibold text-muted hover:text-ink">Sign in</Link>
            <Link href="/auth/sign-in?mode=sign-up" className="bdm-btn-primary bdm-btn-sm">Start free</Link>
          </div>

          <button
            type="button"
            className="md:hidden rounded-control border border-gold-line bg-white/70 px-3 py-2 text-sm font-semibold"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>

        {open && (
          <div id="mobile-nav" className="border-t border-gold-line bg-cream px-4 py-3 md:hidden">
            <nav aria-label="Mobile" className="space-y-1">
              {LINKS.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setOpen(false)}
                   className="block rounded-control px-3 py-2.5 text-sm font-semibold text-ink hover:bg-ink/[0.05]">
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2">
              <Link href="/auth/sign-in" className="bdm-btn-secondary w-full">Sign in</Link>
              <Link href="/auth/sign-in?mode=sign-up" className="bdm-btn-gold w-full">Start free</Link>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
