// Голос рассказчика: node voice.mjs --ep <ep> [--dry] [--check] [--jobs 3]
//   Каждое `say` таймлайна → mp3 (fish-audio/drama-3 через OpenRouter, или FISH_AUDIO_API_KEY напрямую) → кэш
//   episodes/<ep>/cache/voice/<key>.mp3 + .json { dur, start, end, gain, lufs }. key = hash(модель + голос + текст).
//   Без ключа ничего не генерируется: render.mjs берёт длительность по оценке (тихая дорожка).
//   --check  прогнать новые клипы через speech-to-text (OpenRouter, openai/gpt-transcribe) и показать расхождения.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, loadEpisode, voiceKey, spoken, mkdirp, pool, ffLog, probeDur, r3, log, warn } from './lib/common.mjs';

const A = parseArgs();
const E = await loadEpisode(A.ep);
if (!E.voice.narrator) throw new Error('voice.narrator (id голоса fish.audio) не задан в episode.mjs');
const dir = mkdirp(path.join(E.cache, 'voice'));
const TARGET_LUFS = -16;

const lines = E.timeline.filter(it => it.say).map(it => ({ id: it.id, text: it.say.trim(), key: voiceKey(E, it.say.trim()) }));
const uniq = [...new Map(lines.map(l => [l.key, l])).values()];
const todo = uniq.filter(l => !fs.existsSync(path.join(dir, `${l.key}.mp3`)));
const words = lines.reduce((s, l) => s + spoken(l.text).split(' ').length, 0);
log(`голос: реплик ${lines.length} (${words} слов ≈ ${(words / 150).toFixed(1)} мин), в кэше ${uniq.length - todo.length}, к генерации ${todo.length}`);
if (A.dry) process.exit(0);

const PROVIDER = A.provider || process.env.VOICE_PROVIDER || (process.env.OPENROUTER_API_KEY ? 'openrouter' : process.env.FISH_AUDIO_API_KEY ? 'fish' : null);
if (todo.length && !PROVIDER) { warn('нет ключа TTS: OPENROUTER_API_KEY или FISH_AUDIO_API_KEY в .env студии'); process.exit(2); }

async function tts(text) {
  let res;
  if (PROVIDER === 'fish') {
    res = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST', signal: AbortSignal.timeout(180000),
      headers: { Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`, 'Content-Type': 'application/json', model: E.voice.model.replace(/^fish-audio\//, '') },
      body: JSON.stringify({ text, reference_id: E.voice.narrator, format: 'mp3' }),
    });
  } else {
    res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST', signal: AbortSignal.timeout(180000),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: E.voice.model, input: text, voice: E.voice.narrator, response_format: 'mp3' }),
    });
  }
  if (!res.ok) throw new Error(`tts HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`подозрительно короткий ответ TTS (${buf.length} байт)`);
  return buf;
}

// начало/конец речи (обрезаем тишину по краям) и громкость
function analyse(mp3) {
  const dur = probeDur(mp3);
  const s = ffLog(['-i', mp3, '-af', 'silencedetect=n=-38dB:d=0.06', '-f', 'null', '-']);
  const sil = []; let open = null;
  for (const m of s.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') open = Math.max(0, +m[2]); else if (open != null) { sil.push([open, +m[2]]); open = null; }
  }
  if (open != null) sil.push([open, dur]);
  let start = 0, end = dur;
  if (sil.length && sil[0][0] < 0.02) start = sil[0][1];
  const last = sil[sil.length - 1];
  if (last && last[1] > dur - 0.02 && last[0] > start) end = last[0];
  const L = ffLog(['-i', mp3, '-af', 'ebur128', '-f', 'null', '-']).match(/I:\s+(-?[\d.]+) LUFS/);
  const lufs = L && +L[1] > -70 ? +L[1] : null;
  return { dur: r3(dur), start: r3(Math.max(0, start - 0.03)), end: r3(Math.min(dur, end + 0.08)), lufs, gain: r3(lufs == null ? 0 : TARGET_LUFS - lufs) };
}

let made = 0, stop = false; const failed = [];
await pool(todo, +(A.jobs ?? 3), async l => {
  if (stop) return;
  try {
    const buf = await tts(l.text);
    const mp3 = path.join(dir, `${l.key}.mp3`);
    fs.writeFileSync(mp3 + '.part', buf); fs.renameSync(mp3 + '.part', mp3);
    fs.rmSync(path.join(dir, `${l.key}.json`), { force: true });
    made++; log(`  ✓ ${l.id}  «${spoken(l.text).slice(0, 60)}${l.text.length > 60 ? '…' : ''}»`);
  } catch (e) { failed.push(`${l.id}: ${e.message}`); if (/HTTP 40[0-3]/.test(e.message)) stop = true; }   // ключ/баланс — дальше не долбим
});
// анализ всего, у чего нет .json (в т.ч. старых клипов)
for (const l of uniq) {
  const mp3 = path.join(dir, `${l.key}.mp3`), json = path.join(dir, `${l.key}.json`);
  if (fs.existsSync(mp3) && !fs.existsSync(json)) fs.writeFileSync(json, JSON.stringify({ text: l.text, ...analyse(mp3) }, null, 1));
}

if (A.check) {
  if (!process.env.OPENROUTER_API_KEY) warn('--check требует OPENROUTER_API_KEY');
  else for (const l of uniq) {
    const json = path.join(dir, `${l.key}.json`); if (!fs.existsSync(json)) continue;
    const meta = JSON.parse(fs.readFileSync(json, 'utf8'));
    if (meta.transcript == null) {
      const wav = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, `${l.key}.mp3`), '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'], { maxBuffer: 1 << 27 });
      const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-transcribe', input_audio: { data: wav.stdout.toString('base64'), format: 'wav' }, language: 'ru' }),
      });
      if (!res.ok) { warn(`${l.id}: транскрипция HTTP ${res.status}`); continue; }
      meta.transcript = String((await res.json()).text ?? ''); fs.writeFileSync(json, JSON.stringify(meta, null, 1));
    }
    const norm = s => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
    if (norm(spoken(l.text)) !== norm(meta.transcript)) log(`check ${l.id}: РАСХОЖДЕНИЕ\n   текст:    «${spoken(l.text)}»\n   услышано: «${meta.transcript}»`);
  }
}
log(`голос: сгенерировано ${made}`);
if (failed.length) { failed.forEach(m => warn(m)); process.exit(1); }
