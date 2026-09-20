import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import opentype from 'opentype.js';
import axios from 'axios';
import FormData from 'form-data';
import { WASocket } from '@whiskeysockets/baileys';

export const DEFAULT_ID_CARD_PHOTO_URL = 'https://i.pinimg.com/736x/0b/9f/0a/0b9f0a92a598e6c22629004c1027d23f.jpg';

export interface IdCardData {
    nik: string;
    fullName: string;
    placeOfBirth: string;
    dateOfBirth: string;
    gender: string;
    address: string;
    religion: string;
    maritalStatus: string;
    occupation: string;
    citizenship?: string;
    validUntil?: string;
    provinsi?: string;
    city?: string;
    bloodType?: string;
    rtRw?: string;
    village?: string;
    district?: string;
    issuedAt?: Date | string;
    photoUrl?: string;
}

let cachedFontBold: opentype.Font | null = null;
let cachedFontMedium: opentype.Font | null = null;

function toArrayBuffer(buf: Buffer): ArrayBuffer {
    const ab = new ArrayBuffer(buf.byteLength);
    const view = new Uint8Array(ab);
    view.set(buf);
    return ab;
}

function loadFonts(): { fontBold: opentype.Font; fontMedium: opentype.Font } {
    if (cachedFontBold && cachedFontMedium) {
        return { fontBold: cachedFontBold, fontMedium: cachedFontMedium };
    }

    const boldPath = path.resolve(process.cwd(), 'storage', 'fonts', 'static', 'Roboto-Bold.ttf');
    const mediumPath = path.resolve(process.cwd(), 'storage', 'fonts', 'static', 'Roboto-Medium.ttf');

    if (!fs.existsSync(boldPath) || !fs.existsSync(mediumPath)) {
        throw new Error(`Roboto fonts not found in ${path.resolve(process.cwd(), 'storage', 'fonts', 'static')}`);
    }

    const bufBold = fs.readFileSync(boldPath);
    const bufMedium = fs.readFileSync(mediumPath);

    cachedFontBold = opentype.parse(toArrayBuffer(bufBold));
    cachedFontMedium = opentype.parse(toArrayBuffer(bufMedium));

    return { fontBold: cachedFontBold, fontMedium: cachedFontMedium };
}

function getTextWidth(font: opentype.Font, text: string, fontSize: number): number {
    const scale = (1 / font.unitsPerEm) * fontSize;
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        const glyph = font.charToGlyph(text[i]);
        width += (glyph.advanceWidth || font.unitsPerEm) * scale;
    }
    return width;
}

function renderTextPath(
    font: opentype.Font,
    text: string,
    startX: number,
    baselineY: number,
    fontSize: number,
    maxWidth?: number
): string {
    let effectiveFontSize = fontSize;
    if (maxWidth) {
        const currentWidth = getTextWidth(font, text, fontSize);
        if (currentWidth > maxWidth) {
            effectiveFontSize = Math.max(14, Math.floor(fontSize * (maxWidth / currentWidth)));
        }
    }

    const scale = (1 / font.unitsPerEm) * effectiveFontSize;
    const p = new opentype.Path();
    let x = startX;

    for (let i = 0; i < text.length; i++) {
        const glyph = font.charToGlyph(text[i]);
        const glyphPath = glyph.getPath(x, baselineY, effectiveFontSize);
        p.commands.push(...glyphPath.commands);
        x += (glyph.advanceWidth || font.unitsPerEm) * scale;
    }

    return p.toSVG(2);
}

/**
 * Creates a standard placeholder silhouette image (Indonesian red pas-foto background)
 * when a user's WhatsApp profile picture is unavailable.
 */
export async function createPlaceholderPhotoBuffer(): Promise<Buffer> {
    const placeholderSvg = `
        <svg width="270" height="345" xmlns="http://www.w3.org/2000/svg">
            <rect width="270" height="345" fill="#b91c1c" />
            <circle cx="135" cy="120" r="55" fill="#e2e8f0" />
            <path d="M 40 345 C 40 230, 230 230, 230 345 Z" fill="#e2e8f0" />
        </svg>
    `;
    return await sharp(Buffer.from(placeholderSvg)).png().toBuffer();
}

/**
 * Attempts to fetch the WhatsApp profile picture for a given JID or LID.
 * Returns null if the profile picture is hidden, private, or not available.
 */
export async function fetchUserProfilePic(sock: WASocket, userJidOrLid: string): Promise<Buffer | null> {
    if (!sock || typeof sock.profilePictureUrl !== 'function' || !userJidOrLid) {
        return null;
    }

    try {
        const cleaned = userJidOrLid.split(':')[0].split('@')[0];
        const normalizedJid = userJidOrLid.includes('@')
            ? userJidOrLid
            : cleaned.length > 14
              ? `${cleaned}@lid`
              : `${cleaned}@s.whatsapp.net`;

        const url = await sock.profilePictureUrl(normalizedJid, 'image');
        if (!url) return null;

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 8000
        });

        if (response.status === 200 && response.data) {
            return Buffer.from(response.data);
        }
    } catch (err) {
        console.warn(`[IdCard] Could not fetch profile picture for ${userJidOrLid}:`, (err as Error).message);
    }
    return null;
}

/**
 * Attempts to retrieve the public/temporary WhatsApp profile picture URL for a JID/LID.
 * Returns null if not available or privacy restricted.
 */
export async function fetchUserProfilePicUrl(sock: WASocket, userJidOrLid: string): Promise<string | null> {
    if (!sock || typeof sock.profilePictureUrl !== 'function' || !userJidOrLid) {
        return null;
    }

    try {
        const cleaned = userJidOrLid.split(':')[0].split('@')[0];
        const normalizedJid = userJidOrLid.includes('@')
            ? userJidOrLid
            : cleaned.length > 14
              ? `${cleaned}@lid`
              : `${cleaned}@s.whatsapp.net`;

        const url = await sock.profilePictureUrl(normalizedJid, 'image');
        return url || null;
    } catch {
        return null;
    }
}

const PROVINCE_MAP: Record<string, string> = {
    BANDUNG: 'JAWA BARAT',
    BOGOR: 'JAWA BARAT',
    BEKASI: 'JAWA BARAT',
    DEPOK: 'JAWA BARAT',
    CIREBON: 'JAWA BARAT',
    SUKABUMI: 'JAWA BARAT',
    TASIKMALAYA: 'JAWA BARAT',
    CIMAHI: 'JAWA BARAT',
    GARUT: 'JAWA BARAT',
    JAKARTA: 'DKI JAKARTA',
    'JAKARTA PUSAT': 'DKI JAKARTA',
    'JAKARTA SELATAN': 'DKI JAKARTA',
    'JAKARTA BARAT': 'DKI JAKARTA',
    'JAKARTA TIMUR': 'DKI JAKARTA',
    'JAKARTA UTARA': 'DKI JAKARTA',
    SURABAYA: 'JAWA TIMUR',
    MALANG: 'JAWA TIMUR',
    SIDOARJO: 'JAWA TIMUR',
    GRESIK: 'JAWA TIMUR',
    KEDIRI: 'JAWA TIMUR',
    SEMARANG: 'JAWA TENGAH',
    SURAKARTA: 'JAWA TENGAH',
    SOLO: 'JAWA TENGAH',
    YOGYAKARTA: 'D.I. YOGYAKARTA',
    MEDAN: 'SUMATERA UTARA',
    PALEMBANG: 'SUMATERA SELATAN',
    PADANG: 'SUMATERA BARAT',
    PEKANBARU: 'RIAU',
    BATAM: 'KEPULAUAN RIAU',
    DENPASAR: 'BALI',
    MAKASSAR: 'SULAWESI SELATAN',
    MANADO: 'SULAWESI UTARA'
};

function formatIssuedDate(issuedAt?: Date | string): string {
    if (!issuedAt) {
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        return `${d}-${m}-${y}`;
    }
    if (issuedAt instanceof Date) {
        const d = String(issuedAt.getDate()).padStart(2, '0');
        const m = String(issuedAt.getMonth() + 1).padStart(2, '0');
        const y = issuedAt.getFullYear();
        return `${d}-${m}-${y}`;
    }
    const str = String(issuedAt).trim();
    if (/^\d{2}-\d{2}-\d{4}$/.test(str)) return str;
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        const d = String(parsed.getDate()).padStart(2, '0');
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const y = parsed.getFullYear();
        return `${d}-${m}-${y}`;
    }
    return '01-01-2023';
}

/**
 * Generates the Virtual ID Card (e-KTP) image using the canvas e-KTP REST API.
 */
export async function generateIdCardImageRestApi(
    data: IdCardData,
    profilePicBuffer?: Buffer | null,
    photoUrl?: string | null
): Promise<Buffer> {
    const normalizedPlace = (data.placeOfBirth || '').toUpperCase().trim();
    const provinsi = data.provinsi || PROVINCE_MAP[normalizedPlace] || 'JAWA BARAT';
    const city = data.city || data.placeOfBirth || 'BANDUNG';
    const nik = String(data.nik || '1234567890123456');
    const name = data.fullName || 'John Doe';
    const ttl = `${data.placeOfBirth || 'BANDUNG'}, ${data.dateOfBirth || '01-01-1990'}`;

    const normalizedGender = (data.gender || '').toUpperCase().trim();
    const isFemale =
        normalizedGender.includes('FEMALE') ||
        normalizedGender.includes('PEREMPUAN') ||
        normalizedGender.includes('WANITA') ||
        normalizedGender === 'P' ||
        normalizedGender === 'F';
    const genderEn = isFemale ? 'Female' : 'Male';
    const genderId = isFemale ? 'Perempuan' : 'Laki-laki';

    const bloodType = data.bloodType || 'O';
    const address = data.address || 'Jl. Contoh No. 123';
    const rtRw = data.rtRw || '001/002';
    const village = data.village || 'Sukajadi';
    const district = data.district || 'Sukajadi';
    const religion = data.religion || 'Islam';

    const normalizedStatus = (data.maritalStatus || '').toUpperCase().trim();
    const status =
        normalizedStatus.includes('BELUM') || normalizedStatus.includes('SINGLE')
            ? 'Belum Kawin'
            : normalizedStatus.includes('CERAI') || normalizedStatus.includes('DIVORCE')
              ? 'Cerai'
              : 'Kawin';

    const occupation = data.occupation || 'Private Sector Employee';
    const nationality = data.citizenship || 'Indonesian';
    const kewarganegaraan = data.citizenship || 'WNI';
    const validity = data.validUntil || 'Lifetime';
    const masaBerlaku = data.validUntil || 'Seumur Hidup';
    const issued = formatIssuedDate(data.issuedAt);
    const photo = photoUrl || data.photoUrl || DEFAULT_ID_CARD_PHOTO_URL;

    // 1. If buffer exists, attempt multipart/form-data POST first
    if (profilePicBuffer && profilePicBuffer.length > 0) {
        try {
            let uploadBuf: Buffer;
            try {
                uploadBuf = await sharp(profilePicBuffer)
                    .resize(300, 400, { fit: 'cover', position: 'center' })
                    .jpeg({ quality: 90 })
                    .toBuffer();
            } catch {
                uploadBuf = profilePicBuffer;
            }

            const form = new FormData();
            form.append('provinsi', provinsi);
            form.append('kota', city);
            form.append('city', city);
            form.append('nik', nik);
            form.append('nama', name);
            form.append('name', name);
            form.append('ttl', ttl);
            form.append('date_of_birth', ttl);
            form.append('jenis_kelamin', genderId);
            form.append('gender', genderEn);
            form.append('golongan_darah', bloodType);
            form.append('blood_type', bloodType);
            form.append('alamat', address);
            form.append('address', address);
            form.append('rt/rw', rtRw);
            form.append('kel/desa', village);
            form.append('village', village);
            form.append('kecamatan', district);
            form.append('district', district);
            form.append('agama', religion);
            form.append('religion', religion);
            form.append('status', status);
            form.append('pekerjaan', occupation);
            form.append('occupation', occupation);
            form.append('kewarganegaraan', kewarganegaraan);
            form.append('nationality', nationality);
            form.append('masa_berlaku', masaBerlaku);
            form.append('validity', validity);
            form.append('terbuat', issued);
            form.append('issued', issued);
            form.append('pas_photo', uploadBuf, { filename: 'photo.jpg', contentType: 'image/jpeg' });

            const response = await axios.post('https://api.siputzx.my.id/api/canvas/ektp', form, {
                headers: form.getHeaders(),
                responseType: 'arraybuffer',
                timeout: 15000
            });

            if (response.status === 200 && response.data && response.data.length > 0) {
                return Buffer.from(response.data);
            }
        } catch (postErr) {
            console.warn(
                '[IdCard] REST API POST multipart upload failed, attempting GET request:',
                (postErr as Error).message
            );
        }
    }

    // 2. Fallback to GET request with query params
    const params: Record<string, string> = {
        provinsi,
        kota: city,
        city,
        nik,
        nama: name,
        name,
        ttl,
        date_of_birth: ttl,
        jenis_kelamin: genderId,
        gender: genderEn,
        golongan_darah: bloodType,
        blood_type: bloodType,
        alamat: address,
        address,
        'rt/rw': rtRw,
        'kel/desa': village,
        village,
        kecamatan: district,
        district,
        agama: religion,
        religion,
        status,
        pekerjaan: occupation,
        occupation,
        kewarganegaraan: kewarganegaraan,
        nationality,
        masa_berlaku: masaBerlaku,
        validity,
        terbuat: issued,
        issued,
        pas_photo: photo,
        photo
    };

    const getRes = await axios.get('https://api.siputzx.my.id/api/canvas/ektp', {
        params,
        responseType: 'arraybuffer',
        timeout: 15000
    });

    if (getRes.status === 200 && getRes.data && getRes.data.length > 0) {
        return Buffer.from(getRes.data);
    }

    throw new Error(`REST API returned unexpected status ${getRes.status}`);
}

/**
 * Generates the complete Virtual ID Card image by compositing user details
 * and their photo onto ktp_template.jpg using sharp locally.
 */
export async function generateIdCardImageLocal(data: IdCardData, profilePicBuffer?: Buffer | null): Promise<Buffer> {
    const templatePath = path.resolve(process.cwd(), 'storage', 'ktp_template.jpg');
    if (!fs.existsSync(templatePath)) {
        throw new Error(`KTP template image not found at ${templatePath}`);
    }

    const { fontBold, fontMedium } = loadFonts();

    // Prepare text paths (text column has max width ~480 before hitting pas-foto at x=916)
    const paths: string[] = [];

    // NIK (bold, large)
    paths.push(renderTextPath(fontBold, String(data.nik).toUpperCase(), 340, 206, 36, 540));

    // Full Name (bold)
    paths.push(renderTextPath(fontBold, String(data.fullName).toUpperCase(), 420, 268, 25, 480));

    // Place and Date of Birth
    const birthStr = `${data.placeOfBirth}, ${data.dateOfBirth}`.toUpperCase();
    paths.push(renderTextPath(fontMedium, birthStr, 420, 311, 24, 480));

    // Gender
    paths.push(renderTextPath(fontMedium, String(data.gender).toUpperCase(), 420, 355, 24, 480));

    // Address
    paths.push(renderTextPath(fontMedium, String(data.address).toUpperCase(), 420, 398, 24, 480));

    // Religion
    paths.push(renderTextPath(fontMedium, String(data.religion).toUpperCase(), 420, 441, 24, 480));

    // Marital Status
    paths.push(renderTextPath(fontMedium, String(data.maritalStatus).toUpperCase(), 420, 485, 24, 480));

    // Occupation
    paths.push(renderTextPath(fontMedium, String(data.occupation).toUpperCase(), 420, 528, 24, 480));

    // Citizenship (default "WNI")
    const citizenship = (data.citizenship || 'WNI').toUpperCase();
    paths.push(renderTextPath(fontMedium, citizenship, 420, 572, 24, 480));

    // Valid Until (default "SEUMUR HIDUP")
    const validUntil = (data.validUntil || 'SEUMUR HIDUP').toUpperCase();
    paths.push(renderTextPath(fontMedium, validUntil, 420, 616, 24, 480));

    const textSvg = `<svg width="1264" height="848" xmlns="http://www.w3.org/2000/svg">${paths.join('')}</svg>`;

    // Prepare photo buffer (270x345)
    let photoBuffer: Buffer;
    if (profilePicBuffer && profilePicBuffer.length > 0) {
        try {
            photoBuffer = await sharp(profilePicBuffer)
                .resize(270, 345, { fit: 'cover', position: 'center' })
                .toBuffer();
        } catch (photoErr) {
            console.warn('[IdCard] Failed to resize profile picture, falling back to placeholder:', photoErr);
            photoBuffer = await createPlaceholderPhotoBuffer();
        }
    } else {
        photoBuffer = await createPlaceholderPhotoBuffer();
    }

    // Composite onto ktp_template.jpg
    const finalImageBuffer = await sharp(templatePath)
        .composite([
            { input: photoBuffer, top: 198, left: 916 },
            { input: Buffer.from(textSvg), top: 0, left: 0 }
        ])
        .jpeg({ quality: 95 })
        .toBuffer();

    return finalImageBuffer;
}

/**
 * Generates the complete Virtual ID Card image using the REST API
 * and falls back gracefully to local sharp compositing if unavailable.
 */
export async function generateIdCardImage(
    data: IdCardData,
    profilePicBuffer?: Buffer | null,
    photoUrl?: string | null
): Promise<Buffer> {
    try {
        return await generateIdCardImageRestApi(data, profilePicBuffer, photoUrl);
    } catch (err) {
        console.warn(
            '[IdCard] REST API generation failed, falling back to local canvas generator:',
            (err as Error).message
        );
        return await generateIdCardImageLocal(data, profilePicBuffer);
    }
}
