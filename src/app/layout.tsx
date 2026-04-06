import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/nav";
import { Toaster } from "@/components/ui/sonner";

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
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-[#F5F5F5]">
        <Sidebar />
        {/* Main content area offset by sidebar width */}
        <main className="lg:ml-64 pt-14 lg:pt-0 min-h-screen">
          <div className="p-6 lg:p-8">{children}</div>
        </main>
        <Toaster />
      </body>
    </html>
  );
}
