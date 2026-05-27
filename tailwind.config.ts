import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#00D084',
          'green-dim': '#00A866',
          gold: '#F5C842',
          'gold-dim': '#C9A230',
          blue: '#3B82F6',
          'blue-dim': '#2563EB',
          red: '#EF4444',
          'red-dim': '#DC2626',
        },
        surface: {
          950: '#080C14',
          900: '#0D1117',
          800: '#131923',
          700: '#1A2332',
          600: '#22304A',
          500: '#2C3E5A',
        },
        glass: 'rgba(255,255,255,0.04)',
        'glass-border': 'rgba(255,255,255,0.08)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-mesh':
          'radial-gradient(at 40% 20%, rgba(0,208,132,0.08) 0px, transparent 50%), radial-gradient(at 80% 0%, rgba(59,130,246,0.08) 0px, transparent 50%), radial-gradient(at 0% 50%, rgba(245,200,66,0.05) 0px, transparent 50%)',
        'card-shine':
          'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 60%)',
      },
      boxShadow: {
        glass: '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
        'glass-hover': '0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
        glow: '0 0 20px rgba(0,208,132,0.25)',
        'glow-gold': '0 0 20px rgba(245,200,66,0.2)',
        'glow-blue': '0 0 20px rgba(59,130,246,0.2)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        pulse: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
