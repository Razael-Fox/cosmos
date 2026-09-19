import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { config } from '../config.js';
import {
    generateOtpCode,
    generateSalt,
    hashOtp,
    tokenLookupHash,
    timingSafeStringCompare,
    generateInvertedToken,
    buildClickToChatUrl,
    hashPassword,
    verifyPassword
} from '../services/cryptoService.js';
import { verifyTurnstileToken } from '../services/turnstileService.js';
import { checkAndConsumeRateLimit } from '../services/rateLimiter.js';
import {
    sendOtpViaIpc,
    notifyLoginViaIpc,
    fetchProfilePictureViaIpc,
    fetchUserPresenceViaIpc
} from '../services/ipcClient.js';
import { getRestoredClientIp } from '../middleware/clientIp.js';
import { processDeviceValidation } from '../middleware/deviceValidation.js';
import { authenticateJwt } from '../middleware/authenticate.js';
import { serializeUser } from '../utils/userSerializer.js';
import { emitAuthStatus } from '../services/authEventBus.js';

export const authRoutes: FastPluginAsync = async (fastify) => {
    // POST /api/v1/auth/register-inverted
    fastify.post('/register-inverted', async (req, reply) => {
        const body = req.body as {
            phone?: string;
            username?: string;
            email?: string;
            password?: string;
            turnstileToken?: string;
        };

        if (!body.phone || typeof body.phone !== 'string') {
            return reply.status(400).send({ error: 'INVALID_PHONE', message: 'Phone number is required.' });
        }

        const cleanPhone = body.phone.replace(/\D/g, '');
        if (cleanPhone.length < 8) {
            return reply.status(400).send({ error: 'INVALID_PHONE', message: 'Phone number is too short.' });
        }

        const clientIp = getRestoredClientIp(req);

        // Verify Cloudflare Turnstile token
        const turnstileValid = await verifyTurnstileToken(body.turnstileToken || '', clientIp);
        if (!turnstileValid) {
            return reply.status(403).send({
                error: 'INVALID_TURNSTILE_TOKEN',
                message: 'Cloudflare Turnstile token validation failed.'
            });
        }

        // Apply throttling
        const rateLimit = checkAndConsumeRateLimit(cleanPhone, clientIp);
        if (!rateLimit.allowed) {
            return reply.status(429).send({
                error: 'TOO_MANY_REQUESTS',
                message: rateLimit.reason,
                retryAfter: rateLimit.retryAfter
            });
        }

        const canonicalJid = `${cleanPhone}@s.whatsapp.net`;
        const existingUser = await prisma.user.findUnique({ where: { id: canonicalJid } }).catch(() => null);
        if (existingUser?.isWhitelisted) {
            return reply.status(400).send({
                error: 'ALREADY_WHITELISTED',
                message: 'This account is already registered and whitelisted. Please login directly.'
            });
        }

        let passwordHash: string | null = null;
        if (body.password && typeof body.password === 'string' && body.password.length >= 6) {
            passwordHash = hashPassword(body.password);
        }

        const token = generateInvertedToken(cleanPhone);
        const salt = generateSalt();
        const regSessionId = crypto.randomBytes(24).toString('hex');
        const codeHash = hashOtp(token, salt);
        const lookupHash = tokenLookupHash(token);
        const expiresIn = 30 * 60; // 30 minutes in seconds
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        const metadata = {
            username: body.username?.trim() || null,
            email: body.email?.trim() || null,
            passwordHash
        };

        await prisma.otpVerification.create({
            data: {
                phoneNumber: cleanPhone,
                userJid: null,
                codeHash,
                salt,
                lookupHash,
                metadata: JSON.stringify(metadata),
                regSessionId,
                purpose: 'INVERTED_REGISTRATION',
                maxAttempts: 3,
                expiresAt
            }
        });

        const clickToChatUrl = buildClickToChatUrl(config.BOT_PHONE_NUMBER, token);

        return reply.send({
            token,
            clickToChatUrl,
            regSessionId,
            expiresIn
        });
    });

    // POST /api/v1/auth/register-direct
    fastify.post('/register-direct', async (req, reply) => {
        const body = req.body as {
            phone?: string;
            username?: string;
            email?: string;
            password?: string;
            turnstileToken?: string;
        };

        if (!body.phone || typeof body.phone !== 'string') {
            return reply.status(400).send({ error: 'INVALID_PHONE', message: 'Phone number is required.' });
        }

        const cleanPhone = body.phone.replace(/\D/g, '');
        if (cleanPhone.length < 8) {
            return reply.status(400).send({ error: 'INVALID_PHONE', message: 'Phone number is too short.' });
        }

        const clientIp = getRestoredClientIp(req);

        // Mandatory Turnstile validation — 403 on failure, zero bot messages sent
        const turnstileValid = await verifyTurnstileToken(body.turnstileToken || '', clientIp);
        if (!turnstileValid) {
            return reply.status(403).send({
                error: 'INVALID_TURNSTILE_TOKEN',
                message: 'Cloudflare Turnstile token validation failed.'
            });
        }

        // Apply throttling
        const rateLimit = checkAndConsumeRateLimit(cleanPhone, clientIp);
        if (!rateLimit.allowed) {
            return reply.status(429).send({
                error: 'TOO_MANY_REQUESTS',
                message: rateLimit.reason,
                retryAfter: rateLimit.retryAfter
            });
        }

        const canonicalJid = `${cleanPhone}@s.whatsapp.net`;
        const existingUser = await prisma.user.findUnique({ where: { id: canonicalJid } }).catch(() => null);
        if (existingUser?.isWhitelisted) {
            return reply.status(400).send({
                error: 'ALREADY_WHITELISTED',
                message: 'This account is already registered and whitelisted. Please login directly.'
            });
        }

        let passwordHash: string | null = null;
        if (body.password && typeof body.password === 'string' && body.password.length >= 6) {
            passwordHash = hashPassword(body.password);
        }

        const code = generateOtpCode();
        const salt = generateSalt();
        const codeHash = hashOtp(code, salt);
        const lookupHash = tokenLookupHash(code);
        const expiresIn = 5 * 60; // 5 minutes in seconds
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        const metadata = {
            username: body.username?.trim() || null,
            email: body.email?.trim() || null,
            passwordHash
        };

        await prisma.otpVerification.create({
            data: {
                phoneNumber: cleanPhone,
                userJid: null,
                codeHash,
                salt,
                lookupHash,
                metadata: JSON.stringify(metadata),
                purpose: 'REGISTRATION',
                maxAttempts: 3,
                expiresAt
            }
        });

        // Dispatch via IPC to WhatsApp Bot
        const ipcRes = await sendOtpViaIpc(canonicalJid, code);
        if (ipcRes.status !== 200) {
            return reply.status(503).send({
                error: 'BOT_OFFLINE',
                message: 'Cosmos Bot engine is currently offline or unreachable. Please try again later.'
            });
        }

        if (ipcRes.data?.discoveredUsername && !metadata.username) {
            metadata.username = ipcRes.data.discoveredUsername;
            await prisma.otpVerification
                .updateMany({
                    where: {
                        phoneNumber: cleanPhone,
                        purpose: 'REGISTRATION',
                        isUsed: false
                    },
                    data: {
                        metadata: JSON.stringify(metadata)
                    }
                })
                .catch(() => {});
        }

        return reply.send({
            expiresIn,
            message: 'OTP verification code has been dispatched to your WhatsApp.'
        });
    });

    // POST /api/v1/auth/verify-otp
    fastify.post('/verify-otp', async (req, reply) => {
        const body = req.body as {
            phone?: string;
            otp?: string;
        };

        if (!body.phone || !body.otp) {
            return reply.status(400).send({
                error: 'INVALID_PAYLOAD',
                message: 'Phone number and OTP code are required.'
            });
        }

        const cleanPhone = body.phone.replace(/\D/g, '');
        const record = await prisma.otpVerification.findFirst({
            where: {
                phoneNumber: cleanPhone,
                purpose: { in: ['REGISTRATION', 'DIRECT_REGISTRATION'] },
                isUsed: false
            },
            orderBy: { createdAt: 'desc' }
        });

        if (!record) {
            return reply.status(400).send({
                error: 'NOT_FOUND',
                message: 'No pending OTP verification was found for this phone number.'
            });
        }

        if (record.attempts >= record.maxAttempts) {
            return reply.status(403).send({
                error: 'LOCKED',
                message: 'Maximum OTP verification attempts exceeded. Please request a new OTP.'
            });
        }

        if (record.expiresAt.getTime() < Date.now()) {
            return reply.status(400).send({
                error: 'EXPIRED',
                message: 'OTP code has expired. Please request a new OTP.'
            });
        }

        const expected = hashOtp(body.otp.trim(), record.salt);
        const matches = timingSafeStringCompare(expected, record.codeHash);

        if (!matches) {
            await prisma.otpVerification.update({
                where: { id: record.id },
                data: { attempts: { increment: 1 } }
            });
            return reply.status(400).send({
                error: 'INVALID_OTP',
                message: 'Invalid verification code.'
            });
        }

        // Mark OTP as used
        await prisma.otpVerification.update({
            where: { id: record.id },
            data: { isUsed: true }
        });

        const canonicalJid = `${cleanPhone}@s.whatsapp.net`;
        let meta: { username?: string; email?: string; passwordHash?: string } = {};
        if (record.metadata) {
            try {
                meta = JSON.parse(record.metadata);
            } catch {
                meta = {};
            }
        }

        // Check if user already exists (e.g. from previous message or contact sync)
        const existingUser = await prisma.user.findUnique({ where: { id: canonicalJid } });
        let resolvedUsername = meta.username?.trim() || null;
        if (!resolvedUsername && existingUser?.pushName) {
            const collision = await prisma.user.findFirst({
                where: { username: existingUser.pushName, NOT: { id: canonicalJid } }
            });
            if (!collision) {
                resolvedUsername = existingUser.pushName;
            } else {
                resolvedUsername = `${existingUser.pushName}_${cleanPhone.slice(-4)}`;
            }
        }

        // Atomic user whitelisting and default FREE subscription setup
        const [user] = await prisma.$transaction([
            prisma.user.upsert({
                where: { id: canonicalJid },
                update: {
                    isWhitelisted: true,
                    ...(resolvedUsername ? { username: resolvedUsername } : {}),
                    ...(meta.email ? { email: meta.email } : {}),
                    ...(meta.passwordHash ? { passwordHash: meta.passwordHash } : {})
                },
                create: {
                    id: canonicalJid,
                    username: resolvedUsername,
                    pushName: existingUser?.pushName ?? null,
                    email: meta.email ?? null,
                    passwordHash: meta.passwordHash ?? null,
                    isWhitelisted: true
                }
            }),
            prisma.subscription.upsert({
                where: { userId: canonicalJid },
                update: { status: 'ACTIVE' },
                create: {
                    userId: canonicalJid,
                    tier: 'FREE',
                    status: 'ACTIVE',
                    maxSubBots: 2,
                    maxGroups: 5,
                    customPrefix: false
                }
            })
        ]);

        await processDeviceValidation(canonicalJid, req, 'VERIFY_OTP', true);

        const jwtToken = fastify.jwt.sign({ id: canonicalJid, phoneNumber: cleanPhone });

        return reply.send({
            jwtToken,
            user: serializeUser(user)
        });
    });

    // POST /api/v1/auth/resend-otp
    fastify.post('/resend-otp', async (req, reply) => {
        const body = req.body as {
            phone?: string;
            turnstileToken?: string;
        };

        if (!body.phone || typeof body.phone !== 'string') {
            return reply.status(400).send({ error: 'INVALID_PHONE', message: 'Phone number is required.' });
        }

        const cleanPhone = body.phone.replace(/\D/g, '');
        const clientIp = getRestoredClientIp(req);

        // Turnstile challenge
        const turnstileValid = await verifyTurnstileToken(body.turnstileToken || '', clientIp);
        if (!turnstileValid) {
            return reply.status(403).send({
                error: 'INVALID_TURNSTILE_TOKEN',
                message: 'Cloudflare Turnstile token validation failed.'
            });
        }

        // Rate limiting
        const rateLimit = checkAndConsumeRateLimit(cleanPhone, clientIp);
        if (!rateLimit.allowed) {
            return reply.status(429).send({
                error: 'TOO_MANY_REQUESTS',
                message: rateLimit.reason,
                retryAfter: rateLimit.retryAfter
            });
        }

        const canonicalJid = `${cleanPhone}@s.whatsapp.net`;
        // Invalidate older unused records
        await prisma.otpVerification.updateMany({
            where: {
                phoneNumber: cleanPhone,
                purpose: { in: ['REGISTRATION', 'DIRECT_REGISTRATION'] },
                isUsed: false
            },
            data: { isUsed: true }
        });

        const code = generateOtpCode();
        const salt = generateSalt();
        const codeHash = hashOtp(code, salt);
        const lookupHash = tokenLookupHash(code);
        const expiresIn = 5 * 60;
        const expiresAt = new Date(Date.now() + expiresIn * 1000);

        await prisma.otpVerification.create({
            data: {
                phoneNumber: cleanPhone,
                userJid: null,
                codeHash,
                salt,
                lookupHash,
                purpose: 'REGISTRATION',
                maxAttempts: 3,
                expiresAt
            }
        });

        const ipcRes = await sendOtpViaIpc(canonicalJid, code);
        if (ipcRes.status !== 200) {
            return reply.status(503).send({
                error: 'BOT_OFFLINE',
                message: 'Cosmos Bot engine is currently offline or unreachable.'
            });
        }

        return reply.send({
            expiresIn,
            message: 'New OTP dispatched successfully.'
        });
    });

    // POST /api/v1/auth/login
    fastify.post('/login', async (req, reply) => {
        const body = req.body as {
            identifier?: string;
            password?: string;
        };

        if (!body.identifier || !body.password) {
            return reply.status(400).send({
                error: 'INVALID_PAYLOAD',
                message: 'Identifier and password are required.'
            });
        }

        const trimmedIdentifier = body.identifier.trim();
        const cleanDigits = trimmedIdentifier.replace(/\D/g, '');
        const phoneJid = cleanDigits.length >= 8 ? `${cleanDigits}@s.whatsapp.net` : '';

        let user = await prisma.user.findFirst({
            where: {
                OR: [{ username: trimmedIdentifier }, ...(phoneJid ? [{ id: phoneJid }] : [])]
            }
        });

        if (!user || !user.isWhitelisted) {
            return reply.status(401).send({
                error: 'INVALID_CREDENTIALS',
                message: 'Invalid username/phone number or password.'
            });
        }

        if (!user.passwordHash) {
            return reply.status(401).send({
                error: 'PASSWORD_NOT_SET',
                message: 'No password has been configured for this account. Please verify via WhatsApp first.'
            });
        }

        const passwordOk = verifyPassword(body.password, user.passwordHash);
        if (!passwordOk) {
            return reply.status(401).send({
                error: 'INVALID_CREDENTIALS',
                message: 'Invalid username/phone number or password.'
            });
        }

        const clientIp = getRestoredClientIp(req);
        const deviceState = await processDeviceValidation(user.id, req, 'LOGIN', false);

        // Unknown device handling + security alert
        if (!deviceState.isTrusted) {
            const country = typeof req.headers['cf-ipcountry'] === 'string' ? req.headers['cf-ipcountry'] : null;
            const userAgent = req.headers['user-agent'] || null;
            await notifyLoginViaIpc({
                userJid: user.id,
                ipAddress: clientIp,
                country,
                userAgent,
                deviceType: null,
                isNewDevice: deviceState.isNewDevice
            }).catch((err) => {
                console.warn('[Auth] Failed to dispatch login security alert:', err);
            });
        }

        // Update login audit timestamp and IP
        await prisma.user.update({
            where: { id: user.id },
            data: {
                lastLoginIp: clientIp,
                lastLoginAt: new Date()
            }
        });

        // Self-heal: check if clean digits record has pushName
        if (!user.pushName || !user.username) {
            const cleanDigits = user.id.replace(/\D/g, '');
            if (cleanDigits && cleanDigits !== user.id) {
                const legacy = await prisma.user.findUnique({ where: { id: cleanDigits } }).catch(() => null);
                if (legacy?.pushName) {
                    const resolvedName = legacy.pushName;
                    const updated = await prisma.user
                        .update({
                            where: { id: user.id },
                            data: {
                                pushName: user.pushName || resolvedName,
                                ...(!user.username ? { username: resolvedName } : {})
                            }
                        })
                        .catch(() => null);
                    if (updated) user = updated;
                }
            }
        }

        const jwtToken = fastify.jwt.sign({ id: user.id });

        return reply.send({
            jwtToken,
            user: serializeUser(user)
        });
    });

    // GET /api/v1/auth/status
    fastify.get('/status', async (req, reply) => {
        const query = req.query as { session?: string };
        if (!query.session) {
            return reply.status(400).send({ error: 'INVALID_QUERY', message: 'Session ID is required.' });
        }

        const record = await prisma.otpVerification.findUnique({
            where: { regSessionId: query.session }
        });

        if (!record) {
            return reply.status(404).send({ status: 'FAILED', error: 'NOT_FOUND' });
        }

        if (record.isUsed) {
            const canonicalJid = record.userJid || `${record.phoneNumber}@s.whatsapp.net`;
            let user = await prisma.user.findUnique({ where: { id: canonicalJid } });
            if (user && user.isWhitelisted) {
                if (!user.pushName || !user.username) {
                    const cleanDigits = user.id.replace(/\D/g, '');
                    if (cleanDigits && cleanDigits !== user.id) {
                        const legacy = await prisma.user.findUnique({ where: { id: cleanDigits } }).catch(() => null);
                        if (legacy?.pushName) {
                            const resolvedName = legacy.pushName;
                            const updated = await prisma.user
                                .update({
                                    where: { id: user.id },
                                    data: {
                                        pushName: user.pushName || resolvedName,
                                        ...(!user.username ? { username: resolvedName } : {})
                                    }
                                })
                                .catch(() => null);
                            if (updated) user = updated;
                        }
                    }
                }
                await processDeviceValidation(user.id, req, 'VERIFY_INVERTED', true);
                const jwtToken = fastify.jwt.sign({ id: user.id, phoneNumber: record.phoneNumber });
                const serialized = serializeUser(user);
                emitAuthStatus(query.session, { status: 'VERIFIED', jwtToken, user: serialized });
                return reply.send({ status: 'VERIFIED', jwtToken, user: serialized });
            }
        }

        if (record.attempts >= record.maxAttempts) {
            emitAuthStatus(query.session, { status: 'FAILED', error: 'LOCKED' });
            return reply.send({ status: 'FAILED', error: 'LOCKED' });
        }

        if (record.expiresAt.getTime() < Date.now()) {
            emitAuthStatus(query.session, { status: 'EXPIRED' });
            return reply.send({ status: 'EXPIRED' });
        }

        return reply.send({ status: 'PENDING' });
    });

    // GET /api/v1/auth/me
    fastify.get('/me', { preHandler: [authenticateJwt] }, async (req, reply) => {
        let user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) {
            return reply.status(404).send({ error: 'USER_NOT_FOUND', message: 'User account not found.' });
        }
        if (!user.pushName || !user.username) {
            const cleanDigits = user.id.replace(/\D/g, '');
            if (cleanDigits && cleanDigits !== user.id) {
                const legacy = await prisma.user.findUnique({ where: { id: cleanDigits } }).catch(() => null);
                if (legacy?.pushName) {
                    const resolvedName = legacy.pushName;
                    const updated = await prisma.user
                        .update({
                            where: { id: user.id },
                            data: {
                                pushName: user.pushName || resolvedName,
                                ...(!user.username ? { username: resolvedName } : {})
                            }
                        })
                        .catch(() => null);
                    if (updated) user = updated;
                }
            }
        }

        let profilePictureUrl: string | null = null;
        try {
            profilePictureUrl = await fetchProfilePictureViaIpc(user.id);
        } catch {
            /* non-fatal */
        }

        let presence: 'online' | 'offline' = 'offline';
        try {
            const presRes = await fetchUserPresenceViaIpc(user.id);
            presence = presRes.presence;
        } catch {
            /* non-fatal */
        }

        return reply.send({ user: serializeUser(user, profilePictureUrl, presence) });
    });

    // GET /api/v1/auth/profile-photo
    fastify.get('/profile-photo', { preHandler: [authenticateJwt] }, async (req, reply) => {
        const pictureUrl = await fetchProfilePictureViaIpc(req.user.id);
        return reply.send({ pictureUrl });
    });

    // GET /api/v1/auth/presence
    fastify.get('/presence', { preHandler: [authenticateJwt] }, async (req, reply) => {
        const info = await fetchUserPresenceViaIpc(req.user.id);
        return reply.send(info);
    });
};

type FastPluginAsync = FastifyPluginAsync;
