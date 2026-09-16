import type { Metadata } from "next";
import { Geist, Geist_Mono, DM_Sans, Nunito_Sans } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { LanguageProvider } from "@/lib/i18n";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

const nunitoSansHeading = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-heading",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cosmos — WhatsApp Multi-Device & Sub-Bot Platform",
  description:
    "Autonomous multi-device WhatsApp bot platform, group automations, tiered quotas, and secure Cloudflare tunnel architecture.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="id"
      className={cn(
        "h-full",
        "antialiased",
        geistSans.variable,
        geistMono.variable,
        "font-sans",
        dmSans.variable,
        nunitoSansHeading.variable
      )}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground selection:bg-primary/20">
        <LanguageProvider>
          <Navbar />
          <main className="flex-1 flex flex-col">{children}</main>
          <Footer />
        </LanguageProvider>
      </body>
    </html>
  );
}
