'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface ShellBusiness {
  id: string;
  name: string;
  base_currency: string;
  business_type: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Shown in the compact mobile bar. */
  primary?: boolean;
}

/**
 * Navigation is deliberately short. Secondary functions live inside
 * their module rather than adding a permanent sidebar row.
 */
function navFor(businessId: string, businessType: string): NavItem[] {
  const base = `/b/${businessId}`;
  const moneyInLabel =
    businessType === 'travel' ? 'Bookings' :
    businessType === 'ecommerce' || businessType === 'retail' ? 'Sales' :
    'Money in';

  return [
    { href: `${base}/dashboard`, label: 'Dashboard', icon: '◈', primary: true },
    { href: `${base}/money-in`, label: moneyInLabel, icon: '↗', primary: true },
    { href: `${base}/invoices`, label: 'Invoices', icon: '▦', primary: true },
    { href: `${base}/clients`, label: 'Clients', icon: '◍' },
    { href: `${base}/transactions`, label: 'Transactions', icon: '≡' },
    { href: `${base}/reports`, label: 'Reports', icon: '▤' },
    { href: `${base}/zylx`, label: 'Zylx', icon: '✦', primary: true },
    { href: `${base}/settings`, label: 'Settings', icon: '⚙' },
  ];
}

export default function AppShell({
  business,
  businesses,
  children,
}: {
  business: ShellBusiness;
  businesses: ShellBusiness[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const items = navFor(business.id, business.business_type);
  const isActive = (href: string) => pathname === href || pathname?.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh">
      {/* ── Desktop sidebar ─────────────────────────────── */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-gold-line bg-white/55 backdrop-blur-xl lg:flex"
        aria-label="Main navigation"
      >
        <div className="px-5 pb-4 pt-5">
          <Link href="/command" className="block text-[19px] font-extrabold tracking-brand">
            <span className="text-ink">Bank</span>
            <span className="text-gold">DeMark</span>
          </Link>
          <p className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
            Command
          </p>
        </div>

        <BusinessSwitcher
          business={business}
          businesses={businesses}
          open={switcherOpen}
          onToggle={() => setSwitcherOpen((v) => !v)}
        />

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-semibold transition-colors ${
                isActive(item.href)
                  ? 'bg-ink text-cream'
                  : 'text-muted hover:bg-ink/[0.05] hover:text-ink'
              }`}
            >
              <span aria-hidden className="w-4 text-center text-[15px] opacity-80">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-gold-line px-3 py-3">
          <Link
            href="/command/account"
            className="flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-semibold text-muted hover:bg-ink/[0.05] hover:text-ink"
          >
            <span aria-hidden className="w-4 text-center">◯</span>
            Account &amp; billing
          </Link>
        </div>
      </aside>

      {/* ── Mobile header ───────────────────────────────── */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-gold-line bg-cream/85 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Link href="/command" className="text-[17px] font-extrabold tracking-brand">
          <span className="text-ink">Bank</span>
          <span className="text-gold">DeMark</span>
        </Link>
        <button
          type="button"
          onClick={() => setSwitcherOpen((v) => !v)}
          aria-expanded={switcherOpen}
          className="flex max-w-[55%] items-center gap-1.5 rounded-pill border border-gold-line bg-white/70 px-3 py-1.5 text-[13px] font-semibold"
        >
          <span className="truncate">{business.name}</span>
          <span aria-hidden className="text-muted">▾</span>
        </button>
      </header>

      {switcherOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="Switch business">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-ink/25"
            onClick={() => setSwitcherOpen(false)}
          />
          <div className="absolute inset-x-3 top-16 rounded-card border border-gold-line bg-cream p-2 shadow-float">
            <BusinessList
              businesses={businesses}
              currentId={business.id}
              onNavigate={() => setSwitcherOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ── Content ─────────────────────────────────────── */}
      <main className="lg:pl-[248px]">
        <div className="pb-[calc(var(--app-mobile-nav-h)+16px)] lg:pb-0">{children}</div>
      </main>

      {/* ── Mobile bottom nav ───────────────────────────── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid border-t border-gold-line bg-cream/95 backdrop-blur-xl lg:hidden"
        // Derived from the item count rather than hard-coded, so adding
        // a primary destination cannot silently break the bottom bar.
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          gridTemplateColumns: `repeat(${items.filter((i) => i.primary).length}, minmax(0, 1fr))`,
        }}
        aria-label="Primary"
      >
        {items.filter((i) => i.primary).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-semibold ${
              isActive(item.href) ? 'text-ink' : 'text-muted'
            }`}
          >
            <span aria-hidden className="text-[17px]">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function BusinessSwitcher({
  business,
  businesses,
  open,
  onToggle,
}: {
  business: ShellBusiness;
  businesses: ShellBusiness[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative px-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-control border border-gold-line bg-white/70 px-3 py-2.5 text-left transition-colors hover:border-gold/40"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-ink">{business.name}</span>
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted">
            {business.base_currency}
          </span>
        </span>
        <span aria-hidden className="text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute inset-x-3 top-full z-50 mt-1 rounded-panel border border-gold-line bg-cream p-1.5 shadow-float">
          <BusinessList businesses={businesses} currentId={business.id} onNavigate={onToggle} />
        </div>
      )}
    </div>
  );
}

function BusinessList({
  businesses,
  currentId,
  onNavigate,
}: {
  businesses: ShellBusiness[];
  currentId: string;
  onNavigate: () => void;
}) {
  return (
    <>
      {businesses.map((b) => (
        <Link
          key={b.id}
          href={`/b/${b.id}/dashboard`}
          onClick={onNavigate}
          className={`flex items-center justify-between gap-2 rounded-control px-3 py-2.5 text-sm font-semibold ${
            b.id === currentId ? 'bg-ink text-cream' : 'text-ink hover:bg-ink/[0.05]'
          }`}
        >
          <span className="truncate">{b.name}</span>
          <span className={`text-[11px] ${b.id === currentId ? 'text-cream/70' : 'text-muted'}`}>
            {b.base_currency}
          </span>
        </Link>
      ))}

      <div className="my-1.5 h-px bg-gold-line" />

      <Link
        href="/command/portfolio"
        onClick={onNavigate}
        className="block rounded-control px-3 py-2.5 text-sm font-semibold text-muted hover:bg-ink/[0.05] hover:text-ink"
      >
        All businesses
      </Link>
      <Link
        href="/onboarding"
        onClick={onNavigate}
        className="block rounded-control px-3 py-2.5 text-sm font-semibold text-gold-dark hover:bg-gold-tint"
      >
        + Add a business
      </Link>
    </>
  );
}
