import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const alt = 'Cosmos — WhatsApp Multi-Device & Sub-Bot Platform';
export const size = {
    width: 1200,
    height: 630
};
export const contentType = 'image/png';

export default async function Image() {
    return new ImageResponse(
        <div
            style={{
                background: 'linear-gradient(135deg, #0A0F0D 0%, #111815 50%, #064E3B 100%)',
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: '80px',
                fontFamily: 'sans-serif'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <div
                    style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '18px',
                        background: '#10B981',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#022C22',
                        fontSize: '32px',
                        fontWeight: 'bold'
                    }}
                >
                    C
                </div>
                <span style={{ fontSize: '40px', fontWeight: '900', color: '#ffffff', letterSpacing: '-1px' }}>
                    Cosmos
                </span>
                <span
                    style={{
                        marginLeft: '16px',
                        padding: '6px 14px',
                        borderRadius: '9999px',
                        background: 'rgba(16, 185, 129, 0.2)',
                        color: '#34D399',
                        fontSize: '18px',
                        fontWeight: '600',
                        border: '1px solid rgba(16, 185, 129, 0.4)'
                    }}
                >
                    Multi-Device Sub-Bot Platform
                </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '900px' }}>
                <h1
                    style={{
                        fontSize: '56px',
                        fontWeight: '900',
                        color: '#ffffff',
                        lineHeight: 1.15,
                        margin: 0,
                        letterSpacing: '-1px'
                    }}
                >
                    Autonomous WhatsApp Bots for Teams & Communities
                </h1>
                <p style={{ fontSize: '24px', color: '#9CA3AF', margin: 0, lineHeight: 1.4 }}>
                    Multi-device sub-bots, anti-banned inverted verification, group whitelisting, and virtual banking.
                </p>
            </div>

            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '32px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                    width: '100%',
                    paddingTop: '32px',
                    fontSize: '18px',
                    color: '#6EE7B7',
                    fontWeight: '600'
                }}
            >
                <span>• Baileys Multi-Device</span>
                <span>• Anti-Banned Inverted Verify</span>
                <span>• Cloudflare Ingress</span>
                <span>• 2 Sub-Bots Free</span>
            </div>
        </div>,
        {
            ...size
        }
    );
}
