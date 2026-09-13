import os from 'os';
import { ToolDefinition, ToolContext } from './types.js';
import { renderCard, renderProgressBar } from '../utils/uiFormatter.js';

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

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${d > 0 ? `${d}d ` : ''}${h > 0 ? `${h}h ` : ''}${m > 0 ? `${m}m ` : ''}${s}s`;
}

export async function execute(_args: Record<string, any>, ctx: ToolContext): Promise<string> {
    const systemUptime = formatUptime(os.uptime());
    const botUptime = formatUptime(process.uptime());
    const cpus = os.cpus();
    const cpuModel = cpus && cpus[0] ? cpus[0].model.trim() : 'Unknown';
    const cpuArch = os.arch();
    const totalMem = formatBytes(os.totalmem());
    const freeMem = formatBytes(os.freemem());
    const usedMem = formatBytes(os.totalmem() - os.freemem());

    let latencyStr = 'Unknown';
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
        title: 'SERVER TELEMETRY DASHBOARD',
        icon: '🖥️',
        headerStyle: 'light',
        sections: [
            {
                title: 'RUNTIME TELEMETRY',
                items: [
                    { label: 'Latency', value: latencyStr },
                    { label: 'Node.js', value: process.version }
                ]
            },
            {
                title: 'MEMORY UTILIZATION',
                items: [
                    { label: 'Total RAM', value: totalMem },
                    { label: 'Used RAM', value: usedMem },
                    { label: 'Free RAM', value: freeMem },
                    { label: 'Usage Gauge', value: `${ramGauge} ${ramPercent.toFixed(1)}%` }
                ]
            },
            {
                title: 'HOST ENVIRONMENT',
                items: [
                    { label: 'CPU', value: `${cpuModel} (${cpuArch})` },
                    { label: 'Host OS', value: `${os.type()} ${os.release()}` },
                    { label: 'Server Uptime', value: systemUptime },
                    { label: 'Bot Uptime', value: botUptime }
                ]
            }
        ]
    });
}
