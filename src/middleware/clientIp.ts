import { FastifyRequest } from 'fastify';

function isLoopback(ip: string | undefined): boolean {
    if (!ip) return false;
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Restores the client IP strictly from the loopback tunnel.
 * If the connection is directly from non-loopback clients, client-supplied headers
 * like CF-Connecting-IP or X-Forwarded-For are untrusted and ignored.
 */
export function getRestoredClientIp(req: FastifyRequest): string {
    const directRemoteAddress = req.socket.remoteAddress;

    if (isLoopback(directRemoteAddress)) {
        const cfIp = req.headers['cf-connecting-ip'];
        if (typeof cfIp === 'string' && cfIp.trim()) {
            return cfIp.trim();
        }
        const xForwardedFor = req.headers['x-forwarded-for'];
        if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
            const first = xForwardedFor.split(',')[0].trim();
            if (first) return first;
        }
    }

    return directRemoteAddress || '127.0.0.1';
}
