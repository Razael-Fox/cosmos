import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const tier = searchParams.get('tier') || 'SUBSIDIZED';
    const phone = searchParams.get('phone') || '[Nomor WhatsApp Anda]';
    const salesNumber = (process.env.NEXT_PUBLIC_SALES_NUMBER || '628123456789').replace(/\D/g, '');

    const price = tier === 'PARTNER' ? 'Rp32.000' : 'Rp10.000';
    const timestamp = Math.floor(Date.now() / 1000);
    const orderRef = `COSMOS-SUB-${timestamp}`;

    const message = `Halo Tim Sales Cosmos! Saya ingin berlangganan paket berbayar Cosmos.

Paket: ${tier} Tier
Harga: ${price} / bulan
Nomor Akun: ${phone}
Ref Order: ${orderRef}

Mohon kirimkan detail QRIS / rekening pembayaran.`;

    const salesUrl = `https://wa.me/${salesNumber}?text=${encodeURIComponent(message)}`;

    return NextResponse.json({
        salesUrl,
        orderRef
    });
}
