'use client';

import React from 'react';
import { Pricing } from '@/components/Pricing';
import { Check, Minus, Question, CaretDown } from '@phosphor-icons/react';
import { useTranslation } from '@/lib/i18n';
import { Container } from '@/components/ui/container';

type CellValue = string | boolean;

interface ComparisonRow {
    feature: string;
    free: CellValue;
    subsidized: CellValue;
    partner: CellValue;
}

const COMPARISON_CONTENT: Record<'id' | 'en', { title: string; rows: ComparisonRow[] }> = {
    id: {
        title: 'Perbandingan Lengkap Fitur Paket',
        rows: [
            { feature: 'Batas Sub-Bot Aktif', free: '2 Sub-Bot', subsidized: '5 Sub-Bot', partner: '12 Sub-Bot' },
            { feature: 'Batas Whitelist Grup', free: '5 Grup', subsidized: '10 Grup', partner: '25 Grup' },
            {
                feature: 'Kustomisasi Prefix Bot',
                free: 'Terkunci (.)',
                subsidized: 'Bebas per sub-bot',
                partner: 'Bebas per sub-bot'
            },
            { feature: 'Bonus Multiplier Ekonomi', free: '1.0x', subsidized: '1.05x', partner: '1.15x' },
            {
                feature: 'Prioritas Antrean Perintah',
                free: 'Standar',
                subsidized: 'Tinggi',
                partner: 'Prioritas Utama'
            },
            { feature: 'Early Access Fitur Baru', free: false, subsidized: false, partner: true },
            { feature: 'Direct Partner VIP Support', free: false, subsidized: false, partner: true },
            {
                feature: 'Metode Pembayaran',
                free: 'Gratis',
                subsidized: 'QRIS / Bank Transfer',
                partner: 'QRIS / Bank Transfer'
            }
        ]
    },
    en: {
        title: 'Complete Plan Feature Comparison',
        rows: [
            { feature: 'Active Sub-Bot Limit', free: '2 Sub-Bots', subsidized: '5 Sub-Bots', partner: '12 Sub-Bots' },
            { feature: 'Group Whitelist Limit', free: '5 Groups', subsidized: '10 Groups', partner: '25 Groups' },
            {
                feature: 'Bot Prefix Customization',
                free: 'Locked (.)',
                subsidized: 'Custom per sub-bot',
                partner: 'Custom per sub-bot'
            },
            { feature: 'Economy Bonus Multiplier', free: '1.0x', subsidized: '1.05x', partner: '1.15x' },
            { feature: 'Command Queue Priority', free: 'Standard', subsidized: 'High', partner: 'Top Priority' },
            { feature: 'Early Access to New Features', free: false, subsidized: false, partner: true },
            { feature: 'Direct Partner VIP Support', free: false, subsidized: false, partner: true },
            {
                feature: 'Payment Method',
                free: 'Free',
                subsidized: 'QRIS / Bank Transfer',
                partner: 'QRIS / Bank Transfer'
            }
        ]
    }
};

const FAQ_CONTENT: Record<'id' | 'en', { title: string; subtitle: string; items: { q: string; a: string }[] }> = {
    id: {
        title: 'Pertanyaan yang Sering Diajukan (FAQ)',
        subtitle: 'Informasi transparan mengenai pemesanan, pembayaran manual, dan keamanan sub-bot.',
        items: [
            {
                q: 'Bagaimana cara pembayaran paket berbayar?',
                a: 'Cosmos menggunakan alur direct manual sales. Ketika Anda mengklik "Pilih Subsidized" atau "Pilih Partner", Anda akan langsung diarahkan ke chat WhatsApp Sales Representative dengan pesan pra-isi yang menyertakan referensi pesanan unik. Tim sales akan mengirimkan QRIS atau rekening bank untuk pembayaran instan.'
            },
            {
                q: 'Berapa lama proses aktivasi setelah pembayaran dikonfirmasi?',
                a: 'Aktivasi dilakukan secara instan oleh admin atau bot sales melalui perintah terenkripsi (.sub add). Paket dan kuota baru akan langsung aktif dan bertambah di dashboard akun Anda dalam hitungan detik.'
            },
            {
                q: 'Apakah akun saya bisa di-banned WhatsApp jika menggunakan sub-bot?',
                a: 'Cosmos menggunakan engine Baileys multi-device resmi yang mengemulasikan WhatsApp Web asli, dipadukan dengan flow Inverted Verification di mana pesan awal selalu diprakarsai oleh pengguna. Ini mencegah deteksi bot dan menjaga nomor Anda tetap aman.'
            },
            {
                q: 'Apa yang terjadi jika masa aktif langganan habis?',
                a: 'Terdapat masa tenggang (grace period) dan pengingat otomatis via WhatsApp 3 hari sebelum berakhir. Jika tidak diperpanjang, akun akan kembali ke kuota paket Free secara bertahap tanpa kehilangan data profil utama.'
            }
        ]
    },
    en: {
        title: 'Frequently Asked Questions (FAQ)',
        subtitle: 'Transparent information about ordering, manual payments, and sub-bot security.',
        items: [
            {
                q: 'How do I pay for a paid plan?',
                a: 'Cosmos uses a direct manual sales flow. When you click "Choose Subsidized" or "Choose Partner", you are redirected to a WhatsApp chat with our Sales Representative carrying a pre-filled message with a unique order reference. The sales team will send QRIS or bank account details for instant payment.'
            },
            {
                q: 'How long does activation take after payment confirmation?',
                a: 'Activation is performed instantly by an admin or sales bot via an encrypted command (.sub add). Your new plan and quotas appear in your account dashboard within seconds.'
            },
            {
                q: 'Can my account get banned by WhatsApp when using a sub-bot?',
                a: 'Cosmos uses the official multi-device Baileys engine that emulates genuine WhatsApp Web, combined with the Inverted Verification flow where the first message is always initiated by you. This prevents bot detection and keeps your number safe.'
            },
            {
                q: 'What happens when my subscription expires?',
                a: 'There is a grace period with automatic WhatsApp reminders 3 days before expiry. If not renewed, your account gradually returns to Free plan quotas without losing core profile data.'
            }
        ]
    }
};

const TABLE_HEADERS: Record<'id' | 'en', { feature: string; free: string; subsidized: string; partner: string }> = {
    id: { feature: 'Fitur', free: 'Free', subsidized: 'Subsidized', partner: 'Partner' },
    en: { feature: 'Feature', free: 'Free', subsidized: 'Subsidized', partner: 'Partner' }
};

export default function PricingPage() {
    const { language } = useTranslation();
    const comparisonRows = COMPARISON_CONTENT[language].rows;
    const comparisonTitle = COMPARISON_CONTENT[language].title;
    const headers = TABLE_HEADERS[language];
    const faqs = FAQ_CONTENT[language];

    const faqSchema = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.items.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: {
                '@type': 'Answer',
                text: item.a
            }
        }))
    };

    return (
        <div className="flex flex-col w-full">
            {/* FAQ Schema */}
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />

            {/* Pricing Header & Cards */}
            <Pricing />

            {/* Comparison Table Section */}
            <section className="border-t border-border py-16 bg-muted/10">
                <Container size="lg" className="space-y-8">
                    <div className="text-center max-w-2xl mx-auto space-y-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary">Feature Matrix</span>
                        <h3 className="text-2xl sm:text-3xl font-extrabold font-heading text-foreground">
                            {comparisonTitle}
                        </h3>
                    </div>

                    <div className="relative rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-separate border-spacing-0 text-xs sm:text-sm min-w-[580px]">
                                <thead>
                                    <tr className="bg-muted">
                                        <th
                                            scope="col"
                                            className="px-4 py-3.5 sm:px-6 sm:py-4 font-bold text-foreground sticky left-0 bg-muted border-b border-r border-border z-20 min-w-[200px] sm:min-w-[240px] shadow-[4px_0_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)] [transform:translateZ(0)]"
                                        >
                                            {headers.feature}
                                        </th>
                                        <th
                                            scope="col"
                                            className="px-4 py-3.5 sm:px-6 sm:py-4 font-bold text-foreground text-center border-b border-border min-w-[110px] sm:min-w-[130px]"
                                        >
                                            {headers.free}
                                        </th>
                                        <th
                                            scope="col"
                                            className="px-4 py-3.5 sm:px-6 sm:py-4 font-bold text-primary text-center bg-primary/10 border-b border-x border-primary/25 min-w-[120px] sm:min-w-[140px]"
                                        >
                                            <div className="flex flex-col items-center gap-0.5">
                                                <span>{headers.subsidized}</span>
                                                <span className="text-[10px] font-normal uppercase tracking-wider text-primary font-mono">
                                                    Popular
                                                </span>
                                            </div>
                                        </th>
                                        <th
                                            scope="col"
                                            className="px-4 py-3.5 sm:px-6 sm:py-4 font-bold text-foreground text-center border-b border-border min-w-[110px] sm:min-w-[130px]"
                                        >
                                            {headers.partner}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {comparisonRows.map((row, idx) => {
                                        const isLast = idx === comparisonRows.length - 1;
                                        const borderBottom = isLast ? '' : 'border-b border-border';
                                        return (
                                            <tr
                                                key={idx}
                                                className="group transition-colors bg-card hover:bg-muted/40"
                                            >
                                                <td
                                                    className={`px-4 py-3.5 sm:px-6 sm:py-4 font-medium text-foreground sticky left-0 bg-card group-hover:bg-muted transition-colors border-r border-border z-10 min-w-[200px] sm:min-w-[240px] shadow-[4px_0_8px_-2px_rgba(0,0,0,0.06)] dark:shadow-[4px_0_8px_-2px_rgba(0,0,0,0.3)] [transform:translateZ(0)] ${borderBottom}`}
                                                >
                                                    {row.feature}
                                                </td>
                                                <td className={`px-4 py-3.5 sm:px-6 sm:py-4 text-center text-muted-foreground ${borderBottom}`}>
                                                    {typeof row.free === 'boolean' ? (
                                                        row.free ? (
                                                            <Check
                                                                className="w-4 h-4 text-emerald-500 mx-auto"
                                                                weight="bold"
                                                            />
                                                        ) : (
                                                            <Minus className="w-4 h-4 text-muted-foreground/60 mx-auto" />
                                                        )
                                                    ) : (
                                                        row.free
                                                    )}
                                                </td>
                                                <td className={`px-4 py-3.5 sm:px-6 sm:py-4 text-center font-medium text-foreground bg-primary/[0.04] border-x border-primary/20 group-hover:bg-primary/[0.08] transition-colors ${borderBottom}`}>
                                                    {typeof row.subsidized === 'boolean' ? (
                                                        row.subsidized ? (
                                                            <Check
                                                                className="w-4 h-4 text-emerald-500 mx-auto"
                                                                weight="bold"
                                                            />
                                                        ) : (
                                                            <Minus className="w-4 h-4 text-muted-foreground/60 mx-auto" />
                                                        )
                                                    ) : (
                                                        row.subsidized
                                                    )}
                                                </td>
                                                <td className={`px-4 py-3.5 sm:px-6 sm:py-4 text-center font-medium text-foreground ${borderBottom}`}>
                                                    {typeof row.partner === 'boolean' ? (
                                                        row.partner ? (
                                                            <Check
                                                                className="w-4 h-4 text-emerald-500 mx-auto"
                                                                weight="bold"
                                                            />
                                                        ) : (
                                                            <Minus className="w-4 h-4 text-muted-foreground/60 mx-auto" />
                                                        )
                                                    ) : (
                                                        row.partner
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </Container>
            </section>

            {/* FAQ Accordion Section */}
            <section className="py-16 border-t border-border">
                <Container size="md" className="space-y-8">
                    <div className="text-center space-y-2">
                        <div className="inline-flex p-2 rounded-xl bg-primary/10 text-primary">
                            <Question className="w-5 h-5" weight="bold" />
                        </div>
                        <h3 className="text-2xl sm:text-3xl font-extrabold font-heading text-foreground">
                            {faqs.title}
                        </h3>
                        <p className="text-xs sm:text-sm text-muted-foreground">{faqs.subtitle}</p>
                    </div>

                    <div className="space-y-3 pt-2">
                        {faqs.items.map((faq, idx) => (
                            <details
                                key={idx}
                                className="group rounded-2xl border border-border bg-card p-4 transition-all duration-200 open:shadow-xs open:border-primary/40"
                            >
                                <summary className="flex items-center justify-between cursor-pointer list-none font-bold text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg py-1">
                                    <span>{faq.q}</span>
                                    <CaretDown className="w-4 h-4 text-muted-foreground group-open:rotate-180 transition-transform duration-200 shrink-0 ml-2" />
                                </summary>
                                <div className="pt-3 text-xs text-muted-foreground leading-relaxed border-t border-border/50 mt-3">
                                    {faq.a}
                                </div>
                            </details>
                        ))}
                    </div>
                </Container>
            </section>
        </div>
    );
}
