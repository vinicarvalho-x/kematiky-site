// Syncs the Kematiky Records Bandcamp catalogue into data/releases.json
// Runs daily via GitHub Actions (.github/workflows/sync-bandcamp.yml). Node 20+, no dependencies.
import { writeFile, readFile } from "node:fs/promises";

const BASE = "https://kematikyrecords.bandcamp.com";
const OUT = new URL("../data/releases.json", import.meta.url);
const UA = { "user-agent": "Mozilla/5.0 (KematikySiteSync; +https://github.com)" };

const decode = (s = "") =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
const strip = (s = "") => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return res.text();
    await sleep(1500 * (i + 1));
  }
  throw new Error("Failed to fetch " + url);
}

// 1) Discography grid on /music
function parseGrid(html) {
  const items = [];
  const re = /<li[^>]*data-item-id="(album|track)-(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, type, id, inner] = m;
    const href = (inner.match(/href="([^"]+)"/) || [])[1];
    const img = (inner.match(/data-original="([^"]+)"/) || inner.match(/<img[^>]*src="([^"]+)"/) || [])[1];
    const titleHtml = (inner.match(/<p class="title">([\s\S]*?)<\/p>/) || [])[1] || "";
    const artistOverride = strip((titleHtml.match(/<span[^>]*artist-override[^>]*>([\s\S]*?)<\/span>/) || [])[1] || "");
    const title = strip(titleHtml.replace(/<span[\s\S]*?<\/span>/g, ""));
    if (href) items.push({ type, id, url: href.startsWith("http") ? href.split("?")[0] : BASE + href.split("?")[0], art: img, title, artist: artistOverride });
  }
  // Items lazy-loaded beyond the first batch live in data-client-items
  const ci = html.match(/data-client-items="([^"]+)"/);
  if (ci) {
    try {
      for (const it of JSON.parse(decode(ci[1]))) {
        if (items.some((x) => x.id === String(it.id))) continue;
        items.push({
          type: it.type, id: String(it.id),
          url: (it.page_url || "").startsWith("http") ? it.page_url : BASE + it.page_url,
          art: it.art_id ? `https://f4.bcbits.com/img/a${String(it.art_id).padStart(10, "0")}_10.jpg` : "",
          title: it.title || "", artist: it.artist || "",
        });
      }
    } catch {}
  }
  return items;
}

// 2) Each release page → tracks, date, about (data-tralbum JSON)
async function enrich(item) {
  try {
    const html = await get(item.url);
    const raw = (html.match(/data-tralbum="([^"]+)"/) || [])[1];
    const t = raw ? JSON.parse(decode(raw)) : {};
    const og = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
    const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
    item.artist = item.artist || t.artist || "";
    item.date = t.album_release_date || t.current?.release_date || t.current?.publish_date || "";
    item.tracks = (t.trackinfo || []).map((tr) => [tr.title, tr.duration ? fmt(tr.duration) : ""]);
    item.about = (t.current?.about || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || strip(decode(desc || "")).slice(0, 220);
    if (og) item.art = og.replace(/_\d+\.jpg$/, "_10.jpg");
  } catch (e) {
    console.warn("enrich failed", item.url, e.message);
  }
  return item;
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// "[KSE010] Yamoc - House Of Corner EP" → cat KSE010, title "House Of Corner EP"
function tidy(it) {
  const zw = (x = "") => x.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  let title = zw(it.title);
  it.artist = zw(it.artist);
  let cat = "";
  const c = title.match(/^\[([^\]]+)\]\s*-?\s*/);
  if (c) { cat = c[1]; title = title.slice(c[0].length); }
  else if (/^[A-Z]{2,4}\d{2,4}$/.test(title)) { cat = title; title = ""; }
  for (const a of [it.artist, (it.artist || "").split(",")[0].trim()]) {
    if (a && title.toLowerCase().startsWith(a.toLowerCase() + " - ")) { title = title.slice(a.length + 3); break; }
  }
  if (!title) title = cat;
  const d = it.date ? new Date(it.date) : null;
  return {
    cat, title, artist: it.artist || "Kematiky Records",
    date: d && !isNaN(d) ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "",
    iso: d && !isNaN(d) ? d.toISOString().slice(0, 10) : "",
    type: it.type, id: it.id, url: it.url, cover: (it.art || "").replace(/_\d+\.jpg$/, "_10.jpg"),
    tracks: it.tracks || [], about: it.about || "",
  };
}

const html = await get(BASE + "/music");
const grid = parseGrid(html);
if (!grid.length) throw new Error("No releases parsed — Bandcamp layout may have changed. Keeping previous data.");

const out = [];
for (const it of grid) { out.push(tidy(await enrich(it))); await sleep(400); }
out.sort((a, b) => (b.iso || "").localeCompare(a.iso || ""));

const json = JSON.stringify({ updated: new Date().toISOString(), count: out.length, releases: out }, null, 2) + "\n";
let prev = "";
try { prev = await readFile(OUT, "utf8"); } catch {}
const same = prev && JSON.stringify(JSON.parse(prev).releases) === JSON.stringify(out);
if (same) console.log("No changes."); else { await writeFile(OUT, json); console.log(`Wrote ${out.length} releases.`); }
