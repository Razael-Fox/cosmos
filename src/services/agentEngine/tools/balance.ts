import { AgentTool, AgentExecutionContext, ToolExecutionResult, ToolAiPolicy } from '../types.js';
import { prisma } from '../../../db.js';
import { formatRupiah } from '../../../utils/currency.js';
import { getUser } from '../../../utils/casino.js';

export const balanceTool: AgentTool = {
    name: 'get_balance',
    description: 'Retrieves current wallet cash balance, bank savings balance, and net worth for the calling user.',
    policy: ToolAiPolicy.READ_ONLY,
    parameters: {
        type: 'object',
        properties: {}
    },
    execute: async (_args: Record<string, unknown>, ctx: AgentExecutionContext): Promise<ToolExecutionResult> => {
        try {
            await getUser(prisma, ctx.callerJid);
            const user = await prisma.user.findUnique({
                where: { id: ctx.callerJid },
                include: { bankAccount: true }
            });

            if (!user) {
                return {
                    success: false,
                    error: 'User account not found.'
                };
            }

            const wallet = Number(user.balance);
            const bank = user.bankAccount ? Number(user.bankAccount.balance) : 0;
            const netWorth = wallet + bank;

            return {
                success: true,
                data: {
                    walletBalance: wallet,
                    bankBalance: bank,
                    netWorth,
                    formattedWallet: formatRupiah(wallet),
                    formattedBank: formatRupiah(bank),
                    formattedNetWorth: formatRupiah(netWorth),
                    hasBankAccount: Boolean(user.bankAccount),
                    accountNumber: user.bankAccount?.accountNumber ?? null
                }
            };
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                error: `Failed to fetch balance: ${errorMsg}`
            };
        }
    }
};
