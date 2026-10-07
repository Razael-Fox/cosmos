import fs from 'fs';
import path from 'path';

const srcLocales = path.resolve(process.cwd(), 'src', 'locales');
const distLocales = path.resolve(process.cwd(), 'dist', 'locales');

if (fs.existsSync(srcLocales)) {
    fs.mkdirSync(distLocales, { recursive: true });
    fs.cpSync(srcLocales, distLocales, {
        recursive: true,
        filter: (src) => !src.endsWith('.ts')
    });
    console.log('[copy-locales] Copied translation files to dist/locales');
}
