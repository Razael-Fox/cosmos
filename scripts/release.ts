import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function run(cmd: string, echo = true): string {
    if (echo) console.log(`> ${cmd}`);
    return execSync(cmd, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'pipe'] }).trim();
}

async function main() {
    const rootDir = process.cwd();
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    const packageJsonPath = path.join(rootDir, 'package.json');

    // 1. Determine target version (RF-YYMM-BUILD)
    let version = process.argv[2];
    const changelog = fs.readFileSync(changelogPath, 'utf-8');

    if (!version) {
        // Look up top version from CHANGELOG.md matching RF-YYMM-BUILD
        const match = changelog.match(/## \[((RF-\d{4}-\d{2,}))\]/);
        if (match) {
            version = match[1];
        } else {
            const now = new Date();
            const yy = String(now.getFullYear()).slice(-2);
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            version = `RF-${yy}${mm}-01`;
        }
    }

    console.log(`[Release] Target Version: ${version}`);

    // 2. Update package.json version
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    if (pkg.version !== version) {
        pkg.version = version;
        fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 4) + '\n');
        console.log(`[Release] Updated package.json version to ${version}`);
    }

    // 3. Determine target branch (defaults to current active branch)
    const currentBranch = run('git rev-parse --abbrev-ref HEAD');
    const targetBranch = process.env.RELEASE_BRANCH || currentBranch;
    if (currentBranch !== targetBranch) {
        console.log(`[Release] Switching from branch '${currentBranch}' to '${targetBranch}'...`);
        run(`git checkout -B ${targetBranch}`);
    }

    // 4. Commit any pending changes
    const status = run('git status --porcelain', false);
    if (status) {
        run('git add .');
        run(`git commit -m "chore(release): prepare pre-release ${version}"`);
    }

    // 5. Push branch to remote repository
    console.log(`[Release] Pushing branch '${targetBranch}' to origin...`);
    run(`git push -u origin ${targetBranch}`);

    // 6. Extract release notes from CHANGELOG.md for this version
    const versionHeaderRegex = new RegExp(`## \\[${version}\\][^\n]*\n([\\s\\S]*?)(?=\\n## \\[|\\n---\\s*\\n## \\[|$)`);
    const notesMatch = changelog.match(versionHeaderRegex);
    const releaseNotes = notesMatch ? notesMatch[1].trim() : `Pre-release ${version}`;

    const tempNotesPath = path.join(rootDir, '.release_notes.tmp');
    fs.writeFileSync(tempNotesPath, releaseNotes, 'utf-8');

    // 7. Create pre-release tag and GitHub Release
    console.log(`[Release] Creating pre-release ${version} on GitHub...`);
    try {
        run(
            `gh release create "${version}" --target "${targetBranch}" --prerelease --title "${version} (Pre-release)" --notes-file "${tempNotesPath}"`
        );
        console.log(`[Release] Successfully created pre-release ${version} on GitHub!`);
        run(`gh release upload "${version}" "${changelogPath}" --clobber`);
        console.log(`[Release] Successfully uploaded CHANGELOG.md to pre-release ${version}!`);
    } catch (err: any) {
        console.error(`[Release] Error executing gh release create:`, err.message || err);
        throw err;
    } finally {
        if (fs.existsSync(tempNotesPath)) {
            fs.unlinkSync(tempNotesPath);
        }
    }
}

main().catch((err) => {
    console.error('[Release] Process failed:', err);
    process.exit(1);
});
