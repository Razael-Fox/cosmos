import type { Metadata, Viewport } from 'next';
import { DM_Sans, Geist_Mono } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';
import { LanguageProvider } from '@/lib/i18n';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { FloatingBackButton } from '@/components/FloatingBackButton';

const dmSans = DM_Sans({
    subsets: ['latin'],
    variable: '--font-sans',
    display: 'swap'
});

const geistMono = Geist_Mono({
    subsets: ['latin'],
    variable: '--font-mono',
    display: 'swap'
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://cosmos.razaelfox.com';

export const metadata: Metadata = {
    metadataBase: new URL(siteUrl),
    title: {
        default: 'Cosmos — Autonomous WhatsApp Multi-Device & Sub-Bot Platform',
        template: '%s • Cosmos'
    },
    description:
        'Autonomous multi-device WhatsApp bot platform, group automations, tiered quotas, and secure Cloudflare tunnel architecture.',
    icons: {
        icon: [
            { url: '/favicon.ico', sizes: 'any' },
            { url: '/icon.png', type: 'image/png' }
        ],
        apple: [{ url: '/apple-icon.png' }]
    },
    openGraph: {
        type: 'website',
        title: 'Cosmos — Autonomous WhatsApp Multi-Device & Sub-Bot Platform',
        description:
            'Manage WhatsApp bot ecosystems, group automations, virtual banking, and autonomous multi-device sub-bots.',
        url: siteUrl,
        siteName: 'Cosmos'
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Cosmos — Autonomous WhatsApp Multi-Device & Sub-Bot Platform',
        description: 'Autonomous multi-device WhatsApp bot platform with secure verification and tiered quotas.',
        creator: '@razaelfox'
    },
    robots: {
        index: true,
        follow: true
    }
};

export const viewport: Viewport = {
    themeColor: [
        { media: '(prefers-color-scheme: light)', color: '#059669' },
        { media: '(prefers-color-scheme: dark)', color: '#0a0f0d' }
    ]
};

const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Cosmos',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Cloud, Web, WhatsApp',
    offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'IDR'
    },
    description:
        'Autonomous multi-device WhatsApp bot platform, group automations, tiered quotas, and secure Cloudflare tunnel architecture.',
    creator: {
        '@type': 'Person',
        name: 'RazaelFox'
    }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html
            lang="id"
            suppressHydrationWarning
            className={cn('h-full', 'antialiased', dmSans.variable, geistMono.variable)}
        >
            <head>
                <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
            </head>
            <body className="min-h-full flex flex-col bg-background text-foreground selection:bg-primary/20">
                <LanguageProvider>
                    <Navbar />
                    <FloatingBackButton />
                    <main className="flex-1 flex flex-col pb-20 md:pb-0">{children}</main>
                    <Footer />
                </LanguageProvider>
            </body>
        </html>
    );
}
