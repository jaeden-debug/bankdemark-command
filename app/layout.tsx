import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'BankDeMark | Financial Intelligence Platform',
    template: '%s | BankDeMark',
  },
  description:
    'BankDeMark is a premium financial intelligence platform. Calculate, plan, and optimize your financial life with AI-powered tools.',
  keywords: ['personal finance', 'financial planning', 'budget calculator', 'debt payoff', 'wealth building'],
  authors: [{ name: 'BankDeMark' }],
  openGraph: {
    type: 'website',
    locale: 'en_CA',
    url: 'https://bankdemark.com',
    siteName: 'BankDeMark',
    title: 'BankDeMark | Financial Intelligence Platform',
    description: 'Premium financial intelligence. Calculate, plan, and optimize your financial life.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BankDeMark | Financial Intelligence Platform',
    description: 'Premium financial intelligence. Calculate, plan, and optimize your financial life.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
        <meta name="theme-color" content="#080C14" />
      </head>
      <body>{children}</body>
    </html>
  );
}
