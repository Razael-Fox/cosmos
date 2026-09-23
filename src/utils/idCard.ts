import { prisma } from '#db.js';
import { cleanId, lidToPnMap } from '#utils/casino.js';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { generateIdCardImage, DEFAULT_ID_CARD_PHOTO_URL, IdCardData } from '#utils/imageProcessing.js';
import { registerCancellableSession, unregisterCancellableSessionByUser } from '#utils/cancellationManager.js';
import { getTranslator } from '#utils/i18n.js';

export interface RegistrationSession {
    userKey: string;
    remoteJid: string;
    step: number;
    data: Partial<IdCardData>;
    lastActivity: number;
}

// In-memory registration sessions mapped by normalized user ID
const registrationSessions = new Map<string, RegistrationSession>();
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout

const MONTH_MAP: Record<string, number> = {
    januari: 1,
    jan: 1,
    january: 1,
    februari: 2,
    feb: 2,
    february: 2,
    maret: 3,
    mar: 3,
    march: 3,
    april: 4,
    apr: 4,
    mei: 5,
    may: 5,
    juni: 6,
    jun: 6,
    june: 6,
    juli: 7,
    jul: 7,
    july: 7,
    agustus: 8,
    ags: 8,
    agu: 8,
    aug: 8,
    august: 8,
    september: 9,
    sep: 9,
    sept: 9,
    oktober: 10,
    okt: 10,
    oct: 10,
    october: 10,
    november: 11,
    nov: 11,
    desember: 12,
    des: 12,
    dec: 12,
    december: 12
};

export interface ParsedBirthDate {
    day: number;
    month: number;
    year: number;
    formattedDob: string;
}

function isValidDate(day: number, month: number, year: number): boolean {
    const currentYear = new Date().getFullYear();
    if (year < 1900 || year > currentYear) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    const daysInMonth = new Date(year, month, 0).getDate();
    return day <= daysInMonth;
}

export function parseBirthDate(dateStr: string): ParsedBirthDate | null {
    if (!dateStr) return null;
    const trimmed = dateStr.trim();

    // Pattern 1: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD
    const numMatch = trimmed.match(/\b(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (numMatch) {
        let day: number;
        let month: number;
        let year: number;

        if (numMatch[1].length === 4) {
            year = parseInt(numMatch[1], 10);
            month = parseInt(numMatch[2], 10);
            day = parseInt(numMatch[3], 10);
        } else {
            day = parseInt(numMatch[1], 10);
            month = parseInt(numMatch[2], 10);
            let rawYear = parseInt(numMatch[3], 10);
            if (rawYear < 100) {
                rawYear = rawYear > 30 ? 1900 + rawYear : 2000 + rawYear;
            }
            year = rawYear;
        }

        if (isValidDate(day, month, year)) {
            return {
                day,
                month,
                year,
                formattedDob: `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`
            };
        }
    }

    // Pattern 2: DD Month YYYY (e.g. 17 Agustus 1990)
    const textMonthMatch = trimmed.match(/\b(\d{1,2})\s+([a-zA-Z]+)\s+(\d{2,4})\b/);
    if (textMonthMatch) {
        const day = parseInt(textMonthMatch[1], 10);
        const monthName = textMonthMatch[2].toLowerCase();
        let rawYear = parseInt(textMonthMatch[3], 10);
        if (rawYear < 100) {
            rawYear = rawYear > 30 ? 1900 + rawYear : 2000 + rawYear;
        }
        const year = rawYear;
        const month = MONTH_MAP[monthName];

        if (month && isValidDate(day, month, year)) {
            return {
                day,
                month,
                year,
                formattedDob: `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`
            };
        }
    }

    // Pattern 3: Month DD, YYYY (e.g. August 17, 1990)
    const monthFirstMatch = trimmed.match(/\b([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{2,4})\b/);
    if (monthFirstMatch) {
        const monthName = monthFirstMatch[1].toLowerCase();
        const day = parseInt(monthFirstMatch[2], 10);
        let rawYear = parseInt(monthFirstMatch[3], 10);
        if (rawYear < 100) {
            rawYear = rawYear > 30 ? 1900 + rawYear : 2000 + rawYear;
        }
        const year = rawYear;
        const month = MONTH_MAP[monthName];

        if (month && isValidDate(day, month, year)) {
            return {
                day,
                month,
                year,
                formattedDob: `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`
            };
        }
    }

    // Pattern 4: Space-separated numbers (e.g. 17 08 1990)
    const spaceMatch = trimmed.match(/\b(\d{1,2})\s+(\d{1,2})\s+(\d{2,4})\b/);
    if (spaceMatch) {
        const day = parseInt(spaceMatch[1], 10);
        const month = parseInt(spaceMatch[2], 10);
        let rawYear = parseInt(spaceMatch[3], 10);
        if (rawYear < 100) {
            rawYear = rawYear > 30 ? 1900 + rawYear : 2000 + rawYear;
        }
        const year = rawYear;
        if (isValidDate(day, month, year)) {
            return {
                day,
                month,
                year,
                formattedDob: `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`
            };
        }
    }

    return null;
}

export function parseBirthPlaceAndDate(
    input: string
): { place: string; day: number; month: number; year: number; formattedDob: string } | null {
    if (!input || input.trim().length === 0) return null;
    const trimmed = input.trim();

    // Check comma separation
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx !== -1) {
        const rawPlace = trimmed.slice(0, commaIdx).trim();
        const rawDate = trimmed.slice(commaIdx + 1).trim();
        const parsedDate = parseBirthDate(rawDate);
        if (parsedDate) {
            return {
                place: rawPlace ? rawPlace.toUpperCase() : 'INDONESIA',
                ...parsedDate
            };
        }
    }

    // Direct date parsing from full input
    const parsedDate = parseBirthDate(trimmed);
    if (parsedDate) {
        const words = trimmed.split(/\s+/);
        const placeWords: string[] = [];
        for (const word of words) {
            if (/^[a-zA-Z]+$/.test(word) && !MONTH_MAP[word.toLowerCase()]) {
                placeWords.push(word);
            } else {
                break;
            }
        }
        const place = placeWords.length > 0 ? placeWords.join(' ').toUpperCase() : 'INDONESIA';
        return {
            place,
            ...parsedDate
        };
    }

    return null;
}

/**
 * Calculates user's age from their date of birth with exact month and day precision.
 */
export function calculateAge(dateOfBirthStr: string): number {
    const parsed = parseBirthDate(dateOfBirthStr);
    if (!parsed) return 0;

    const today = new Date();
    let age = today.getFullYear() - parsed.year;
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    if (currentMonth < parsed.month || (currentMonth === parsed.month && currentDay < parsed.day)) {
        age--;
    }
    return age;
}

function isSameChat(chatA?: string, chatB?: string): boolean {
    if (!chatA || !chatB) return true;
    if (chatA === chatB) return true;
    return cleanId(chatA) === cleanId(chatB);
}

function findRegistrationSession(userKey: string): RegistrationSession | undefined {
    const cleaned = cleanId(userKey);
    if (registrationSessions.has(cleaned)) {
        return registrationSessions.get(cleaned);
    }
    const mapped = lidToPnMap.get(cleaned);
    if (mapped && registrationSessions.has(mapped)) {
        return registrationSessions.get(mapped);
    }
    for (const [lid, pn] of lidToPnMap.entries()) {
        if (pn === cleaned && registrationSessions.has(lid)) {
            return registrationSessions.get(lid);
        }
    }
    return undefined;
}

/**
 * Checks whether a user is currently in the middle of a registration session.
 */
export function isUserRegistering(userKey: string, remoteJid?: string): boolean {
    const session = findRegistrationSession(userKey);
    if (!session) return false;
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT_MS) {
        registrationSessions.delete(session.userKey);
        return false;
    }
    if (remoteJid && !isSameChat(session.remoteJid, remoteJid)) {
        return false;
    }
    return true;
}

/**
 * Cancels an active registration session.
 */
export function cancelRegistrationSession(userKey: string, remoteJid?: string): boolean {
    const session = findRegistrationSession(userKey);
    if (!session) return false;
    if (remoteJid && !isSameChat(session.remoteJid, remoteJid)) {
        return false;
    }
    const chatJid = remoteJid || session.remoteJid;
    if (chatJid) {
        unregisterCancellableSessionByUser(session.userKey, chatJid);
    }
    return registrationSessions.delete(session.userKey);
}

/**
 * Starts a new registration session for a user.
 */
export function startRegistrationSession(
    userKey: string,
    remoteJid: string,
    t?: (key: string, args?: Record<string, any>) => string
): string {
    const tr = t || getTranslator('id');
    const cleaned = cleanId(userKey);
    registrationSessions.set(cleaned, {
        userKey: cleaned,
        remoteJid,
        step: 1,
        data: {},
        lastActivity: Date.now()
    });

    registerCancellableSession({
        sessionId: `idcard_${cleaned}`,
        feature: 'idcard',
        userJid: cleaned,
        chatJid: remoteJid,
        description: 'Virtual ID card registration',
        descriptionKey: 'utilities.idcard.registration_desc',
        onCancel: async () => {
            registrationSessions.delete(cleaned);
            return tr('utilities.idcard.cancelled');
        }
    });

    return tr('utilities.idcard.welcome');
}

/**
 * Retrieves the user's IdCard record if one exists.
 */
export async function getIdCardByUser(userJidOrLid: string) {
    if (!userJidOrLid) return null;
    const cleaned = cleanId(userJidOrLid);

    try {
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { id: userJidOrLid },
                    { id: cleaned },
                    { id: `${cleaned}@s.whatsapp.net` },
                    { lid: userJidOrLid },
                    { lid: cleaned },
                    { lid: `${cleaned}@lid` }
                ]
            },
            include: {
                idCard: true
            }
        });

        if (user && user.idCard) {
            return user.idCard;
        }

        // Direct lookup by userJid if not found via relation
        const direct = await prisma.idCard.findFirst({
            where: {
                OR: [{ userJid: userJidOrLid }, { userJid: cleaned }, { userJid: `${cleaned}@s.whatsapp.net` }]
            }
        });
        return direct;
    } catch (err) {
        console.error('[IdCard] Error fetching ID card:', err);
        return null;
    }
}

/**
 * Future Integration Hook: Requires the user to have a valid Virtual ID Card.
 * Gracefully rejects and returns an authorized flag and standard prompt message.
 */
export async function requireIdCard(userJidOrLid: string, t?: (key: string, args?: Record<string, any>) => string) {
    const idCard = await getIdCardByUser(userJidOrLid);
    const tr = t || getTranslator('id');
    if (!idCard) {
        return {
            authorized: false,
            idCard: null,
            message: tr('utilities.idcard.access_denied')
        };
    }
    return {
        authorized: true,
        idCard,
        message: null
    };
}

/**
 * Generates a standard Indonesian 16-digit NIK based on gender and date of birth.
 */
export async function generateNik(gender: string, dateOfBirthStr: string): Promise<string> {
    const provinceCityDistrict = '317101'; // Cosmos / Jakarta Province (31), Kota Utama (71), Sub-district (01)

    const normalizedGender = gender.trim().toUpperCase();
    const isFemale =
        normalizedGender === 'PEREMPUAN' ||
        normalizedGender === 'FEMALE' ||
        normalizedGender === 'WANITA' ||
        normalizedGender === 'F';

    const parsed = parseBirthDate(dateOfBirthStr);
    const day = parsed ? parsed.day : 1;
    const month = parsed ? parsed.month : 1;
    const year = parsed ? parsed.year : 1990;

    let nikDay = day;
    if (isFemale) {
        nikDay += 40;
    }

    const dayStr = String(nikDay).padStart(2, '0');
    const monthStr = String(month).padStart(2, '0');
    const yearStr = String(year).slice(-2);
    const dobPart = `${dayStr}${monthStr}${yearStr}`;

    // Ensure uniqueness of the 4-digit sequence
    for (let seq = 1; seq <= 9999; seq++) {
        const seqStr = String(seq).padStart(4, '0');
        const candidateNik = `${provinceCityDistrict}${dobPart}${seqStr}`;

        const existing = await prisma.idCard.findUnique({
            where: { nik: candidateNik }
        });

        if (!existing) {
            return candidateNik;
        }
    }

    // Fallback: random 4 digits with timestamp
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `${provinceCityDistrict}${dobPart}${randomSuffix}`;
}

/**
 * Saves a new Virtual ID Card to the database.
 */
export async function saveIdCard(data: {
    userJid: string;
    fullName: string;
    placeOfBirth: string;
    dateOfBirth: string;
    gender: string;
    bloodType?: string;
    address: string;
    rtRw?: string;
    village?: string;
    district?: string;
    city?: string;
    provinsi?: string;
    religion: string;
    maritalStatus: string;
    occupation: string;
    citizenship?: string;
    validUntil?: string;
}) {
    const cleanedJid = cleanId(data.userJid);

    // Find existing user in db by raw JID, cleaned JID, or LID
    const existingUser = await prisma.user.findFirst({
        where: {
            OR: [
                { id: data.userJid },
                { id: cleanedJid },
                { id: `${cleanedJid}@s.whatsapp.net` },
                { lid: data.userJid },
                { lid: cleanedJid },
                { lid: `${cleanedJid}@lid` }
            ]
        }
    });

    const targetUserId = existingUser
        ? existingUser.id
        : data.userJid.includes('@')
          ? data.userJid
          : `${cleanedJid}@s.whatsapp.net`;

    await prisma.user.upsert({
        where: { id: targetUserId },
        update: {
            ...(existingUser?.pushName ? {} : { pushName: data.fullName })
        },
        create: {
            id: targetUserId,
            pushName: data.fullName
        }
    });

    const nik = await generateNik(data.gender, data.dateOfBirth);

    const record = await prisma.idCard.upsert({
        where: { userJid: targetUserId },
        update: {
            fullName: data.fullName.toUpperCase().trim(),
            placeOfBirth: data.placeOfBirth.toUpperCase().trim(),
            dateOfBirth: data.dateOfBirth.trim(),
            gender: data.gender.toUpperCase().trim(),
            bloodType: (data.bloodType || 'O').toUpperCase().trim(),
            address: data.address.toUpperCase().trim(),
            rtRw: (data.rtRw || '001/002').trim(),
            village: (data.village || 'SUKAJADI').toUpperCase().trim(),
            district: (data.district || 'SUKAJADI').toUpperCase().trim(),
            city: (data.city || data.placeOfBirth || 'BANDUNG').toUpperCase().trim(),
            provinsi: (data.provinsi || 'JAWA BARAT').toUpperCase().trim(),
            religion: data.religion.toUpperCase().trim(),
            maritalStatus: data.maritalStatus.toUpperCase().trim(),
            occupation: data.occupation.toUpperCase().trim(),
            citizenship: (data.citizenship || 'WNI').toUpperCase().trim(),
            validUntil: (data.validUntil || 'SEUMUR HIDUP').toUpperCase().trim()
        },
        create: {
            nik,
            userJid: targetUserId,
            fullName: data.fullName.toUpperCase().trim(),
            placeOfBirth: data.placeOfBirth.toUpperCase().trim(),
            dateOfBirth: data.dateOfBirth.trim(),
            gender: data.gender.toUpperCase().trim(),
            bloodType: (data.bloodType || 'O').toUpperCase().trim(),
            address: data.address.toUpperCase().trim(),
            rtRw: (data.rtRw || '001/002').trim(),
            village: (data.village || 'SUKAJADI').toUpperCase().trim(),
            district: (data.district || 'SUKAJADI').toUpperCase().trim(),
            city: (data.city || data.placeOfBirth || 'BANDUNG').toUpperCase().trim(),
            provinsi: (data.provinsi || 'JAWA BARAT').toUpperCase().trim(),
            religion: data.religion.toUpperCase().trim(),
            maritalStatus: data.maritalStatus.toUpperCase().trim(),
            occupation: data.occupation.toUpperCase().trim(),
            citizenship: (data.citizenship || 'WNI').toUpperCase().trim(),
            validUntil: (data.validUntil || 'SEUMUR HIDUP').toUpperCase().trim()
        }
    });

    return record;
}

/**
 * Handles incoming conversational input for an ongoing ID registration session.
 * Returns true if the message was handled as part of registration.
 */
export async function processRegistrationStep(
    sock: WASocket,
    msg: WAMessage,
    userKey: string,
    remoteJid: string,
    input: string,
    t?: (key: string, args?: Record<string, any>) => string
): Promise<boolean> {
    const tr = t || getTranslator('id');
    t = tr;
    const session = findRegistrationSession(userKey);
    if (!session) return false;
    const cleaned = session.userKey;
    // Chat isolation: only process in the chat where registration was initiated
    if (!isSameChat(session.remoteJid, remoteJid)) {
        return false;
    }

    session.lastActivity = Date.now();
    const trimmed = input.trim();

    // Cancellation check
    if (
        trimmed.toLowerCase() === '.cancel' ||
        trimmed.toLowerCase() === 'cancel' ||
        trimmed.toLowerCase() === '.batal' ||
        trimmed.toLowerCase() === 'batal' ||
        trimmed.toLowerCase() === '.abort' ||
        trimmed.toLowerCase() === 'abort'
    ) {
        cancelRegistrationSession(cleaned, remoteJid);
        await sock.sendMessage(
            remoteJid,
            { text: t ? t('utilities.idcard.cancelled') : 'Virtual ID card registration has been cancelled.' },
            { quoted: msg }
        );
        return true;
    }

    switch (session.step) {
        case 1: {
            // Full Name
            if (trimmed.length < 2) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_name_min_length')
                            : 'Please provide a valid full name (at least 2 characters).'
                    },
                    { quoted: msg }
                );
                return true;
            }
            session.data.fullName = trimmed;
            session.step = 2;
            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_dob')
                        : 'Thank you. Now, please reply with your *Place and Date of Birth* (e.g., *Jakarta, 17-08-1990* or *Surabaya, 20 November 2002*).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 2: {
            // Place and Date of Birth
            const parsed = parseBirthPlaceAndDate(trimmed);
            if (!parsed) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_dob_invalid')
                            : 'Invalid format. Please reply with your *Place and Date of Birth* (e.g., *Jakarta, 17-08-1990* or *Surabaya, 20 November 2002*).'
                    },
                    { quoted: msg }
                );
                return true;
            }

            session.data.placeOfBirth = parsed.place;
            session.data.dateOfBirth = parsed.formattedDob;
            session.step = 3;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_gender')
                        : 'Thank you. Please specify your *Gender* (e.g., Male / Female or Laki-laki / Perempuan).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 3: {
            // Gender
            const g = trimmed.toUpperCase();
            let gender: string | null = null;
            if (g.includes('FEMALE') || g.includes('PEREMPUAN') || g.includes('WANITA') || g === 'P' || g === 'F') {
                gender = 'PEREMPUAN';
            } else if (g.includes('MALE') || g.includes('LAKI') || g.includes('PRIA') || g === 'L' || g === 'M') {
                gender = 'LAKI-LAKI';
            }

            if (!gender) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_gender_invalid')
                            : 'Please specify a valid gender: *Male* (*Laki-laki*) or *Female* (*Perempuan*).'
                    },
                    { quoted: msg }
                );
                return true;
            }

            session.data.gender = gender;
            session.step = 4;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_blood')
                        : 'Thank you. Please specify your *Blood Type* (A / B / AB / O).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 4: {
            // Blood Type
            const bt = trimmed.toUpperCase().replace(/[^A-Z]/g, '');
            if (bt !== 'A' && bt !== 'B' && bt !== 'AB' && bt !== 'O') {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_blood_invalid')
                            : 'Please specify a valid blood type: *A*, *B*, *AB*, or *O*.'
                    },
                    { quoted: msg }
                );
                return true;
            }

            session.data.bloodType = bt;
            session.step = 5;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_address')
                        : 'Thank you. Please reply with your *Street Address* (e.g., Jl. Merdeka No. 1).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 5: {
            // Street Address
            if (trimmed.length < 3) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_address_invalid')
                            : 'Please provide a valid address (at least 3 characters).'
                    },
                    { quoted: msg }
                );
                return true;
            }
            session.data.address = trimmed;
            session.step = 6;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_rtrw')
                        : 'Thank you. Please reply with your *RT/RW* (e.g., 001/002).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 6: {
            // RT / RW
            if (trimmed.length < 3) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_rtrw_invalid')
                            : 'Please provide a valid RT/RW format (e.g., 001/002).'
                    },
                    { quoted: msg }
                );
                return true;
            }
            session.data.rtRw = trimmed;
            session.step = 7;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_village')
                        : 'Thank you. Please reply with your *Village/Kelurahan* (e.g., Sukajadi).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 7: {
            // Village / Kelurahan
            if (trimmed.length < 2) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_village_invalid')
                            : 'Please provide a valid village/kelurahan name (at least 2 characters).'
                    },
                    { quoted: msg }
                );
                return true;
            }
            session.data.village = trimmed;
            session.step = 8;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_district')
                        : 'Thank you. Please reply with your *District/Kecamatan* (e.g., Sukajadi).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 8: {
            // District / Kecamatan
            if (trimmed.length < 2) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_district_invalid')
                            : 'Please provide a valid district/kecamatan name (at least 2 characters).'
                    },
                    { quoted: msg }
                );
                return true;
            }
            session.data.district = trimmed;
            session.step = 9;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_city')
                        : 'Thank you. Please reply with your *City/Regency* (e.g., Bandung or Jakarta Pusat).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 9: {
            // City / Kota
            if (trimmed.length < 2) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_city_invalid')
                            : 'Please provide a valid city/regency name (at least 2 characters).'
                    },
                    { quoted: msg }
                );
                return true;
            }
            session.data.city = trimmed;
            session.step = 10;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_province')
                        : 'Thank you. Please reply with your *Province* (e.g., Jawa Barat or DKI Jakarta).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 10: {
            // Province / Provinsi
            if (trimmed.length < 2) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_province_invalid')
                            : 'Please provide a valid province name (at least 2 characters).'
                    },
                    { quoted: msg }
                );
                return true;
            }
            session.data.provinsi = trimmed;
            session.step = 11;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_religion')
                        : 'Thank you. Please specify your *Religion* (e.g., Islam, Christian, Catholic, Hindu, Buddhist, Confucian).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 11: {
            // Religion
            if (trimmed.length < 2) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_religion_invalid')
                            : 'Please provide a valid religion (at least 2 characters).'
                    },
                    { quoted: msg }
                );
                return true;
            }
            session.data.religion = trimmed;
            session.step = 12;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_marital')
                        : 'Thank you. Please specify your *Marital Status* (e.g., Single / Married or Belum Kawin / Kawin).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 12: {
            // Marital Status
            const status = trimmed.toUpperCase();
            let maritalStatus: string = status;
            if (status.includes('SINGLE') || status.includes('BELUM')) {
                maritalStatus = 'BELUM KAWIN';
            } else if (status.includes('MARRIED') || status.includes('KAWIN') || status.includes('MENIKAH')) {
                maritalStatus = 'KAWIN';
            } else if (status.includes('DIVORCE') || status.includes('CERAI')) {
                maritalStatus = 'CERAI';
            }

            if (maritalStatus.length < 3) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_marital_invalid')
                            : 'Please specify a valid marital status (e.g., Single / Married or Belum Kawin / Kawin).'
                    },
                    { quoted: msg }
                );
                return true;
            }

            session.data.maritalStatus = maritalStatus;
            session.step = 13;

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.step_prompt_occupation')
                        : 'Thank you. Please reply with your *Occupation* (e.g., Developer, Student, Entrepreneur).'
                },
                { quoted: msg }
            );
            return true;
        }

        case 13: {
            // Occupation - Final Step!
            if (trimmed.length < 2) {
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.step_occupation_invalid')
                            : 'Please provide a valid occupation (at least 2 characters).'
                    },
                    { quoted: msg }
                );
                return true;
            }

            session.data.occupation = trimmed;
            unregisterCancellableSessionByUser(cleaned, remoteJid);
            registrationSessions.delete(cleaned);

            await sock.sendMessage(
                remoteJid,
                {
                    text: t
                        ? t('utilities.idcard.processing_card')
                        : '⏳ All data collected successfully. Processing your virtual ID card...'
                },
                { quoted: msg }
            );

            try {
                // Save to database
                const saved = await saveIdCard({
                    userJid: cleaned,
                    fullName: session.data.fullName || 'CITIZEN',
                    placeOfBirth: session.data.placeOfBirth || 'INDONESIA',
                    dateOfBirth: session.data.dateOfBirth || '01-01-2000',
                    gender: session.data.gender || 'LAKI-LAKI',
                    bloodType: session.data.bloodType || 'O',
                    address: session.data.address || 'JL. UTAMA NO. 1',
                    rtRw: session.data.rtRw || '001/002',
                    village: session.data.village || 'SUKAJADI',
                    district: session.data.district || 'SUKAJADI',
                    city: session.data.city || session.data.placeOfBirth || 'BANDUNG',
                    provinsi: session.data.provinsi || 'JAWA BARAT',
                    religion: session.data.religion || 'ISLAM',
                    maritalStatus: session.data.maritalStatus || 'BELUM KAWIN',
                    occupation: session.data.occupation || 'DEVELOPER',
                    citizenship: 'WNI',
                    validUntil: 'SEUMUR HIDUP'
                });

                // Generate ID card image with original REST API test photo format (no WhatsApp avatar)
                const imageBuffer = await generateIdCardImage(saved, null, DEFAULT_ID_CARD_PHOTO_URL);

                const caption = t
                    ? t('utilities.idcard.issued_caption', {
                          nik: saved.nik,
                          fullName: saved.fullName,
                          dob: saved.dateOfBirth,
                          gender: saved.gender,
                          bloodType: saved.bloodType,
                          city: saved.city,
                          provinsi: saved.provinsi,
                          citizenship: saved.citizenship,
                          validUntil: saved.validUntil
                      })
                    : `✅ Your Virtual ID Card has been successfully issued! You can now use this ID to apply for future banking loans or licenses.\n\n` +
                      `*NIK:* ${saved.nik}\n` +
                      `*Full Name:* ${saved.fullName}\n` +
                      `*Date of Birth:* ${saved.dateOfBirth}\n` +
                      `*Gender:* ${saved.gender}\n` +
                      `*Blood Type:* ${saved.bloodType}\n` +
                      `*City & Province:* ${saved.city}, ${saved.provinsi}\n` +
                      `*Citizenship:* ${saved.citizenship}\n` +
                      `*Valid Until:* ${saved.validUntil}`;

                await sock.sendMessage(remoteJid, { image: imageBuffer, caption }, { quoted: msg });
                return true;
            } catch (err) {
                console.error('[IdCard] Error generating final ID card:', err);
                await sock.sendMessage(
                    remoteJid,
                    {
                        text: t
                            ? t('utilities.idcard.error_generating')
                            : '❌ An error occurred while generating your Virtual ID Card. Please try again later.'
                    },
                    { quoted: msg }
                );
                return true;
            }
        }

        default:
            registrationSessions.delete(cleaned);
            return false;
    }
}
