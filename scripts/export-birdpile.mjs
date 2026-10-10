// Build a static copy of Prizmichael and put it in birdpile, which serves it at
// /prizmichael (the northern mockingbird's page shows it full-screen).
//
//   npm run export:birdpile                 # into ../birdpile/public/prizmichael
//   npm run export:birdpile -- <birdpile>   # another birdpile checkout
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const birdpile = resolve(root, process.argv[2] ?? '../birdpile');
if (!existsSync(join(birdpile, 'src/lib/birds.ts'))) {
  console.error(`No birdpile checkout at ${birdpile}`);
  process.exit(1);
}

rmSync(join(root, 'out'), { recursive: true, force: true });
execSync('npx next build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PRIZMICHAEL_STATIC: '1', PRIZMICHAEL_BASE_PATH: '/prizmichael' },
});

const target = join(birdpile, 'public/prizmichael');
rmSync(target, { recursive: true, force: true });
// Leave behind what the app never loads: the unused rubberband engine, and the
// worker's TypeScript source (Turbopack also emits it as an asset, but the
// engine runs the compiled worker; birdpile would try to typecheck it)
const unused = (src) => basename(src) === 'rubberband.wasm' || src.endsWith('.ts');
cpSync(join(root, 'out'), target, { recursive: true, filter: src => !unused(src) });
console.log(`\nPrizmichael exported to ${target}`);
