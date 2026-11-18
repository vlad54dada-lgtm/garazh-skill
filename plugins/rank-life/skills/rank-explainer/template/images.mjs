// Картинки эпизода через OpenRouter: node images.mjs --ep <ep> [--dry] [--only id,id] [--max 40] [--jobs 4]
//   Сначала листы персонажей (characters), потом обложки уровней и кадры — с листами героев как референсом (одно лицо во всём ролике).
//   Кэш: episodes/<ep>/cache/img/<key>.png; key = hash(модель + полный промпт + ключи референсов + v). Править промпт → новая картинка;
//   перегенерировать неудачную при том же промпте — поставь в спеке v: 2.
//   --dry   только показать, что будет сгенерировано (и сколько) — без запросов.
//   --max N защита кошелька: не больше N новых картинок за запуск (по умолчанию 40).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, loadEpisode, imageJobs, imgFile, mkdirp, pool, log, warn } from './lib/common.mjs';

const A = parseArgs();
const E = await loadEpisode(A.ep);
const { jobs } = imageJobs(E);
const dir = mkdirp(path.join(E.cache, 'img'));
const only = A.only ? new Set(String(A.only).split(',')) : null;
const MAX = +(A.max ?? 40), JOBS = +(A.jobs ?? 4);

const all = [...jobs.values()];
const todo = all.filter(j => !imgFile(E, j.key) && (!only || only.has(j.id)));
log(`картинки: всего ${all.length}, в кэше ${all.length - all.filter(j => !imgFile(E, j.key)).length}, к генерации ${todo.length} (${E.imageModel})`);
if (A.dry) { for (const j of todo) log(`  ${j.id}${j.refs.length ? '  [ref: ' + j.refs.join(', ') + ']' : ''}`); process.exit(0); }
if (!todo.length) process.exit(0);
if (!process.env.OPENROUTER_API_KEY) { warn('нет OPENROUTER_API_KEY (положи его в .env студии)'); process.exit(2); }
if (todo.length > MAX) { warn(`новых картинок ${todo.length} > --max ${MAX}. Подтверди объём и запусти с --max ${todo.length}`); process.exit(3); }

const dataUrl = f => `data:image/${path.extname(f).slice(1).replace('jpg', 'jpeg')};base64,${fs.readFileSync(f).toString('base64')}`;
let spent = 0, made = 0;

async function generate(j) {
  const refFiles = j.refKeys.map(k => imgFile(E, k));
  if (refFiles.some(f => !f)) throw new Error(`${j.id}: нет картинки-референса (${j.refs.join(', ')}) — сначала сгенерируй персонажей`);
  const content = [{ type: 'text', text: j.prompt }, ...refFiles.map(f => ({ type: 'image_url', image_url: { url: dataUrl(f) } }))];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(180000),
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'rank-life studio' },
        body: JSON.stringify({ model: E.imageModel, modalities: ['image', 'text'], messages: [{ role: 'user', content }],
          image_config: { aspect_ratio: j.aspect }, usage: { include: true } }),
      });
      const body = await res.text();
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
        if ([400, 401, 402, 403].includes(res.status)) e.fatal = true;   // ключ/баланс/запрос — повтор не поможет
        throw e;
      }
      const J = JSON.parse(body);
      const url = J.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (!url) throw new Error(`в ответе нет картинки: ${(J.choices?.[0]?.message?.content || body).slice(0, 200)}`);
      const m = url.match(/^data:image\/(\w+);base64,(.+)$/s);
      if (!m) throw new Error('картинка не data:url');
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const f = path.join(dir, `${j.key}.${ext}`);
      fs.writeFileSync(f + '.part', Buffer.from(m[2], 'base64')); fs.renameSync(f + '.part', f);
      fs.writeFileSync(path.join(dir, `${j.key}.json`), JSON.stringify({ id: j.id, model: E.imageModel, prompt: j.prompt, refs: j.refs, cost: J.usage?.cost ?? null }, null, 1));
      spent += J.usage?.cost || 0; made++;
      log(`  ✓ ${j.id}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB${J.usage?.cost != null ? `  $${J.usage.cost.toFixed(4)}` : ''}`);
      return;
    } catch (e) {
      if (attempt === 3 || e.fatal) throw Object.assign(new Error(`${j.id}: ${e.message}`), { fatal: e.fatal });
      warn(`${j.id}: попытка ${attempt} — ${e.message.slice(0, 200)}; повтор`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

// волнами: персонажи по порядку зависимостей (from), потом все сцены параллельно
const chars = todo.filter(j => j.kind === 'char'), scenes = todo.filter(j => j.kind === 'scene');
const failed = []; let stop = false;
const run = j => stop ? null : generate(j).catch(e => { failed.push(e.message); if (e.fatal) stop = true; });
for (const j of chars) await run(j);
await pool(scenes, JOBS, run);
if (stop) warn('остановлено: ошибка ключа/баланса/запроса — проверь OPENROUTER_API_KEY и баланс на openrouter.ai');
log(`картинки: сделано ${made}${spent ? `, потрачено ≈ $${spent.toFixed(3)}` : ''}`);
if (failed.length) { failed.forEach(m => warn(m)); process.exit(1); }
