import os from 'os';
import { ToolDefinition, ToolContext } from './types.js';
import { renderCard, renderProgressBar } from '../utils/uiFormatter.js';
import { formatUptimeDuration } from '../utils/menuFormatter.js';

export const definition: ToolDefinition = {
    name: 'system_info',
    title: 'System Information',
    category: 'System & Help',
    aliases: ['.ping', '.stats', '.status', '.speed'],
    description: 'Displays server specifications, bot status, and network latency.',
    descriptionKey: 'tools.commands.system_info.description',
    parameters: {
        type: 'object',
        properties: {},
        required: []
    }
};

function formatBytes(bytes: number): string {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
}

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const unknownStr = ctx.t('tools.system_info.unknown');
    const systemUptime = formatUptimeDuration(os.uptime(), ctx.t);
    const botUptime = formatUptimeDuration(process.uptime(), ctx.t);
    const cpus = os.cpus();
    const cpuModel = cpus && cpus[0] ? cpus[0].model.trim() : unknownStr;
    const cpuArch = os.arch();
    const totalMem = formatBytes(os.totalmem());
    const freeMem = formatBytes(os.freemem());
    const usedMem = formatBytes(os.totalmem() - os.freemem());

    let latencyStr = unknownStr;
    if (ctx && ctx.msg && ctx.msg.messageTimestamp) {
        let timestampVal = 0;
        const msgTs = ctx.msg.messageTimestamp as any;
        if (typeof msgTs === 'object' && msgTs !== null) {
            if (typeof msgTs.toNumber === 'function') {
                timestampVal = msgTs.toNumber();
            } else {
                timestampVal = Number(msgTs.low ?? msgTs.unsigned ?? 0);
            }
        } else if (typeof msgTs === 'number' || typeof msgTs === 'string') {
            timestampVal = Number(msgTs);
        }

        if (timestampVal > 0) {
            const msgTimeMs = timestampVal * 1000;
            const diff = Date.now() - msgTimeMs;
            latencyStr = `${diff} ms`;
        }
    }

    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;
    const ramPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    const ramGauge = renderProgressBar({
        current: usedBytes,
        total: totalBytes,
        length: 10
    });

    return renderCard({
        title: ctx.t('tools.system_info.dashboard_title'),
        icon: '🖥️',
        headerStyle: 'light',
        t: ctx.t,
        sections: [
            {
                title: ctx.t('tools.system_info.section_runtime'),
                items: [
                    { label: ctx.t('tools.system_info.ping_label'), value: latencyStr },
                    { label: ctx.t('tools.system_info.nodejs_label'), value: process.version }
                ]
            },
            {
                title: ctx.t('tools.system_info.section_memory'),
                items: [
                    { label: ctx.t('tools.system_info.total_ram_label'), value: totalMem },
                    { label: ctx.t('tools.system_info.used_ram_label'), value: usedMem },
                    { label: ctx.t('tools.system_info.free_ram_label'), value: freeMem },
                    { label: ctx.t('tools.system_info.ram_label'), value: `${ramGauge} ${ramPercent.toFixed(1)}%` }
                ]
            },
            {
                title: ctx.t('tools.system_info.section_host'),
                items: [
                    { label: ctx.t('tools.system_info.cpu_label'), value: `${cpuModel} (${cpuArch})` },
                    { label: ctx.t('tools.system_info.os_label'), value: `${os.type()} ${os.release()}` },
                    { label: ctx.t('tools.system_info.server_uptime_label'), value: systemUptime },
                    { label: ctx.t('tools.system_info.bot_uptime_label'), value: botUptime }
                ]
            }
        ]
    });
}
