// Пилот: «Твоя жизнь на каждом ранге римского легиона» — вступление, карта 9 уровней, подробно уровни 1–3 (≈2 мин).
// Факты: Вегеций, «Эпитома военного дела» I.11, I.9, II.5; Тацит, «Анналы» I.17, I.23; жалованье при Августе — 225 денариев в год;
// контуберний — 8 человек на палатку; запрет браков для солдат — до Септимия Севера (197 г.).
export default {
  title: 'Твоя жизнь на каждом ранге римского легиона',
  mapTitle: 'Римский легион: девять ступеней',
  imageModel: 'google/gemini-3.1-flash-image',
  style: [
    'Detailed hand-drawn digital illustration in the style of a modern historical graphic novel:',
    'clean confident dark ink outlines, rich environmental detail, muted earthy palette (ochre, umber, olive, slate blue, dusty red),',
    'soft cel shading with subtle paper grain, natural cinematic lighting, slightly stylized but realistic proportions,',
    'expressive faces with clear readable emotions, historically accurate clothing, armor and architecture of the early Roman Empire (1st century AD).',
  ].join(' '),
  voice: { narrator: '7312c38557eb4fb384e3874e8e9cea67' },   // fish.audio «Мужской Профессиональный» — спокойный рассказчик, ru

  characters: {
    hero: { prompt: 'Lucius, a 17-year-old farm boy from northern Italy, 1st century AD: short dark curly hair, slim but wiry build, olive skin, slightly big ears, honest wide-eyed face, plain off-white wool tunic with a rope belt, worn leather sandals' },
    hero_legionary: { from: 'hero', prompt: 'Lucius at 20 as a Roman legionary: tanned, more muscular, short military haircut, red wool tunic, segmented iron armor (lorica segmentata), neck scarf, hobnailed caligae boots, gladius on the right hip, no helmet' },
    hero_immunis: { from: 'hero', prompt: 'Lucius at 26 as a legion craftsman (immunis): short dark beard, small scar through the left eyebrow, red tunic with a heavy leather work apron, forearms with soot, a hammer tucked in the belt' },
    centurion: { prompt: 'a stern Roman centurion in his late 40s: weathered square face, broken nose, grey stubble, helmet with a transverse red horsehair crest, mail shirt with round silver phalerae medals, greaves, a twisted vine stick (vitis) in his hand' },
  },

  levels: [
    { n: 1, name: 'Тирон', sub: 'новобранец', cover: { prompt: 'a young recruit swings a wooden practice sword at a tall wooden post in a dusty training field outside a Roman fort, wicker shield on his arm, morning light', chars: ['hero'] } },
    { n: 2, name: 'Легионер', sub: 'милес, рядовой', cover: { prompt: 'a legionary marches in a long column of soldiers on a stone Roman road through green hills, carrying a pole with his kit over the shoulder, eagle standard far ahead', chars: ['hero_legionary'] } },
    { n: 3, name: 'Иммун', sub: 'мастер без нарядов', cover: { prompt: 'a legion smith hammers a red-hot blade on an anvil in a busy fortress workshop full of sparks, tools and armor pieces', chars: ['hero_immunis'] } },
    { n: 4, name: 'Тессерарий', sub: 'начальник караула', cover: { prompt: 'at dusk a Roman guard officer hands a small wax tablet with the night watchword to two sentries at the torch-lit gate of a timber fort' } },
    { n: 5, name: 'Опцион', sub: 'заместитель центуриона', cover: { prompt: 'a Roman optio at the rear of a battle line pushes wavering soldiers back into formation with a long knobbed staff, dust and shouting' } },
    { n: 6, name: 'Аквилифер', sub: 'несущий орла', cover: { prompt: 'a proud Roman aquilifer wearing a lion pelt over his helmet holds the golden eagle standard high above the legion at sunrise' } },
    { n: 7, name: 'Центурион', sub: 'командир сотни', cover: { prompt: 'a centurion stands in front of eighty legionaries in perfect ranks on a parade ground, inspecting them with a cold stare', chars: ['centurion'] } },
    { n: 8, name: 'Примипил', sub: 'первый центурион легиона', cover: { prompt: 'a senior Roman centurion in ornate armor covered with medals stands in the shrine of a stone fortress headquarters beside the legion\'s eagle, torchlight' } },
    { n: 9, name: 'Префект лагеря', sub: 'хозяин крепости', cover: { prompt: 'a grey-haired Roman camp prefect in a fine cloak watches from a rampart as soldiers build a huge stone legionary fortress below, cranes and scaffolding' } },
  ],

  timeline: [
    { id: 'hook', say: 'Представь: тебе семнадцать, ты сын крестьянина из северной Италии, и впереди у тебя двадцать пять лет службы в армии, которая покорила полмира.',
      img: { prompt: 'a farm boy leans on a wooden fence of his family farm at golden hour and stares at a long Roman army column marching on a distant road through the valley', chars: ['hero'] }, move: 'in' },
    { id: 'promise', say: 'Сегодня мы пройдём весь путь римского солдата: от безусого новобранца до человека, который управляет целой крепостью.',
      img: { prompt: 'epic wide view of a Roman legion marching across a stone bridge toward a huge legionary fortress on a river, banners and the golden eagle glinting, dramatic clouds' }, move: 'right' },
    { id: 'map', levelmap: true, say: 'Девять ступеней. И на каждой — своя жизнь, свои деньги и свои способы умереть.' },

    { id: 'ch1', chapter: 1, say: 'Уровень первый. Тирон.' },
    { id: 'probatio', say: 'Всё начинается с проверки. Тебя меряют, смотрят зубы и глаза и спрашивают, не беглый ли ты раб. Рабов в легион не берут.',
      img: { prompt: 'inside a Roman recruiting office a bored clerk with a wax tablet measures a nervous young recruit against a marked wooden post, while an old army medic with a bare face and no glasses peers into his mouth; other recruits wait on a bench', chars: ['hero'] } },
    { id: 'oath', say: 'Прошёл? Поздравляю. На шею тебе вешают свинцовую бирку с именем, ты приносишь клятву императору, и с этой минуты твоя жизнь тебе не принадлежит.',
      img: { prompt: 'a row of young recruits with right hands raised swear an oath in front of Roman military standards in a fortress courtyard; the closest one wears a small lead tag on a cord around his neck and looks solemn and a little scared', chars: ['hero'] } },
    { id: 'palus', say: 'Дальше — четыре месяца учёбы. Деревянный меч и плетёный щит, вдвое тяжелее настоящих. Ты рубишь деревянный столб, пока не отваливаются руки.',
      img: { prompt: 'a sweating exhausted recruit hacks at a tall wooden post with a heavy wooden sword and a wicker shield; rows of other recruits do the same on a dusty training ground', chars: ['hero'] }, move: 'left' },
    { id: 'march', say: 'И марши. Двадцать миль за пять часов, с поклажей на шесте за плечом. Солдат с таким грузом сами римляне называли «мулами Мария».',
      img: { prompt: 'a column of recruits marches uphill on a dusty road in the heat, each carrying a T-shaped pole over the shoulder loaded with a sack, cooking pot and tools; the boy in front is red-faced and panting', chars: ['hero'] } },
    { id: 'vitis', say: 'А если ты отстаёшь, тебя подбадривает центурион. Виноградной палкой. Одного такого солдаты прозвали «Подай другую»: он ломал палки о спины и требовал новую.',
      img: { prompt: 'an angry centurion raises his vine stick and shouts at a frightened recruit who stumbled on the march; a broken stick lies on the ground', chars: ['centurion', 'hero'] } },

    { id: 'ch2', chapter: 2, say: 'Уровень второй. Легионер.' },
    { id: 'pay', say: 'Учёба позади, ты — полноценный легионер. Жалованье — двести двадцать пять денариев в год. Звучит неплохо.',
      img: { prompt: 'a proud young legionary receives a small heap of silver coins from a clerk at a wooden table in a fortress office, sunlight through a small window', chars: ['hero_legionary'] } },
    { id: 'deduct', say: 'Но не спеши радоваться. Из них вычтут за еду, одежду, сапоги и даже взнос в похоронную кассу. До кошелька доходит немного.',
      img: { prompt: 'in a plain stone fortress office with a small square window, an elderly bald clerk (no glasses) calmly rakes most of the silver coins across the wooden table into his own leather money bag with his forearm, while the young legionary standing at the table stares in disbelief at the three coins left in his open palm', chars: ['hero_legionary'] }, move: 'in' },
    { id: 'tent', say: 'Живёшь ты в контубернии: восемь человек на одну кожаную палатку, одного мула и один котёл с кашей.',
      img: { prompt: 'eight Roman soldiers crammed inside a low leather tent at night around a small fire with a pot of porridge, elbows in each other\'s faces, one snoring, the young legionary squeezed in the middle', chars: ['hero_legionary'] } },
    { id: 'camp', say: 'А в походе каждый вечер — лопата. Римская армия на ночь строит себе лагерь: ров, вал, частокол. Каждый. Божий. Вечер.',
      img: { prompt: 'at sunset hundreds of legionaries dig a ditch and build an earth rampart with a wooden palisade around a marching camp; the young legionary, covered in dirt, leans on his pickaxe-shovel with a tired face', chars: ['hero_legionary'] }, move: 'right' },
    { id: 'marry', say: 'Ах да, жениться тебе нельзя. Официально — до самого конца службы.',
      img: { prompt: 'a young legionary in armor says a sad goodbye to a village girl at a garden gate, she holds his hand, the army column waits on the road behind', chars: ['hero_legionary'] } },

    { id: 'ch3', chapter: 3, say: 'Уровень третий. Иммун.' },
    { id: 'immunes', say: 'Но если у тебя есть голова и руки, можно подняться без единой битвы. Иммуны — это кузнецы, плотники, лекари, писари и землемеры легиона.',
      img: { prompt: 'a busy workshop inside a Roman fortress: smiths at anvils, a carpenter shaping a beam, a medic rolling bandages, a clerk with scrolls; the bearded craftsman in a leather apron in the foreground inspects a fresh blade', chars: ['hero_immunis'] } },
    { id: 'munera', say: 'Главная награда — свобода от грязных нарядов. Ты больше не чистишь отхожие места и не таскаешь дрова.',
      img: { prompt: 'a satisfied craftsman in a leather apron strolls past grumbling legionaries who carry firewood and buckets and scrub a latrine channel', chars: ['hero_immunis'] }, move: 'left' },
    { id: 'bribe', say: 'Остальным такую свободу приходилось покупать. Тацит пишет, что солдаты платили центурионам за освобождение от работ.',
      img: { prompt: 'behind a row of tents a legionary secretly slips a few coins into the palm of a centurion who pretends to look away', chars: ['centurion'] } },
    { id: 'tease', say: 'Жалованье почти то же, зато спина целее. А дальше начинается настоящая лестница: пароли, ночные караулы и золотой орёл. Но об этом — в следующей части.',
      img: { prompt: 'at sunset the bearded craftsman stands on a fortress wall looking up at the golden eagle standard against a burning orange sky', chars: ['hero_immunis'] }, move: 'out', pad: 1.2 },
  ],
};
