/* eslint-disable no-undef */
// Isolated PM2 runtime config: environment variables are strictly scoped per process.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');

const apps = [
    {
        name: 'cosmos-bot',
        cwd: '/app/bot',
        script: 'dist/index.js',
        node_args: '--max-old-space-size=384',
        env: {
            NODE_ENV: 'production',
            DATABASE_URL: 'file:/app/storage/database.sqlite',
            BOT_IPC_SOCKET: '/app/storage/ipc.sock',
            INTERNAL_IPC_SECRET: process.env.INTERNAL_IPC_SECRET,
            GROQ_API_KEY: process.env.GROQ_API_KEY,
            GROQ_MODEL: process.env.GROQ_MODEL,
            AGENT_EXECUTOR_MODEL: process.env.AGENT_EXECUTOR_MODEL,
            AGENT_GUIDANCE_MODEL: process.env.AGENT_GUIDANCE_MODEL,
            STORAGE_ENCRYPTION_KEY: process.env.STORAGE_ENCRYPTION_KEY
        },
        max_memory_restart: '512M',
        kill_timeout: 5000,
        restart_delay: 3000,
        exp_backoff_restart_delay: 100,
        merge_logs: true,
        time: true
    },
    {
        name: 'cosmos-api',
        cwd: '/app/api',
        script: 'dist/index.js',
        node_args: '--max-old-space-size=192',
        env: {
            NODE_ENV: 'production',
            PORT: '4000',
            DATABASE_URL: 'file:/app/storage/database.sqlite',
            BOT_IPC_SOCKET: '/app/storage/ipc.sock',
            INTERNAL_IPC_SECRET: process.env.INTERNAL_IPC_SECRET,
            JWT_SECRET: process.env.JWT_SECRET,
            OTP_SECRET: process.env.OTP_SECRET,
            CLOUDFLARE_TURNSTILE_SECRET_KEY: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
            ADMIN_API_KEY: process.env.ADMIN_API_KEY
        },
        max_memory_restart: '220M',
        kill_timeout: 5000,
        restart_delay: 3000,
        exp_backoff_restart_delay: 100,
        merge_logs: true,
        time: true
    },
    {
        name: 'cosmos-web',
        cwd: '/app/website',
        script: 'server.js',
        node_args: '--max-old-space-size=192',
        env: {
            NODE_ENV: 'production',
            PORT: '3000',
            HOSTNAME: '0.0.0.0'
        },
        max_memory_restart: '220M',
        kill_timeout: 5000,
        restart_delay: 3000,
        exp_backoff_restart_delay: 100,
        merge_logs: true,
        time: true
    },
    {
        name: 'cosmos-nginx',
        script: 'nginx',
        args: '-g "daemon off;" -c /app/config/nginx.conf -p /tmp/',
        max_memory_restart: '80M',
        kill_timeout: 3000,
        restart_delay: 3000,
        merge_logs: true,
        time: true
    }
];

// Supervise the Cloudflare tunnel only when a token is provided (NAT VPS egress).
if (process.env.CLOUDFLARE_TUNNEL_TOKEN) {
    apps.push({
        name: 'cosmos-tunnel',
        script: 'cloudflared',
        args: `tunnel --no-autoupdate run --token ${process.env.CLOUDFLARE_TUNNEL_TOKEN} --url http://127.0.0.1:80`,
        env: {
            TUNNEL_TOKEN: process.env.CLOUDFLARE_TUNNEL_TOKEN,
            TUNNEL_URL: 'http://127.0.0.1:80'
        },
        restart_delay: 5000,
        merge_logs: true,
        time: true
    });
}

// Drop apps whose entry scripts were not packaged into the image under `main`
// (`/app/api` and `/app/website` only exist once the `api` / `website` branches
// land). Without this, PM2 restart-loops the missing services every few seconds.
function scriptPackaged(app) {
    // Bare binary names (nginx, cloudflared: no path separator, no extension).
    if (!app.script.includes('/') && !app.script.includes('.')) return true;
    const cwd = app.cwd || '/app';
    const entry = app.script.startsWith('/') ? app.script : `${cwd}/${app.script}`;
    let ok;
    try {
        ok = fs.existsSync(entry);
    } catch {
        ok = false;
    }
    if (!ok) console.log(`[PM2] Skipping unavailable service: ${app.name} (${entry} not packaged)`);
    return ok;
}

module.exports = { apps: apps.filter(scriptPackaged) };
