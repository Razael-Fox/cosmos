/**
 * Cosmos MCP Server — privacy utilities.
 *
 * Mirrors the zero-knowledge contact policy already mandated for the end-user
 * agent engine (AGENTS.md Rule AB) and the Laya Decision Engine (Rule AG):
 * raw phone numbers and raw JIDs must never leave the server in a tool result.
 *
 * Two complementary mechanisms are provided:
 *  - {@link maskJid} / {@link maskPhone} for display purposes.
 *  - {@link issueContactRef} for stable, non-reversible ephemeral aliases
 *    (`contact_ref_...`) that an agent can echo back to resolve a real JID
 *    server-side without ever learning it.
 */

const CONTACT_REF_TTL_MS = 3 * 60 * 1000; // 3 minutes
const CONTACT_REF_CAPACITY = 10_000; // LRU bound

interface ContactRefEntry {
    /** Canonical JID. Never serialised into a tool result. */
    jid: string;
    /** Owner identity that requested the alias. */
    owner: string;
    expiresAt: number;
    /** Monotonic counter backing the LRU ordering. */
    touchedAt: number;
}

/** `ref` -> entry, maintained in insertion/touch order so eviction is O(1). */
const contactRefs = new Map<string, ContactRefEntry>();
let contactRefCounter = 0;

/** Clears the in-RAM nonce table. Used by tests and by the HTTP transport. */
export function clearContactRefs(): void {
    contactRefs.clear();
    contactRefCounter = 0;
}

function pruneExpired(now: number): void {
    for (const [ref, entry] of contactRefs) {
        if (entry.expiresAt <= now) contactRefs.delete(ref);
    }
}

/**
 * Issues (or re-issues) an ephemeral `contact_ref_...` alias for a JID.
 *
 * The mapping lives only in server RAM, expires after 3 minutes, and is bounded
 * to 10 000 entries with LRU eviction. It is never persisted to disk.
 */
export function issueContactRef(jid: string, owner: string): string {
    const now = Date.now();
    pruneExpired(now);

    for (const [ref, entry] of contactRefs) {
        if (entry.jid === jid && entry.owner === owner && entry.expiresAt > now) {
            entry.touchedAt = ++contactRefCounter;
            // Refresh LRU position.
            contactRefs.delete(ref);
            contactRefs.set(ref, entry);
            return ref;
        }
    }

    if (contactRefs.size >= CONTACT_REF_CAPACITY) {
        const oldest = contactRefs.keys().next();
        if (!oldest.done) contactRefs.delete(oldest.value);
    }

    const ref = `contact_ref_${(++contactRefCounter).toString(36)}`;
    contactRefs.set(ref, { jid, owner, expiresAt: now + CONTACT_REF_TTL_MS, touchedAt: contactRefCounter });
    return ref;
}

/**
 * Resolves an ephemeral alias back to the real JID. Returns `null` for an
 * unknown, expired, or foreign-owner alias.
 */
export function resolveContactRef(ref: string, owner: string): string | null {
    const entry = contactRefs.get(ref);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        contactRefs.delete(ref);
        return null;
    }
    if (entry.owner !== owner) return null;
    entry.touchedAt = ++contactRefCounter;
    contactRefs.delete(ref);
    contactRefs.set(ref, entry);
    return entry.jid;
}

/**
 * Masks a WhatsApp JID so an agent can correlate it without learning it.
 * `6281234567890@s.whatsapp.net` becomes `62812•••••7890@s.whatsapp.net`.
 */
export function maskJid(jid: string): string {
    const at = jid.indexOf('@');
    const domain = at === -1 ? '' : jid.slice(at);
    const local = at === -1 ? jid : jid.slice(0, at);
    return `${maskPhone(local)}${domain}`;
}

/** Masks a phone number, keeping the first 5 and last 4 digits. */
export function maskPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length <= 9) return '•'.repeat(digits.length);
    return `${digits.slice(0, 5)}${'•'.repeat(Math.max(1, digits.length - 9))}${digits.slice(-4)}`;
}

/**
 * Recursively masks any value that looks like a phone number or JID so an
 * accidental field in a row diff cannot leak contact identifiers.
 */
export function maskDeep(value: unknown, depth = 0): unknown {
    if (depth > 6) return value;
    if (typeof value === 'string') return maskIfContactLike(value);
    if (Array.isArray(value)) return value.map((entry) => maskDeep(entry, depth + 1));
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            out[key] = maskDeep(entry, depth + 1);
        }
        return out;
    }
    return value;
}

const JID_PATTERN = /^[\w.+-]+@(s\.whatsapp\.net|g\.us|lid|broadcast|newsletter)$/;

function maskIfContactLike(value: string): string {
    if (JID_PATTERN.test(value)) return maskJid(value);
    if (/^\+?\d{9,15}$/.test(value)) return maskPhone(value);
    return value;
}
