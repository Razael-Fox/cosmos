import { ToolAiPolicy } from './types.js';

const POLICY_MAP: Record<string, ToolAiPolicy> = {
    // DENIED: Never executable by LLM
    addbalance: ToolAiPolicy.DENIED,
    forceupdate: ToolAiPolicy.DENIED,
    config: ToolAiPolicy.DENIED,
    subbot: ToolAiPolicy.DENIED,
    idcard: ToolAiPolicy.DENIED,
    cancel: ToolAiPolicy.DENIED,
    tgadd: ToolAiPolicy.DENIED,
    tgdel: ToolAiPolicy.DENIED,
    tgpair: ToolAiPolicy.DENIED,
    roulette_start: ToolAiPolicy.DENIED,
    roulette_join: ToolAiPolicy.DENIED,
    roulette_shoot: ToolAiPolicy.DENIED,
    roulette_spin: ToolAiPolicy.DENIED,
    roulette_use: ToolAiPolicy.DENIED,
    roulette_stats: ToolAiPolicy.DENIED,
    roulette_leaderboard: ToolAiPolicy.DENIED,
    roulette_cancel: ToolAiPolicy.DENIED,
    slot: ToolAiPolicy.DENIED,
    coinflip: ToolAiPolicy.DENIED,
    dice: ToolAiPolicy.DENIED,
    setgrouplang: ToolAiPolicy.DENIED,
    setlang: ToolAiPolicy.DENIED,
    startautocorrection: ToolAiPolicy.DENIED,
    stopautocorrection: ToolAiPolicy.DENIED,
    togglesticker: ToolAiPolicy.DENIED,

    // READ_ONLY: Safe query actions
    get_balance: ToolAiPolicy.READ_ONLY,
    balance: ToolAiPolicy.READ_ONLY,
    system_info: ToolAiPolicy.READ_ONLY,
    market: ToolAiPolicy.READ_ONLY,
    property_catalog: ToolAiPolicy.READ_ONLY,
    property_inventory: ToolAiPolicy.READ_ONLY,
    myplan: ToolAiPolicy.READ_ONLY,
    vault: ToolAiPolicy.READ_ONLY,
    top: ToolAiPolicy.READ_ONLY,
    topglobal: ToolAiPolicy.READ_ONLY,
    help: ToolAiPolicy.READ_ONLY,
    menu: ToolAiPolicy.READ_ONLY,

    // UTILITY: Messaging and media actions
    send_message: ToolAiPolicy.UTILITY,
    send_location: ToolAiPolicy.UTILITY,
    stt: ToolAiPolicy.UTILITY,
    sticker_maker: ToolAiPolicy.UTILITY,
    stickerly: ToolAiPolicy.UTILITY,
    pinterestdl: ToolAiPolicy.UTILITY,
    tiktokdl: ToolAiPolicy.UTILITY,
    ytdl: ToolAiPolicy.UTILITY,
    telegramdl: ToolAiPolicy.UTILITY,
    play: ToolAiPolicy.UTILITY,
    playlyrics: ToolAiPolicy.UTILITY,
    stoplyrics: ToolAiPolicy.UTILITY,
    quoted: ToolAiPolicy.UTILITY,
    readviewonce: ToolAiPolicy.UTILITY,

    // CONFIRMATION_REQUIRED: Direct balance, bank, loan, and property mutations
    transfer: ToolAiPolicy.CONFIRMATION_REQUIRED,
    bank_action: ToolAiPolicy.CONFIRMATION_REQUIRED,
    bank: ToolAiPolicy.CONFIRMATION_REQUIRED,
    property_buy: ToolAiPolicy.CONFIRMATION_REQUIRED,
    property_sell: ToolAiPolicy.CONFIRMATION_REQUIRED,
    loan: ToolAiPolicy.CONFIRMATION_REQUIRED,
    shop: ToolAiPolicy.CONFIRMATION_REQUIRED
};

const OWNER_ONLY_TOOLS: Record<string, true> = {
    addbalance: true,
    forceupdate: true,
    config: true,
    subbot: true,
    startautocorrection: true,
    stopautocorrection: true,
    setgrouplang: true,
    setlang: true
};

export class AgentToolPolicyManager {
    public static getPolicy(toolName: string): ToolAiPolicy {
        const cleanName = toolName.toLowerCase().replace(/^[.-]+/, '');
        return POLICY_MAP[cleanName] ?? ToolAiPolicy.DENIED;
    }

    public static isOwnerOnly(toolName: string): boolean {
        const cleanName = toolName.toLowerCase().replace(/^[.-]+/, '');
        return OWNER_ONLY_TOOLS[cleanName] === true;
    }

    public static isAllowed(toolName: string, isOwner: boolean): boolean {
        const cleanName = toolName.toLowerCase().replace(/^[.-]+/, '');
        const policy = this.getPolicy(cleanName);
        if (policy === ToolAiPolicy.DENIED) return false;
        if (this.isOwnerOnly(cleanName) && !isOwner) return false;
        return true;
    }
}
