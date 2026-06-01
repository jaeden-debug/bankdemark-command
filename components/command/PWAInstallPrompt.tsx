'use client';

import { useEffect, useState } from 'react';

type Platform = 'ios' | 'android' | 'desktop' | null;

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

export default function PWAInstallPrompt() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<Platform>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [iosInstructions, setIosInstructions] = useState(false);

  useEffect(() => {
    // Don't show if already installed (running as standalone)
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if ((window.navigator as any).standalone === true) return;

    // Don't show if user dismissed recently
    const dismissed = localStorage.getItem('pwa-prompt-dismissed');
    if (dismissed) {
      const age = Date.now() - parseInt(dismissed, 10);
      if (age < 1000 * 60 * 60 * 24 * 7) return; // 7 days
    }

    const p = detectPlatform();
    setPlatform(p);

    if (p === 'ios') {
      // iOS doesn't fire beforeinstallprompt — show manual instructions
      setShow(true);
    } else {
      // Chrome / Edge / Android
      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setShow(true);
      };
      window.addEventListener('beforeinstallprompt', handler as EventListener);
      return () => window.removeEventListener('beforeinstallprompt', handler as EventListener);
    }
  }, []);

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  function dismiss() {
    localStorage.setItem('pwa-prompt-dismissed', String(Date.now()));
    setShow(false);
  }

  async function install() {
    if (platform === 'ios') {
      setIosInstructions(true);
      return;
    }
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setShow(false);
    }
    setDeferredPrompt(null);
  }

  if (!show) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 p-3 sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm"
      role="dialog"
      aria-label="Install BankDeMark"
    >
      <div className="glass-card border-brand-green/25 bg-surface-950/95 p-4 shadow-2xl backdrop-blur-xl">
        {!iosInstructions ? (
          <>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-green to-brand-blue text-white font-bold text-lg">
                B
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">Install BankDeMark</p>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Add to your {platform === 'ios' ? 'home screen' : platform === 'android' ? 'home screen' : 'desktop'} for instant access — no browser needed.
                </p>
              </div>
              <button
                onClick={dismiss}
                className="ml-1 flex-shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={install}
                className="cmd-btn-primary flex-1 py-2 text-sm"
              >
                {platform === 'ios' ? 'How to install' : 'Install App'}
              </button>
              <button
                onClick={dismiss}
                className="cmd-btn-ghost py-2 text-sm text-zinc-400"
              >
                Not now
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-white">Install on iPhone / iPad</p>
              <button onClick={() => setIosInstructions(false)} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
            </div>
            <ol className="space-y-2 text-xs text-zinc-300">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-brand-green/20 text-brand-green text-[10px] font-bold">1</span>
                Tap the <span className="font-semibold text-white mx-1">Share</span> button at the bottom of Safari (the box with an arrow)
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-brand-green/20 text-brand-green text-[10px] font-bold">2</span>
                Scroll down and tap <span className="font-semibold text-white mx-1">Add to Home Screen</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-brand-green/20 text-brand-green text-[10px] font-bold">3</span>
                Tap <span className="font-semibold text-white mx-1">Add</span> in the top right — done!
              </li>
            </ol>
            <button onClick={dismiss} className="mt-3 w-full cmd-btn-primary py-2 text-sm">
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}
