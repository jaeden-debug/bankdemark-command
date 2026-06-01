import type { Metadata } from "next";
import "./globals.css";
import PWAInstallPrompt from "@/components/command/PWAInstallPrompt";

export const metadata: Metadata = {
  metadataBase: new URL("https://command.bankdemark.com"),

  title: {
    default: "Command by BankDeMark | Your Financial Command Center",
    template: "%s | Command by BankDeMark",
  },

  description:
    "Plan. Track. Optimize. Grow. AI-powered wealth planning, debt elimination, financial health scoring, and smarter money decisions.",

  applicationName: "Command",

  keywords: [
    "financial dashboard",
    "personal finance app",
    "wealth tracker",
    "debt payoff planner",
    "financial health score",
    "ai financial coach",
    "wealth building",
    "budget planner",
    "financial intelligence platform",
    "command by bankdemark",
  ],

  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
    ],
    shortcut: ["/favicon.ico"],
  },

  openGraph: {
    type: "website",
    siteName: "Command by BankDeMark",
    title: "Command by BankDeMark | Your Financial Command Center",
    description:
      "Plan. Track. Optimize. Grow. AI-powered wealth planning, debt elimination, financial health scoring, and smarter money decisions.",
    url: "https://command.bankdemark.com",
    images: [
      {
        url: "/command-bankdemark-financial-intelligence-dashboard-og-image.png",
        width: 1200,
        height: 630,
        alt: "Command by BankDeMark Financial Dashboard",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "Command by BankDeMark | Your Financial Command Center",
    description:
      "Plan. Track. Optimize. Grow. AI-powered wealth planning, debt elimination, financial health scoring, and smarter money decisions.",
    images: [
      "/command-bankdemark-financial-intelligence-dashboard-og-image.png",
    ],
  },

  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <PWAInstallPrompt />
      </body>
    </html>
  );
}
