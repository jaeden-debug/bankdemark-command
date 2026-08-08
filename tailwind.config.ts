import type { Config } from 'tailwindcss';

/**
 * BankDeMark Command design tokens.
 *
 * Extracted from the production public site (bankdemark.com,
 * src/app/globals.css) so Command reads as the application belonging
 * to that brand: cream paper, deep navy ink, gold accent, Inter.
 *
 * The previous dark #080C14 / #00D084 palette was a different brand
 * and has been retired.
 */
const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0b1220',
          80: 'rgba(11,18,32,0.80)',
          60: 'rgba(11,18,32,0.60)',
        },
        muted: '#667085',
        gold: {
          DEFAULT: '#c6a24a',
          light: '#efd58a',
          dark: '#9f7b2e',
          tint: 'rgba(198,162,74,0.10)',
          line: 'rgba(198,162,74,0.18)',
        },
        cream: {
          DEFAULT: '#fbf7ef',
          soft: '#f7f3ea',
          deep: '#f4efe5',
        },
        paper: 'rgba(255,255,255,0.72)',
        // Financial signal colours. Deliberately muted — a financial
        // dashboard should not look like a trading terminal.
        positive: { DEFAULT: '#1d7a53', soft: 'rgba(29,122,83,0.10)' },
        negative: { DEFAULT: '#b3261e', soft: 'rgba(179,38,30,0.09)' },
        caution: { DEFAULT: '#a8730f', soft: 'rgba(168,115,15,0.10)' },
        info: { DEFAULT: '#1f4f82', soft: 'rgba(31,79,130,0.09)' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        // Tabular figures for money columns so digits line up.
        num: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '24px',
        panel: '18px',
        control: '12px',
        pill: '999px',
      },
      boxShadow: {
        card: '0 18px 48px rgba(15,23,42,0.07), inset 0 1px 0 rgba(255,255,255,0.75)',
        'card-hover': '0 26px 70px rgba(15,23,42,0.11), inset 0 1px 0 rgba(255,255,255,0.85)',
        float: '0 22px 70px rgba(15,23,42,0.11), inset 0 1px 0 rgba(255,255,255,0.82)',
        inset: 'inset 0 1px 2px rgba(11,18,32,0.06)',
      },
      letterSpacing: {
        brand: '-0.045em',
        tight2: '-0.02em',
      },
      backgroundImage: {
        'bdm-page':
          'radial-gradient(circle at 16% 6%, rgba(198,162,74,.18), transparent 34%), radial-gradient(circle at 92% 14%, rgba(11,18,32,.06), transparent 28%), linear-gradient(180deg, #fbf7ef 0%, #f4efe5 46%, #fbf7ef 100%)',
        'gold-sweep': 'linear-gradient(135deg, #c6a24a 0%, #efd58a 100%)',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-500px 0' },
          '100%': { backgroundPosition: '500px 0' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.28s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
