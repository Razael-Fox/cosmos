import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { getRestoredClientIp } from './clientIp.js';

export interface DeviceTrustState {
    deviceId: string;
    isTrusted: boolean;
    isNewDevice: boolean;
}

export async function processDeviceValidation(
    userId: string,
    req: FastifyRequest,
    action: string = 'ACCESS',
    defaultTrust: boolean = false
): Promise<DeviceTrustState> {
    const ipAddress = getRestoredClientIp(req);
    const rawCountry = req.headers['cf-ipcountry'];
    const country = typeof rawCountry === 'string' ? rawCountry : null;
    const userAgent = req.headers['user-agent'] || 'unknown';

    const deviceTokenHash = crypto.createHash('sha256').update(`${userId}:${userAgent}`).digest('hex');

    let isNewDevice = false;
    let device = await prisma.userDevice.findUnique({
        where: {
            userId_deviceTokenHash: {
                userId,
                deviceTokenHash
            }
        }
    });

    if (!device) {
        isNewDevice = true;
        device = await prisma.userDevice.create({
            data: {
                userId,
                deviceTokenHash,
                lastIpAddress: ipAddress,
                userAgent,
                country,
                isTrusted: defaultTrust
            }
        });
    } else {
        device = await prisma.userDevice.update({
            where: { id: device.id },
            data: {
                lastIpAddress: ipAddress,
                lastSeenAt: new Date(),
                ...(country ? { country } : {})
            }
        });
    }

    try {
        await prisma.userIpAccessLog.create({
            data: {
                userId,
                ipAddress,
                country,
                userAgent,
                action,
                status: device.isTrusted ? 'ALLOWED' : 'UNTRUSTED_DEVICE',
                details: JSON.stringify({ isNewDevice, deviceId: device.id })
            }
        });
    } catch (err) {
        console.error('[DeviceValidation] Failed to write access log:', err);
    }

    return {
        deviceId: device.id,
        isTrusted: device.isTrusted,
        isNewDevice
    };
}

export async function deviceValidationPreHandler(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const user = (req as FastifyRequest & { user?: { id: string } }).user;
    if (!user || !user.id) return;

    await processDeviceValidation(user.id, req, 'API_ACCESS', false);
}
