// Всё подряд: картинки → голос → сборка.  node make.mjs --ep <ep> [--preview] [--contact] [--max 40]
// Остальные флаги уходят в соответствующие шаги (см. images.mjs, voice.mjs, render.mjs).
import { spawnSync } from 'node:child_process';
const argv = process.argv.slice(2);
const pick = (...names) => argv.flatMap((a, i) => names.includes(a) ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? [a, argv[i + 1]] : [a]) : []);
const ep = pick('--ep');
const steps = [
  ['images.mjs', [...ep, ...pick('--max', '--jobs')]],
  ['voice.mjs', [...ep, ...pick('--check')]],
  ['render.mjs', [...ep, ...pick('--preview', '--contact', '--from', '--to', '--out')]],
];
for (const [script, args] of steps) {
  console.log(`\n▶ ${script} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`✖ ${script} завершился с кодом ${r.status}`); process.exit(r.status || 1); }
}
