// Build a static copy of Prizmiker and put it in birdpile, which serves it at
// /prizmiker (the northern mockingbird's page shows it full-screen).
//
//   npm run export:birdpile                 # into ../birdpile/public/prizmiker
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
  env: { ...process.env, PRIZMIKER_STATIC: '1', PRIZMIKER_BASE_PATH: '/prizmiker' },
});

const target = join(birdpile, 'public/prizmiker');
rmSync(target, { recursive: true, force: true });
// Leave behind what the app never loads: the unused rubberband engine, and the
// worker's TypeScript source (Turbopack also emits it as an asset, but the
// engine runs the compiled worker; birdpile would try to typecheck it)
const unused = (src) => basename(src) === 'rubberband.wasm' || src.endsWith('.ts');
cpSync(join(root, 'out'), target, { recursive: true, filter: src => !unused(src) });
console.log(`\nPrizmiker exported to ${target}`);
