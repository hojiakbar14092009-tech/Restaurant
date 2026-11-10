// One-off asset script: finds CC0 / public-domain food photos on Wikimedia Commons,
// converts them to 800x600 WebP in public/assets/menu and records credits.
//   node scripts/fetch-menu-images.mjs sheet   -> candidate contact sheets (scripts/.cache)
//   node scripts/fetch-menu-images.mjs         -> final images using PICKS below
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const UA = 'LumiereRestaurantDemo/1.0 (local asset script)';
const CACHE = 'scripts/.cache';
const OUT = 'public/assets/menu';
const PER = 4;

// slug -> search query
const ITEMS = {
  'classic-bucket': 'fried chicken',
  'crispy-drumsticks': 'fried chicken drumstick',
  'hot-wings': 'chicken wings',
  'golden-strips': 'chicken tenders',
  'popcorn-bites': 'chicken nuggets',
  'crispy-chicken-burger': 'chicken burger',
  'double-cheeseburger': 'cheeseburger',
  'classic-twister': 'chicken wrap',
  'spicy-twister': 'tortilla wrap',
  fries: 'french fries',
  coleslaw: 'coleslaw salad',
  corn: 'corn on the cob',
  'onion-rings': 'onion rings',
  'mashed-potatoes': 'mashed potatoes',
  sundae: 'ice cream sundae',
  brownie: 'chocolate brownie',
  'apple-pie': 'apple pie',
  donut: 'doughnut',
  cola: 'cola glass',
  'orange-juice': 'orange juice',
  lemonade: 'lemonade',
  cappuccino: 'cappuccino',
  'black-tea': 'cup of tea',
  milkshake: 'milk shake',
};

// slug -> candidate index chosen after looking at the contact sheets
const PICKS = {
  'classic-bucket': 1, 'golden-strips': 2, 'crispy-chicken-burger': 1, 'spicy-twister': 2, coleslaw: 1, corn: 2,
  'onion-rings': 3, sundae: 1, donut: 2, cola: 1, 'orange-juice': 1, lemonade: 1, cappuccino: 2,
};

const strip = (s = '') => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function search(q) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6' +
    `&gsrlimit=${PER + 4}&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap haslicense:unrestricted')}` +
    '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=800';
  const j = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
  return Object.values(j.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .map((p) => ({ p, i: p.imageinfo[0] }))
    .filter(({ i }) => i.width >= 700 && i.width >= i.height * 0.9)
    .slice(0, PER)
    .map(({ p, i }) => ({
      title: p.title.replace(/^File:/, ''),
      page: i.descriptionurl,
      thumb: i.thumburl,
      license: strip(i.extmetadata.LicenseShortName?.value) || 'Public domain',
      author: strip(i.extmetadata.Artist?.value).slice(0, 80) || 'Unknown',
    }));
}

async function image(c) {
  const file = `${CACHE}/${encodeURIComponent(c.title)}`;
  if (!existsSync(file)) {
    const r = await fetch(c.thumb, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`${r.status} ${c.thumb}`);
    await writeFile(file, Buffer.from(await r.arrayBuffer()));
    await new Promise((r) => setTimeout(r, 250)); // be polite to the thumbnail server
  }
  return file;
}

await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });
const candFile = `${CACHE}/candidates.json`;
let cands = existsSync(candFile) ? JSON.parse(await readFile(candFile, 'utf8')) : {};
for (const [slug, q] of Object.entries(ITEMS)) {
  if (cands[slug]?.length) continue;
  cands[slug] = await search(q);
  await writeFile(candFile, JSON.stringify(cands, null, 1));
  await new Promise((r) => setTimeout(r, 2500)); // the API rate-limits bursts
}

if (process.argv[2] === 'sheet') {
  const slugs = process.argv.length > 3 ? process.argv.slice(3) : Object.keys(ITEMS);
  const W = 200, H = 150, ROWS = 12;
  for (let s = 0; s * ROWS < slugs.length; s++) {
    const tiles = [];
    for (const [r, slug] of slugs.slice(s * ROWS, s * ROWS + ROWS).entries()) {
      for (const [c, cand] of cands[slug].entries()) {
        try {
          const input = await sharp(await image(cand)).resize(W, H, { fit: 'cover' }).toBuffer();
          tiles.push({ input, left: c * W, top: r * H });
        } catch (e) {
          console.warn(slug, c, e.message);
        }
      }
    }
    await sharp({ create: { width: W * PER, height: H * ROWS, channels: 3, background: '#222' } })
      .composite(tiles)
      .jpeg({ quality: 70 })
      .toFile(`${CACHE}/sheet-${s}.jpg`);
  }
  console.log(Object.entries(cands).map(([k, v], i) => `${i} ${k}: ${v.length}`).join('\n'));
} else {
  const credits = [];
  for (const slug of Object.keys(ITEMS)) {
    const c = cands[slug][PICKS[slug] ?? 0];
    await sharp(await image(c)).resize(800, 600, { fit: 'cover' }).webp({ quality: 76 }).toFile(`${OUT}/${slug}.webp`);
    credits.push(`| ${slug}.webp | [${c.title}](${c.page}) | ${c.author} | ${c.license} |`);
  }
  await writeFile(`${CACHE}/credits.md`, credits.join('\n'));
  console.log('done', credits.length);
}
