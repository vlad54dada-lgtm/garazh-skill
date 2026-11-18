// Общие помощники студии rank-life: эпизод, план, хэши, ffmpeg, Chrome.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// .env студии читается сам и ПЕРЕКРЫВАЕТ переменные окружения (node --env-file так не умеет: там окружение главнее,
// и старый/просроченный ключ из системы побеждал бы свежий из .env). Пустые значения игнорируются.
(() => {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (v) process.env[m[1]] = v;
  }
})();
export const r3 = x => Math.round(x * 1000) / 1000;
export const sha = (...parts) => createHash('sha1').update(parts.map(p => typeof p === 'string' ? p : JSON.stringify(p)).join('\n')).digest('hex').slice(0, 14);
export const mkdirp = d => (fs.mkdirSync(d, { recursive: true }), d);
export const fwd = p => p.replace(/\\/g, '/');
export const log = (...a) => console.log(...a);
export const warn = m => console.warn('!! ' + m);

// --key value | --flag
export function parseArgs(argv = process.argv.slice(2)) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2), v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
  }
  return o;
}

// ---------- эпизод ----------
// episodes/<ep>/episode.mjs → export default { title, style, characters, levels, timeline, … } (см. references/pipeline.md)
export async function loadEpisode(ep) {
  if (!ep || !/^[\w-]+$/.test(ep)) throw new Error('нужен --ep <имя> (латиница/цифры/-/_)');
  const dir = path.join(ROOT, 'episodes', ep), file = path.join(dir, 'episode.mjs');
  if (!fs.existsSync(file)) throw new Error(`нет ${path.relative(ROOT, file)}`);
  const E = { ...(await import(pathToFileURL(file).href + '?t=' + Date.now())).default };
  E.ep = ep; E.dir = dir; E.cache = path.join(dir, 'cache');
  E.size ??= [1920, 1080]; E.fps ??= 30;
  E.imageModel ??= 'google/gemini-3.1-flash-image';
  E.aspect ??= '16:9';
  E.voice = { model: 'fish-audio/drama-3', pad: 0.35, lead: 0.12, ...(E.voice || {}) };
  E.characters ??= {}; E.levels ??= []; E.timeline ??= [];
  // id элементов таймлайна: свой id или t<номер>
  E.timeline.forEach((it, i) => { it.id ??= `t${i + 1}`; });
  const ids = new Set();
  for (const it of E.timeline) { if (ids.has(it.id)) throw new Error(`дубль id в timeline: ${it.id}`); ids.add(it.id); }
  for (const lv of E.levels) if (!lv.n || !lv.name) throw new Error(`уровень без n/name: ${JSON.stringify(lv)}`);
  return E;
}

// ---------- картинки: задания и ключи (детерминированно из эпизода, без файлов) ----------
const STYLE_TAIL = 'Wide cinematic 16:9 frame. No text, no letters, no captions, no speech bubbles, no borders, no watermark, no signature.';

export function imageJobs(E) {
  const jobs = new Map();   // id → { id, kind, prompt, refs:[charId], key }
  const charKey = {};
  const charOrder = [];
  const visit = (id, stack = []) => {
    if (charKey[id]) return;
    const c = E.characters[id];
    if (!c) throw new Error(`персонаж «${id}» не описан в characters`);
    if (stack.includes(id)) throw new Error(`цикл from: ${[...stack, id].join(' → ')}`);
    if (c.from) visit(c.from, [...stack, id]);
    const refs = c.from ? [c.from] : [];
    const prompt = [E.style,
      c.from ? `Character model sheet of the SAME person as in the reference image (keep face, features and build identical), now: ${c.prompt}`
        : `Character model sheet: ${c.prompt}`,
      'Left: full-body front view standing. Right: head-and-shoulders close-up portrait. Plain light neutral background, even lighting.',
      'No text, no letters, no labels, no watermark.'].join('\n\n');
    const key = sha(E.imageModel, prompt, refs.map(r => charKey[r]), c.v ?? 0);
    charKey[id] = key; charOrder.push(id);
    jobs.set('char:' + id, { id: 'char:' + id, kind: 'char', prompt, refs, refKeys: refs.map(r => charKey[r]), key, aspect: '16:9' });
  };
  Object.keys(E.characters).forEach(id => visit(id));

  const scene = (id, spec) => {
    if (typeof spec === 'string') return;   // ссылка на чужую картинку
    const chars = spec.chars || [];
    chars.forEach(c => visit(c));
    const castNote = chars.length ? 'Characters (must match the reference images exactly — same face, hair, build, age as in the reference):\n' +
      chars.map((c, i) => `- reference image ${i + 1}: ${E.characters[c].prompt}`).join('\n') : '';
    const prompt = [E.style, `Scene: ${spec.prompt}`, castNote, STYLE_TAIL].filter(Boolean).join('\n\n');
    const key = sha(E.imageModel, prompt, chars.map(c => charKey[c]), spec.v ?? 0);
    jobs.set(id, { id, kind: 'scene', prompt, refs: chars, refKeys: chars.map(c => charKey[c]), key, aspect: E.aspect });
  };
  for (const lv of E.levels) if (lv.cover) scene(`cover:${lv.n}`, lv.cover);
  for (const it of E.timeline) {
    const imgs = Array.isArray(it.img) ? it.img : it.img ? [it.img] : [];
    imgs.forEach((s, k) => scene(imgs.length > 1 ? `${it.id}#${k + 1}` : it.id, s));
  }
  return { jobs, charKey, charOrder };
}

export function imgFile(E, key) {
  const dir = path.join(E.cache, 'img');
  for (const ext of ['png', 'jpg', 'webp']) { const f = path.join(dir, `${key}.${ext}`); if (fs.existsSync(f)) return f; }
  return null;
}

// ---------- озвучка: ключ реплики ----------
export const spoken = t => t.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
export const voiceKey = (E, text) => sha(E.voice.model, E.voice.narrator, text);
export function estimateDur(text) {
  const w = spoken(text).split(' ').filter(Boolean);
  const syl = w.reduce((s, x) => s + Math.max(1, (x.toLowerCase().match(/[аеёиоуыэюяaeiouy]/g) || []).length), 0);
  return r3(0.3 + syl * 0.075 + w.length * 0.05);   // рассказчик ≈ 13 слогов/с
}
export function voiceMeta(E, text) {
  const key = voiceKey(E, text), dir = path.join(E.cache, 'voice');
  const mp3 = path.join(dir, `${key}.mp3`), json = path.join(dir, `${key}.json`);
  if (fs.existsSync(mp3) && fs.existsSync(json)) return { key, mp3, ...JSON.parse(fs.readFileSync(json, 'utf8')) };
  const d = estimateDur(text);
  return { key, mp3: null, dur: d, start: 0, end: d, gain: 0, placeholder: true };
}

// ---------- ffmpeg ----------
export function ff(args, label = 'ffmpeg') {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-v', 'error', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) throw new Error(`ffmpeg не найден в PATH (${r.error.message})`);
  if (r.status !== 0) throw new Error(`${label}: ffmpeg failed\n${r.stderr.slice(-3000)}`);
  return r.stderr;
}
export function ffAsync(args, label = 'ffmpeg') {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-v', 'error', ...args]);
    let err = ''; p.stderr.on('data', d => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('error', e => rej(new Error(`ffmpeg: ${e.message}`)));
    p.on('close', c => c === 0 ? res() : rej(new Error(`${label}: ffmpeg failed\n${err.slice(-3000)}`)));
  });
}
export function ffLog(args) {   // ffmpeg с -v info, вернуть stderr (для silencedetect/ebur128)
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed\n${r.stderr.slice(-2000)}`);
  return r.stderr;
}
export function probeDur(file) {
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = +p.stdout; if (!(d > 0)) throw new Error(`ffprobe: нет длительности у ${file}`); return d;
}

// пул: n параллельных задач
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---------- Chrome (карточки уровней и карта) ----------
export async function withBrowser(fn) {
  const { default: puppeteer } = await import('puppeteer-core');
  const exe = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || findChrome();
  let browser;
  try { browser = await puppeteer.launch({ ...(exe ? { executablePath: exe } : { channel: 'chrome' }), headless: true, args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] }); }
  catch (e) { throw new Error(`не удалось запустить Chrome (нужен Google Chrome или CHROME_PATH): ${e.message}`); }
  try { return await fn(browser); } finally { await browser.close(); }
}
function findChrome() {
  const c = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return c.find(f => fs.existsSync(f)) || null;
}
