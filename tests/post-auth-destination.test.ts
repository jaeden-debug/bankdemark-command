// ============================================================
// POST-AUTH DESTINATION
//
// Two things are under test and they fail differently.
//
// `safeInternalPath` is a security boundary. It decides whether a value
// that arrived in a URL is allowed to become a redirect target after a
// successful sign-in. Getting it wrong is an open redirect: an attacker
// sends a victim a sign-in link with ?next=//evil.example, the victim
// authenticates for real, and the application hands them to the
// attacker's page with the sign-in having appeared to work. Most of the
// cases below are that one attack written several ways.
//
// `resolveCommandDestination` is a product decision — where somebody
// belongs when they have no business yet, one, or several. The business
// lookup is faked, because what is being tested is the branching, not
// Supabase.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const listBusinesses = vi.fn();
const requireUser = vi.fn();

vi.mock('@/lib/services/businesses', () => ({
  listBusinesses: (...args: unknown[]) => listBusinesses(...args),
}));
vi.mock('@/lib/services/context', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

const { resolveCommandDestination, safeInternalPath } = await import('@/lib/services/post-auth');

/** Minimal shape — only what the resolver reads. */
const business = (id: string) => ({ id, name: id, status: 'active' });

beforeEach(() => {
  listBusinesses.mockReset();
  requireUser.mockReset();
  requireUser.mockResolvedValue({ userId: 'user-1' });
});

describe('safeInternalPath — open redirect protection', () => {
  const FALLBACK = '/command/portfolio';

  it('accepts ordinary internal paths', () => {
    expect(safeInternalPath('/b/abc/dashboard', FALLBACK)).toBe('/b/abc/dashboard');
    expect(safeInternalPath('/onboarding', FALLBACK)).toBe('/onboarding');
    expect(safeInternalPath('/', FALLBACK)).toBe('/');
  });

  it('falls back when there is no next at all', () => {
    expect(safeInternalPath(null, FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath(undefined, FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath('', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects absolute URLs to another origin', () => {
    expect(safeInternalPath('https://evil.example/steal', FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath('http://evil.example', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects protocol-relative URLs', () => {
    // The classic one. `//evil.example` is a *relative* URL to the browser
    // and inherits the current scheme, so a naive "starts with /" check
    // waves it straight through.
    expect(safeInternalPath('//evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath('//evil.example/path', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects backslash and whitespace tricks browsers may normalise', () => {
    expect(safeInternalPath('/\\evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath('\\\\evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath('/ /evil.example', FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath('javascript:alert(1)', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects anything carrying a query string or fragment', () => {
    // Not an attack by itself, but the allow-list is deliberately narrow:
    // characters that cannot appear cannot be used to smuggle anything.
    expect(safeInternalPath('/b/abc?x=1', FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath('/b/abc#frag', FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath('/b/abc%2f..%2f', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a path that does not start at the root', () => {
    expect(safeInternalPath('b/abc/dashboard', FALLBACK)).toBe(FALLBACK);
    expect(safeInternalPath('../admin', FALLBACK)).toBe(FALLBACK);
  });
});

describe('resolveCommandDestination', () => {
  it('sends a brand-new account to onboarding', async () => {
    listBusinesses.mockResolvedValue([]);
    await expect(resolveCommandDestination()).resolves.toBe('/onboarding');
  });

  it('sends a single-business user straight into that business', async () => {
    // The hop this whole change exists to remove: one business does not
    // need a page listing one thing to choose from.
    listBusinesses.mockResolvedValue([business('biz-1')]);
    await expect(resolveCommandDestination()).resolves.toBe('/b/biz-1/dashboard');
  });

  it('sends a multi-business user to the selector', async () => {
    listBusinesses.mockResolvedValue([business('biz-1'), business('biz-2')]);
    await expect(resolveCommandDestination()).resolves.toBe('/command/portfolio');
  });

  it('never lands anyone in the legacy personal-finance screens', async () => {
    // wealth, debt, goals, affordability, marketplace and profile are
    // pre-rebuild routes kept for a later phase. Authentication must not
    // be the thing that puts a user inside them.
    const legacy = [
      '/command/wealth',
      '/command/debt',
      '/command/goals',
      '/command/affordability',
      '/command/marketplace',
      '/command/profile',
      '/command/dashboard',
      '/command/reports',
    ];

    for (const businesses of [[], [business('a')], [business('a'), business('b')]]) {
      listBusinesses.mockResolvedValue(businesses);
      const destination = await resolveCommandDestination();
      expect(legacy).not.toContain(destination);
    }
  });
});

describe('deep links survive the round trip', () => {
  it('honours a deep link over the resolved destination', async () => {
    listBusinesses.mockResolvedValue([business('biz-1')]);
    const fallback = await resolveCommandDestination();

    // Someone who clicked /b/biz-9/transactions while signed out should
    // land back there, not on their default business dashboard.
    expect(safeInternalPath('/b/biz-9/transactions', fallback)).toBe('/b/biz-9/transactions');
  });

  it('falls back to the resolved destination when the deep link is hostile', async () => {
    listBusinesses.mockResolvedValue([business('biz-1')]);
    const fallback = await resolveCommandDestination();

    expect(safeInternalPath('//evil.example', fallback)).toBe('/b/biz-1/dashboard');
    expect(safeInternalPath('https://evil.example', fallback)).toBe('/b/biz-1/dashboard');
  });

  it('falls back to onboarding when a hostile deep link meets a new account', async () => {
    listBusinesses.mockResolvedValue([]);
    const fallback = await resolveCommandDestination();
    expect(safeInternalPath('https://evil.example', fallback)).toBe('/onboarding');
  });
});
