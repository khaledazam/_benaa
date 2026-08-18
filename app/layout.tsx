/**
 * Root layout: fonts, metadata (SEO), and providers (Query, Auth, Theme, Toaster).
 * Wraps all pages; force-dynamic so useSearchParams and server session work correctly.
 */
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeyboardShortcutsProvider } from "@/components/providers/KeyboardShortcutsProvider";
import { Poppins } from "next/font/google";
import localFont from "next/font/local";
import React from "react";
import { AuthProvider, LanguageProvider } from "@/contexts";
import { ShellSsrProvider } from "@/contexts/shell-ssr-context";
import { getSession } from "@/lib/auth-server";
import { mapSessionToAppUser } from "@/lib/auth/map-session-user";
import { getShellNotificationsForUser } from "@/lib/server/notifications-data";
import { QueryProvider } from "@/lib/react-query";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { AuthSessionToasts } from "@/components/shared/AuthSessionToasts";
import { SuppressApiErrorOverlay } from "@/components/shared/SuppressApiErrorOverlay";
import { RouteWarmPrefetch } from "@/components/providers/RouteWarmPrefetch";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
});

/** Force dynamic rendering for all routes so useSearchParams etc. work without Suspense and pages render instantly. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: {
    default: "Benaa — Construction Materials & Modern Decoration Warehouse Management System",
    template: "%s | Benaa",
  },
  description:
    "Benaa is a professional warehouse management system for construction materials and decoration suppliers. Manage products, categories, suppliers, purchase orders, invoices, and multi-warehouse stock with full auditability. Role-based access for administrators, warehouse managers, storekeepers, and purchasing officers.",
  applicationName: "Benaa",
  keywords: [
    "warehouse management",
    "inventory management",
    "construction materials",
    "building materials",
    "decoration warehouse",
    "stock management",
    "tiles",
    "paints",
    "sanitary ware",
    "purchase orders",
    "stock movement",
    "multi-warehouse",
  ],
  icons: {
    icon: "/favicon.ico",
    apple: "/favicon.ico",
    other: [{ rel: "icon", url: "/favicon.ico" }],
  },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "Benaa — Construction Materials & Modern Decoration Warehouse Management System",
    description:
      "Professional warehouse management system for construction materials and decoration suppliers. Manage stock, purchase orders, and multi-warehouse inventory with full auditability.",
    siteName: "Benaa",
    images: [
      {
        url: "/favicon.ico",
        width: 32,
        height: 32,
        alt: "BuildStock — Warehouse Management System",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BuildStock — Construction Materials & Modern Decoration Warehouse Management System",
    description:
      "Professional warehouse management system for construction materials and decoration suppliers.",
    images: ["/favicon.ico"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

/** Optional: set NEXT_PUBLIC_DISABLE_BROWSER_TRANSLATE=true on Vercel prod only (blocks Chrome Translate). */
const disableBrowserTranslate =
  process.env.NEXT_PUBLIC_DISABLE_BROWSER_TRANSLATE === "true";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  const initialUser = session ? mapSessionToAppUser(session) : null;
  const shellNotifications = session
    ? await getShellNotificationsForUser(session.id)
    : null;

  return (
    <html
      lang="en"
      {...(disableBrowserTranslate ? { translate: "no" as const } : {})}
      suppressHydrationWarning
      style={{ overscrollBehavior: "none" }}
      data-scroll-behavior="smooth"
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${poppins.variable} antialiased`}
        suppressHydrationWarning
        style={{ overscrollBehavior: "none" }}
      >
        <ErrorBoundary>
          <QueryProvider>
            <AuthProvider initialUser={initialUser}>
              <LanguageProvider>
                <ShellSsrProvider
                  value={
                    shellNotifications ?? {
                      initialNotifications: undefined,
                      initialUnreadCount: undefined,
                    }
                  }
                >
                <RouteWarmPrefetch />
                <SuppressApiErrorOverlay />
                <ThemeProvider
                  attribute="class"
                  defaultTheme="system"
                  enableSystem
                  disableTransitionOnChange
                >
                  <TooltipProvider delayDuration={200}>
                    <KeyboardShortcutsProvider>
                      {children}
                    </KeyboardShortcutsProvider>
                  </TooltipProvider>
                </ThemeProvider>
                {/* Toaster must mount before AuthSessionToasts so useToast listeners exist when deferred toasts fire */}
                <Toaster />
                <AuthSessionToasts />
                </ShellSsrProvider>
              </LanguageProvider>
            </AuthProvider>
          </QueryProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
