import { EventEmitter } from 'events';

import type { UserProfile } from '../utils/userSerializer.js';

export interface AuthStatusEvent {
    status: 'VERIFIED' | 'EXPIRED' | 'FAILED';
    jwtToken?: string;
    user?: UserProfile;
    error?: string;
}

class AuthEventEmitter extends EventEmitter {}

export const authEventBus = new AuthEventEmitter();
// Increase listener limit for high concurrent registration sessions
authEventBus.setMaxListeners(1000);

export function emitAuthStatus(regSessionId: string, event: AuthStatusEvent): void {
    authEventBus.emit(`auth:${regSessionId}`, event);
}

export function subscribeAuthStatus(regSessionId: string, callback: (event: AuthStatusEvent) => void): () => void {
    const eventName = `auth:${regSessionId}`;
    authEventBus.on(eventName, callback);
    return () => {
        authEventBus.off(eventName, callback);
    };
}
