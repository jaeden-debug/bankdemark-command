import type { Metadata } from "next";
import "./globals.css";
import PWAInstallPrompt from "@/components/command/PWAInstallPrompt";

export const metadata: Metadata = {
  metadataBase: new URL("https://command.bankdemark.com"),

  title: {
    default: "BankDeMark Command | AI Financial Command Center for Business",
    // Pages already carry the brand, so the template only appends it when
    // a page title does not. Absolute titles opt out entirely.
    template: "%s | BankDeMark Command",
  },

  description:
    "Track revenue, expenses, commissions, cash flow and business wealth in one AI-powered financial command center, with Zylx built in to explain your numbers.",

  applicationName: "Command",

  keywords: [
    "ai financial command center",
    "business financial dashboard",
    "small business finance software",
    "business expense tracking",
    "business revenue tracking",
    "cash flow dashboard",
    "ai financial assistant",
    "business financial reporting",
    "commission tracking software",
    "bankdemark command",
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
    title: "BankDeMark Command | AI Financial Command Center for Business",
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
    title: "BankDeMark Command | AI Financial Command Center for Business",
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
