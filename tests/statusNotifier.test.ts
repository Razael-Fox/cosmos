import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
    formatDiscordEmbed,
    formatSlackBlocks,
    formatWhatsAppText,
    getEventTitle,
    redactIdentifiers
} from '../src/services/notifier/formatters.js';
import {
    getStatusNotifierConfig,
    maskSecret,
    resetStatusNotifierConfigCache
} from '../src/services/notifier/config.js';

describe('Status notifier formatters', () => {
    it('redacts raw JIDs and phone numbers from outbound text', () => {
        const redacted = redactIdentifiers('contact 628123456789@s.whatsapp.net or +62 812-3456-7890');
        assert.ok(!redacted.includes('628123456789'));
        assert.ok(!redacted.includes('812-3456-7890'));
        assert.ok(redacted.includes('[redacted'));
    });

    it('renders a Discord embed with sanitized fields', () => {
        const body = formatDiscordEmbed('BOT_DOWN', 'CRITICAL', {
            summary: 'Session 628123456789@s.whatsapp.net dropped',
            fields: { Reason: 'conflict from 628999888777' },
            version: 'G2-F28-P0',
            sessionId: 'default'
        });
        assert.strictEqual(body.embeds.length, 1);
        assert.ok(body.embeds[0].title.includes('Bot Down'));
        assert.ok(!JSON.stringify(body).includes('628123456789'));
        assert.strictEqual(body.embeds[0].color, 0xe74c3c);
    });

    it('renders Slack blocks and WhatsApp text within limits', () => {
        const payload = {
            summary: 'Database backup delivered.',
            fields: { Hash: 'abc123', Database: 'storage/database.sqlite' },
            version: 'G2-F28-P0'
        };
        const slack = formatSlackBlocks('DB_BACKUP_SUCCESS', 'INFO', payload);
        assert.ok(Array.isArray(slack.blocks) && slack.blocks.length >= 2);

        const wa = formatWhatsAppText('DB_BACKUP_SUCCESS', 'INFO', payload);
        assert.ok(wa.length <= 4096);
        assert.ok(wa.includes('Database Backup Delivered'));
    });

    it('has display titles for bot/server lifecycle events', () => {
        for (const event of [
            'BOT_STARTED',
            'BOT_RESTARTED',
            'BOT_STOPPED',
            'SERVER_BOOTED',
            'SERVER_REBOOTED'
        ] as const) {
            assert.notStrictEqual(getEventTitle(event), event, `${event} has no title`);
        }
    });
});

describe('Status notifier config', () => {
    it('masks secrets without revealing them', () => {
        assert.strictEqual(maskSecret(null), '(unset)');
        assert.strictEqual(maskSecret('short'), '••••');
        const masked = maskSecret('https://discord.com/api/webhooks/123456/abcdefghijklmnop');
        assert.ok(masked.endsWith('mnop'));
        assert.ok(!masked.includes('123456'));
    });

    it('defaults to fail-closed channels when no URLs are configured', () => {
        const saved = {
            discord: process.env.DISCORD_STATUS_WEBHOOK_URL,
            slack: process.env.SLACK_STATUS_WEBHOOK_URL,
            wa: process.env.WA_STATUS_NEWSLETTER_JID
        };
        delete process.env.DISCORD_STATUS_WEBHOOK_URL;
        delete process.env.SLACK_STATUS_WEBHOOK_URL;
        delete process.env.WA_STATUS_NEWSLETTER_JID;
        resetStatusNotifierConfigCache();

        const config = getStatusNotifierConfig();
        assert.strictEqual(config.discord.enabled, false);
        assert.strictEqual(config.slack.enabled, false);
        assert.strictEqual(config.whatsapp.enabled, false);
        assert.strictEqual(config.minSeverity, 'WARN');

        if (saved.discord !== undefined) process.env.DISCORD_STATUS_WEBHOOK_URL = saved.discord;
        if (saved.slack !== undefined) process.env.SLACK_STATUS_WEBHOOK_URL = saved.slack;
        if (saved.wa !== undefined) process.env.WA_STATUS_NEWSLETTER_JID = saved.wa;
        resetStatusNotifierConfigCache();
    });
});
