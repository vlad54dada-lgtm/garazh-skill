# Пайплайн и формат эпизода

## 0. Карта студии
```
rank-life-studio/
├─ episodes/<ep>/episode.mjs   ЭПИЗОД (данные): стиль, персонажи, уровни, таймлайн
├─ episodes/<ep>/cache/        сгенерированное: img/ (картинки + .json с промптом и ценой), voice/ (mp3 + .json анализа),
│                              cards/ (карточки и карта, PNG из Chrome), seg/ (куски видео), aud/ (куски звука), tmp/
├─ images.mjs                  картинки через OpenRouter (кэш по хэшу промпта)
├─ voice.mjs                   голос рассказчика (fish-audio/drama-3 через OpenRouter или Fish Audio), анализ тишины/громкости
├─ render.mjs                  план → карточки → куски (ffmpeg zoompan) → склейка → звук → mp4 + srt (+ контакт-лист)
├─ make.mjs                    всё подряд: images → voice → render
├─ lib/common.mjs              загрузка эпизода, ключи картинок/голоса, ffmpeg, Chrome
├─ fonts/                      Rubik (карточки)
└─ out/                        <ep>.mp4, <ep>.srt, <ep>_contact.jpg, <ep>_preview.mp4
```

## 1. episode.mjs
```js
export default {
  title: 'Твоя жизнь на каждом ранге …',
  mapTitle: 'Заголовок над картой уровней',          // (опц.)
  imageModel: 'google/gemini-3.1-flash-image',        // любая модель OpenRouter с выводом картинок
  style: '…единый стиль иллюстраций (англ.)…',
  voice: { narrator: '<id голоса fish.audio>', model: 'fish-audio/drama-3', pad: 0.35, lead: 0.12 },
  music: { file: 'music/bed.mp3', db: -20 },           // (опц.) путь от папки эпизода
  theme: { accent: '#e9c46a' },                        // (опц.) цвет «УРОВЕНЬ N» и линеек
  characters: {
    hero:     { prompt: 'внешность героя (англ.)' },                       // лист персонажа: в рост + портрет
    hero_old: { from: 'hero', prompt: 'тот же человек в 40, …' },         // вариант: лист героя идёт референсом
  },
  levels: [ { n: 1, name: 'Тирон', sub: 'новобранец', cover: { prompt: '…', chars: ['hero'] } }, … ],
  timeline: [
    { id: 'hook', say: 'Реплика рассказчика.', img: { prompt: '…', chars: ['hero'] }, move: 'in' },
    { id: 'map', levelmap: true, say: '…' },            // карта уровней из обложек levels[].cover
    { id: 'ch1', chapter: 1, say: 'Уровень первый. Тирон.' },   // карточка на фоне обложки уровня 1 (или своя img)
    { id: 'x', say: '…', img: 'cover:3' },              // ссылка на готовую картинку: 'cover:N' или id другого элемента
    { id: 'y', say: 'длинная реплика', img: [ {…}, {…} ] },     // две картинки на одну реплику (время пополам)
    { id: 'z', img: { prompt: '…' }, hold: 3 },         // кадр без голоса, 3 с
  ],
};
```
Поля элемента таймлайна: `id` (по умолчанию t1, t2…), `say` (текст рассказчика; теги `[спокойно]` не озвучиваются и не идут в субтитры), `img`, `chapter`, `levelmap`, `move` (`in|out|left|right|up|down|still` или `{ z:[a,b], x:[a,b], y:[a,b] }`, x/y — 0..1 доля свободного поля), `pad` (пауза после реплики), `lead` (задержка перед репликой), `hold` (минимальная длительность).
Спека картинки: `{ prompt, chars?: [id…], v?: number }`. `v` — «соль» для перегенерации при том же промпте.

Длительность кадра = `lead + длительность речи + pad` (речь — из mp3 без тишины по краям; без mp3 — оценка по слогам). Карточка главы ≥ 3.2 с, карта ≥ 6 с.

## 2. Команды
```bash
node images.mjs --ep <ep> --dry                       # сколько картинок будет сгенерировано (без запросов)
node images.mjs --ep <ep> --only char:hero,char:hero_old   # только листы персонажей
node images.mjs --ep <ep> [--max 40] [--jobs 4]       # остальное (защита: не больше --max новых за запуск)
node voice.mjs  --ep <ep> [--check]                   # голос (только новые реплики) + сверка STT
node render.mjs --ep <ep> --preview --contact         # превью 960×540 + контакт-лист
node render.mjs --ep <ep> --from ch2 --to marry --preview   # только кусок
node render.mjs --ep <ep> --contact                   # финал 1920×1080 → out/<ep>.mp4 + .srt
node make.mjs --ep <ep> --preview   # всё подряд
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration -of compact out/<ep>.mp4
```
Ключ: `$STUDIO/.env` (читается скриптами сам и перекрывает переменные окружения) или переменная окружения `OPENROUTER_API_KEY`. Флаг `--env-file` не нужен.

## 3. Кэш и деньги
- Картинка: `key = hash(imageModel, полный промпт (стиль + сцена + описание персонажей), ключи листов-референсов, v)`. Поменял стиль или описание героя → перегенерируются ВСЕ кадры с ним. Поэтому стиль и персонажей утверждай до массовой генерации.
- В `cache/img/<key>.json` — промпт и цена (`cost`, $) каждой картинки.
- Голос: `key = hash(model, narrator, text)`; правка одной реплики → один новый TTS.
- Куски видео кэшируются по полному описанию (картинка, движение, длительность, карточка, качество); превью и финал — раздельно.

## 4. Проверка перед сдачей
- [ ] `images.mjs --dry` → «к генерации 0»; `voice.mjs` → «сгенерировано 0», без расхождений `--check`.
- [ ] Контакт-лист: на каждом кадре то, о чём говорится; герой узнаваем; нет текста/лишних пальцев/анахронизмов.
- [ ] ffprobe: h264 1920×1080 30/1, aac 48000 стерео, длительности видео и звука совпадают (±0.05 с).
- [ ] .srt открывается, первые реплики совпадают со звуком.
