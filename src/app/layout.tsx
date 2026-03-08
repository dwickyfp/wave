import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import {
  ThemeProvider,
  ThemeStyleProvider,
} from "@/components/layouts/theme-provider";
import { Toaster } from "ui/sonner";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Emma AI",
  description:
    "Emma AI is a chatbot workspace that uses tools to answer questions.",
  icons: {
    icon: [
      { url: "/black-brain.svg", type: "image/svg+xml" },
      {
        url: "/black-brain-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/black-brain-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      { url: "/black-brain.ico", sizes: "any" },
    ],
    shortcut: [
      {
        url: "/black-brain-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
    ],
    apple: [{ url: "/brain-tab-apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          themes={["light", "dark"]}
          storageKey="app-theme-v2"
          disableTransitionOnChange
        >
          <ThemeStyleProvider>
            <NextIntlClientProvider>
              <div id="root">
                {children}
                <Toaster richColors />
              </div>
            </NextIntlClientProvider>
          </ThemeStyleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
