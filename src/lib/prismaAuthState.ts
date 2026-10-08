import {
    AuthenticationCreds,
    AuthenticationState,
    BufferJSON,
    initAuthCreds,
    proto,
    SignalDataTypeMap,
    SignalDataSet
} from '@whiskeysockets/baileys';
import { getPrismaClient } from '#db.js';
export async function usePrismaAuthState(
    sessionCategory: string = 'default'
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
    const prisma = getPrismaClient(sessionCategory);
    const fixId = (id: string): string => `${sessionCategory}_${id.replace(/\//g, '__').replace(/:/g, '-')}`;

    const readData = async (id: string): Promise<any> => {
        try {
            const fullId = fixId(id);
            const data = await prisma.whatsAppAuth.findUnique({
                where: { id: fullId }
            });

            if (!data || !data.value) {
                return null;
            }

            return JSON.parse(data.value, BufferJSON.reviver);
        } catch (err) {
            console.error(`[PrismaAuth] Error reading key "${id}":`, err);
            return null;
        }
    };

    const writeData = async (id: string, value: any): Promise<void> => {
        try {
            const fullId = fixId(id);
            const serialized = JSON.stringify(value, BufferJSON.replacer);

            await prisma.whatsAppAuth.upsert({
                where: { id: fullId },
                update: { value: serialized },
                create: { id: fullId, value: serialized }
            });
        } catch (err) {
            console.error(`[PrismaAuth] Exception writing key "${id}":`, err);
        }
    };

    const removeData = async (id: string): Promise<void> => {
        try {
            const fullId = fixId(id);
            await prisma.whatsAppAuth.delete({
                where: { id: fullId }
            });
        } catch (err) {
            // Ignore record not found errors
            if (err && typeof err === 'object' && 'code' in err && err.code === 'P2025') {
                return;
            }
            console.error(`[PrismaAuth] Exception removing key "${id}":`, err);
        }
    };

    const creds: AuthenticationCreds = (await readData('creds.json')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                    const data: { [id: string]: SignalDataTypeMap[T] } = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}.json`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value as SignalDataTypeMap[T];
                        })
                    );
                    return data;
                },
                set: async (data: SignalDataSet) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        const categoryKey = category as keyof SignalDataTypeMap;
                        const categoryData = data[categoryKey];
                        if (!categoryData) continue;
                        for (const id of Object.keys(categoryData)) {
                            const value = categoryData[id];
                            const file = `${category}-${id}.json`;
                            tasks.push(value ? writeData(file, value) : removeData(file));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async (): Promise<void> => {
            await writeData('creds.json', creds);
        }
    };
}
