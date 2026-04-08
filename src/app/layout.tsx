import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import BrandColorsProvider from "@/components/brand-colors-provider";
import { ConfigProvider } from "@/lib/config-context";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AAA Disaster Recovery — Platform",
  description: "Business management platform for AAA Disaster Recovery",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-background">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ConfigProvider>
            <BrandColorsProvider />
            <Sidebar />
            <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen">
              <div className="p-6 lg:p-8">{children}</div>
            </main>
            <Toaster />
          </ConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
