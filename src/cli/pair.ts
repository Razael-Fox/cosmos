import dotenv from 'dotenv';
import { connectToWhatsApp } from '#utils/connectionManager.js';
import { promptBotPhoneNumber, promptPairingMethod } from '#utils/startupPrompt.js';

dotenv.config();

async function startPairing(): Promise<void> {
    console.log('Starting pairing process...');

    const phoneNumber = await promptBotPhoneNumber();
    const pairingMethod = await promptPairingMethod();

    connectToWhatsApp({
        sessionId: 'default',
        phoneNumber,
        pairingMethod,
        isPairingMode: true,
        onConnected: () => {
            console.log('Successfully paired and connected!');
            process.exit(0);
        }
    });
}

startPairing();
