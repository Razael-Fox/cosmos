import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

dotenv.config();

const SESSION_FILE = path.resolve(process.cwd(), 'storage', 'telegram_session.txt');

function question(rl: readline.Interface, promptText: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(promptText, (answer) => resolve(answer.trim()));
    });
}

async function startTelegramPairing(): Promise<void> {
    const apiId = parseInt(process.env.TELEGRAM_API_ID || '', 10);
    const apiHash = process.env.TELEGRAM_API_HASH;

    if (!apiId || !apiHash) {
        console.error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env');
        console.error('You can obtain them at https://my.telegram.org (API development tools).');
        process.exit(1);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 3 });

    try {
        await client.start({
            phoneNumber: async () => {
                const value = await question(rl, 'Please enter the dummy account phone number (with country code): ');
                return value;
            },
            password: async () => {
                const value = await question(rl, 'Please enter the two-factor password (leave empty if none): ');
                return value;
            },
            phoneCode: async () => {
                const value = await question(rl, 'Please enter the login code you received: ');
                return value;
            },
            onError: (err) => console.error('Login error:', err)
        });

        const sessionString = client.session.save() as unknown as string;
        if (!sessionString || typeof sessionString !== 'string') {
            throw new Error('The resulting session string is invalid.');
        }

        const storagePath = path.dirname(SESSION_FILE);
        if (!fs.existsSync(storagePath)) fs.mkdirSync(storagePath, { recursive: true });
        fs.writeFileSync(SESSION_FILE, sessionString, 'utf8');

        const me = await client.getMe();
        console.log(`Successfully paired as ${me.username ? '@' + me.username : me.firstName}!`);
        console.log(`Session saved to ${SESSION_FILE}.`);
        console.log('You can now start the bot with "pnpm dev" or "pnpm pm2:start".');
        rl.close();
        await client.disconnect();
        process.exit(0);
    } catch (err) {
        console.error('Pairing failed:', err);
        rl.close();
        process.exit(1);
    }
}

startTelegramPairing();
