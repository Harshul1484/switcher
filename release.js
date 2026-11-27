// npm run release: tag the pushed HEAD with v<version> and push the tag. GitHub Actions (.github/workflows/build.yml)
// then creates one draft release and builds Windows, macOS and Linux into it (macOS can only be built on a Mac).
// Check the draft, edit the notes, then publish it.
const { execFileSync } = require('child_process');
const { version } = require('./package.json');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });
const head = run('git', ['rev-parse', 'HEAD']).trim();
const tag = `v${version}`;
if (run('git', ['status', '--porcelain']).trim()) throw new Error('Commit your changes first.');
if (run('git', ['rev-parse', '@{u}']).trim() !== head) throw new Error('Push HEAD first: the release is built from it.');
if (run('git', ['tag', '--list', tag]).trim()) throw new Error(`${tag} already exists: bump "version" in package.json first.`);

run('git', ['tag', tag]);
run('git', ['push', 'origin', tag], { stdio: 'inherit' });
console.log(`\nPushed ${tag}. GitHub Actions is building Windows, macOS and Linux into a draft release:` +
  `\n  https://github.com/Harshul1484/switcher/actions\nWhen all three are done, edit the notes and publish:\n  gh release edit ${tag} --draft=false`);
