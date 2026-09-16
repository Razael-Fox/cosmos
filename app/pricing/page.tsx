'use client';

import React from 'react';
import { Pricing } from '@/components/Pricing';
import { Check, Minus, Question } from '@phosphor-icons/react';

export default function PricingPage() {

  const comparisonRows = [
    { feature: 'Batas Sub-Bot Aktif', free: '2 Sub-Bot', subsidized: '5 Sub-Bot', partner: '12 Sub-Bot' },
    { feature: 'Batas Whitelist Grup', free: '5 Grup', subsidized: '10 Grup', partner: '25 Grup' },
    { feature: 'Kustomisasi Prefix Bot', free: 'Terkunci (.)', subsidized: 'Bebas per sub-bot', partner: 'Bebas per sub-bot' },
    { feature: 'Bonus Multiplier Ekonomi', free: '1.0x', subsidized: '1.05x', partner: '1.15x' },
    { feature: 'Prioritas Antrean Perintah', free: 'Standar', subsidized: 'Tinggi', partner: 'Prioritas Utama' },
    { feature: 'Early Access Fitur Baru', free: false, subsidized: false, partner: true },
    { feature: 'Direct Partner VIP Support', free: false, subsidized: false, partner: true },
    { feature: 'Metode Pembayaran', free: 'Gratis', subsidized: 'QRIS / Bank Transfer', partner: 'QRIS / Bank Transfer' },
  ];

  const faqs = [
    {
      q: 'Bagaimana cara pembayaran paket berbayar?',
      a: 'Cosmos menggunakan alur direct manual sales. Ketika Anda mengklik "Pilih Subsidized" atau "Pilih Partner", Anda akan langsung diarahkan ke chat WhatsApp Sales Representative dengan pesan pra-isi yang menyertakan referensi pesanan unik. Tim sales akan mengirimkan QRIS atau rekening bank untuk pembayaran instan.',
    },
    {
      q: 'Berapa lama proses aktivasi setelah pembayaran dikonfirmasi?',
      a: 'Aktivasi dilakukan secara instan oleh admin atau bot sales melalui perintah terenkripsi (.sub add). Paket dan kuota baru akan langsung aktif dan bertambah di dashboard akun Anda dalam hitungan detik.',
    },
    {
      q: 'Apakah akun saya bisa di-banned WhatsApp jika menggunakan sub-bot?',
      a: 'Cosmos menggunakan engine Baileys multi-device resmi yang mengemulasikan WhatsApp Web asli, dipadukan dengan flow Inverted Verification di mana pesan awal selalu diprakarsai oleh pengguna. Ini mencegah deteksi bot dan menjaga nomor Anda tetap aman.',
    },
    {
      q: 'Apa yang terjadi jika masa aktif langganan habis?',
      a: 'Terdapat masa tenggang (grace period) dan pengingat otomatis via WhatsApp 3 hari sebelum berakhir. Jika tidak diperpanjang, akun akan kembali ke kuota paket Free secara bertahap tanpa kehilangan data profil utama.',
    },
  ];

  return (
    <div className="flex flex-col w-full py-8">
      <Pricing />

      {/* Comparison Table Section */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-12 border-t border-border">
        <h3 className="text-2xl font-bold font-heading text-center mb-8 text-foreground">
          Perbandingan Lengkap Fitur Paket
        </h3>

        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="p-4 font-semibold text-foreground">Fitur</th>
                <th className="p-4 font-semibold text-foreground text-center">Free</th>
                <th className="p-4 font-semibold text-foreground text-center bg-primary/5">Subsidized</th>
                <th className="p-4 font-semibold text-foreground text-center">Partner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comparisonRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-muted/20 transition-colors">
                  <td className="p-4 font-medium text-foreground">{row.feature}</td>
                  <td className="p-4 text-center text-muted-foreground">
                    {typeof row.free === 'boolean' ? (
                      row.free ? (
                        <Check className="w-5 h-5 text-emerald-600 mx-auto" weight="bold" />
                      ) : (
                        <Minus className="w-5 h-5 text-zinc-400 mx-auto" />
                      )
                    ) : (
                      row.free
                    )}
                  </td>
                  <td className="p-4 text-center font-medium text-foreground bg-primary/5">
                    {typeof row.subsidized === 'boolean' ? (
                      row.subsidized ? (
                        <Check className="w-5 h-5 text-emerald-600 mx-auto" weight="bold" />
                      ) : (
                        <Minus className="w-5 h-5 text-zinc-400 mx-auto" />
                      )
                    ) : (
                      row.subsidized
                    )}
                  </td>
                  <td className="p-4 text-center font-medium text-foreground">
                    {typeof row.partner === 'boolean' ? (
                      row.partner ? (
                        <Check className="w-5 h-5 text-emerald-600 mx-auto" weight="bold" />
                      ) : (
                        <Minus className="w-5 h-5 text-zinc-400 mx-auto" />
                      )
                    ) : (
                      row.partner
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-12 border-t border-border space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-2 rounded-full bg-primary/10 text-primary">
            <Question className="w-5 h-5" weight="bold" />
          </div>
          <h3 className="text-2xl font-bold font-heading text-foreground">
            Pertanyaan yang Sering Diajukan (FAQ)
          </h3>
          <p className="text-sm text-muted-foreground">
            Informasi transparan mengenai pemesanan, pembayaran manual, dan keamanan sub-bot.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
          {faqs.map((faq, idx) => (
            <div key={idx} className="p-6 rounded-2xl bg-card border border-border space-y-2">
              <h4 className="font-bold text-sm text-foreground">{faq.q}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
