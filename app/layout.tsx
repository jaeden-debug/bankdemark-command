import type { Metadata } from "next";
import "./globals.css";
import PWAInstallPrompt from "@/components/command/PWAInstallPrompt";

export const metadata: Metadata = {
  metadataBase: new URL("https://command.bankdemark.com"),

  title: {
    default: "Command by BankDeMark",
    template: "%s | Command by BankDeMark",
  },

  description:
    "Plan. Track. Optimize. Grow. Command is the financial command center for wealth building, debt elimination, financial intelligence, and AI-powered money decisions.",

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
    title: "Command by BankDeMark",
    description:
      "Your Financial Command Center. AI-powered wealth planning, debt optimization, goal tracking, and financial intelligence.",
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
    title: "Command by BankDeMark",
    description:
      "Plan. Track. Optimize. Grow. The all-in-one financial command center.",
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
