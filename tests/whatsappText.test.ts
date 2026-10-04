import assert from 'node:assert';
import { describe, it } from 'node:test';
import { toWhatsAppText } from '../src/services/agentEngine/whatsappText.js';

describe('WhatsApp text normalisation', () => {
    it('converts a Markdown pipe table into label/value lines', () => {
        const md = ['| Logam | Harga |', '|---|---|', '| Gold | Rp1.500.000 |', '| Silver | Rp18.000 |'].join('\n');
        const out = toWhatsAppText(md);

        assert.ok(!out.includes('|'), `no pipes remain, got: ${out}`);
        assert.ok(!out.includes('---'), `no delimiter row remains, got: ${out}`);
        assert.ok(out.includes('Logam: Gold'), `expected labelled gold row, got: ${out}`);
        assert.ok(out.includes('Harga: Rp1.500.000'), `expected labelled gold price, got: ${out}`);
        assert.ok(out.includes('Logam: Silver'), `expected labelled silver row, got: ${out}`);
        assert.ok(out.includes('Harga: Rp18.000'), `expected labelled silver price, got: ${out}`);
    });

    it('strips ATX heading hashes but keeps emphasis', () => {
        assert.equal(toWhatsAppText('## Harga Emas'), '*Harga Emas*');
    });

    it('converts double bold/italic markers to WhatsApp form', () => {
        assert.equal(toWhatsAppText('**tebal**'), '*tebal*');
        assert.equal(toWhatsAppText('__miring__'), '_miring_');
    });

    it('expands Markdown links to literal label and URL', () => {
        assert.equal(toWhatsAppText('Lihat [Kitco](https://kitco.com/price)'), 'Lihat Kitco (https://kitco.com/price)');
    });

    it('removes blockquote markers and horizontal rules', () => {
        assert.equal(toWhatsAppText('> kutipan'), 'kutipan');
        assert.equal(toWhatsAppText('a\n\n---\n\nb'), 'a\n\nb');
    });

    it('leaves plain WhatsApp-native text untouched', () => {
        const src = '*Hai* Sah! Harga emas naik.\n\nSumber:\nhttps://kitco.com';
        assert.equal(toWhatsAppText(src), src);
    });

    it('does not mangle URLs containing underscores or slashes', () => {
        const src = 'https://example.com/a_b/c?x=1';
        assert.equal(toWhatsAppText(src), src);
    });

    it('handles empty input without throwing', () => {
        assert.equal(toWhatsAppText(''), '');
    });
});
