// Сборка ролика: node render.mjs --ep <ep> [--preview] [--from <id>] [--to <id>] [--jobs 3] [--contact] [--out file.mp4]
//   Тайминг из длительности реплик (cache/voice), картинки из cache/img, карточки уровней/карта — Chrome → PNG,
//   движение (наезд/отъезд/панорама) — ffmpeg zoompan, каждый кусок кэшируется (cache/seg), склейка без перекодирования,
//   звук: рассказчик + удары на главах (+ музыка из episode.music, приглушается под голосом) → out/<ep>.mp4 + out/<ep>.srt
//   --preview  960×540, быстрый x264 (свой кэш кусков) → out/<ep>_preview.mp4
//   --from/--to  собрать только кусок таймлайна (по id элементов) — для быстрых проверок
//   --contact  контакт-лист out/<ep>_contact.jpg (кадр из середины каждого куска)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, parseArgs, loadEpisode, imageJobs, imgFile, voiceMeta, spoken, sha, mkdirp, fwd, pool, ff, ffAsync, withBrowser, r3, log, warn } from './lib/common.mjs';

const A = parseArgs();
const E = await loadEpisode(A.ep);
const PREVIEW = !!A.preview;
const [FW, FH] = E.size, FPS = E.fps;
const [W, H] = PREVIEW ? [Math.round(FW / 2 / 2) * 2, Math.round(FH / 2 / 2) * 2] : [FW, FH];
const Q = PREVIEW ? { preset: 'veryfast', crf: 24, tag: 'p' } : { preset: 'medium', crf: 18, tag: 'f' };
const SR = 48000;
const { jobs } = imageJobs(E);
const cacheSeg = mkdirp(path.join(E.cache, 'seg', Q.tag)), cacheCard = mkdirp(path.join(E.cache, 'cards')), cacheAud = mkdirp(path.join(E.cache, 'aud'));
const outDir = mkdirp(path.join(ROOT, 'out'));
const t0 = Date.now();

// ---------- 1) план ----------
const level = n => E.levels.find(l => l.n === n) || (() => { throw new Error(`уровень ${n} не описан в levels`); })();
const MOVES = ['in', 'right', 'out', 'left', 'in', 'up', 'out', 'down'];
const moveFor = (it, k) => it.move || MOVES[parseInt(sha(it.id, k).slice(0, 6), 16) % MOVES.length];

function imgOf(it, k, spec) {   // spec: объект (своя картинка) или строка-ссылка ('cover:3' | id элемента)
  if (typeof spec === 'string') {
    const j = jobs.get(spec) || jobs.get(spec + '#1');
    if (!j) throw new Error(`${it.id}: ссылка на картинку «${spec}» не найдена`);
    return { key: j.key, label: spec };
  }
  const id = Array.isArray(it.img) && it.img.length > 1 ? `${it.id}#${k + 1}` : it.id;
  return { key: jobs.get(id).key, label: id };
}

let missingImg = 0, placeholderVoice = 0;
const items = [];
for (const it of E.timeline) {
  const lead = it.lead ?? E.voice.lead, pad = it.pad ?? E.voice.pad;
  const v = it.say ? voiceMeta(E, it.say.trim()) : null;
  if (v?.placeholder) placeholderVoice++;
  const speech = v ? v.end - v.start : 0;
  let kind = 'scene', dur, voiceAt = lead, imgs = [], overlay = null, move;
  if (it.chapter != null) {
    kind = 'chapter'; const lv = level(it.chapter);
    voiceAt = 0.55 + lead; dur = Math.max(3.2, voiceAt + speech + 1.1);
    imgs = [it.img ? imgOf(it, 0, it.img) : imgOf(it, 0, `cover:${lv.n}`)];
    overlay = { type: 'chapter', n: lv.n, name: lv.name, sub: lv.sub || '' }; move = it.move || 'in';
  } else if (it.levelmap) {
    kind = 'map'; dur = Math.max(6, lead + speech + pad + 0.4); move = it.move || 'mapPan';
  } else {
    const list = Array.isArray(it.img) ? it.img : it.img ? [it.img] : [];
    if (!list.length) throw new Error(`${it.id}: нет img (кадру нужна картинка; для карточек — chapter/levelmap)`);
    imgs = list.map((s, k) => imgOf(it, k, s));
    dur = v ? lead + speech + pad : (it.hold ?? 3);
  }
  if (it.hold) dur = Math.max(dur, it.hold);
  const frames = Math.max(2, Math.round(dur * FPS));
  for (const im of imgs) { im.file = imgFile(E, im.key); if (!im.file) missingImg++; }
  items.push({ it, kind, frames, voice: v, voiceAt, imgs, overlay, move });
}
let sel = items;
if (A.from || A.to) {
  const a = A.from ? items.findIndex(x => x.it.id === A.from) : 0, b = A.to ? items.findIndex(x => x.it.id === A.to) : items.length - 1;
  if (a < 0 || b < 0) throw new Error('--from/--to: id не найден в timeline');
  sel = items.slice(a, b + 1);
}
const totalFrames = sel.reduce((s, x) => s + x.frames, 0);
log(`план: ${sel.length} элементов, ${(totalFrames / FPS / 60).toFixed(2)} мин, ${W}×${H}@${FPS}${PREVIEW ? ' (превью)' : ''}`);
if (missingImg) warn(`${missingImg} картинок ещё нет — вместо них серые заглушки (node images.mjs --ep ${E.ep})`);
if (placeholderVoice) warn(`${placeholderVoice} реплик без аудио — тайминг по оценке, дорожка тихая (node voice.mjs --ep ${E.ep})`);

// ---------- 2) карточки и карта (Chrome) ----------
const fontsCss = fwd(path.join(ROOT, 'fonts', 'fonts.css'));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fileUrl = f => pathToFileURL(f).href;
const theme = { accent: '#e9c46a', ...(E.theme || {}) };

function chapterHtml(o) {
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${fileUrl(fontsCss)}"><style>
html,body{margin:0;width:${FW}px;height:${FH}px;background:transparent;overflow:hidden;font-family:Rubik,sans-serif}
.band{position:absolute;inset:auto 0 0 0;height:${Math.round(FH * .55)}px;background:linear-gradient(to top,rgba(8,6,4,.88) 0%,rgba(8,6,4,.55) 45%,rgba(8,6,4,0) 100%)}
.box{position:absolute;left:0;right:0;bottom:${Math.round(FH * .1)}px;text-align:center;color:#fff}
.lvl{font-weight:800;font-size:${Math.round(FH * .042)}px;letter-spacing:.34em;color:${theme.accent};text-shadow:0 3px 14px rgba(0,0,0,.7)}
.name{font-weight:900;font-size:${Math.round(FH * .135)}px;line-height:1;margin-top:${Math.round(FH * .012)}px;text-transform:uppercase;letter-spacing:.02em;text-shadow:0 8px 30px rgba(0,0,0,.8),0 2px 0 rgba(0,0,0,.5)}
.rule{width:${Math.round(FW * .16)}px;height:4px;background:${theme.accent};margin:${Math.round(FH * .024)}px auto 0;border-radius:2px;box-shadow:0 2px 10px rgba(0,0,0,.6)}
.sub{font-weight:700;font-size:${Math.round(FH * .04)}px;margin-top:${Math.round(FH * .022)}px;color:#f3ead6;text-shadow:0 3px 14px rgba(0,0,0,.8)}
</style><div class="band"></div><div class="box"><div class="lvl">УРОВЕНЬ ${o.n}</div><div class="name">${esc(o.name)}</div><div class="rule"></div>${o.sub ? `<div class="sub">${esc(o.sub)}</div>` : ''}</div>`;
}
function mapHtml() {
  const L = E.levels, n = L.length, cols = n <= 4 ? 2 : n <= 9 ? 3 : 4, rows = Math.ceil(n / cols);
  const titleH = E.mapTitle ? 110 : 40, gap = 34, availH = FH - titleH - 60, tileH = Math.floor((availH - gap * (rows - 1)) / rows);
  const tileW = Math.min(Math.floor(tileH * 16 / 9), Math.floor((FW - 160 - gap * (cols - 1)) / cols));
  const tiles = L.map(lv => {
    const j = jobs.get(`cover:${lv.n}`), f = j && imgFile(E, j.key);
    return `<div class="t" style="${f ? `background-image:url('${fileUrl(f)}')` : ''}"><div class="l"><b>Уровень ${lv.n}</b><span>${esc(lv.name)}</span></div></div>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${fileUrl(fontsCss)}"><style>
html,body{margin:0;width:${FW}px;height:${FH}px;overflow:hidden;font-family:Rubik,sans-serif;background:radial-gradient(ellipse at center,#2b241b 0%,#16120d 70%,#0d0b08 100%)}
h1{margin:0;padding-top:34px;height:${titleH - 34}px;text-align:center;color:#f3ead6;font-weight:900;font-size:52px;letter-spacing:.02em;text-shadow:0 4px 16px #000}
.g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:${gap}px;justify-content:center;margin-top:20px}
.t{position:relative;width:${tileW}px;height:${Math.round(tileW * 9 / 16)}px;border-radius:12px;background:#3a3128 center/cover;box-shadow:0 10px 30px rgba(0,0,0,.65),0 0 0 4px #4a3f31,0 0 0 6px #1a1510;overflow:hidden}
.l{position:absolute;inset:auto 0 0 0;padding:44px 18px 14px;background:linear-gradient(to top,rgba(0,0,0,.85),rgba(0,0,0,0));color:#fff;text-align:center;display:flex;flex-direction:column;gap:2px}
.l b{font-weight:900;font-size:30px;text-shadow:0 2px 8px #000}.l span{font-weight:700;font-size:22px;color:${theme.accent};text-shadow:0 2px 8px #000}
</style>${E.mapTitle ? `<h1>${esc(E.mapTitle)}</h1>` : ''}<div class="g">${tiles}</div>`;
}

const cardJobs = [];
const cardFile = (html, scale, transparent) => {
  const key = sha(html, scale, transparent), f = path.join(cacheCard, `${key}.png`);
  if (!fs.existsSync(f)) cardJobs.push({ html, scale, transparent, f, key });
  return f;
};
for (const x of sel) {
  if (x.overlay) x.overlayFile = cardFile(chapterHtml(x.overlay), 1, true);
  if (x.kind === 'map') x.imgs = [{ file: cardFile(mapHtml(), 2, false), key: 'map', label: 'map' }];
}
if (cardJobs.length) {
  await withBrowser(async browser => {
    const page = await browser.newPage();
    for (const c of cardJobs) {
      await page.setViewport({ width: FW, height: FH, deviceScaleFactor: c.scale });
      const html = path.join(cacheCard, `${c.key}.html`); fs.writeFileSync(html, c.html);
      await page.goto(fileUrl(html), { waitUntil: 'load' });
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode?.().catch(() => {}))); });
      await page.screenshot({ path: c.f, omitBackground: c.transparent });
    }
  });
  log(`карточки: ${cardJobs.length} новых`);
}

// ---------- 3) куски видео ----------
const grey = path.join(cacheCard, 'placeholder.png');
if (!fs.existsSync(grey)) ff(['-f', 'lavfi', '-i', `color=c=0x4a4440:s=${FW}x${FH}`, '-frames:v', '1', grey], 'placeholder');

function moveExpr(move, N) {
  const p = `(on/${N - 1})`;
  const M = typeof move === 'object' ? move : ({
    in: { z: [1.0, 1.1] }, out: { z: [1.1, 1.0] }, still: { z: [1.03, 1.03] },
    left: { z: [1.1, 1.1], x: [.78, .22] }, right: { z: [1.1, 1.1], x: [.22, .78] },
    up: { z: [1.1, 1.1], y: [.8, .2] }, down: { z: [1.1, 1.1], y: [.2, .8] },
    mapPan: { z: [1.18, 1.0], x: [.3, .5], y: [.35, .5] },
  })[move];
  if (!M) throw new Error(`неизвестное движение «${move}» (in/out/left/right/up/down/still или {z:[a,b],x:[a,b],y:[a,b]})`);
  const lin = ([a, b] = [.5, .5]) => a === b ? `${a}` : `(${a}+(${b - a})*${p})`;
  return { z: lin(M.z || [1, 1]), x: `(iw-iw/zoom)*${lin(M.x)}`, y: `(ih-ih/zoom)*${lin(M.y)}` };
}

const parts = [];   // { file, args }
let cursor = 0;
for (const [i, x] of sel.entries()) {
  x.start = cursor / FPS; cursor += x.frames;
  const n = x.imgs.length, base = Math.floor(x.frames / n);
  x.imgs.forEach((im, k) => {
    const N = k === n - 1 ? x.frames - base * (n - 1) : base;
    const mv = moveExpr(n > 1 ? moveFor(x.it, k) : (x.move || moveFor(x.it, k)), N);
    const fadeIn = k === 0 && (i === 0 || x.kind === 'chapter') ? 0.45 : 0;
    const fadeOut = k === n - 1 && (i === sel.length - 1 || sel[i + 1]?.kind === 'chapter') ? 0.35 : 0;
    const src = im.file || grey, up = `${W * 2}:${H * 2}`;
    const dur = N / FPS;
    let fc = `[0:v]scale=${up}:force_original_aspect_ratio=increase:flags=lanczos,crop=${up},setsar=1,` +
      `zoompan=z='${mv.z}':x='${mv.x}':y='${mv.y}':d=${N}:s=${W}x${H}:fps=${FPS}`;
    const inputs = ['-i', src];
    if (x.overlayFile && k === 0) {
      inputs.push('-loop', '1', '-framerate', `${FPS}`, '-t', `${r3(dur + 0.1)}`, '-i', x.overlayFile);
      fc += `[b];[1:v]scale=${W}:${H},format=rgba,fade=t=in:st=0.35:d=0.55:alpha=1,fade=t=out:st=${r3(Math.max(0.9, dur - 0.55))}:d=0.45:alpha=1[o];[b][o]overlay=shortest=1:format=auto`;
    }
    if (fadeIn) fc += `,fade=t=in:st=0:d=${fadeIn}`;
    if (fadeOut) fc += `,fade=t=out:st=${r3(dur - fadeOut)}:d=${fadeOut}`;
    fc += ',format=yuv420p[v]';
    const key = sha(fc, im.file ? im.key : 'grey', x.overlayFile ? path.basename(x.overlayFile) : '', Q);
    const file = path.join(cacheSeg, `${key}.mp4`);
    parts.push({ file, label: `${x.it.id}${n > 1 ? '#' + (k + 1) : ''}`, mid: x.start + (base * k + N / 2) / FPS,
      args: [...inputs, '-filter_complex', fc, '-map', '[v]', '-frames:v', `${N}`, '-r', `${FPS}`, '-c:v', 'libx264', '-preset', Q.preset, '-crf', `${Q.crf}`,
        '-pix_fmt', 'yuv420p', '-video_track_timescale', `${FPS * 512}`, '-an', file + '.part.mp4'] });
  });
}
const todoParts = parts.filter(p => !fs.existsSync(p.file));
log(`видео: кусков ${parts.length}, новых ${todoParts.length}`);
let done = 0;
await pool(todoParts, +(A.jobs ?? 3), async p => {
  await ffAsync(p.args, p.label); fs.renameSync(p.file + '.part.mp4', p.file);
  done++; if (done % 5 === 0 || done === todoParts.length) process.stdout.write(`\r  кусков: ${done}/${todoParts.length}   `);
});
if (todoParts.length) process.stdout.write('\n');
const tag = (PREVIEW ? '_preview' : '') + (A.from || A.to ? '_part' : '');
const tmp = mkdirp(path.join(E.cache, 'tmp'));
const listV = path.join(tmp, 'video.txt');
fs.writeFileSync(listV, parts.map(p => `file '${fwd(p.file).replace(/'/g, "'\\''")}'`).join('\n'));
const videoOnly = path.join(tmp, `video${tag}.mp4`);
ff(['-f', 'concat', '-safe', '0', '-i', listV, '-c', 'copy', videoOnly], 'concat video');

// ---------- 4) звук ----------
const pieces = [];
for (const x of sel) {
  const samples = Math.round(x.frames * SR / FPS);
  const v = x.voice && !x.voice.placeholder ? x.voice : null;
  const key = sha('piece', samples, v ? [v.key, v.start, v.end, v.gain, x.voiceAt] : 'silence');
  const f = path.join(cacheAud, `${key}.wav`);
  if (!fs.existsSync(f)) {
    if (v) ff(['-i', v.mp3, '-af', `atrim=${v.start}:${v.end},asetpts=PTS-STARTPTS,aresample=${SR},volume=${v.gain}dB,pan=stereo|c0=c0|c1=c0,` +
      `adelay=${Math.round(x.voiceAt * 1000)}:all=1,apad=whole_len=${samples},atrim=end_sample=${samples}`, '-ar', `${SR}`, '-c:a', 'pcm_s16le', f], `voice ${x.it.id}`);
    else ff(['-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo`, '-af', `atrim=end_sample=${samples}`, '-c:a', 'pcm_s16le', f], 'silence');
  }
  pieces.push(f);
}
const listA = path.join(tmp, 'audio.txt');
fs.writeFileSync(listA, pieces.map(f => `file '${fwd(f)}'`).join('\n'));
const narration = path.join(tmp, `narration${tag}.wav`);
ff(['-f', 'concat', '-safe', '0', '-i', listA, '-c', 'copy', narration], 'concat audio');

// удары на главах и «вжух» на карте — синтез (ffmpeg aevalsrc), без внешних файлов
const totalSec = r3(totalFrames / FPS);
const hits = sel.filter(x => x.kind === 'chapter' || x.kind === 'map').map(x => ({ t: x.start + (x.kind === 'chapter' ? 0.3 : 0.05), kind: x.kind }));
const boom = "0.9*sin(2*PI*(42+70*exp(-7*t))*t)*exp(-3.2*t)+0.25*sin(2*PI*84*t)*exp(-6*t)";
const swish = "(random(0)*2-1)*pow(sin(PI*min(t,1.1)/1.1),2)*0.5";
const sfxInputs = [], sfxChains = [];
hits.forEach((h, i) => {
  sfxInputs.push('-f', 'lavfi', '-i', `aevalsrc='${h.kind === 'chapter' ? boom : swish}':s=${SR}:d=${h.kind === 'chapter' ? 2.2 : 1.2}`);
  sfxChains.push(`[${i}:a]${h.kind === 'map' ? 'highpass=f=400,lowpass=f=2500,' : 'lowpass=f=900,'}aformat=channel_layouts=stereo,volume=${h.kind === 'chapter' ? -9 : -14}dB,adelay=${Math.round(h.t * 1000)}:all=1[h${i}]`);
});
// входы финальной склейки: 0 — видео, 1 — рассказчик, дальше — удары и музыка
let mixInputs = ['-i', narration], filter = [], mixLabels = ['[1:a]'];
let idx = 2;
if (hits.length) {
  const sfx = path.join(tmp, `sfx${tag}.wav`);
  ff([...sfxInputs, '-filter_complex', `${sfxChains.join(';')};${hits.map((_, i) => `[h${i}]`).join('')}amix=inputs=${hits.length}:normalize=0,apad=whole_dur=${totalSec},atrim=0:${totalSec}[s]`,
    '-map', '[s]', '-ar', `${SR}`, '-c:a', 'pcm_s16le', sfx], 'sfx');
  mixInputs.push('-i', sfx); mixLabels.push(`[${idx++}:a]`);
}
if (E.music?.file) {
  const mf = path.resolve(E.dir, E.music.file);
  if (!fs.existsSync(mf)) warn(`музыка не найдена: ${mf}`);
  else {
    mixInputs.push('-stream_loop', '-1', '-i', mf);
    filter.push(`[${idx}:a]aresample=${SR},aformat=channel_layouts=stereo,volume=${E.music.db ?? -20}dB,atrim=0:${totalSec},afade=t=out:st=${Math.max(0, totalSec - 3)}:d=3[m]`,
      `[1:a]asplit=2[nar][key]`,`[m][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=600[md]`);
    mixLabels[0] = '[nar]'; mixLabels.push('[md]'); idx++;
  }
}
filter.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:duration=first,alimiter=limit=0.89:level=disabled[a]`);
const outFile = A.out ? path.resolve(A.out) : path.join(outDir, `${E.ep}${tag}.mp4`);
ff(['-i', videoOnly, ...mixInputs, '-filter_complex', filter.join(';'), '-map', '0:v', '-map', '[a]',
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outFile], 'mux');

// ---------- 5) субтитры .srt ----------
const ts = s => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
const srt = []; let n = 0;
for (const x of sel) {
  if (!x.it.say) continue;
  const text = spoken(x.it.say), a = x.start + x.voiceAt, b = a + (x.voice.end - x.voice.start);
  const chunks = []; let cur = '';
  for (const w of text.split(' ')) { if ((cur + ' ' + w).trim().length > 84 && cur) { chunks.push(cur.trim()); cur = ''; } cur += ' ' + w; }
  if (cur.trim()) chunks.push(cur.trim());
  const total = chunks.reduce((s, c) => s + c.length, 0); let acc = 0;
  for (const c of chunks) {
    const s = a + (b - a) * acc / total; acc += c.length; const e = a + (b - a) * acc / total;
    const wrap = c.length > 42 ? c.replace(new RegExp(`^(.{${Math.floor(c.length / 2) - 8},${Math.floor(c.length / 2) + 10}}?)\\s`), '$1\n') : c;
    srt.push(`${++n}\n${ts(s)} --> ${ts(e)}\n${wrap}\n`);
  }
}
const srtFile = outFile.replace(/\.mp4$/i, '.srt');
fs.writeFileSync(srtFile, srt.join('\n'));

// ---------- 6) контакт-лист ----------
if (A.contact) {
  const shots = parts.map(p => p.mid);
  const cols = 6, contact = outFile.replace(/\.mp4$/i, '_contact.jpg');
  const sel2 = shots.map(t => `lt(prev_pts*TB\\,${r3(t)})*gte(pts*TB\\,${r3(t)})`).join('+');
  ff(['-i', outFile, '-vf', `select='${sel2}',scale=320:-2,tile=${cols}x${Math.ceil(shots.length / cols)}:padding=4`,
    '-frames:v', '1', '-q:v', '3', contact], 'contact');
  log(`контакт-лист: ${path.relative(ROOT, contact)}`);
}
log(`готово: ${path.relative(ROOT, outFile)} (${(totalFrames / FPS).toFixed(1)} с) + ${path.basename(srtFile)} за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
