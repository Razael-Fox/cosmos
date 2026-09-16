import type { SubBotInstance, WhitelistedGroup, SubscriptionStatusResponse, UserProfile } from './types';

// In-memory mock store for local/isolated web app testing
export interface VerificationSession {
  token: string;
  phone: string;
  username?: string;
  email?: string;
  expiresAt: number;
  verifiedAt?: number;
  jwtToken?: string;
}

class MockStore {
  public sessions: Map<string, VerificationSession> = new Map();
  public directOtps: Map<string, { code: string; expiresAt: number; attempts: number }> = new Map();

  public subscription: SubscriptionStatusResponse = {
    tier: 'FREE',
    status: 'ACTIVE',
    maxSubBots: 2,
    maxGroups: 5,
    customPrefix: false,
    startedAt: new Date().toISOString(),
    expiresAt: null,
    currentSubBots: 1,
    currentGroups: 2,
  };

  public subBots: SubBotInstance[] = [
    {
      id: '6281234567890',
      ownerJid: '628123456789@s.whatsapp.net',
      customPrefix: '.',
      status: 'ACTIVE',
      createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  public groups: WhitelistedGroup[] = [
    {
      jid: '120363023456789012@g.us',
      language: 'ID',
      ownerJid: '628123456789@s.whatsapp.net',
      createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      jid: '120363098765432101@g.us',
      language: 'ID',
      ownerJid: '628123456789@s.whatsapp.net',
      createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ];

  public defaultUser: UserProfile = {
    id: '628123456789@s.whatsapp.net',
    username: 'cosmos_user',
    email: 'user@cosmos.io',
    isWhitelisted: true,
    language: 'ID',
    balance: '10000',
    creditScore: 500,
    createdAt: new Date().toISOString(),
  };
}

const globalForMock = global as unknown as { mockStore?: MockStore };
export const mockStore = globalForMock.mockStore || new MockStore();
if (process.env.NODE_ENV !== 'production') globalForMock.mockStore = mockStore;
