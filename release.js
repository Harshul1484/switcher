// npm run release: create the draft GitHub release first, then let electron-builder upload into it.
// (If electron-builder creates the release itself, its parallel uploads race and split the files across
// duplicate drafts.) The draft is pinned to HEAD, so HEAD must be pushed. Publish it after adding notes.
const { execFileSync } = require('child_process');
const { version } = require('./package.json');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });
const head = run('git', ['rev-parse', 'HEAD']).trim();
if (run('git', ['status', '--porcelain']).trim()) throw new Error('Commit your changes first.');
if (run('git', ['rev-parse', '@{u}']).trim() !== head) throw new Error('Push HEAD first: the draft is pinned to it.');

process.env.GH_TOKEN ||= run('gh', ['auth', 'token']).trim();
run('gh', ['release', 'create', `v${version}`, '--draft', '--target', head, '--title', `Switcher ${version}`, '--generate-notes'], { stdio: 'inherit' });
run(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', '--publish', 'always'], { stdio: 'inherit' });
console.log(`\nDraft v${version} is ready. Check it, edit the notes, then publish:\n  gh release edit v${version} --draft=false`);
