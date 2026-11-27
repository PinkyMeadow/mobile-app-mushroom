"use strict";
/* Shroom Log: an offline-first field log for mushrooms and plants. */

/* ============================================================
   Storage: IndexedDB, with an in-memory fallback.
   ============================================================ */
const DB_NAME = "spore-leaf", DB_VER = 2;
const mem = { finds: new Map(), photos: new Map(), tiles: new Map(), kv: new Map(), trails: new Map() };
let idb = null;
function openDB() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains("finds")) d.createObjectStore("finds", { keyPath: "id" });
        if (!d.objectStoreNames.contains("trails")) d.createObjectStore("trails", { keyPath: "id" });
        for (const s of ["photos", "tiles", "kv"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      };
      rq.onsuccess = () => { idb = rq.result; res(); };
      rq.onerror = () => res();
      setTimeout(res, 3000);
    } catch (e) { res(); }
  });
}
function tx(name, mode, fn) {
  return new Promise((res, rej) => {
    try {
      const t = idb.transaction(name, mode);
      const r = fn(t.objectStore(name));
      t.oncomplete = () => res(r && "result" in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    } catch (e) { rej(e); }
  });
}
const store = {
  all: n => idb ? tx(n, "readonly", s => s.getAll()) : Promise.resolve([...mem[n].values()]),
  keys: n => idb ? tx(n, "readonly", s => s.getAllKeys()) : Promise.resolve([...mem[n].keys()]),
  get: (n, k) => idb ? tx(n, "readonly", s => s.get(k)) : Promise.resolve(mem[n].get(k)),
  put: (n, v, k) => idb ? tx(n, "readwrite", s => k === undefined ? s.put(v) : s.put(v, k)) : Promise.resolve(void mem[n].set(k ?? v.id, v)),
  del: (n, k) => idb ? tx(n, "readwrite", s => s.delete(k)) : Promise.resolve(void mem[n].delete(k)),
  count: n => idb ? tx(n, "readonly", s => s.count()) : Promise.resolve(mem[n].size),
  clear: n => idb ? tx(n, "readwrite", s => s.clear()) : Promise.resolve(void mem[n].clear())
};
function lsGet(k, d) { try { const v = localStorage.getItem("sl:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem("sl:" + k, JSON.stringify(v)); } catch (e) {} }

/* ============================================================
   Helpers
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY = 86400000;
/* Android app: the GitHub build swaps in its build number here. */
const APP_BUILD = 0;
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const nat = (method, opts) => window.Capacitor.nativePromise("TrailGPS", method, opts || {});
const REPO = "PinkyMeadow/mobile-app-mushroom";
const APK_URL = `https://github.com/${REPO}/releases/latest/download/shroom-log.apk`;
function openExternal(url) { if (NATIVE) nat("openUrl", { url }).catch(() => { location.href = url; }); else window.open(url, "_blank", "noopener"); }
// Looks for a newer Android build on GitHub. Runs at most once a day unless asked.
async function checkForUpdate(manual) {
  if (!NATIVE || !netOK()) return manual ? { err: settings.camp ? "Turn off camping mode first." : "This needs signal." } : null;
  if (!manual && Date.now() - lsGet("updChecked", 0) < DAY) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error("github");
    const j = await r.json(), latest = parseInt(String(j.tag_name || "").replace(/\D+/g, ""), 10) || 0;
    lsSet("updChecked", Date.now()); lsSet("updLatest", latest);
    const res = { latest, newer: latest > APP_BUILD, notes: j.body || "" };
    if (res.newer && !manual) toast(`Update available (build ${latest})`, { label: "Download", run: () => openExternal(APK_URL) });
    return res;
  } catch (e) { return manual ? { err: "Couldn't reach GitHub. Try again later." } : null; }
}
function toast(msg, action) {
  $$(".toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  if (action) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = action.label;
    b.style.cssText = "margin-left:14px;background:none;border:0;color:var(--shroom-ink);font:inherit;font-weight:800;text-decoration:underline;cursor:pointer;padding:6px 0";
    b.addEventListener("click", () => { t.remove(); action.run(); });
    t.appendChild(b); t.style.pointerEvents = "auto";
  }
  document.body.appendChild(t);
  setTimeout(() => t.remove(), action ? 7000 : 2600);
}
function timeOfDay(d) {
  const h = d.getHours();
  if (h >= 5 && h < 8) return "Early morning";
  if (h >= 8 && h < 12) return "Morning";
  if (h >= 12 && h < 17) return "Afternoon";
  if (h >= 17 && h < 21) return "Evening";
  return "Night";
}
const fmtDate = (iso, o) => new Date(iso).toLocaleDateString(undefined, o || { day: "numeric", month: "short", year: "numeric" });
const fmtTime = iso => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
function toLocalInput(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function haversine(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtDist(km) {
  if (settings.units === "in") { const mi = km * 0.621371; return mi < 0.1 ? Math.round(mi * 5280) + " ft" : mi.toFixed(mi < 10 ? 1 : 0) + " mi"; }
  return km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(km < 10 ? 1 : 0) + " km";
}
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now"; if (m < 60) return m + " min ago";
  const h = Math.round(m / 60); if (h < 24) return h + " h ago";
  const d = Math.round(h / 24); return d === 1 ? "yesterday" : d + " days ago";
}
const unitLabel = () => settings.units === "in" ? "in" : "cm";
const toDisp = cm => cm == null || cm === "" ? "" : settings.units === "in" ? +(cm / 2.54).toFixed(2) : +(+cm).toFixed(1);
const fromDisp = v => v === "" || v == null || isNaN(+v) ? null : settings.units === "in" ? +v * 2.54 : +v;
const parseTags = s => [...new Set(String(s || "").split(/[,\n]+|\s+(?=#)/).map(t => t.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];

const COLOURS = [
  ["White","#f4f1ea"],["Cream","#efe0b9"],["Yellow","#e8c547"],["Orange","#e58a3a"],["Red","#c9442e"],["Pink","#e39bb0"],
  ["Purple","#8a5fa8"],["Brown","#7a5233"],["Tan","#c4a074"],["Grey","#8f9491"],["Black","#1c1c1c"],["Green","#5f9a57"],["Blue","#4f7fb8"]
];
const SPORE = [["White","#f4f1ea"],["Cream","#efe0b9"],["Pink","#e3a5a5"],["Yellow-ochre","#c99a3e"],["Rusty brown","#9a5a2c"],["Brown","#6e4a2e"],["Purple-brown","#5a3a4a"],["Black","#1c1c1c"],["Green","#6f9a5a"]];
const GILLS = ["Gills","Pores (sponge)","Teeth or spines","Ridges (false gills)","Smooth","None (puffball or similar)"];
const SUBSTRATE = ["Soil","Leaf litter","Moss","Grass","Dead wood","Living tree","Buried wood or roots","Dung","Other"];
// Habitat log: one tap each, all optional.
const HAB_LOG = [
  ["soilType", "Ground", ["Sandy", "Loamy", "Clay", "Peaty", "Rocky", "Mossy", "Leaf mould"]],
  ["wet", "Ground felt", ["Dry", "Damp", "Wet", "Waterlogged"]],
  ["slopeObs", "Slope", ["Flat", "Gentle", "Steep"]],
  ["aspect", "Facing", ["North", "East", "South", "West"]],
  ["light", "Light", ["Open sun", "Part shade", "Deep shade"]],
  ["growth", "Growing as", ["Single", "Scattered", "Cluster", "Ring or arc", "Troop"]],
  ["abundance", "How many", ["1", "2 to 5", "6 to 20", "Lots"]]
];
const HABITAT = ["Broadleaf woods","Conifer woods","Mixed woods","Grassland","Heath or moor","Wetland","Hedgerow","Garden or park","Roadside","Coast"];
const EDIBILITY = [
  ["unknown", "Unknown"],
  ["edible", "Edible: confirmed in person by an expert"],
  ["inedible", "Inedible"],
  ["toxic", "Toxic"],
  ["deadly", "Deadly"]
];
const PHOTO_LABELS = ["Whole", "Cap", "Gills or underside", "Stem", "Stem base", "Spore print", "Leaf", "Flower", "Habitat", "Other"];
const SMELL = ["No smell","Mushroomy","Fruity or apricot","Aniseed","Garlic","Mealy or floury","Radish","Ink or chemical","Unpleasant"];
const TEXTURE = ["Smooth","Sticky or slimy","Dry","Scaly","Velvety","Fibrous","Warty","Brittle","Rubbery","Woody"];
const BRUISE = [["No change","transparent"],["Blue","#3f6fc0"],["Red or pink","#c9485a"],["Yellow","#e8c547"],["Orange","#e58a3a"],["Brown","#7a5233"],["Black","#1c1c1c"]];
// Common dangerous lookalikes, matched against the find's name. Not a complete list.
const LOOKALIKES = [
  { keys: ["chanterelle", "cantharellus", "girolle"], list: [
    ["Jack-o'-lantern (Omphalotus)", "toxic", "Has true, crowded, blade-like gills and grows in clusters on wood or buried roots."],
    ["False chanterelle (Hygrophoropsis)", "toxic", "Has thin, forked true gills, is brighter orange, and has no apricot smell."]] },
  { keys: ["field mushroom", "horse mushroom", "agaricus", "meadow mushroom", "button mushroom"], list: [
    ["Destroying angel and death cap (Amanita)", "deadly", "Gills stay white, the spore print is white, and there's a sac-like volva at the stem base. Dig up the whole base to check."],
    ["Yellow stainer (Agaricus xanthodermus)", "toxic", "Stem base bruises bright chrome yellow when scratched, and it smells of ink or phenol."]] },
  { keys: ["puffball", "calvatia", "lycoperdon", "bovista"], list: [
    ["Young Amanita in its 'egg' stage", "deadly", "Cut it top to bottom. Any outline of a cap, gills or stem inside means it is not a puffball."],
    ["Common earthball (Scleroderma)", "toxic", "Firm with a thick, warty skin, and the inside turns dark purple-black."]] },
  { keys: ["wild garlic", "ramsons", "allium ursinum", "ramps"], list: [
    ["Lily of the valley", "deadly", "No garlic smell when a single leaf is crushed. Smell each leaf on its own, since the scent stays on your hands."],
    ["Lords-and-ladies (Arum)", "toxic", "Arrow-shaped leaves with branching veins, no garlic smell. Often grows right among wild garlic."],
    ["Autumn crocus", "deadly", "Leaves have no smell and grow from a bulb-like corm. It grows in some of the same damp meadows and woods."]] },
  { keys: ["morel", "morchella"], list: [
    ["False morel (Gyromitra)", "deadly", "Brain-like, wrinkled cap instead of honeycomb pits. Cut it lengthways: true morels are completely hollow."]] },
  { keys: ["honey fungus", "armillaria"], list: [
    ["Funeral bell (Galerina marginata)", "deadly", "Grows on wood too, but is smaller, with a rusty brown spore print. Honey fungus has a white spore print."]] },
  { keys: ["parasol", "macrolepiota"], list: [
    ["Small Lepiota dapperlings", "deadly", "Look like small parasols. Avoid any parasol-like mushroom with a cap under about 10 cm across."],
    ["Shaggy parasol (Chlorophyllum)", "toxic", "Flesh bruises orange-red when cut and the stem has no snakeskin pattern. It upsets many people's stomachs."]] },
  { keys: ["cep", "penny bun", "porcini", "boletus", "bolete", "king bolete"], list: [
    ["Devil's bolete (Rubroboletus satanas)", "toxic", "Red pores and a reddish stem, and the flesh bruises blue."],
    ["Bitter bolete (Tylopilus felleus)", "inedible", "Pores turn pink with age, there's a dark net on the stem, and a tiny taste is very bitter."]] },
  { keys: ["st george", "calocybe gambosa"], list: [
    ["Deadly fibrecap (Inocybe erubescens)", "deadly", "Grows at the same time of year. Its cap is fibrous and splits, and the flesh reddens with age. Spore print is brown, not white."]] },
  { keys: ["blusher", "amanita rubescens"], list: [
    ["Panther cap (Amanita pantherina)", "deadly", "Its flesh never turns pink, and it has a rimmed, collar-like volva at the stem base."]] },
  { keys: ["wood blewit", "blewit", "lepista"], list: [
    ["Webcaps (Cortinarius)", "deadly", "Rusty brown spore print and a cobweb-like veil under young caps. Blewits have a pale pink spore print."]] },
  { keys: ["oyster mushroom", "pleurotus"], list: [
    ["Angel's wings (Pleurocybella)", "toxic", "Thin, pure white and small, growing on conifer wood."]] },
  { keys: ["ink cap", "coprinus", "coprinopsis"], list: [
    ["Common ink cap (Coprinopsis atramentaria)", "toxic", "Grey, smooth and bell-shaped. It causes severe sickness if alcohol is drunk within a few days."]] },
  { keys: ["elderflower", "elder", "cow parsley", "wild carrot", "hogweed", "sweet cicely", "wild parsnip", "pignut", "angelica"], list: [
    ["Hemlock (Conium)", "deadly", "Smooth stem with purple blotches and a mousy smell. Never eat a plant from the carrot family that you can't identify for certain."],
    ["Hemlock water dropwort (Oenanthe crocata)", "deadly", "Grows by water, with roots like small parsnips. One of the most poisonous plants in Britain."]] },
  { keys: ["wild garlic flower", "three-cornered leek", "wild onion"], list: [
    ["Star of Bethlehem and other bulbs", "toxic", "No onion or garlic smell. Smell every plant."]] }
];
const SCALE_REFS = [
  ["tape", "Measuring tape or ruler: tap two marks", null],
  ["ruler", "Ruler, 0 to 10 cm", 100],
  ["bic", "Standard lighter (BIC Classic), height", 81],
  ["card", "Credit or debit card, long edge", 85.6], ["cardS", "Credit or debit card, short edge", 53.98],
  ["cad200", "Canadian toonie ($2)", 28.0], ["cad100", "Canadian loonie ($1)", 26.5], ["cad25", "Canadian quarter", 23.88],
  ["cad5", "Canadian nickel", 21.2], ["cad10", "Canadian dime", 18.03]
];
function suggestLookalikes(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return [];
  const out = [];
  for (const g of LOOKALIKES) if (g.keys.some(k => t.includes(k))) for (const [name, danger, how] of g.list) if (!out.some(o => o.name === name)) out.push({ name, danger, how });
  return out;
}
const WEATHER = ["Sunny","Partly cloudy","Overcast","Drizzle","Rain","Heavy rain","Fog","Windy","Frost","Snow"];
const RAIN_RECENT = ["Dry for days","Light rain recently","Heavy rain recently","Not sure"];

/* ============================================================
   State
   ============================================================ */
let settings = { units: lsGet("units", "cm"), field: lsGet("field", false), camp: lsGet("camp", false), night: lsGet("night", false) };
// Camping mode keeps the radio quiet: nothing goes online until it's turned off.
const netOK = () => navigator.onLine && !settings.camp;
function applyModes() {
  document.body.classList.toggle("camp", !!settings.camp);
  document.body.classList.toggle("night", !!settings.night);
  const nb = document.getElementById("nightBtn"); if (nb) nb.setAttribute("aria-pressed", !!settings.night);
  const nm = document.getElementById("nightMode"); if (nm) nm.checked = !!settings.night;
}
let lastLoc = lsGet("lastLoc", null);  // {lat,lng,acc,ts}
let finds = [];
const photoURLs = new Map();
let view = { filter: lsGet("filter", "all"), sort: lsGet("sort", "newest"), q: "", quick: lsGet("quick", []), trip: null };
const QUICK = [
  ["edible", "Edible", f => f.edibility === "edible"],
  ["revisit", "Revisit", f => f.revisit],
  ["month", "This month", f => new Date(f.foundAt).getMonth() === new Date().getMonth()],
  ["near", "Within 5 km", f => lastLoc && f.lat != null && haversine(lastLoc, f) <= 5],
  ["photo", "Has photos", f => f.photos.length > 0],
  ["confirmed", "iNat confirmed", f => f.inat && f.inat.quality === "research"]
];
let maps = [];
document.body.classList.toggle("field", !!settings.field);
applyModes();
document.getElementById("nightBtn").addEventListener("click", () => { settings.night = !settings.night; lsSet("night", settings.night); applyModes(); });

/* Older entries stored a single photo key. */
function normalise(f) {
  if (!f.photos) f.photos = f.photo ? [{ key: f.photo, label: "Whole" }] : [];
  delete f.photo;
  f.tags = f.tags || [];
  f.habitat = f.habitat || [];
  f.edibility = f.edibility || "unknown";
  f.lookalikes = f.lookalikes || [];
  f.voice = f.voice || [];
  f.smell = f.smell || [];
  f.texture = f.texture || [];
  return f;
}
const cover = f => f.photos && f.photos[0] ? f.photos[0].key : null;
let trash = [];
async function loadFinds() {
  const all = ((await store.all("finds").catch(() => [])) || []).map(normalise);
  // Finds in the trash for over 30 days are deleted for good.
  for (const f of all.filter(x => x.deletedAt && Date.now() - x.deletedAt > 30 * DAY)) await purgeFind(f);
  finds = all.filter(f => !f.deletedAt);
  trash = all.filter(f => f.deletedAt && Date.now() - f.deletedAt <= 30 * DAY).sort((a, b) => b.deletedAt - a.deletedAt);
}
async function purgeFind(f) {
  await store.del("finds", f.id);
  for (const p of [...(f.photos || []), ...(f.voice || [])]) { await store.del("photos", p.key).catch(() => {}); photoURLs.delete(p.key); }
}
async function trashFind(f, after) {
  f.deletedAt = Date.now(); await store.put("finds", f); await loadFinds();
  toast("Moved to the trash", { label: "Undo", run: async () => { delete f.deletedAt; await store.put("finds", f); await loadFinds(); toast("Find restored"); location.hash = "find-" + f.id; route(); } });
  after && after();
}
async function photoURL(key) {
  if (!key) return null;
  if (photoURLs.has(key)) return photoURLs.get(key);
  const rec = await store.get("photos", key).catch(() => null);
  if (!rec) return null;
  const url = typeof rec === "string" ? rec : URL.createObjectURL(rec);
  photoURLs.set(key, url);
  return url;
}

/* ============================================================
   Location
   ============================================================ */
const geoAvailable = () => "geolocation" in navigator;
function getPosition(timeout = 12000) {
  return new Promise((res, rej) => {
    if (!geoAvailable()) return rej(new Error("unavailable"));
    try {
      navigator.geolocation.getCurrentPosition(p => {
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), alt: p.coords.altitude != null ? Math.round(p.coords.altitude) : null, ts: Date.now() };
        lastLoc = loc; lsSet("lastLoc", loc);
        res(loc);
      }, e => rej(e), { enableHighAccuracy: true, timeout, maximumAge: settings.camp ? 120000 : 30000 });
    } catch (e) { rej(e); }
  });
}

/* Read GPS and the date taken from a JPEG's EXIF block, when the camera kept them. */
async function exifGPS(file) { return (await exifRead(file)).gps; }
async function exifRead(file) {
  const out = { gps: null, date: null };
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off < v.byteLength - 4) {
      const marker = v.getUint16(off), len = v.getUint16(off + 2);
      if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) {
        const tiff = off + 10, le = v.getUint16(tiff) === 0x4949;
        const u16 = o => v.getUint16(o, le), u32 = o => v.getUint32(o, le);
        const ifd0 = tiff + u32(tiff + 4);
        let gpsOff = null, exifOff = null, dt0 = null;
        const str = (e) => { const cnt = u32(e + 4), p = cnt > 4 ? tiff + u32(e + 8) : e + 8; let t = ""; for (let k = 0; k < cnt - 1 && p + k < v.byteLength; k++) t += String.fromCharCode(v.getUint8(p + k)); return t; };
        const toDate = t => { const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(t || ""); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; };
        for (let i = 0, n = u16(ifd0); i < n; i++) { const e = ifd0 + 2 + i * 12, tg = u16(e); if (tg === 0x8825) gpsOff = tiff + u32(e + 8); if (tg === 0x8769) exifOff = tiff + u32(e + 8); if (tg === 0x0132) dt0 = str(e); }
        if (exifOff) for (let i = 0, n = u16(exifOff); i < n; i++) { const e = exifOff + 2 + i * 12; if (u16(e) === 0x9003) out.date = toDate(str(e)); }
        if (!out.date) out.date = toDate(dt0);
        if (out.date && isNaN(out.date)) out.date = null;
        if (!gpsOff) return out;
        const tags = {};
        for (let i = 0, n = u16(gpsOff); i < n; i++) {
          const e = gpsOff + 2 + i * 12, tag = u16(e), type = u16(e + 2);
          if (type === 2) tags[tag] = String.fromCharCode(v.getUint8(e + 8));
          else if (type === 5) { const p = tiff + u32(e + 8), r = []; for (let k = 0; k < 3; k++) r.push(u32(p + k * 8) / (u32(p + k * 8 + 4) || 1)); tags[tag] = r; }
        }
        if (!tags[2] || !tags[4]) return out;
        const dms = a => a[0] + a[1] / 60 + a[2] / 3600;
        let lat = dms(tags[2]), lng = dms(tags[4]);
        if (tags[1] === "S") lat = -lat;
        if (tags[3] === "W") lng = -lng;
        if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return out;
        out.gps = { lat, lng }; return out;
      }
      if ((marker & 0xFF00) !== 0xFF00) break;
      off += 2 + len;
    }
  } catch (e) {}
  return out;
}

function resizeImage(file, max = 1600, q = 0.85) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? res(b) : rej(new Error("encode")), "image/jpeg", q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("That file couldn't be read as a photo.")); };
    img.src = url;
  });
}

/* ============================================================
   Weather: fills in from Open-Meteo when there's signal.
   ============================================================ */
function wmoToChips(code, wind) {
  const out = [];
  if (code === 0 || code === 1) out.push("Sunny");
  else if (code === 2) out.push("Partly cloudy");
  else if (code === 3) out.push("Overcast");
  else if (code === 45 || code === 48) out.push("Fog");
  else if (code >= 51 && code <= 57) out.push("Drizzle");
  else if ((code >= 61 && code <= 63) || code === 80 || code === 81) out.push("Rain");
  else if (code === 65 || code === 82 || code >= 95) out.push("Heavy rain");
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) out.push("Snow");
  else if (code === 66 || code === 67) out.push("Frost");
  if (wind >= 30) out.push("Windy");
  return out;
}
/* Weather for the time and place of a find, from Open-Meteo (needs signal).
   Recent finds use the forecast service; older ones use the historical archive. */
const SOIL = ["Dry", "Moist", "Wet", "Saturated", "Not sure"];
function soilLabel(v) { return v == null ? "" : v < 0.12 ? "Dry" : v < 0.22 ? "Moist" : v < 0.32 ? "Wet" : "Saturated"; }
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function fetchWeather(lat, lng, whenISO) {
  const when = new Date(whenISO || Date.now());
  const ageDays = (Date.now() - when) / DAY;
  if (ageDays < -1) throw new Error("future");
  const from = new Date(when - 3 * DAY);
  const old = ageDays > 85;
  const soilVar = old ? "soil_moisture_0_to_7cm" : "soil_moisture_3_to_9cm";
  const host = old ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
  const u = `${host}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=temperature_2m,weather_code,wind_speed_10m,precipitation,${soilVar}&start_date=${ymd(from)}&end_date=${ymd(when)}&timezone=auto`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
  let r;
  try { r = await fetch(u, { signal: ctl.signal }); } finally { clearTimeout(t); }
  if (!r.ok) throw new Error("weather " + r.status);
  const j = await r.json();
  const h = j.hourly || {};
  const times = h.time || [];
  if (!times.length) throw new Error("no data");
  // The hour of the find, in the spot's local time (close enough to the phone's).
  const key = `${ymd(when)}T${String(when.getHours()).padStart(2, "0")}:00`;
  let i = times.indexOf(key);
  if (i < 0) i = times.length - 1;
  // Archive data lags a few days; step back to the latest hour that has values.
  while (i > 0 && h.temperature_2m[i] == null) i--;
  const rain = (h.precipitation || []).slice(Math.max(0, i - 72), i + 1).reduce((s, x) => s + (x || 0), 0);
  const temps = (h.temperature_2m || []).slice(Math.max(0, i - 72), i + 1).filter(x => x != null);
  const soil = (h[soilVar] || [])[i];
  return {
    chips: wmoToChips(h.weather_code[i], h.wind_speed_10m[i]),
    temp: h.temperature_2m[i] == null ? null : Math.round(h.temperature_2m[i]),
    rainRecent: rain < 1 ? "Dry for days" : rain < 10 ? "Light rain recently" : "Heavy rain recently",
    soil: soil == null ? "" : soilLabel(soil),
    soilVwc: soil == null ? null : +soil.toFixed(3),
    note: `${rain.toFixed(1)} mm of rain in the 3 days before${temps.length ? `, lowest ${Math.round(Math.min(...temps))} °C` : ""}. From Open-Meteo.`
  };
}

/* Moon phase, worked out on the phone. No signal needed. */
function moonPhase(d) {
  const syn = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((new Date(d) - ref) / DAY) % syn + syn) % syn;
  const illum = Math.round((1 - Math.cos(2 * Math.PI * age / syn)) / 2 * 100);
  const names = [[1.84, "New moon"], [5.53, "Waxing crescent"], [9.23, "First quarter"], [12.91, "Waxing gibbous"], [16.61, "Full moon"], [20.30, "Waning gibbous"], [23.99, "Last quarter"], [27.68, "Waning crescent"], [99, "New moon"]];
  const name = names.find(n => age < n[0])[1];
  return { name, illum, age: +age.toFixed(1) };
}
function moonIcon(age) {
  // A small drawn moon: lit part grows from the right while waxing.
  const syn = 29.53, k = Math.cos(2 * Math.PI * age / syn);   // 1 = new, -1 = full
  const waxing = age < syn / 2;
  const rx = Math.abs(k) * 9;
  const lit = "#ede6d8", dark = "#2b3833";
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = (k > 0) === waxing ? 0 : 1;
  return `<svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true" style="vertical-align:-4px"><circle r="9" fill="${dark}"/><path d="M0 -9 A9 9 0 0 ${sweepOuter} 0 9 A${rx.toFixed(2)} 9 0 0 ${sweepInner} 0 -9Z" fill="${lit}"/></svg>`;
}

/* ============================================================
   Maps: OpenStreetMap tiles, cached on the device for offline use.
   ============================================================ */
const hasLeaflet = typeof L !== "undefined";
const TILE_LAYERS = {
  osm: { name: "Street", prefix: "", max: 19, url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
  topo: { name: "Topo", prefix: "topo/", max: 17, url: (z, x, y) => `https://${"abc"[(x + y) % 3]}.tile.opentopomap.org/${z}/${x}/${y}.png`,
    attr: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, SRTM · style &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)' },
  hike: { name: "Hiking trails", prefix: "hike/", max: 18, overlay: true, url: (z, x, y) => `https://tile.waymarkedtrails.org/hiking/${z}/${x}/${y}.png`,
    attr: 'Trails &copy; <a href="https://hiking.waymarkedtrails.org" target="_blank" rel="noopener">Waymarked Trails</a>' }
};
const TILE_URL = TILE_LAYERS.osm.url;
const OfflineTiles = hasLeaflet ? L.TileLayer.extend({
  createTile(coords, done) {
    const lay = TILE_LAYERS[this.options.layerId] || TILE_LAYERS.osm;
    const img = document.createElement("img");
    img.alt = ""; img.setAttribute("role", "presentation");
    const key = `${lay.prefix}${coords.z}/${coords.x}/${coords.y}`;
    const net = () => { if (settings.camp) { done(new Error("camping mode"), img); return; } img.onload = () => done(null, img); img.onerror = () => done(new Error("tile"), img); img.src = lay.url(coords.z, coords.x, coords.y); };
    store.get("tiles", key).then(blob => {
      if (!blob) return net();
      const u = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(u); done(null, img); };
      img.onerror = () => done(new Error("tile"), img);
      img.src = u;
    }).catch(net);
    return img;
  }
}) : null;
function makeMap(el, center, zoom, opts = {}) {
  if (!hasLeaflet) { el.innerHTML = '<p class="hint" style="padding:16px">The map couldn\'t load.</p>'; return null; }
  const m = L.map(el, { zoomControl: true, attributionControl: true, ...opts }).setView(center, zoom);
  const mk = id => new OfflineTiles("", { layerId: id, maxZoom: 19, maxNativeZoom: TILE_LAYERS[id].max, attribution: TILE_LAYERS[id].attr, className: TILE_LAYERS[id].overlay ? "overlay-tiles" : "" });
  const bases = { osm: mk("osm"), topo: mk("topo") };
  const hike = mk("hike");
  const baseId = lsGet("mapBase", "osm");
  (bases[baseId] || bases.osm).addTo(m);
  if (lsGet("mapHike", false)) hike.addTo(m);
  m._layerIds = () => [m.hasLayer(bases.topo) ? "topo" : "osm", ...(m.hasLayer(hike) ? ["hike"] : [])];
  L.control.layers({ Street: bases.osm, Topo: bases.topo }, { "Hiking trails": hike }, { position: "topright" }).addTo(m);
  m.on("baselayerchange", e => lsSet("mapBase", e.layer === bases.topo ? "topo" : "osm"));
  m.on("overlayadd overlayremove", e => { if (e.layer === hike) lsSet("mapHike", e.type === "overlayadd"); });
  m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  maps.push(m);
  setTimeout(() => { if (maps.includes(m) && document.body.contains(el)) m.invalidateSize(); }, 60);
  return m;
}
const pinIcon = kind => L.divIcon({ className: "", html: `<div class="pin ${kind}"></div>`, iconSize: [22, 22], iconAnchor: kind === "me" ? [8, 8] : [11, 22] });
function defaultCenter() {
  if (lastLoc) return [lastLoc.lat, lastLoc.lng];
  const w = finds.find(f => f.lat != null);
  return w ? [w.lat, w.lng] : [54.5, -2.5];
}
const lng2x = (lng, z) => Math.floor((lng + 180) / 360 * 2 ** z);
function lat2y(lat, z) { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); }
function tilesFor(b, zMin, zMax) {
  const list = [];
  for (let z = zMin; z <= zMax; z++) {
    const x0 = lng2x(b.getWest(), z), x1 = lng2x(b.getEast(), z), y0 = lat2y(b.getNorth(), z), y1 = lat2y(b.getSouth(), z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) list.push([z, x, y]);
  }
  return list;
}
const MAX_TILES = 1500;
let downloading = false;
async function downloadTiles(list, onProgress) {
  // list items: [layerId, z, x, y]
  downloading = true;
  let done = 0, failed = 0, i = 0;
  async function worker() {
    while (i < list.length && downloading) {
      const [id, z, x, y] = list[i++], lay = TILE_LAYERS[id], key = `${lay.prefix}${z}/${x}/${y}`;
      try {
        if (!(await store.get("tiles", key))) {
          const r = await fetch(lay.url(z, x, y), { mode: "cors" });
          if (!r.ok) throw new Error(r.status);
          await store.put("tiles", await r.blob(), key);
        }
      } catch (e) { failed++; }
      done++; onProgress(done, failed);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  downloading = false;
  return { done, failed };
}

/* ============================================================
   Revisit spots: when is this find's spot next worth checking?
   ============================================================ */
function nextVisit(f) {
  const found = new Date(f.foundAt), now = new Date();
  let d = new Date(now.getFullYear(), found.getMonth(), found.getDate());
  // Found this season, or the window has passed: look ahead to next year.
  if ((now - d) / DAY > 21 || d.getFullYear() === found.getFullYear()) d = new Date(now.getFullYear() + 1, found.getMonth(), found.getDate());
  const days = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / DAY);
  return { date: d, days };
}
function visitLabel(days) {
  if (days < -1) return `Season started ${-days} days ago`;
  if (days <= 1 && days >= -1) return "Due now";
  if (days <= 21) return `Due in ${days} days`;
  if (days < 60) return `In ${Math.round(days / 7)} weeks`;
  return `In about ${Math.round(days / 30)} months`;
}

/* ============================================================
   Example finds, shown until the first real one is saved.
   ============================================================ */
function sampleSVG(kind, hue, variant = 0) {
  const svg = kind === "mushroom"
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22302a"/><stop offset="1" stop-color="#121a16"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><ellipse cx="200" cy="262" rx="150" ry="22" fill="#2c3a2c"/>${variant ? `<g transform="translate(200 150)">${Array.from({length: 26}, (_, i) => `<path d="M0 0L${(Math.cos(i/26*Math.PI*2)*110).toFixed(1)} ${(Math.sin(i/26*Math.PI*2)*70).toFixed(1)}" stroke="${hue}" stroke-width="3" opacity=".8"/>`).join("")}<ellipse rx="112" ry="72" fill="none" stroke="${hue}" stroke-width="6"/><circle r="16" fill="#e9dfc8"/></g>` : `<path d="M176 150h48l10 100a12 12 0 0 1-12 13h-44a12 12 0 0 1-12-13z" fill="#e9dfc8"/><path d="M200 70c-70 0-118 40-118 82 0 8 6 12 14 12h208c8 0 14-4 14-12 0-42-48-82-118-82z" fill="${hue}"/><path d="M104 164c30 10 162 10 192 0" stroke="#000" stroke-opacity=".18" stroke-width="6" fill="none"/>`}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f2b26"/><stop offset="1" stop-color="#111915"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><path d="M200 280V120" stroke="#6f9a62" stroke-width="6"/><path d="M200 180c-60-6-90-40-96-86 50 2 88 30 96 86z" fill="${hue}"/><path d="M200 150c50-8 78-44 84-90-46 4-80 34-84 90z" fill="${hue}" opacity=".85"/><circle cx="200" cy="108" r="14" fill="#f2f0e4"/><circle cx="200" cy="108" r="5" fill="#e8c547"/></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
async function seedExamples() {
  if (lsGet("seeded", false)) return;
  lsSet("seeded", true);
  const now = Date.now(), base = lastLoc || { lat: 54.55, lng: -2.95 };
  const ex = [
    { type: "mushroom", name: "Chanterelle (example)", hue: "#e7a343", d: 2, h: 9, dl: 0.004, dg: -0.006, width: 6, height: 7, length: 6, stem: 4.5, colours: ["Yellow","Orange"], weather: ["Overcast"], rain: "Heavy rain recently", temp: 13,
      spore: "Cream", gills: "Ridges (false gills)", substrate: "Moss", habitat: ["Mixed woods"], trees: "Birch and beech", edib: "unknown", revisit: true, tags: ["birch-wood", "autumn"], idApp: { result: "Cantharellus cibarius", confidence: 88 },
      desc: "Funnel-shaped cap with a wavy edge. Blunt ridges run down the stem instead of true gills. Faint apricot smell.", photos: 2 },
    { type: "plant", name: "Wild garlic (example)", hue: "#5f9a57", d: 230, h: 11, dl: -0.01, dg: 0.012, width: 5, height: 30, length: 22, stem: 25, colours: ["Green","White"], weather: ["Partly cloudy"], rain: "Light rain recently", temp: 11,
      substrate: "Soil", habitat: ["Broadleaf woods"], trees: "Ash and alder by the stream", edib: "unknown", revisit: true, tags: ["stream-bank", "spring"],
      desc: "Broad, bright green leaves with a strong garlic smell when crushed. Star-shaped white flowers. Carpeting a damp, shady stream bank.", photos: 1 },
    { type: "mushroom", name: "", hue: "#b23b2a", d: 380, h: 16, dl: 0.02, dg: 0.03, width: 12, height: 14, length: 12, stem: 11, colours: ["Red","White"], weather: ["Rain"], rain: "Heavy rain recently", temp: 9,
      spore: "White", gills: "Gills", substrate: "Leaf litter", habitat: ["Broadleaf woods"], trees: "Birch", edib: "toxic", tags: ["birch-wood"],
      desc: "Bright red cap with white warty spots. White gills, ring on the stem, bulbous base. Looks like fly agaric, which is toxic. Photographed only.", photos: 1 }
  ];
  for (const e of ex) {
    const t = new Date(now - e.d * DAY); t.setHours(e.h, 20, 0, 0);
    const photos = [];
    for (let i = 0; i < e.photos; i++) { const key = "ex-" + uid(); await store.put("photos", sampleSVG(e.type, e.hue, i), key); photos.push({ key, label: i ? "Gills or underside" : "Whole" }); }
    await store.put("finds", {
      id: uid(), sample: true, type: e.type, name: e.name, photos,
      lat: base.lat + e.dl, lng: base.lng + e.dg, acc: 8, locSource: "gps",
      foundAt: t.toISOString(), createdAt: t.toISOString(), updatedAt: t.toISOString(),
      width: e.width, height: e.height, length: e.length, stem: e.stem,
      colours: e.colours, colourNote: "", description: e.desc,
      weather: e.weather, rainRecent: e.rain, temp: e.temp, weatherNote: "",
      spore: e.spore || "", gills: e.gills || "", substrate: e.substrate, habitat: e.habitat, trees: e.trees,
      edibility: e.edib, revisit: !!e.revisit, tags: e.tags, idApp: e.idApp || null,
      smell: e.type === "mushroom" && e.revisit ? ["Fruity or apricot"] : [], texture: e.revisit ? ["Smooth"] : [], bruise: "", bruiseNote: "",
      lookalikes: suggestLookalikes(e.name).map((l, i) => ({ ...l, suggested: true, ruledOut: i === 0, note: i === 0 ? "Blunt ridges, not true gills. Growing in moss, not on wood." : "" }))
    });
  }
}
async function removeExamples() {
  for (const f of finds.filter(f => f.sample)) {
    await store.del("finds", f.id);
    for (const p of [...f.photos, ...(f.voice || [])]) await store.del("photos", p.key);
  }
  await loadFinds();
}

/* ============================================================
   Router
   ============================================================ */
const titleEl = $("#title"), backBtn = $("#backBtn"), brand = $("#brandMark"), main = $("#main"), topActions = $("#topActions");
topActions.style.cssText = "display:flex;align-items:center";
backBtn.addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "log"; });
function setChrome({ title, back = false, tab = null, actions = "" }) {
  titleEl.textContent = title;
  backBtn.hidden = !back; brand.style.display = back ? "none" : "";
  topActions.innerHTML = (activeTrail ? `<a href="#map" class="badge-todo" style="text-decoration:none;margin-right:6px" aria-label="Recording a trail">● Trail</a>` : "") + actions;
  $$(".tab").forEach(t => t.removeAttribute("aria-current"));
  if (tab) { const t = $(`.tab[data-tab="${tab}"]`); if (t) t.setAttribute("aria-current", "page"); }
  const nb = $("#notesBtn"); if (nb) { if (tab === "notes") nb.setAttribute("aria-current", "page"); else nb.removeAttribute("aria-current"); }
  const mb = $("#moreBtn"); if (mb) { if (tab === "more") mb.setAttribute("aria-current", "page"); else mb.removeAttribute("aria-current"); }
}
function cleanupMaps() { maps.forEach(m => { try { m.remove(); } catch (e) {} }); maps = []; }
async function route() {
  cleanupMaps();
  $$(".sheet-bg").forEach(s => s.remove());
  const h = (location.hash || "#log").slice(1);
  window.scrollTo(0, 0);
  if (h === "new") return renderForm(null);
  if (h.startsWith("edit-")) return renderForm(h.slice(5));
  if (h.startsWith("find-")) return renderDetail(h.slice(5));
  if (h === "species") return renderSpeciesList();
  if (h === "review") return renderReview();
  if (h === "inat-past") return renderInatPast();
  if (h === "hikes") return renderHikes();
  if (h === "notes") return renderNotebook();
  if (h === "anatomy") return renderAnatomy();
  if (h === "key") return renderKey();
  if (h === "labels") return renderLabels();
  if (h.startsWith("label-")) return renderLabels(h.slice(6));
  if (h.startsWith("hike-")) return renderHike(h.slice(5));
  if (h === "trash") return renderTrash();
  if (h === "trips") return renderTrips();
  if (h.startsWith("trip-")) return renderTrip(h.slice(5));
  if (h === "import") return renderImport();
  if (h === "guides") return renderGuides();
  if (h.startsWith("guide-")) return renderGuide(h.slice(6));
  if (h.startsWith("tree-")) return renderTree(h.slice(5));
  if (h === "pack") return renderPack();
  if (h === "camera") return renderCamera();
  if (h.startsWith("species-")) return renderSpecies(decodeURIComponent(h.slice(8)));
  if (h === "map") return renderMap();
  if (h === "season") return renderSeason();
  if (h === "season-stats") return renderSeason("stats");
  if (h === "edibles") return renderEdibles();
  if (h === "more") return renderSettings();
  if (h === "safety") return renderSafety();
  return renderLog();
}
window.addEventListener("hashchange", route);

/* ============================================================
   Quick log: photo + location + time now, details later.
   ============================================================ */
async function quickLog(file) {
  toast("Saving…");
  try {
    const exif = await exifGPS(file);
    const blob = await resizeImage(file);
    let loc = null, src = null;
    // Use the photo's own location when it has one, so GPS doesn't need to wake up.
    if (exif) { loc = { ...exif, acc: null }; src = "photo"; }
    else { try { loc = await getPosition(8000); src = "gps"; } catch (e) {} }
    const key = "p-" + uid(), nowISO = new Date().toISOString();
    await store.put("photos", blob, key);
    const f = normalise({
      id: uid(), type: lsGet("lastType", "mushroom"), name: "", photos: [{ key, label: "Whole" }],
      lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, acc: loc ? loc.acc ?? null : null, locSource: src,
      foundAt: nowISO, createdAt: nowISO, updatedAt: nowISO, needsDetails: true, moon: moonPhase(nowISO), inatQueued: inat.connected() && lsGet("inatAuto", true) ? true : undefined,
      width: null, height: null, length: null, stem: null, colours: [], colourNote: "", description: "",
      weather: [], rainRecent: "", temp: null, weatherNote: ""
    });
    if (activeTripId()) f.tripId = activeTripId();
    await store.put("finds", f);
    if (finds.some(x => x.sample)) await removeExamples();
    await loadFinds();
    toast(loc ? "Saved with location. Add details later." : "Saved. No location yet, so pin it when you add details.");
    renderLog();
    // Fill weather quietly if there's signal.
    if (loc && netOK()) fetchWeather(loc.lat, loc.lng, f.foundAt).then(async w => {
      const cur = finds.find(x => x.id === f.id); if (!cur || cur.weather.length) return;
      Object.assign(cur, { weather: w.chips, temp: w.temp, rainRecent: w.rainRecent, weatherNote: w.note, soil: w.soil, soilVwc: w.soilVwc, soilAuto: !!w.soil, wxAuto: true });
      try { Object.assign(cur, await fetchTerrain(loc.lat, loc.lng)); } catch (e) {}
      await store.put("finds", cur);
    }).catch(() => {});
  } catch (e) { toast(e.message || "Couldn't save that photo"); }
}

/* ============================================================
   Finds list
   ============================================================ */
function matches(f) {
  if (view.filter === "todo") { if (!missingInfo(f).length) return false; }
  else if (view.filter !== "all" && f.type !== view.filter) return false;
  for (const q of view.quick) { const d = QUICK.find(x => x[0] === q); if (d && !d[2](f)) return false; }
  if (view.trip && f.tripId !== view.trip) return false;
  if (view.q) {
    const hay = [f.name, f.description, f.notes, f.kitchen && f.kitchen.text, ...Object.values(f.hablog || {}), ...((f.kitchen && f.kitchen.ways) || []), f.colourNote, f.trees, f.substrate, f.weatherNote, ...(f.habitat || []), ...(f.tags || []), ...(f.colours || []), f.idApp && f.idApp.result, ...(f.smell || []), ...(f.texture || []), f.bruise, f.soil, (f.moon || {}).name, ...(f.lookalikes || []).map(l => l.name)].join(" ").toLowerCase();
    return view.q.toLowerCase().split(/\s+/).every(w => hay.includes(w.replace(/^#/, "")));
  }
  return true;
}
function sortFinds(list) {
  const t = f => new Date(f.foundAt).getTime();
  switch (view.sort) {
    case "oldest": return list.sort((a, b) => t(a) - t(b));
    case "name": return list.sort((a, b) => (a.name || "~").localeCompare(b.name || "~"));
    case "nearest": if (lastLoc) { const d = f => f.lat == null ? Infinity : haversine(lastLoc, f); return list.sort((a, b) => d(a) - d(b)); } break;
    case "season": return list.sort((a, b) => new Date(a.foundAt).getMonth() - new Date(b.foundAt).getMonth() || t(b) - t(a));
  }
  return list.sort((a, b) => t(b) - t(a));
}
function groupKey(f) {
  const d = new Date(f.foundAt);
  if (view.sort === "season") return MONTHS[d.getMonth()];
  if (view.sort === "newest" || view.sort === "oldest") return MONTHS[d.getMonth()] + " " + d.getFullYear();
  return null;
}
// What a find is still missing, so it can be finished later.
function missingInfo(f) {
  if (f.sample) return [];
  const m = [];
  if (!f.name) m.push("name");
  if (!f.photos || !f.photos.length) m.push("photo");
  if (f.lat == null) m.push("location");
  if (f.needsDetails && !m.length) m.push("details");
  return m;
}
function cardHTML(f) {
  const dist = lastLoc && f.lat != null ? fmtDist(haversine(lastLoc, f)) : null;
  const dateStr = view.sort === "season" ? fmtDate(f.foundAt) : fmtDate(f.foundAt, { weekday: "short", day: "numeric", month: "short" });
  return `<a class="card" href="#find-${esc(f.id)}">
    <img class="thumb" data-photo="${esc(cover(f) || "")}" alt="">
    <div class="card-body">
      <div class="card-title ${f.name ? "" : "unnamed"}">${esc(f.name || "Not yet identified")}<span class="edot ${esc(f.edibility || "unknown")}" title="${esc(edibLabel(f.edibility))}" aria-label="${esc(edibLabel(f.edibility))}"></span></div>
      <div class="meta"><span class="dot ${f.type}"></span><span>${f.type === "plant" ? "Plant" : "Mushroom"}</span>${missingInfo(f).length ? `<span class="badge-todo">Needs ${esc(missingInfo(f).join(", "))}</span>` : ""}${f.revisit ? '<span class="badge-rv">Revisit</span>' : ""}${f.inat && f.inat.quality === "research" ? '<span class="badge-rv">iNat confirmed</span>' : ""}${f.sample ? '<span class="badge-ex">Example</span>' : ""}${f.sharedFrom ? `<span class="badge-rv" style="color:var(--shroom);border-color:color-mix(in srgb, var(--shroom) 50%, transparent)">From ${esc(f.sharedFrom)}</span>` : ""}${!f.photos.length && f.voice.length ? '<span class="badge-rv">Voice</span>' : ""}</div>
      <div class="meta num"><span>${esc(dateStr)}</span><span class="sep">${esc(fmtTime(f.foundAt))}</span>${dist ? `<span class="sep">${esc(dist)} away</span>` : f.lat == null ? '<span class="sep">No location</span>' : ""}</div>
    </div>
  </a>`;
}
async function hydrateThumbs(root) {
  for (const img of $$("img[data-photo]", root)) {
    const k = img.dataset.photo; img.removeAttribute("data-photo");
    if (!k) continue;
    const u = await photoURL(k); if (u) img.src = u;
  }
}
function renderLog() {
  setChrome({ title: "Shroom Log", tab: "log" });
  main.innerHTML = `<div class="wrap view">
    ${finds.some(f => f.sample) ? `<div class="banner warn"><svg><use href="#i-warn"/></svg><div class="grow">The finds marked <b>Example</b> show how the log looks. They'll disappear when you save your first find.</div></div>` : ""}
    <div id="fruitBanner"></div>
    <div class="quickrow"><label class="quick" for="quickIn"><span class="qi"><svg><use href="#i-bolt"/></svg></span><span><b>Quick log</b><span>Photo now, details later</span></span></label>
    <input class="sr" type="file" id="quickIn" accept="image/*" capture="environment">
    ${canRecord() ? `<button type="button" class="quick" id="voiceQuick" style="text-align:left;color:inherit;font:inherit"><span class="qi" style="background:var(--plant);color:var(--plant-ink)"><svg><use href="#i-mic"/></svg></span><span><b>Voice log</b><span>Say what you found</span></span></button>` : ""}</div>
    ${finds.some(f => f.idReview) ? `<a class="banner" href="#review" style="text-decoration:none;color:var(--fg)"><svg style="color:var(--plant)"><use href="#i-edit"/></svg><div class="grow"><b>${finds.filter(f => f.idReview).length} ID ${finds.filter(f => f.idReview).length === 1 ? "change" : "changes"} to review</b> from iNaturalist. Nothing changes until you choose.</div></a>` : ""}
    ${activeTripId() && tripById(activeTripId()) ? `<a class="banner" href="#trip-${esc(activeTripId())}" style="text-decoration:none;color:var(--fg)"><svg style="color:var(--shroom)"><use href="#i-map"/></svg><div class="grow"><b>On a trip: ${esc(tripById(activeTripId()).name)}.</b> New finds are added to it.</div></a>` : `<a href="#trips" class="hint" style="color:var(--plant);font-weight:700;text-decoration:none">Start a trip ›</a>`}
    ${settings.camp ? `<a class="banner warn" href="#more" style="text-decoration:none;color:inherit"><svg><use href="#i-bolt"/></svg><div class="grow"><b>Camping mode is on.</b> Nothing goes online, to save battery.</div></a>` : ""}
    <div class="toolbar">
      <div class="toprow"><div class="search" style="flex:1;min-width:0"><svg><use href="#i-search"/></svg><input type="text" id="q" placeholder="Search finds" value="${esc(view.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search finds"></div>
        <label class="tbtn" title="Sort"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="sr">Sort</span>
        <select id="sortSel" aria-label="Sort">
          <option value="newest">Newest first, by month</option>
          <option value="oldest">Oldest first, by month</option>
          <option value="season">Month of the year</option>
          <option value="nearest">Nearest to me</option>
          <option value="name">Name, A to Z</option>
        </select></label>
        <button type="button" class="tbtn" id="layoutBtn" aria-label="${lsGet("layout", "list") === "grid" ? "Show as a list" : "Show as photo grid"}">${lsGet("layout", "list") === "grid"
          ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
          : `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></g></svg>`}</button></div>
      <div class="chiprow" role="group" aria-label="Filters"><div id="filterSeg" class="chips"></div><span class="vsep" aria-hidden="true"></span><div class="chips" id="quickRow"></div></div>
      <div id="sortNote"></div>
      <div id="sunLine" class="sunmini">${sunsetHTML()}</div>
    </div>
    <div id="results" class="${lsGet("layout", "list") === "grid" ? "gridview" : ""}" style="display:flex;flex-direction:column;gap:16px"></div>
  </div>`;
  $("#sortSel").value = view.sort;
  $("#layoutBtn").addEventListener("click", () => { lsSet("layout", lsGet("layout", "list") === "grid" ? "list" : "grid"); renderLog(); });
  const vq = $("#voiceQuick"); if (vq) vq.addEventListener("click", () => voiceQuickLog(vq));
  // Today's fruiting outlook, with any of your own spots that look good.
  Promise.all([fruitOutlook().catch(() => null), checkFruiting(false).catch(() => null)]).then(([o, r]) => {
    const hits = (r && r.hits || []).filter(h => finds.some(f => f.id === h.id));
    const fb = $("#fruitBanner"); if (!fb || (!o && !hits.length)) return;
    const col = o ? { Good: "var(--plant)", Fair: "var(--shroom)", Poor: "var(--muted)", "Off season": "var(--muted)" }[o.level] : "var(--plant)";
    fb.innerHTML = `<a class="outlook" href="#season"><span class="olvl" style="color:${col}">${o ? esc(o.level) : "Good"}</span><span class="grow"><b>Today's fruiting outlook</b><span class="hint num">${o ? `${o.rain} mm rain this week · ${o.temp} °C average${o.stale ? " · " + esc(ago(o.ts)) : ""}` : ""}${hits.length ? `${o ? " · " : ""}<b style="color:var(--plant)">${hits.length} of your ${hits.length === 1 ? "spots looks" : "spots look"} good</b>` : ""}</span></span><svg class="gchev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a>`;
  });
  $("#quickIn").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) quickLog(f); });
  $("#q").addEventListener("input", e => { view.q = e.target.value.trim(); renderResults(); });
  $("#sortSel").addEventListener("change", async e => {
    view.sort = e.target.value; lsSet("sort", view.sort);
    if (view.sort === "nearest" && !lastLoc) { try { await getPosition(); } catch (err) {} }
    renderResults();
  });
  renderResults();
}
function renderResults() {
  const counts = { all: finds.length, mushroom: 0, plant: 0, todo: 0 };
  finds.forEach(f => { counts[f.type]++; if (missingInfo(f).length) counts.todo++; });
  if (view.filter === "todo" && !counts.todo) view.filter = "all";
  const segs = [["all", "All"], ["mushroom", "Mushrooms"], ["plant", "Plants"]];
  if (counts.todo) segs.push(["todo", "Needs details"]);
  $("#filterSeg").innerHTML = segs.map(([v, l]) => `<button type="button" class="chip k-${v}" data-v="${v}" aria-pressed="${view.filter === v}">${l} <span class="num" style="opacity:.7">${counts[v]}</span></button>`).join("");
  $$("#filterSeg button").forEach(b => b.addEventListener("click", () => { view.filter = b.dataset.v; lsSet("filter", view.filter); renderResults(); }));

  const trips = tripList();
  if (view.trip && !trips.some(t => t.id === view.trip)) view.trip = null;
  $("#quickRow").innerHTML = QUICK.map(([k, l]) => `<button type="button" class="chip" data-q="${k}" aria-pressed="${view.quick.includes(k)}">${l}</button>`).join("")
    + (trips.length ? `<select id="tripSel" aria-label="Trip" style="min-height:36px;border-radius:999px;padding:0 12px"><option value="">Any trip</option>${trips.map(t => `<option value="${esc(t.id)}" ${view.trip === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>` : "")
    + (view.quick.length || view.trip ? `<button type="button" class="chip" id="qClear">Clear</button>` : "");
  $$("#quickRow [data-q]").forEach(b => b.addEventListener("click", async () => {
    const k = b.dataset.q;
    view.quick = view.quick.includes(k) ? view.quick.filter(x => x !== k) : [...view.quick, k];
    lsSet("quick", view.quick);
    if (k === "near" && view.quick.includes("near") && !lastLoc) { try { await getPosition(); } catch (e) { toast("Location isn't available here"); } }
    renderResults();
  }));
  const ts = $("#tripSel"); if (ts) ts.addEventListener("change", () => { view.trip = ts.value || null; renderResults(); });
  const qc = $("#qClear"); if (qc) qc.addEventListener("click", () => { view.quick = []; view.trip = null; lsSet("quick", []); renderResults(); });

  let note = "";
  if (view.sort === "nearest") note = lastLoc
    ? `<div class="context-note">Sorted by distance from your last known location, updated ${esc(ago(lastLoc.ts))}. <button class="btn ghost small" id="refreshLoc" type="button"><svg><use href="#i-gps"/></svg>Update</button></div>`
    : `<div class="context-note">Your location isn't known yet. <button class="btn ghost small" id="refreshLoc" type="button"><svg><use href="#i-gps"/></svg>Find me</button></div>`;
  if (view.sort === "season") note = `<div class="context-note">Grouped by month of the year across all years, to show what turns up when.</div>`;
  $("#sortNote").innerHTML = note;
  const rl = $("#refreshLoc");
  if (rl) rl.addEventListener("click", async () => {
    rl.disabled = true;
    try { await getPosition(); toast("Location updated"); } catch (e) { toast("Location isn't available here"); }
    renderResults();
  });

  const list = sortFinds(finds.filter(matches));
  const res = $("#results");
  if (!list.length) {
    res.innerHTML = finds.length
      ? `<div class="empty"><h2>No matches</h2><p>Nothing matches this search or filter.</p></div>`
      : `<div class="empty"><svg width="56" height="56" style="color:var(--faint)"><use href="#i-shroom"/></svg><h2>Your log is empty</h2><p>Tap the + button, or Quick log, to save your first mushroom or plant.</p><a class="btn primary" href="#new"><svg><use href="#i-plus"/></svg>Log a find</a></div>`;
    return;
  }
  navIds = list.map(f => f.id); lsSet("navIds", navIds);
  const groupCounts = {};
  list.forEach(f => { const k = groupKey(f); if (k) groupCounts[k] = (groupCounts[k] || 0) + 1; });
  // Months fold up. The newest one starts open; your choices are remembered, and a search opens them all.
  const keys = Object.keys(groupCounts), openSet = new Set(lsGet("logOpen:" + view.sort, keys.slice(0, 1)));
  const allOpen = !!(view.q || "").trim();
  let cur = null, html = "", items = [];
  const flush = () => { if (items.length) { html += cur ? `<div class="list">${items.join("")}</div></details>` : `<div class="list">${items.join("")}</div>`; items = []; } };
  for (const f of list) {
    const k = groupKey(f);
    if (k && k !== cur) { flush(); cur = k; html += `<details class="mgroup" data-k="${esc(k)}" ${allOpen || openSet.has(k) ? "open" : ""}><summary class="group-h"><h2>${esc(k)}</h2><span class="num">${groupCounts[k]} ${groupCounts[k] === 1 ? "find" : "finds"}</span><svg class="gchev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></summary>`; }
    items.push(cardHTML(f));
  }
  flush();
  res.innerHTML = (keys.length > 1 ? `<div class="mtools"><button type="button" id="mAll">Open all</button><span aria-hidden="true">·</span><button type="button" id="mNone">Close all</button></div>` : "") + html;
  const saveOpen = () => { if (!allOpen) lsSet("logOpen:" + view.sort, $$(".mgroup", res).filter(d => d.open).map(d => d.dataset.k)); };
  $$(".mgroup", res).forEach(d => d.addEventListener("toggle", () => { saveOpen(); if (d.open) hydrateThumbs(d); }));
  const ma = $("#mAll"); if (ma) ma.addEventListener("click", () => { $$(".mgroup", res).forEach(d => { d.open = true; }); saveOpen(); });
  const mn = $("#mNone"); if (mn) mn.addEventListener("click", () => { $$(".mgroup", res).forEach(d => { d.open = false; }); saveOpen(); });
  hydrateThumbs(res);
}

/* ============================================================
   Detail
   ============================================================ */
const measureVal = cm => cm == null ? "—" : `${toDisp(cm)}<small> ${unitLabel()}</small>`;
const edibLabel = v => (EDIBILITY.find(e => e[0] === v) || EDIBILITY[0])[1];
function chipSwatch(name, list) { const s = list.find(x => x[0] === name); return `<span class="chip" style="cursor:default"><span class="sw" style="background:${s ? s[1] : "transparent"}"></span>${esc(name)}</span>`; }



/* ============================================================
   Guides: beginner edibles, host trees and tree ID. All offline.
   ============================================================ */
const guideBanner = `<div class="banner danger"><svg><use href="#i-warn"/></svg><div class="grow"><b>Learn from this, but never eat from it.</b> Have every find checked in person by an expert, every time.</div></div>`;
const GUIDE_GROUPS = [
  ["Shelves and brackets on wood", ["chicken", "hen", "oyster", "reishi", "chaga"]],
  ["Teeth and spines", ["lionsmane", "bearshead", "hedgehog"]],
  ["Ridges and trumpets", ["chanterelle", "blacktrumpet"]],
  ["Gills", ["shaggymane", "winecap", "enoki"]],
  ["Pores (boletes)", ["porcini"]],
  ["Odd shapes", ["morel", "puffball", "lobster", "woodear"]]
];
function guideCard(href, img, title, sub, line) {
  return `<a class="gcard" href="${href}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'gph'}))">` : `<span class="gph"></span>`}<span class="gbody"><b>${esc(title)}</b><i>${esc(sub)}</i><span>${esc(line)}</span></span><svg class="gchev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></a>`;
}
function renderGuides() {
  setChrome({ title: "Guides", back: true });
  const taxa = lsGet("taxa2", {}), tph = lsGet("treePh", {});
  const open = new Set(lsGet("guideOpen", ["Shelves and brackets on wood"]));
  const firstSentence = x => (x.match(/^[^.]*\./) || [x])[0];
  const grp = (name, count, body, icon) => `<details class="ggroup" data-g="${esc(name)}" ${open.has(name) ? "open" : ""}><summary><span class="gicon ${icon}"></span><span class="gname">${esc(name)}</span><span class="gcount num">${count}</span><svg class="gchev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></summary><div class="glist">${body}</div></details>`;
  const shroom = GUIDE_GROUPS.map(([g, ids]) => {
    const list = ids.map(id => EDIBLES.find(e => e.id === id)).filter(e => e && GUIDES[e.id]);
    return grp(g, list.length, list.map(e => guideCard(`#guide-${e.id}`, taxa[e.latin] && taxa[e.latin].photo, e.name, e.latin, GUIDES[e.id].why)).join(""), "mushroom");
  }).join("");
  const trees = [["Broadleaf trees", "Broadleaf"], ["Conifers", "Conifer"], ["Other places to look", "Habitat"]].map(([g, type]) => {
    const list = TREES.filter(t => t.type === type).sort((a, b) => a.name.localeCompare(b.name));
    return grp(g, list.length, list.map(t => guideCard(`#tree-${t.id}`, tph[t.id] && (tph[t.id].leaf || tph[t.id].bark || {}).src, t.name, t.latin, firstSentence(t.bark))).join(""), "plant");
  }).join("");
  main.innerHTML = `<div class="wrap view">${guideBanner}
    <div class="btn-row"><a class="btn plant" href="#key">Mushroom key: step by step</a><a class="btn" href="#anatomy">Mushroom anatomy</a></div>
    <div class="section"><h3>Beginner mushrooms</h3><p class="hint">Often taught first because their key features are distinctive. Every one still has lookalikes.</p>${shroom}</div>
    <div class="section"><h3>Trees</h3><p class="hint">Knowing the trees tells you where to look.</p>${trees}
      <div class="btn-row"><button class="btn small" type="button" id="treeSave"><svg><use href="#i-down"/></svg>Save all tree photos for offline</button></div><p class="hint" id="treeSaveMsg" style="margin:0"></p></div>
    <div class="btn-row"><a class="btn" href="#pack">Trip packing list</a></div>
  </div>`;
  $$(".ggroup").forEach(d => d.addEventListener("toggle", () => {
    const o = new Set(lsGet("guideOpen", [])); d.open ? o.add(d.dataset.g) : o.delete(d.dataset.g); lsSet("guideOpen", [...o]);
  }));
  $("#treeSave").addEventListener("click", async () => {
    const b = $("#treeSave"), msg = $("#treeSaveMsg");
    if (!netOK()) { msg.textContent = settings.camp ? "Turn off camping mode first." : "This needs signal."; return; }
    b.disabled = true;
    const list = TREES.filter(t => t.type !== "Habitat");
    let n = 0;
    for (const t of list) {
      msg.textContent = `Saving ${t.name} (${++n} of ${list.length})…`;
      const ph = await treePhotos(t).catch(() => null);
      // Fetching each image puts it in the offline photo store.
      for (const x of [ph && ph.leaf, ph && ph.bark]) if (x) await fetch(x.src, { mode: "no-cors" }).catch(() => {});
    }
    msg.textContent = "Tree photos saved. They'll show with no signal.";
    renderGuides();
  });
}
function refPhotoHTML(e, h = 200) {
  const t = lsGet("taxa2", {})[e.latin];
  return t && t.photo ? `<figure style="margin:0"><img src="${esc(t.big || t.photo)}" alt="${esc(e.name)}, reference" style="width:100%;height:${h}px;object-fit:cover;border-radius:var(--r-md);background:var(--surface-2);display:block" onerror="this.closest('figure').remove()"><figcaption class="hint" style="font-size:11px;margin-top:4px">${esc(t.attr)}, via iNaturalist</figcaption></figure>` : "";
}
function renderGuide(id) {
  const e = EDIBLES.find(x => x.id === id), g = GUIDES[id];
  if (!e || !g) { location.hash = "guides"; return; }
  setChrome({ title: "Guide", back: true });
  const host = HOSTS[id];
  const mine = finds.filter(f => guideFor(f.name) === e);
  main.innerHTML = `<div class="wrap view">
    <div class="detail-head"><span class="type-pill mushroom" style="align-self:flex-start"><span class="dot mushroom"></span>Mushroom</span><h2>${esc(e.name)}</h2><div class="meta"><i>${esc(e.latin)}</i></div></div>
    ${refPhotoHTML(e, 220)}
    ${guideBanner}
    <p>${esc(g.why)}</p>
    <div class="panel" style="gap:6px"><h3>Check every one of these</h3><ol style="margin:0;padding-left:22px;display:grid;gap:6px">${g.steps.map(x => `<li>${esc(x)}</li>`).join("")}</ol>
      ${(EDIBLE_ID[id] || []).length ? `<details><summary style="cursor:pointer;font-weight:700">More features</summary><ul style="margin:6px 0 0;padding-left:20px">${EDIBLE_ID[id].map(x => `<li>${esc(x)}</li>`).join("")}</ul></details>` : ""}</div>
    <div class="section"><h3>Lookalikes</h3><div class="settings-list">${g.vs.map(([n, d, how]) => `<div class="panel" style="gap:6px"><div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(n)}</b><span class="edib ${/deadly/i.test(d) ? "deadly" : /toxic|avoid/i.test(d) ? "toxic" : "unknown"}" style="flex:none">${esc(d)}</span></div><p style="margin:0">${esc(how)}</p></div>`).join("")}</div></div>
    <div class="facts" style="grid-template-columns:1fr">
      <div class="fact"><span class="eyebrow">Season</span><span class="v" style="font-size:15px">${esc(monthRanges((e.na || []).map(m => m - 1)) || "—")} in eastern and central North America</span></div>
      ${host ? `<div class="fact"><span class="eyebrow">Where to look</span><span class="v" style="font-size:15px">${host.trees.map(t => { const tr = TREES.find(x => x.id === t); return tr ? `<a href="#tree-${t}" style="color:var(--plant)">${esc(tr.name)}</a>` : ""; }).filter(Boolean).join(", ")}${host.trees.length ? ". " : ""}${esc(host.note)}</span></div>` : ""}
      <div class="fact"><span class="eyebrow">Picking and cooking</span><span class="v" style="font-size:15px">${esc(g.harvest)}</span></div>
      <div class="fact"><span class="eyebrow">Keeping</span><span class="v" style="font-size:15px">${esc(g.keep)}</span></div>
    </div>
    ${mine.length ? `<a class="btn" href="#species-${encodeURIComponent(speciesKey(mine[0]))}">Your ${mine.length} ${mine.length === 1 ? "find" : "finds"} of this ›</a>` : ""}
  </div>`;
}

/* Leaf and bark photos for the tree guide, from Wikimedia Commons (openly licensed), saved after the first look. */
const TREE_QUERY = { spruce: "Picea glauca", aspen: "Populus tremuloides", whiteoak: "Quercus alba", redpine: "Pinus resinosa", willow: "Salix", hawthorn: "Crataegus",
  mountainash: "Sorbus americana", balsampoplar: "Populus balsamifera", apple: "Malus domestica", cedar: "Thuja occidentalis" };
const treeQ = t => TREE_QUERY[t.id] || t.latin.split(",")[0].replace(/ and relatives/, "").trim();
async function commonsPhoto(q, part) {
  const words = part === "bark" ? /bark|trunk|stem/i : /lea(f|ves)|foliage|needle|twig|branch/i;
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(`"${q}" ${part === "bark" ? "bark" : "leaves"} filetype:bitmap`)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640`;
  const r = await fetch(u); if (!r.ok) throw new Error("commons");
  const pages = Object.values(((await r.json()).query || {}).pages || {}).sort((a, b) => a.index - b.index);
  const ok = pages.filter(p => { const m = (p.imageinfo || [])[0]; const lic = m && m.extmetadata && m.extmetadata.LicenseShortName && m.extmetadata.LicenseShortName.value; return m && m.thumburl && /cc|public domain|pd/i.test(lic || ""); });
  const best = ok.find(p => words.test(p.title)) || ok[0];
  if (!best) return null;
  const m = best.imageinfo[0], md = m.extmetadata;
  const artist = String((md.Artist && md.Artist.value) || "Unknown").replace(/<[^>]*>/g, "").trim().slice(0, 60);
  return { src: m.thumburl, page: m.descriptionurl, artist, lic: md.LicenseShortName.value };
}
async function treePhotos(t, force) {
  const all = lsGet("treePh", {});
  if (all[t.id] && !force) return all[t.id];
  if (!netOK() || t.type === "Habitat") return all[t.id] || null;
  const q = treeQ(t);
  const [leaf, bark] = await Promise.all([commonsPhoto(q, "leaf").catch(() => null), commonsPhoto(q, "bark").catch(() => null)]);
  if (!leaf && !bark) return null;
  all[t.id] = { leaf, bark, at: Date.now() }; lsSet("treePh", all);
  return all[t.id];
}
function treePhotoHTML(ph, t) {
  const fig = (x, label) => x ? `<figure style="margin:0"><a href="${esc(x.page)}" target="_blank" rel="noopener"><img src="${esc(x.src)}" alt="${esc(t.name)} ${label.toLowerCase()}" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:var(--surface-2);display:block" onerror="this.closest('figure').innerHTML='<p class=hint>Photo not saved yet.</p>'"></a><figcaption class="hint" style="font-size:11px;margin-top:4px"><b style="color:var(--fg)">${label}</b> · ${esc(x.artist)}, ${esc(x.lic)}, Wikimedia Commons</figcaption></figure>` : `<p class="hint">No ${label.toLowerCase()} photo found.</p>`;
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${fig(ph.leaf, t.type === "Conifer" ? "Needles" : "Leaf")}${fig(ph.bark, "Bark")}</div>`;
}
function renderTree(id) {
  const t = TREES.find(x => x.id === id);
  if (!t) { location.hash = "guides"; return; }
  setChrome({ title: "Tree ID", back: true });
  const grows = EDIBLES.filter(e => HOSTS[e.id] && HOSTS[e.id].trees.includes(id));
  main.innerHTML = `<div class="wrap view">
    <div class="detail-head"><span class="type-pill plant" style="align-self:flex-start"><span class="dot plant"></span>${esc(t.type)}</span><h2>${esc(t.name)}</h2><div class="meta"><i>${esc(t.latin)}</i></div></div>
    ${t.type === "Habitat" ? "" : `<div id="treePh">${lsGet("treePh", {})[t.id] ? treePhotoHTML(lsGet("treePh", {})[t.id], t) : `<p class="hint">${netOK() ? "Loading leaf and bark photos…" : "Leaf and bark photos load the first time you open this with signal."}</p>`}</div>`}
    <div class="facts" style="grid-template-columns:1fr">
      <div class="fact"><span class="eyebrow">Leaves or needles</span><span class="v" style="font-size:15px">${esc(t.leaf)}</span></div>
      <div class="fact"><span class="eyebrow">Bark</span><span class="v" style="font-size:15px">${esc(t.bark)}</span></div>
      <div class="fact"><span class="eyebrow">Shape and where</span><span class="v" style="font-size:15px">${esc(t.form)}</span></div>
      <div class="fact"><span class="eyebrow">Through the seasons</span><span class="v" style="font-size:15px">${esc(t.season)}</span></div>
      <div class="fact"><span class="eyebrow">Don't confuse with</span><span class="v" style="font-size:15px">${esc(t.look)}</span></div>
    </div>
    ${grows.length ? `<div class="section"><h3>Look here for</h3><div class="chips">${grows.map(e => `<a class="chip" href="${GUIDES[e.id] ? "#guide-" + e.id : "#edibles"}" style="text-decoration:none"><span class="dot ${e.kind}"></span>${esc(e.name)}</a>`).join("")}</div></div>` : ""}
    <p class="hint">Where trees grow changes what's under them. These notes are for eastern and central Canada and the northern US. Photos are picked automatically from Wikimedia Commons; tap one to see its source.</p>
  </div>`;
  if (t.type !== "Habitat" && !lsGet("treePh", {})[t.id] && netOK()) treePhotos(t).then(ph => { const el = $("#treePh"); if (el) el.innerHTML = ph ? treePhotoHTML(ph, t) : `<p class="hint">Couldn't find photos for this one.</p>`; }).catch(() => {});
}

/* Side by side: your photo and a reference photo, with the ID checklist. */
async function openCompare(f) {
  const bg = document.createElement("div"); bg.className = "sheet-bg";
  const guess = guideFor(f.name);
  const opts = EDIBLES.map(e => `<option value="${e.id}" ${guess === e ? "selected" : ""}>${esc(e.name)}</option>`).join("");
  bg.innerHTML = `<div class="sheet" role="dialog" aria-label="Compare photos" style="max-height:92vh;overflow:auto"><h3>Compare with a reference</h3>
    <div class="field"><label for="cmpSel">Compare with</label><select id="cmpSel">${guess ? "" : '<option value="">Pick a species</option>'}${opts}</select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="cmpGrid"></div>
    <div id="cmpList"></div>
    <p class="hint">A reference photo is one example: real ones vary a lot. A match here is not an ID. Have it checked in person by an expert.</p>
    <div class="btn-row"><button class="btn" type="button" id="cmpClose">Close</button></div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", ev => { if (ev.target === bg) close(); });
  $("#cmpClose", bg).addEventListener("click", close);
  const mineURL = await photoURL(f.photos[0].key);
  let pick = 0;
  const draw = () => {
    const e = EDIBLES.find(x => x.id === $("#cmpSel", bg).value);
    const ph = f.photos[pick] || f.photos[0];
    $("#cmpGrid", bg).innerHTML = `<figure style="margin:0"><img id="cmpMine" alt="Your photo" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;background:var(--surface-2)"><figcaption class="hint" style="font-size:12px">Yours${f.photos.length > 1 ? ` · <button type="button" class="btn small ghost" id="cmpNext" style="min-height:28px;padding:0 8px">Next photo</button>` : ""}</figcaption></figure>`
      + (e ? (() => { const t = lsGet("taxa2", {})[e.latin]; return t && t.photo ? `<figure style="margin:0"><img src="${esc(t.big || t.photo)}" alt="${esc(e.name)} reference" style="width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:10px;background:var(--surface-2)" onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'hint',textContent:'Reference photo not saved yet. Open In season with signal once.'}))"><figcaption class="hint" style="font-size:12px">${esc(e.name)} · ${esc(t.attr)}</figcaption></figure>` : `<p class="hint">No reference photo saved for this one yet. Open In season once with signal to load them.</p>`; })() : "<span></span>");
    photoURL(ph.key).then(u => { const im = $("#cmpMine", bg); if (im && u) im.src = u; });
    const nx = $("#cmpNext", bg); if (nx) nx.addEventListener("click", () => { pick = (pick + 1) % f.photos.length; draw(); });
    $("#cmpList", bg).innerHTML = e && EDIBLE_ID[e.id] ? `<div class="panel" style="gap:6px;margin-top:8px"><b>Does yours have all of these?</b>${EDIBLE_ID[e.id].map((x, i) => `<label class="switch" style="font-size:14px;gap:10px"><span>${esc(x)}</span><input type="checkbox"></label>`).join("")}<p style="margin:0;color:#f6c2b6"><b>Lookalikes:</b> ${esc(e.look)}</p></div>` : "";
  };
  $("#cmpSel", bg).addEventListener("change", draw);
  draw();
}

/* Packing list, ticked off per trip. */
function renderPack() {
  setChrome({ title: "Packing list", back: true });
  const done = new Set(lsGet("packDone", [])), extra = lsGet("packExtra", []);
  const groups = [...PACK, ...(extra.length ? [["Your items", extra]] : [])];
  const total = groups.reduce((a, g) => a + g[1].length, 0), n = groups.reduce((a, g) => a + g[1].filter(x => done.has(x)).length, 0);
  main.innerHTML = `<div class="wrap view checklist">
    <p class="num"><b>${n} of ${total} packed</b></p>
    ${groups.map(([g, items]) => `<div class="panel" style="gap:4px"><h3>${esc(g)}</h3>${items.map(x => `<label class="switch" style="font-size:15px"><span>${esc(x)}</span><span style="display:flex;gap:6px;align-items:center">${g === "Your items" ? `<button type="button" class="btn small ghost" data-rm="${esc(x)}" aria-label="Remove ${esc(x)}">×</button>` : ""}<input type="checkbox" data-item="${esc(x)}" ${done.has(x) ? "checked" : ""}></span></label>`).join("")}</div>`).join("")}
    <div class="panel"><div class="btn-row"><input type="text" id="packNew" placeholder="Add your own item" style="flex:1"><button class="btn small plant" type="button" id="packAdd">Add</button></div></div>
    <div class="btn-row"><button class="btn ghost" type="button" id="packReset">Untick everything for the next trip</button></div>
  </div>`;
  $$("[data-item]").forEach(c => c.addEventListener("change", () => { const d = new Set(lsGet("packDone", [])); c.checked ? d.add(c.dataset.item) : d.delete(c.dataset.item); lsSet("packDone", [...d]); renderPack(); }));
  $$("[data-rm]").forEach(b => b.addEventListener("click", ev => { ev.preventDefault(); lsSet("packExtra", lsGet("packExtra", []).filter(x => x !== b.dataset.rm)); renderPack(); }));
  $("#packAdd").addEventListener("click", () => { const v = $("#packNew").value.trim(); if (v) { lsSet("packExtra", [...lsGet("packExtra", []).filter(x => x !== v), v]); renderPack(); } });
  $("#packReset").addEventListener("click", () => { lsSet("packDone", []); renderPack(); });
}

/* Home screen shortcut: opens on one big camera button (phones need one tap before the camera can open). */
function renderCamera() {
  setChrome({ title: "Quick log", back: true });
  main.innerHTML = `<div class="wrap view" style="min-height:60vh;display:grid;place-items:center">
    <label for="camIn" class="btn primary" style="width:min(320px,100%);min-height:180px;border-radius:28px;flex-direction:column;font-size:22px;gap:12px"><svg style="width:56px;height:56px"><use href="#i-cam"/></svg>Take a photo</label>
    <input class="sr" type="file" id="camIn" accept="image/*" capture="environment">
    <p class="hint" style="text-align:center">Saves the photo with location and time. Add the details later.</p>
  </div>`;
  $("#camIn").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) { location.hash = "log"; quickLog(f); } });
}
/* ============================================================
   Trips: group finds and hikes from one outing.
   ============================================================ */
const tripList = () => lsGet("trips", []).sort((a, b) => b.start - a.start);
const tripById = id => lsGet("trips", []).find(t => t.id === id) || null;
const activeTripId = () => lsGet("tripLive", null);
function saveTrips(list) { lsSet("trips", list); }
function renderTrips() {
  setChrome({ title: "Trips", back: true });
  const list = tripList(), live = activeTripId();
  const d = new Date();
  main.innerHTML = `<div class="wrap view">
    ${live && tripById(live) ? "" : `<div class="panel"><h3>Start a trip</h3><p>Finds and hikes you log until you end it are added to the trip.</p>
      <div class="field"><label for="tripName">Name</label><input type="text" id="tripName" value="${esc(`Trip, ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`)}"></div>
      <div class="btn-row"><button class="btn plant" type="button" id="tripGo">Start trip</button></div></div>`}
    ${list.length ? list.map(t => { const n = finds.filter(f => f.tripId === t.id).length; return `<a class="card plain" href="#trip-${esc(t.id)}" style="padding:14px"><div class="card-body"><div class="card-title">${esc(t.name)}${t.id === live ? ' <span class="badge-rv">On now</span>' : ""}</div><div class="meta num"><span>${esc(fmtDate(new Date(t.start).toISOString()))}${t.end ? ` to ${esc(fmtDate(new Date(t.end).toISOString()))}` : ""}</span><span class="sep">${n} ${n === 1 ? "find" : "finds"}</span></div></div></a>`; }).join("") : `<p class="hint">No trips yet.</p>`}
  </div>`;
  const go = $("#tripGo");
  if (go) go.addEventListener("click", () => {
    const t = { id: "trip-" + uid(), name: $("#tripName").value.trim() || "Trip", start: Date.now(), end: null };
    saveTrips([...lsGet("trips", []), t]); lsSet("tripLive", t.id); toast("Trip started"); location.hash = "trip-" + t.id;
  });
}
async function renderTrip(id) {
  const t = tripById(id); if (!t) { location.hash = "trips"; return; }
  setChrome({ title: "Trip", back: true });
  const list = finds.filter(f => f.tripId === id).sort((a, b) => new Date(b.foundAt) - new Date(a.foundAt));
  const hikes = ((await store.all("trails").catch(() => [])) || []).filter(h => h.tripId === id || (h.start >= t.start && h.start <= (t.end || Date.now())));
  const live = activeTripId() === id;
  const names = [...new Set(list.filter(f => f.name).map(f => f.name))];
  const km = hikes.reduce((a, h) => a + (h.km || 0), 0), up = hikes.reduce((a, h) => a + (h.up || 0), 0);
  const loose = finds.filter(f => !f.tripId && new Date(f.foundAt).getTime() >= t.start - 6 * 3600000 && new Date(f.foundAt).getTime() <= (t.end || Date.now()));
  main.innerHTML = `<div class="wrap view">
    <div class="detail-head"><h2 id="tripTitle">${esc(t.name)}</h2><div class="meta num"><span>${esc(fmtDate(new Date(t.start).toISOString(), { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}${t.end ? ` to ${esc(fmtDate(new Date(t.end).toISOString(), { day: "numeric", month: "short" }))}` : " · on now"}</span></div></div>
    <div class="facts" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr))">
      <div class="fact"><span class="eyebrow">Finds</span><span class="v num">${list.length}</span></div>
      <div class="fact"><span class="eyebrow">Species</span><span class="v num">${names.length}</span></div>
      <div class="fact"><span class="eyebrow">Hiked</span><span class="v num">${esc(fmtDist(km))}</span></div>
      <div class="fact"><span class="eyebrow">Climb</span><span class="v num">${esc(fmtElev(up))}</span></div>
    </div>
    <div class="btn-row">${live ? `<button class="btn primary" type="button" id="tripEnd">End trip</button>` : ""}<a class="btn ghost" href="#pack">Packing list</a><button class="btn ghost" type="button" id="tripRename">Rename</button>${loose.length ? `<button class="btn ghost" type="button" id="tripAdd">Add ${loose.length} ${loose.length === 1 ? "find" : "finds"} from these dates</button>` : ""}</div>
    ${list.some(f => f.lat != null) || hikes.length ? `<div class="mini-map" id="tripMap" style="height:260px"></div>` : ""}
    ${names.length ? `<p><b>Found:</b> ${names.map(esc).join(", ")}</p>` : ""}
    <div class="list">${list.map(cardHTML).join("") || `<p class="hint">No finds on this trip yet.</p>`}</div>
    <div class="btn-row"><button class="btn small danger" type="button" id="tripDel">Delete trip</button></div><p class="hint">Deleting a trip keeps its finds.</p>
  </div>`;
  hydrateThumbs(main);
  const mapEl = $("#tripMap");
  if (mapEl && hasLeaflet) {
    const pts = list.filter(f => f.lat != null).map(f => [f.lat, f.lng]);
    const m = makeMap(mapEl, pts[0] || defaultCenter(), 13, { dragging: !L.Browser.mobile, scrollWheelZoom: false });
    if (m) {
      list.filter(f => f.lat != null).forEach(f => L.marker([f.lat, f.lng], { icon: pinIcon(f.type) }).addTo(m).bindPopup(`<a href="#find-${esc(f.id)}">${esc(f.name || "Not yet identified")}</a>`));
      const all = [...pts];
      hikes.forEach(h => { const ll = h.points.map(p => [p[0], p[1]]); all.push(...ll); L.polyline(ll, { color: getComputedStyle(document.documentElement).getPropertyValue("--plant").trim(), weight: 3, dashArray: "6 6" }).addTo(m); });
      if (all.length > 1) m.fitBounds(all, { padding: [30, 30], maxZoom: 15 });
    }
  }
  const e1 = $("#tripEnd"); if (e1) e1.addEventListener("click", () => { saveTrips(lsGet("trips", []).map(x => x.id === id ? { ...x, end: Date.now() } : x)); lsSet("tripLive", null); toast("Trip ended"); renderTrip(id); });
  $("#tripRename").addEventListener("click", () => {
    $("#tripTitle").outerHTML = `<div class="btn-row"><input type="text" id="tripNew" value="${esc(t.name)}" style="flex:1"><button class="btn small plant" type="button" id="tripSave">Save</button></div>`;
    $("#tripSave").addEventListener("click", () => { const v = $("#tripNew").value.trim(); if (v) saveTrips(lsGet("trips", []).map(x => x.id === id ? { ...x, name: v } : x)); renderTrip(id); });
  });
  const ad = $("#tripAdd"); if (ad) ad.addEventListener("click", async () => { for (const f of loose) { f.tripId = id; await store.put("finds", f); } await loadFinds(); toast("Added to the trip"); renderTrip(id); });
  $("#tripDel").addEventListener("click", async () => {
    for (const f of list) { delete f.tripId; await store.put("finds", f); }
    saveTrips(lsGet("trips", []).filter(x => x.id !== id)); if (activeTripId() === id) lsSet("tripLive", null);
    await loadFinds(); toast("Trip deleted. Its finds are kept."); location.hash = "trips";
  });
}

/* ============================================================
   Upload past finds to iNaturalist: pick which ones, skip any already there.
   ============================================================ */
const inatState = f => f.inat && f.inat.id ? "sent" : f.sample || f.sharedFrom ? "never" : f.lat == null ? "noloc" : f.inatQueued ? "queued" : "unsent";
// Finds already on iNaturalist that you posted another way (same day, within 300 m).
async function inatFindDuplicates(list) {
  const me = lsGet("inatUser", null) || await inatWhoAmI();
  if (!me || !me.id) return {};
  const days = [...new Set(list.map(f => (f.foundAt || "").slice(0, 10)).filter(Boolean))];
  const out = {};
  for (const d of days) {
    const r = await fetch(`${INAT_API}/observations?user_id=${me.id}&on=${d}&per_page=200&order_by=observed_on`);
    if (!r.ok) continue;
    const obs = ((await r.json()).results || []).filter(o => o.geojson && o.geojson.coordinates);
    for (const f of list.filter(x => (x.foundAt || "").slice(0, 10) === d)) {
      const m = obs.map(o => ({ o, km: haversine({ lat: f.lat, lng: f.lng }, { lat: o.geojson.coordinates[1], lng: o.geojson.coordinates[0] }) })).filter(x => x.km < 0.3).sort((a, b) => a.km - b.km)[0];
      if (m) out[f.id] = { id: m.o.id, name: m.o.taxon ? (m.o.taxon.preferred_common_name || m.o.taxon.name) : "Unknown", m: Math.round(m.km * 1000) };
    }
  }
  return out;
}
async function renderInatPast() {
  setChrome({ title: "Upload past finds", back: true });
  const list = finds.slice().sort((a, b) => (b.foundAt || "").localeCompare(a.foundAt || ""));
  const by = k => list.filter(f => inatState(f) === k);
  const unsent = by("unsent"), queued = by("queued"), sent = by("sent"), noloc = by("noloc");
  const dups = lsGet("inatDups", {});
  const row = (f, extra) => `<div class="panel" style="gap:6px;padding:12px 14px" data-row="${esc(f.id)}"><label class="switch" style="align-items:center;gap:12px">
      <span style="min-width:0"><b>${esc(f.name || "Not yet identified")}</b><br><span class="hint">${esc(fmtDate(f.foundAt))}${f.photos && f.photos.length ? ` · ${f.photos.length} ${f.photos.length === 1 ? "photo" : "photos"}` : " · no photo"}</span></span>
      ${extra}</label>${dups[f.id] ? `<div class="banner warn" style="margin:0"><div class="grow"><b>Might already be on iNaturalist.</b> You posted <a href="${INAT}/observations/${dups[f.id].id}" target="_blank" rel="noopener" style="color:inherit">${esc(dups[f.id].name)}</a> that day, ${dups[f.id].m} m away. It's unticked so it isn't posted twice.</div><button class="btn small" type="button" data-link="${esc(f.id)}">It's the same, link it</button></div>` : ""}</div>`;
  const connected = inat.connected() && !lsGet("inatExpired", false);
  main.innerHTML = `<div class="wrap view">
    <p class="hint">New finds upload on their own when "Send new finds automatically" is on. Older finds only go if you pick them here. Finds already on iNaturalist are never sent again.</p>
    ${connected ? "" : `<a class="banner warn" href="#more" style="text-decoration:none;color:inherit"><div class="grow"><b>${inat.connected() ? "Your iNaturalist sign-in has expired." : "Connect iNaturalist first."}</b> You can still pick finds now; they upload once you're connected. Tap to go to More.</div></a>`}
    <div class="facts" style="grid-template-columns:repeat(4,1fr)">
      <div class="fact"><span class="eyebrow">Not sent</span><span class="v num">${unsent.length}</span></div><div class="fact"><span class="eyebrow">Waiting</span><span class="v num">${queued.length}</span></div>
      <div class="fact"><span class="eyebrow">On iNat</span><span class="v num">${sent.length}</span></div><div class="fact"><span class="eyebrow">No location</span><span class="v num">${noloc.length}</span></div></div>
    <p class="hint" id="dupMsg" style="margin:0"></p>
    <div class="section"><h3>Not sent yet</h3>
      ${unsent.length ? `<div class="btn-row"><button class="btn small" type="button" id="selAll">Select all</button><button class="btn small ghost" type="button" id="selNone">Select none</button></div>
        ${unsent.map(f => row(f, `<input type="checkbox" data-pick="${esc(f.id)}" ${dups[f.id] ? "" : "checked"} aria-label="Upload ${esc(f.name || "this find")}">`)).join("")}
        <div class="btn-row"><button class="btn primary" type="button" id="upPicked" style="flex:1"></button></div>` : `<p class="hint">Nothing left to send.</p>`}</div>
    ${queued.length ? `<div class="section"><h3>Waiting to upload</h3><p class="hint">These go as soon as you have signal${connected ? "" : " and are connected"}.</p>${queued.map(f => row(f, `<button class="btn small ghost" type="button" data-unq="${esc(f.id)}">Don't send</button>`)).join("")}</div>` : ""}
    ${noloc.length ? `<div class="section"><h3>Need a location first</h3><p class="hint">iNaturalist needs to know where it was found. Open one and pin it on the map.</p>${noloc.map(f => `<a class="panel" href="#find-${esc(f.id)}" style="text-decoration:none;color:inherit;padding:12px 14px"><b>${esc(f.name || "Not yet identified")}</b><span class="hint">${esc(fmtDate(f.foundAt))}</span></a>`).join("")}</div>` : ""}
    ${sent.length ? `<details class="section"><summary style="cursor:pointer;font-weight:700">Already on iNaturalist (${sent.length})</summary>${sent.map(f => `<a class="panel" href="${esc(f.inat.url || `${INAT}/observations/${f.inat.id}`)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;padding:12px 14px;margin-top:8px"><b>${esc(f.name || "Not yet identified")}</b><span class="hint">${esc(fmtDate(f.foundAt))} · ${esc(inatQualityLabel(f.inat.quality))}</span></a>`).join("")}</details>` : ""}
  </div>`;
  const picks = () => $$("[data-pick]").filter(c => c.checked).map(c => c.dataset.pick);
  const label = () => { const b = $("#upPicked"); if (b) { const n = picks().length; b.textContent = n ? `Upload ${n} ${n === 1 ? "find" : "finds"}` : "Pick finds to upload"; b.disabled = !n; } };
  label();
  $$("[data-pick]").forEach(c => c.addEventListener("change", label));
  const sa = $("#selAll"); if (sa) sa.addEventListener("click", () => { $$("[data-pick]").forEach(c => { c.checked = true; }); label(); });
  const sn = $("#selNone"); if (sn) sn.addEventListener("click", () => { $$("[data-pick]").forEach(c => { c.checked = false; }); label(); });
  const up = $("#upPicked"); if (up) up.addEventListener("click", async () => {
    const ids = new Set(picks());
    for (const f of finds.filter(x => ids.has(x.id) && inatState(x) === "unsent")) { f.inatQueued = true; await store.put("finds", f); }
    await loadFinds();
    toast(netOK() && connected ? `Uploading ${ids.size} ${ids.size === 1 ? "find" : "finds"}…` : `${ids.size} queued. They upload when you're online and connected.`);
    renderInatPast(); inatProcess().then(() => { if (location.hash === "#inat-past") renderInatPast(); });
  });
  $$("[data-unq]").forEach(b => b.addEventListener("click", async () => { const f = finds.find(x => x.id === b.dataset.unq); delete f.inatQueued; await store.put("finds", f); await loadFinds(); renderInatPast(); }));
  $$("[data-link]").forEach(b => b.addEventListener("click", async () => {
    const f = finds.find(x => x.id === b.dataset.link), d = dups[f.id];
    f.inat = { id: d.id, url: `${INAT}/observations/${d.id}`, uploadedAt: Date.now(), linked: true }; delete f.inatQueued;
    await store.put("finds", f); delete dups[f.id]; lsSet("inatDups", dups); await loadFinds();
    toast("Linked. Its iNaturalist IDs will come into your log."); renderInatPast(); inatProcess();
  }));
  // Look for posts made outside the app, once per visit.
  const checked = lsGet("inatDupChecked", {});
  const check = unsent.concat(queued).filter(f => !checked[f.id]);
  const nDup = Object.keys(dups).filter(k => unsent.some(f => f.id === k)).length;
  if (!check.length && nDup) $("#dupMsg").textContent = `${nDup} ${nDup === 1 ? "find looks like it's" : "finds look like they're"} already on iNaturalist. Check ${nDup === 1 ? "it" : "them"} below.`;
  if (check.length && netOK() && connected && !renderInatPast.checking) {
    renderInatPast.checking = true; $("#dupMsg").textContent = "Checking iNaturalist for finds you already posted yourself…";
    try {
      const found = await inatFindDuplicates(check);
      const all = lsGet("inatDups", {}); Object.assign(all, found); lsSet("inatDups", all);
      check.forEach(f => { checked[f.id] = Date.now(); }); lsSet("inatDupChecked", checked);
      // Pull any newly flagged ones out of the queue so nothing goes twice.
      for (const f of queued.filter(x => found[x.id])) { delete f.inatQueued; await store.put("finds", f); }
      if (Object.keys(found).length) { await loadFinds(); renderInatPast.checking = false; if (location.hash === "#inat-past") return renderInatPast(); }
      const el = $("#dupMsg"); if (el) el.textContent = nDup ? el.textContent : "Checked: none of these are on iNaturalist yet.";
    } catch (e) { const el = $("#dupMsg"); if (el) el.textContent = e.message === "token_expired" ? "Your sign-in expired, so the duplicate check was skipped." : "Couldn't check iNaturalist for duplicates right now."; }
    renderInatPast.checking = false;
  }
}

/* ============================================================
   Saved hikes: a list, and a page for each with its route and full stats.
   ============================================================ */
const hikeDate = t => fmtDate(new Date(t.start).toISOString(), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const hikeFinds = t => finds.filter(f => { const x = new Date(f.foundAt).getTime(); return f.trailId === t.id || (x >= t.start - 60000 && x <= (t.end || t.start) + 60000); });
/* ============================================================
   Notebook: general notes that aren't tied to one find.
   ============================================================ */
const notebook = () => lsGet("notebook", []);
const saveNotebook = list => lsSet("notebook", list);
let nbEdit = null;
async function renderNotebook() {
  setChrome({ title: "Notes", tab: "notes" });
  const list = notebook().sort((a, b) => b.at - a.at);
  const cur = nbEdit ? list.find(n => n.id === nbEdit) : null;
  main.innerHTML = `<div class="wrap view">
    <div class="panel nbcomp">
      <textarea id="nbText" rows="3" placeholder="A note, a spot to check, an idea for next time…">${esc(cur ? cur.text : "")}</textarea>
      <div id="nbVoice"></div>
      <div class="nbbar">
        ${canDictate() ? '<button class="btn small ghost" type="button" id="nbDict" aria-pressed="false"><svg><use href="#i-mic"/></svg><span>Dictate</span></button>' : ""}
        ${canRecord() ? '<button class="btn small ghost" type="button" id="nbRec"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="#e0604f"/></svg><span>Record</span></button>' : ""}
        <span style="flex:1"></span>
        ${cur ? '<button class="btn small ghost" type="button" id="nbCancel">Cancel</button>' : ""}
        <button class="btn small primary" type="button" id="nbSave">${cur ? "Save changes" : "Save note"}</button>
      </div>
    </div>
    ${list.length > 4 ? `<input type="text" id="nbSearch" placeholder="Search notes" aria-label="Search notes">` : ""}
    <div class="nblist" id="nbList">${list.length ? "" : `<p class="hint" style="text-align:center">No notes yet. These are for anything not tied to one find.</p>`}</div>
  </div>`;
  let voices = cur ? (cur.voice || []).map(v => ({ ...v })) : [];
  const removed = [];
  const audioSrc = async v => v.blob ? (v.url ||= URL.createObjectURL(v.blob)) : await store.get("photos", v.key).then(r => r ? URL.createObjectURL(r) : "").catch(() => "");
  async function drawVoice() {
    const rows = [];
    for (let i = 0; i < voices.length; i++) rows.push(`<div class="vrow"><audio controls preload="metadata" src="${await audioSrc(voices[i])}"></audio><button type="button" class="laX" data-vx="${i}" aria-label="Remove recording">×</button></div>`);
    $("#nbVoice").innerHTML = rows.join("");
  }
  drawVoice();
  $("#nbVoice").addEventListener("click", e => { const x = e.target.closest("[data-vx]"); if (x) { const [v] = voices.splice(+x.dataset.vx, 1); if (v.key) removed.push(v.key); drawVoice(); } });
  const dict = $("#nbDict"); if (dict) dict.addEventListener("click", () => { if (dict._r) dict._r.stop(); else dictateInto($("#nbText"), dict); });
  const rec = $("#nbRec");
  if (rec) rec.addEventListener("click", async () => {
    if (rec._rec) { const { blob, secs } = await rec._rec.stop(); rec._rec = null; $("span", rec).textContent = "Record"; rec.setAttribute("aria-pressed", "false"); voices.push({ blob, secs, at: new Date().toISOString() }); drawVoice(); return; }
    try { rec._rec = await recordVoice(s => { $("span", rec).textContent = `Stop ${s}s`; }); $("span", rec).textContent = "Stop"; rec.setAttribute("aria-pressed", "true"); }
    catch (e) { micHelp(e); }
  });
  const cancel = $("#nbCancel"); if (cancel) cancel.addEventListener("click", () => { nbEdit = null; renderNotebook(); });
  $("#nbSave").addEventListener("click", async () => {
    const text = $("#nbText").value.trim();
    if (!text && !voices.length) { toast("Write or record something first"); return; }
    const saved = [];
    for (const v of voices) {
      if (v.blob) { const key = "v-" + uid(); await store.put("photos", v.blob, key); saved.push({ key, secs: v.secs, at: v.at }); }
      else saved.push({ key: v.key, secs: v.secs, at: v.at });
    }
    for (const k of removed) await store.del("photos", k).catch(() => {});
    const all = notebook();
    if (cur) { const n = all.find(x => x.id === cur.id); if (n) Object.assign(n, { text, voice: saved, updatedAt: Date.now() }); }
    else all.push({ id: uid(), text, voice: saved, at: Date.now() });
    saveNotebook(all); nbEdit = null; toast(cur ? "Note updated" : "Note saved"); renderNotebook();
  });
  async function drawList(q = "") {
    const shown = list.filter(n => !q || (n.text || "").toLowerCase().includes(q));
    const out = [];
    for (const n of shown) {
      const aud = [];
      for (const v of n.voice || []) aud.push(`<audio controls preload="metadata" src="${await audioSrc(v)}"></audio>`);
      out.push(`<div class="panel nbitem"><div class="nbmeta"><span class="num">${esc(fmtDate(new Date(n.at).toISOString(), { weekday: "short", day: "numeric", month: "short", year: "numeric" }))} · ${esc(fmtTime(new Date(n.at).toISOString()))}</span><span><button type="button" class="btn small ghost" data-ne="${esc(n.id)}">Edit</button><button type="button" class="laX" data-nx="${esc(n.id)}" aria-label="Delete note">×</button></span></div>${n.text ? `<p style="margin:0;white-space:pre-wrap">${esc(n.text)}</p>` : ""}${aud.join("")}</div>`);
    }
    if (list.length) $("#nbList").innerHTML = out.join("") || `<p class="hint">No notes match.</p>`;
  }
  drawList();
  const sq = $("#nbSearch"); if (sq) sq.addEventListener("input", () => drawList(sq.value.trim().toLowerCase()));
  $("#nbList").addEventListener("click", async e => {
    const ed = e.target.closest("[data-ne]"), x = e.target.closest("[data-nx]");
    if (ed) { nbEdit = ed.dataset.ne; renderNotebook(); return; }
    if (x) {
      if (x.dataset.armed !== "1") { x.dataset.armed = "1"; x.textContent = "Delete?"; x.style.width = "auto"; x.style.fontSize = "14px"; x.style.color = "var(--danger)"; setTimeout(() => { if (document.body.contains(x)) { x.dataset.armed = ""; x.textContent = "×"; x.style.cssText = ""; } }, 3000); return; }
      const all = notebook(); const n = all.find(y => y.id === x.dataset.nx);
      for (const v of (n && n.voice) || []) await store.del("photos", v.key).catch(() => {});
      saveNotebook(all.filter(y => y.id !== x.dataset.nx)); toast("Note deleted"); renderNotebook();
    }
  });
}

async function renderHikes() {
  setChrome({ title: "Hikes", back: true });
  const all = ((await store.all("trails").catch(() => [])) || []).sort((a, b) => b.start - a.start);
  const km = all.reduce((a, t) => a + (t.km || 0), 0), up = all.reduce((a, t) => a + (t.up || 0), 0);
  main.innerHTML = `<div class="wrap view">
    ${all.length ? `<div class="facts" style="grid-template-columns:repeat(3,1fr)"><div class="fact"><span class="eyebrow">Hikes</span><span class="v num">${all.length}</span></div><div class="fact"><span class="eyebrow">Distance</span><span class="v num">${esc(fmtDist(km))}</span></div><div class="fact"><span class="eyebrow">Climb</span><span class="v num">${esc(fmtElev(up))}</span></div></div>
      <div class="list" style="grid-template-columns:1fr">${all.map(t => `<a class="panel" href="#hike-${esc(t.id)}" style="text-decoration:none;color:inherit;padding:12px 14px;gap:2px"><b>${esc(t.name || hikeDate(t))}</b><span class="hint num">${t.name ? esc(hikeDate(t)) + " · " : ""}${esc(fmtDist(t.km || 0))} · ${esc(fmtDur((t.end || t.start) - t.start))}${t.up != null ? ` · ${esc(fmtElev(t.up))} climb` : ""}${hikeFinds(t).length ? ` · ${hikeFinds(t).length} ${hikeFinds(t).length === 1 ? "find" : "finds"}` : ""}</span></a>`).join("")}</div>`
      : `<div class="empty"><h2>No hikes yet</h2><p>Start recording from the Map tab. When you stop, the hike is saved here with its route and stats.</p><a class="btn primary" href="#map">Go to the map</a></div>`}
  </div>`;
}
async function renderHike(id) {
  const t = await store.get("trails", id).catch(() => null);
  if (!t) { location.hash = "hikes"; return; }
  setChrome({ title: "Hike", back: true });
  const fs = hikeFinds(t);
  main.innerHTML = `<div class="wrap view">
    <div class="detail-head"><h2>${esc(t.name || hikeDate(t))}</h2><div class="meta num">${t.name ? `<span>${esc(hikeDate(t))}</span>` : ""}<span class="${t.name ? "sep" : ""}">${esc(fmtTime(new Date(t.start).toISOString()))} to ${esc(fmtTime(new Date(t.end || t.start).toISOString()))}</span></div></div>
    <div class="mini-map" id="hikeMap" style="height:300px"></div>
    ${trailStatsHTML(t)}
    ${fs.length ? `<div class="section"><h3>Found on this hike</h3><div class="list">${fs.map(cardHTML).join("")}</div></div>` : ""}
    <div class="field"><label for="hikeName">Name</label><input type="text" id="hikeName" value="${esc(t.name || "")}" placeholder="For example, Algonquin, Track and Tower"></div>
    <div class="btn-row"><button class="btn small" type="button" id="hikeGpx"><svg><use href="#i-down"/></svg>Save as GPX</button><button class="btn small danger" type="button" id="hikeDel">Delete hike</button></div>
    <p class="hint" style="margin:0">GPX files open in Strava, Gaia GPS, AllTrails and most map apps.</p>
  </div>`;
  hydrateThumbs(main);
  const el = $("#hikeMap"), ll = (t.points || []).map(p => [p[0], p[1]]);
  if (hasLeaflet && ll.length) {
    const m = makeMap(el, ll[0], 14, { dragging: !L.Browser.mobile, scrollWheelZoom: false });
    if (m) {
      const css = getComputedStyle(document.documentElement);
      L.polyline(ll, { color: css.getPropertyValue("--plant").trim(), weight: 4 }).addTo(m);
      L.circleMarker(ll[0], { radius: 7, color: "#fff", weight: 2, fillColor: css.getPropertyValue("--plant").trim(), fillOpacity: 1 }).addTo(m).bindTooltip("Start");
      L.circleMarker(ll[ll.length - 1], { radius: 7, color: "#fff", weight: 2, fillColor: css.getPropertyValue("--shroom").trim(), fillOpacity: 1 }).addTo(m).bindTooltip("End");
      fs.filter(f => f.lat != null).forEach(f => L.marker([f.lat, f.lng], { icon: pinIcon(f.type) }).addTo(m).bindPopup(`<a href="#find-${esc(f.id)}">${esc(f.name || "Not yet identified")}</a>`));
      if (ll.length > 1) m.fitBounds(ll, { padding: [24, 24], maxZoom: 16 });
    }
  } else el.remove();
  $("#hikeName").addEventListener("change", async e => { t.name = e.target.value.trim() || undefined; await store.put("trails", t); toast("Name saved"); });
  $("#hikeGpx").addEventListener("click", async () => {
    const pts = (t.points || []).map(p => `<trkpt lat="${p[0]}" lon="${p[1]}">${p[3] != null ? `<ele>${p[3]}</ele>` : ""}<time>${new Date(p[2]).toISOString()}</time></trkpt>`).join("\n");
    const name = (t.name || "Hike " + new Date(t.start).toISOString().slice(0, 10)).replace(/[<&>]/g, "");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Shroom Log" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>\n${pts}\n</trkseg></trk></gpx>\n`;
    await saveFile(`hike-${new Date(t.start).toISOString().slice(0, 10)}.gpx`, gpx, "application/gpx+xml");
  });
  $("#hikeDel").addEventListener("click", async () => {
    const b = $("#hikeDel");
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap again to delete"; return; }
    await store.del("trails", id); toast("Hike deleted"); location.hash = "hikes";
  });
}

/* ============================================================
   Mushroom anatomy and a step-by-step key. Both work offline.
   ============================================================ */
function renderAnatomy() {
  setChrome({ title: "Mushroom anatomy", back: true });
  main.innerHTML = `<div class="wrap view">
    <p class="hint">The parts to look at and photograph on every find. Learning these makes guides, keys and experts much easier to follow.</p>
    <div class="panel">${ANATOMY_SVG}</div>
    <div class="settings-list">${ANATOMY.map(([t, d]) => `<div class="panel" style="gap:4px;padding:12px 14px"><b>${esc(t)}</b><p style="margin:0">${esc(d)}</p></div>`).join("")}</div>
    <div class="banner warn"><div class="grow"><b>Always dig up the whole mushroom</b> to see the base, and photograph the cap, underside, stem and base. The base is often what tells a deadly one apart.</div></div>
    <div class="btn-row"><a class="btn plant" href="#key">Try the mushroom key</a><a class="btn" href="#guides">Beginner guides</a></div>
  </div>`;
}
let keyPath = ["start"];
function renderKey() {
  setChrome({ title: "Mushroom key", back: true });
  const id = keyPath[keyPath.length - 1], n = KEY[id] || KEY.start;
  const crumbs = keyPath.slice(0, -1).map((k, i) => { const next = keyPath[i + 1]; const o = KEY[k].opts.find(x => x[1] === next); return o ? o[0] : ""; }).filter(Boolean);
  const sevTxt = { deadly: "Deadly group", toxic: "Toxic", expert: "Expert only", guide: "Beginner guide" };
  const sevCls = { deadly: "deadly", toxic: "toxic", expert: "unknown", guide: "edible" };
  main.innerHTML = `<div class="wrap view">
    <div class="banner danger"><svg><use href="#i-warn"/></svg><div class="grow"><b>A key narrows things down. It never tells you something is safe to eat.</b> Have every find checked in person by an expert.</div></div>
    ${crumbs.length ? `<ol class="hint" style="margin:0;padding-left:20px;display:grid;gap:2px">${crumbs.map(c => `<li>${esc(c)}</li>`).join("")}</ol>` : `<p class="hint" style="margin:0">Answer each question with the mushroom in front of you. Not sure what a word means? <a href="#anatomy" style="color:var(--plant)">See the anatomy guide</a>.</p>`}
    ${n.leaf ? `<div class="panel" style="gap:10px"><span class="edib ${sevCls[n.sev]}" style="align-self:flex-start">${sevTxt[n.sev]}</span><h2 style="margin:0">${esc(n.title)}</h2><p style="margin:0">${esc(n.text)}</p>
        ${(n.guides || []).filter(g => GUIDES[g]).map(g => { const e = EDIBLES.find(x => x.id === g); return `<a class="btn small plant" href="#guide-${g}" style="align-self:flex-start">Check every step in the ${esc(e ? e.name : g)} guide ›</a>`; }).join("")}</div>`
      : `<div class="panel" style="gap:10px"><h2 style="margin:0;font-size:21px">${esc(n.q)}</h2><div class="settings-list" style="gap:8px">${n.opts.map(([l, to]) => `<button class="btn keyopt" type="button" data-to="${esc(to)}">${esc(l)}</button>`).join("")}</div></div>`}
    <div class="btn-row">${keyPath.length > 1 ? `<button class="btn ghost" type="button" id="keyBack">‹ Back a step</button><button class="btn ghost" type="button" id="keyRestart">Start again</button>` : ""}<a class="btn ghost" href="#anatomy">Anatomy</a></div>
  </div>`;
  $$(".keyopt").forEach(b => b.addEventListener("click", () => { keyPath.push(b.dataset.to); renderKey(); window.scrollTo(0, 0); }));
  const kb = $("#keyBack"); if (kb) kb.addEventListener("click", () => { keyPath.pop(); renderKey(); });
  const kr = $("#keyRestart"); if (kr) kr.addEventListener("click", () => { keyPath = ["start"]; renderKey(); });
}

/* ============================================================
   Specimen labels with a QR code, to print and keep with a sample.
   ============================================================ */
function labelQR(text) {
  try { qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"]; const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); } catch (e) { return ""; }
}
function labelText(f) {
  return [`Shroom Log ${f.id}`, f.name || "Not yet identified", fmtDate(f.foundAt) + " " + fmtTime(f.foundAt), f.lat != null ? `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}` : "", f.substrate ? "On: " + f.substrate : "", (f.habitat || []).join(", "), f.trees ? "Near: " + f.trees : "", f.spore ? "Spore print: " + f.spore : "", lsGet("collector", "") ? "Collector: " + lsGet("collector", "") : ""].filter(Boolean).join("\n");
}
function labelHTML(f) {
  const where = f.lat != null ? `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}` : "No location";
  return `<div class="slabel"><div class="slq">${labelQR(labelText(f))}</div><div class="slt"><b>${esc(f.name || "Not yet identified")}</b>
    <span>${esc(fmtDate(f.foundAt))} · ${esc(fmtTime(f.foundAt))}</span><span>${esc(where)}${f.elev != null ? ` · ${esc(fmtElev(f.elev))}` : ""}</span>
    ${f.substrate || (f.habitat || []).length ? `<span>${esc([f.substrate, ...(f.habitat || [])].filter(Boolean).join(" · "))}</span>` : ""}
    ${f.trees ? `<span>Near ${esc(f.trees)}</span>` : ""}${f.spore ? `<span>Spore print: ${esc(f.spore)}</span>` : ""}
    <span class="slid">${esc(lsGet("collector", "") ? lsGet("collector", "") + " · " : "")}#${esc(f.id.slice(-6).toUpperCase())}</span></div></div>`;
}
const LABEL_CSS = `.slabels{display:grid;grid-template-columns:repeat(2,1fr);gap:4mm}.slabel{display:flex;gap:3mm;border:1px solid #333;border-radius:2mm;padding:3mm;break-inside:avoid;color:#000;background:#fff;font:9pt/1.3 system-ui,sans-serif}.slq{width:22mm;flex:none}.slq svg{width:22mm;height:22mm;display:block}.slt{display:flex;flex-direction:column;min-width:0}.slt b{font-size:11pt}.slid{color:#555;margin-top:auto}@page{margin:10mm}`;
let labelPick = null;
function renderLabels(one) {
  setChrome({ title: "Specimen labels", back: true });
  const list = finds.filter(f => !f.sample).sort((a, b) => (b.foundAt || "").localeCompare(a.foundAt || ""));
  if (one) labelPick = new Set([one]);
  if (!labelPick) { const d = list[0] && list[0].foundAt.slice(0, 10); labelPick = new Set(list.filter(f => f.foundAt.slice(0, 10) === d).map(f => f.id)); }
  const chosen = list.filter(f => labelPick.has(f.id));
  main.innerHTML = `<div class="wrap view">
    <p class="hint">Print and keep a label with each dried sample or spore print. The QR code holds the find's details, so a phone can read it with no signal.</p>
    <div class="field"><label for="collector">Collector name on labels</label><input type="text" id="collector" value="${esc(lsGet("collector", ""))}" placeholder="Optional"></div>
    <details class="edmore"><summary>Pick finds (${chosen.length} chosen)</summary><div class="settings-list" style="gap:6px;margin-top:8px">
      <div class="btn-row"><button class="btn small ghost" type="button" id="lbNone">Clear</button></div>
      ${list.map(f => `<label class="switch" style="padding:6px 0"><span><b>${esc(f.name || "Not yet identified")}</b> <span class="hint">${esc(fmtDate(f.foundAt))}</span></span><input type="checkbox" data-lb="${esc(f.id)}" ${labelPick.has(f.id) ? "checked" : ""}></label>`).join("")}
    </div></details>
    <div class="btn-row"><button class="btn primary" type="button" id="lbPrint" ${chosen.length ? "" : "disabled"}>Print ${chosen.length} ${chosen.length === 1 ? "label" : "labels"}</button><button class="btn" type="button" id="lbSave" ${chosen.length ? "" : "disabled"}><svg><use href="#i-down"/></svg>Save as a file</button></div>
    <style>${LABEL_CSS}</style>
    <div class="slabels" id="lbPreview">${chosen.map(labelHTML).join("")}</div>
  </div>`;
  $("#collector").addEventListener("change", e => { lsSet("collector", e.target.value.trim()); renderLabels(); });
  $$("[data-lb]").forEach(c => c.addEventListener("change", () => { c.checked ? labelPick.add(c.dataset.lb) : labelPick.delete(c.dataset.lb); const op = $(".edmore").open; renderLabels(); $(".edmore").open = op; }));
  $("#lbNone").addEventListener("click", () => { labelPick.clear(); renderLabels(); $(".edmore").open = true; });
  const doc = () => `<!doctype html><html><head><meta charset="utf-8"><title>Specimen labels</title><style>body{margin:0;background:#fff}${LABEL_CSS}</style></head><body><div class="slabels">${chosen.map(labelHTML).join("")}</div></body></html>`;
  $("#lbPrint").addEventListener("click", async () => {
    if (NATIVE) { try { await nat("printHTML", { html: doc(), name: "Specimen labels" }); } catch (e) { toast("Printing isn't available. Save as a file instead."); } return; }
    const wdw = window.open("", "_blank");
    if (!wdw) { toast("Allow pop-ups to print, or save as a file."); return; }
    wdw.document.write(doc()); wdw.document.close(); wdw.focus(); setTimeout(() => wdw.print(), 300);
  });
  $("#lbSave").addEventListener("click", () => saveFile(`specimen-labels-${stamp()}.html`, doc(), "text/html"));
}

/* ============================================================
   Trash: deleted finds wait 30 days before they're gone.
   ============================================================ */
function renderTrash() {
  setChrome({ title: "Trash", back: true });
  main.innerHTML = `<div class="wrap view">
    <p class="hint">Deleted finds stay here for 30 days, then they're removed for good.</p>
    ${trash.length ? trash.map(f => `<div class="panel" style="gap:8px"><div class="switch" style="align-items:center"><span><b>${esc(f.name || "Not yet identified")}</b><br><span class="hint">${esc(fmtDate(f.foundAt))} · deleted ${esc(ago(f.deletedAt))} · ${Math.max(0, 30 - Math.floor((Date.now() - f.deletedAt) / DAY))} days left</span></span></div>
      <div class="btn-row"><button class="btn small plant" type="button" data-restore="${esc(f.id)}">Restore</button><button class="btn small danger" type="button" data-purge="${esc(f.id)}">Delete forever</button></div></div>`).join("")
      + `<div class="btn-row"><button class="btn small danger" type="button" id="emptyTrash">Empty the trash</button></div>` : `<div class="empty"><h2>The trash is empty</h2></div>`}
  </div>`;
  $$("[data-restore]").forEach(b => b.addEventListener("click", async () => { const f = trash.find(x => x.id === b.dataset.restore); delete f.deletedAt; await store.put("finds", f); await loadFinds(); toast("Find restored"); renderTrash(); }));
  $$("[data-purge]").forEach(b => b.addEventListener("click", async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap again to delete"; return; }
    await purgeFind(trash.find(x => x.id === b.dataset.purge)); await loadFinds(); toast("Deleted for good"); renderTrash();
  }));
  const et = $("#emptyTrash");
  if (et) et.addEventListener("click", async () => {
    if (et.dataset.armed !== "1") { et.dataset.armed = "1"; et.textContent = `Tap again to delete ${trash.length} for good`; return; }
    for (const f of trash) await purgeFind(f); await loadFinds(); toast("Trash emptied"); renderTrash();
  });
}

/* ============================================================
   Import old photos: location and date come from the photo.
   ============================================================ */
function renderImport() {
  setChrome({ title: "Import photos", back: true });
  main.innerHTML = `<div class="wrap view">
    <div class="panel"><h3>Import old photos</h3><p>Pick photos from your gallery. Each one's location and date are read from the photo itself, so no GPS is needed. They're saved as finds marked <b>Add details</b>.</p>
      <div class="seg" role="group" aria-label="Type" id="impType"><button type="button" data-v="mushroom" aria-pressed="true">Mushrooms</button><button type="button" data-v="plant" aria-pressed="false">Plants</button></div>
      <label class="switch" for="impGroup"><span>Put photos taken within 10 minutes and 50 m of each other into one find</span><input type="checkbox" id="impGroup" checked></label>
      <div class="btn-row"><label class="btn plant" for="impIn"><svg><use href="#i-img"/></svg>Choose photos</label></div>
      <input class="sr" type="file" id="impIn" accept="image/*" multiple>
      <div class="progress" id="impProg" hidden><i></i></div><p id="impMsg" class="hint"></p></div>
    <p class="hint" id="impTip">Some apps remove the location when sharing photos. Pick them from the gallery or Files instead of a chat app.</p>
    <div id="impReview"></div>
  </div>`;
  let type = "mushroom";
  $$("#impType button").forEach(b => b.addEventListener("click", () => { type = b.dataset.v; $$("#impType button").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
  $("#impIn").addEventListener("change", async e => {
    const files = [...(e.target.files || [])]; e.target.value = "";
    if (!files.length) return;
    const prog = $("#impProg"), bar = prog.firstElementChild, msg = $("#impMsg");
    prog.hidden = false;
    const items = [];
    for (let i = 0; i < files.length; i++) {
      msg.textContent = `Reading ${i + 1} of ${files.length}…`; bar.style.width = ((i + 1) / files.length * 50) + "%";
      const ex = await exifRead(files[i]);
      items.push({ file: files[i], gps: ex.gps, when: ex.date || new Date(files[i].lastModified) });
    }
    items.sort((a, b) => a.when - b.when);
    const groups = [];
    for (const it of items) {
      const g = groups[groups.length - 1];
      const near = g && $("#impGroup").checked && Math.abs(it.when - g[g.length - 1].when) <= 10 * 60000 && (!it.gps || !g[0].gps || haversine(it.gps, g[0].gps) <= 0.05);
      if (near) g.push(it); else groups.push([it]);
    }
    prog.hidden = true; msg.textContent = "";
    const intro = $(".panel", main); intro.hidden = true; $("#impTip").hidden = true;
    const reviewed = await reviewImportGroups(groups);
    intro.hidden = false; $("#impTip").hidden = false; $("#impReview").innerHTML = "";
    if (!reviewed) { msg.textContent = "Import cancelled. Nothing was saved."; return; }
    groups.length = 0; groups.push(...reviewed);
    items.length = 0; groups.forEach(g => items.push(...g));
    prog.hidden = false;
    let made = 0, withLoc = 0, done = 0;
    for (const g of groups) {
      const photos = [];
      for (const it of g) {
        try { const blob = await resizeImage(it.file); const key = "p-" + uid(); await store.put("photos", blob, key); photos.push({ key, label: photos.length ? "Detail" : "Whole" }); } catch (err) {}
        done++; bar.style.width = (50 + done / items.length * 50) + "%"; msg.textContent = `Saving ${done} of ${items.length}…`;
      }
      if (!photos.length) continue;
      const gps = (g.find(x => x.gps) || {}).gps || null, whenISO = g[0].when.toISOString(), nowISO = new Date().toISOString();
      const f = normalise({ id: uid(), type, name: "", photos, lat: gps ? gps.lat : null, lng: gps ? gps.lng : null, acc: null, locSource: gps ? "photo" : null,
        foundAt: whenISO, createdAt: nowISO, updatedAt: nowISO, needsDetails: true, imported: true, moon: moonPhase(whenISO),
        width: null, height: null, length: null, stem: null, colours: [], colourNote: "", description: "", weather: [], rainRecent: "", temp: null, weatherNote: "" });
      await store.put("finds", f); made++; if (gps) withLoc++;
    }
    if (made && finds.some(x => x.sample)) await removeExamples();
    await loadFinds();
    msg.textContent = `Imported ${items.length} ${items.length === 1 ? "photo" : "photos"} as ${made} ${made === 1 ? "find" : "finds"}. ${withLoc} had a location${made - withLoc ? `; pin the other ${made - withLoc} on the map when you add details` : ""}.`;
    toast(`Imported ${made} ${made === 1 ? "find" : "finds"}`);
  });
}
// Show the proposed finds before anything is saved, so photos of different mushrooms
// taken close together can be moved, split, merged or dropped.
function reviewImportGroups(groups0) {
  return new Promise(resolve => {
    let groups = groups0.map(g => [...g]);
    const urls = new Map();
    const url = it => { if (!urls.has(it)) urls.set(it, URL.createObjectURL(it.file)); return urls.get(it); };
    let sel = new Set();
    const box = $("#impReview");
    const finish = v => { urls.forEach(u => URL.revokeObjectURL(u)); resolve(v); };
    const tidy = () => { groups = groups.filter(g => g.length); groups.forEach(g => g.sort((a, b) => a.when - b.when)); groups.sort((a, b) => a[0].when - b[0].when); };
    function draw() {
      tidy();
      const n = groups.reduce((a, g) => a + g.length, 0);
      box.innerHTML = `<div class="panel" style="gap:6px"><h3>Check the finds</h3><p class="hint" style="margin:0">${n} ${n === 1 ? "photo" : "photos"} grouped into ${groups.length} ${groups.length === 1 ? "find" : "finds"}. Tap photos to select them, then move them, make them a new find or remove them.</p></div>
        <div class="irgroups">${groups.map((g, gi) => `<div class="panel irg" data-g="${gi}">
          <div class="irhead"><b>Find ${gi + 1}</b><span class="hint num">${g.length} ${g.length === 1 ? "photo" : "photos"} · ${esc(fmtDate(g[0].when.toISOString(), { day: "numeric", month: "short", year: "numeric" }))}, ${esc(fmtTime(g[0].when.toISOString()))}${g.some(x => x.gps) ? "" : " · no location"}</span></div>
          <div class="irphotos">${g.map((it, pi) => `<button type="button" class="irph" data-g="${gi}" data-p="${pi}" aria-pressed="${sel.has(it)}" aria-label="Photo ${pi + 1} of find ${gi + 1}"><img src="${url(it)}" alt="" loading="lazy"></button>`).join("")}</div>
          <div class="irtools">
            ${sel.size && !g.some(it => sel.has(it)) ? `<button type="button" class="btn small primary" data-here="${gi}">Move here</button>` : ""}
            ${g.length > 1 ? `<button type="button" class="btn small ghost" data-split="${gi}">Split into ${g.length}</button>` : ""}
            ${gi > 0 ? `<button type="button" class="btn small ghost" data-merge="${gi}">Merge with find ${gi}</button>` : ""}
          </div></div>`).join("")}</div>
        <div class="irbar">${sel.size ? `<span class="num"><b>${sel.size}</b> selected</span><button type="button" class="btn small" id="irNew">Make new find</button><button type="button" class="btn small danger" id="irDel">Remove</button><button type="button" class="btn small ghost" id="irClear">Clear</button>`
          : `<button type="button" class="btn ghost" id="irCancel">Cancel</button><button type="button" class="btn primary" id="irOk" style="flex:1" ${n ? "" : "disabled"}>Import ${groups.length} ${groups.length === 1 ? "find" : "finds"}</button>`}</div>`;
    }
    const pull = () => { const moved = []; groups = groups.map(g => g.filter(it => { if (sel.has(it)) { moved.push(it); return false; } return true; })); sel = new Set(); return moved; };
    box.addEventListener("click", e => {
      const t = e.target.closest("button"); if (!t) return;
      if (t.classList.contains("irph")) { const it = groups[+t.dataset.g][+t.dataset.p]; sel.has(it) ? sel.delete(it) : sel.add(it); }
      else if (t.dataset.here != null) { const dest = groups[+t.dataset.here]; const moved = pull(); dest.push(...moved); }
      else if (t.dataset.split != null) { const gi = +t.dataset.split; const g = groups[gi]; groups.splice(gi, 1, ...g.map(it => [it])); }
      else if (t.dataset.merge != null) { const gi = +t.dataset.merge; groups[gi - 1].push(...groups[gi]); groups.splice(gi, 1); }
      else if (t.id === "irNew") { const moved = pull(); if (moved.length) groups.push(moved); }
      else if (t.id === "irDel") { pull(); }
      else if (t.id === "irClear") { sel = new Set(); }
      else if (t.id === "irCancel") { box.innerHTML = ""; return finish(null); }
      else if (t.id === "irOk") { tidy(); box.innerHTML = ""; return finish(groups); }
      else return;
      draw();
    });
    draw();
  });
}
/* ============================================================
   Species pages: every find with the same name, together.
   ============================================================ */
function speciesKey(f) { return f.name ? f.name.replace(/\s*\(example\)$/i, "").toLowerCase().trim() : ""; }
function speciesHref(f) { return "#species-" + encodeURIComponent(speciesKey(f)); }
function speciesGroups() {
  const g = new Map();
  for (const f of finds) {
    const k = speciesKey(f); if (!k) continue;
    if (!g.has(k)) g.set(k, { key: k, name: f.name.replace(/\s*\(example\)$/i, ""), type: f.type, list: [] });
    g.get(k).list.push(f);
  }
  for (const v of g.values()) v.list.sort((a, b) => new Date(a.foundAt) - new Date(b.foundAt));
  return [...g.values()];
}
// Match a find's name to the In season guide, by common or Latin name.
function guideFor(name) {
  const n = (name || "").toLowerCase();
  return EDIBLES.find(e => n.includes(e.latin.toLowerCase()) || n.includes(e.name.toLowerCase().replace(/s$/, "").split(" (")[0])) || null;
}
function renderSpeciesList() {
  setChrome({ title: "Species", back: true });
  const gs = speciesGroups().sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
  main.innerHTML = `<div class="wrap view">
    <p class="hint">Every named find, grouped by name. Unnamed finds aren't here until you name them.</p>
    <div class="search"><svg><use href="#i-search"/></svg><input type="text" id="spFilter" placeholder="Filter species" autocomplete="off" aria-label="Filter species"></div>
    <div class="list" id="spList" style="grid-template-columns:1fr"></div>
  </div>`;
  const draw = q => {
    const rows = gs.filter(g => !q || g.name.toLowerCase().includes(q));
    $("#spList").innerHTML = rows.length ? rows.map(g => { const last = g.list[g.list.length - 1]; return `<a class="card" href="#species-${encodeURIComponent(g.key)}">
      <img class="thumb" data-photo="${esc(cover([...g.list].reverse().find(f => f.photos.length) || last) || "")}" alt="">
      <div class="card-body"><div class="card-title">${esc(g.name)}</div>
        <div class="meta"><span class="dot ${g.type}"></span><span>${g.type === "plant" ? "Plant" : "Mushroom"}</span><span class="sep num">${g.list.length} ${g.list.length === 1 ? "find" : "finds"}</span></div>
        <div class="meta num"><span>Last seen ${esc(fmtDate(last.foundAt))}</span></div></div></a>`; }).join("") : `<p class="hint">No species match.</p>`;
    hydrateThumbs($("#spList"));
  };
  draw("");
  $("#spFilter").addEventListener("input", e => draw(e.target.value.trim().toLowerCase()));
}
async function renderSpecies(key) {
  const g = speciesGroups().find(x => x.key === key);
  if (!g) { location.hash = "species"; return; }
  setChrome({ title: g.type === "plant" ? "Plant" : "Mushroom", back: true });
  const first = g.list[0], last = g.list[g.list.length - 1];
  const months = Array(12).fill(0); g.list.forEach(f => months[new Date(f.foundAt).getMonth()]++);
  const mx = Math.max(1, ...months);
  const years = [...new Set(g.list.map(f => new Date(f.foundAt).getFullYear()))].sort();
  const spots = g.list.filter(f => f.lat != null);
  const near = lastLoc && spots.length ? spots.map(f => ({ f, d: haversine(lastLoc, f) })).sort((a, b) => a.d - b.d)[0] : null;
  const photos = g.list.flatMap(f => f.photos.map(p => ({ f, p }))).reverse();
  const col = g.type === "plant" ? "var(--chart-plant)" : "var(--chart-shroom)";
  const guide = guideFor(g.name);
  const conf = g.list.filter(f => f.inat && f.inat.quality === "research").length;
  main.innerHTML = `<div class="wrap view">
    <div class="detail-head">
      <span class="type-pill ${g.type}" style="align-self:flex-start"><span class="dot ${g.type}"></span>${g.type === "plant" ? "Plant" : "Mushroom"}</span>
      <h2>${esc(g.name)}</h2>
    </div>
    <div class="facts" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <div class="fact"><span class="eyebrow">Finds</span><span class="v num">${g.list.length}</span></div>
      <div class="fact"><span class="eyebrow">First seen</span><span class="v num">${esc(fmtDate(first.foundAt, { day: "numeric", month: "short", year: "numeric" }))}</span></div>
      <div class="fact"><span class="eyebrow">Last seen</span><span class="v num">${esc(fmtDate(last.foundAt, { day: "numeric", month: "short", year: "numeric" }))}</span></div>
      <div class="fact"><span class="eyebrow">Spots</span><span class="v num">${spots.length}${near ? `<small> · nearest ${esc(fmtDist(near.d))}</small>` : ""}</span></div>
      ${years.length > 1 ? `<div class="fact"><span class="eyebrow">Years found</span><span class="v num">${esc(years.join(", "))}</span></div>` : ""}
      ${conf ? `<div class="fact"><span class="eyebrow">iNat confirmed</span><span class="v num">${conf}</span></div>` : ""}
    </div>
    <div class="panel" style="gap:6px"><h3>Months you've found it</h3>
      <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:3px;align-items:end;height:40px">${months.map((n, i) => `<span title="${MONTHS[i]}: ${n} ${n === 1 ? "find" : "finds"}" style="display:block;height:${n ? 8 + 32 * n / mx : 3}px;border-radius:3px;background:${n ? col : "var(--surface-2)"}"></span>`).join("")}</div>
      <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:3px;font-size:10px;color:var(--muted);text-align:center">${MONTHS3.map(x => `<span>${x[0]}</span>`).join("")}</div>
      <p class="hint" style="margin:0">${(() => { const r = monthRanges(months.map((n, i) => n ? i : -1).filter(i => i >= 0)); return r ? `Found in ${esc(r)}.` : ""; })()}</p>
    </div>
    ${photos.length ? `<div class="section"><h3>Photos <span class="num" style="color:var(--muted);font-weight:400">${photos.length}</span></h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${photos.slice(0, 30).map(({ f, p }) => `<a href="#find-${esc(f.id)}" style="display:block"><img data-photo="${esc(p.key)}" alt="${esc(p.label || g.name)}, ${esc(fmtDate(f.foundAt))}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:var(--surface-2);display:block"></a>`).join("")}</div>
      ${photos.length > 30 ? `<p class="hint">Showing the latest 30.</p>` : ""}</div>` : ""}
    ${spots.length ? `<div class="section"><h3>Where you've found it</h3><div class="mini-map" id="spMap" style="height:260px"></div></div>` : ""}
    ${guide && EDIBLE_ID[guide.id] ? `<div class="panel" style="gap:6px"><h3>How to identify ${esc(guide.name.toLowerCase())}</h3><ul style="margin:0;padding-left:20px;display:grid;gap:3px">${EDIBLE_ID[guide.id].map(x => `<li>${esc(x)}</li>`).join("")}</ul><p style="margin:0;color:#f6c2b6"><b>Lookalikes:</b> ${esc(guide.look)}</p><p class="hint" style="margin:0">Never eat anything based on this app. Have it checked in person by an expert.</p></div>` : ""}
    <div class="section"><h3>All finds</h3><div class="list" id="spFinds">${[...g.list].reverse().map(cardHTML).join("")}</div></div>
  </div>`;
  hydrateThumbs(main);
  if (spots.length && hasLeaflet) {
    const m = makeMap($("#spMap"), [spots[0].lat, spots[0].lng], 14, { dragging: !L.Browser.mobile, scrollWheelZoom: false });
    if (m) {
      spots.forEach(f => L.marker([f.lat, f.lng], { icon: pinIcon(f.type) }).addTo(m).bindPopup(`<a href="#find-${esc(f.id)}">${esc(fmtDate(f.foundAt))}</a>`));
      if (spots.length > 1) m.fitBounds(spots.map(f => [f.lat, f.lng]), { padding: [30, 30], maxZoom: 15 });
    }
  }
}
// The order you last saw on the Finds list, so next and previous follow it.
let navIds = lsGet("navIds", []);
function navNeighbors(id) {
  let ids = navIds.filter(x => finds.some(f => f.id === x));
  if (!ids.includes(id)) ids = finds.slice().sort((a, b) => (b.foundAt || "").localeCompare(a.foundAt || "")).map(f => f.id);
  const i = ids.indexOf(id);
  return { i, n: ids.length, prev: i > 0 ? ids[i - 1] : null, next: i >= 0 && i < ids.length - 1 ? ids[i + 1] : null };
}
// A sideways swipe goes to the next or previous find. Maps, photo strips and inputs keep their own swipes.
function wireSwipe(el, onLeft, onRight) {
  let sx = 0, sy = 0, st = 0, ok = false;
  el.addEventListener("touchstart", e => { const t = e.touches[0]; ok = e.touches.length === 1 && !e.target.closest(".leaflet-container,.strip,input,textarea,select,canvas"); sx = t.clientX; sy = t.clientY; st = Date.now(); }, { passive: true });
  el.addEventListener("touchend", e => {
    if (!ok) return; ok = false;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - st < 700) (dx < 0 ? onLeft : onRight)();
  }, { passive: true });
}
let swipeDir = 0;
function goFind(id, dir) { if (!id) return; swipeDir = dir; location.hash = "find-" + id; }
async function renderDetail(id) {
  const f = finds.find(x => x.id === id);
  if (!f) { location.hash = "log"; return; }
  const nb = navNeighbors(id), dirNow = swipeDir; swipeDir = 0;
  setChrome({ title: f.type === "plant" ? "Plant" : "Mushroom", back: true, actions: `<a class="icon-btn" href="#edit-${esc(f.id)}" aria-label="Edit"><svg><use href="#i-edit"/></svg></a>` });
  const dist = lastLoc && f.lat != null ? fmtDist(haversine(lastLoc, f)) : null;
  const src = { gps: "From GPS", photo: "From the photo", pin: "Pinned on map" }[f.locSource] || "";
  const colours = (f.colours || []).map(c => chipSwatch(c, COLOURS)).join("");
  const nv = f.revisit ? nextVisit(f) : null;
  const isShroom = f.type === "mushroom";
  const idBits = [];
  if (isShroom && f.spore) idBits.push(`<div class="fact"><span class="eyebrow">Spore print</span><span class="v">${esc(f.spore)}</span></div>`);
  if (isShroom && f.gills) idBits.push(`<div class="fact"><span class="eyebrow">Underside</span><span class="v">${esc(f.gills)}</span></div>`);
  if (f.substrate) idBits.push(`<div class="fact"><span class="eyebrow">Growing on</span><span class="v">${esc(f.substrate)}</span></div>`);
  if (f.habitat.length) idBits.push(`<div class="fact"><span class="eyebrow">Habitat</span><span class="v">${esc(f.habitat.join(", "))}</span></div>`);
  if (f.smell.length) idBits.push(`<div class="fact"><span class="eyebrow">Smell</span><span class="v">${esc(f.smell.join(", "))}</span></div>`);
  if (f.texture.length) idBits.push(`<div class="fact"><span class="eyebrow">Texture</span><span class="v">${esc(f.texture.join(", "))}</span></div>`);
  if (isShroom && f.bruise) idBits.push(`<div class="fact"><span class="eyebrow">Bruising</span><span class="v">${esc(f.bruise)}${f.bruiseNote ? `<small><br>${esc(f.bruiseNote)}</small>` : ""}</span></div>`);
  if (f.elev != null || f.slope != null) idBits.push(`<div class="fact"><span class="eyebrow">Terrain</span><span class="v">${esc(terrainText(f))}</span></div>`);
  if (f.trees) idBits.push(`<div class="fact"><span class="eyebrow">Nearby trees</span><span class="v">${esc(f.trees)}</span></div>`);
  HAB_LOG.forEach(([k, l]) => { if (f.hablog && f.hablog[k]) idBits.push(`<div class="fact"><span class="eyebrow">${esc(l)}</span><span class="v">${esc(f.hablog[k])}</span></div>`); });

  main.innerHTML = `<div class="wrap view${dirNow > 0 ? " slide-l" : dirNow < 0 ? " slide-r" : ""}" id="detailView">
    ${nb.n > 1 ? `<div class="findnav"><button class="btn ghost small" type="button" id="fPrev" ${nb.prev ? "" : "disabled"}>‹ Previous</button><span class="hint num">${nb.i + 1} of ${nb.n} · swipe to move</span><button class="btn ghost small" type="button" id="fNext" ${nb.next ? "" : "disabled"}>Next ›</button></div>` : ""}
    ${f.needsDetails ? `<div class="banner warn"><svg><use href="#i-bolt"/></svg><div class="grow">Saved with Quick log. <a href="#edit-${esc(f.id)}" style="color:inherit;font-weight:700">Add the details</a> while you remember them.</div></div>` : ""}
    ${f.photos.length ? `<img class="hero-photo" id="heroImg" alt="Photo of ${esc(f.name || "this find")}">` : ""}
    ${f.photos.length > 1 ? `<div class="strip" id="strip">${f.photos.map((p, i) => `<button type="button" data-i="${i}" aria-pressed="${i === 0}" aria-label="Show ${esc(p.label || "photo " + (i + 1))}"><img data-photo="${esc(p.key)}" alt=""><small>${esc(p.label || "Photo")}</small></button>`).join("")}</div>` : ""}
    <div class="detail-head">
      <div class="btn-row" style="gap:8px"><span class="type-pill ${f.type}"><span class="dot ${f.type}"></span>${isShroom ? "Mushroom" : "Plant"}${f.sample ? " · Example" : ""}</span><span class="edib ${esc(f.edibility)}">${esc(edibLabel(f.edibility))}</span>${f.sharedFrom ? `<span class="edib">From ${esc(f.sharedFrom)}</span>` : ""}</div>
      <h2>${esc(f.name || "Not yet identified")}</h2>
      ${f.name ? (() => { const n = finds.filter(x => speciesKey(x) === speciesKey(f)).length; return `<a href="${speciesHref(f)}" class="hint" style="color:var(--plant);font-weight:700;text-decoration:none">${n > 1 ? `See all ${n} finds of this species` : "Species page"} ›</a>`; })() : ""}
      <div class="meta num" style="font-size:15px"><span>${esc(fmtDate(f.foundAt, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</span><span class="sep">${esc(fmtTime(f.foundAt))}</span><span class="sep">${esc(timeOfDay(new Date(f.foundAt)))}</span></div>
    </div>
    <div class="banner danger"><svg><use href="#i-warn"/></svg><div class="grow"><b>Never eat anything based on this log or any app${f.edibility === "edible" ? ", even when it's marked edible" : ""}.</b> Many deadly species look like edible ones. Have every find checked in person by an expert.</div></div>
    ${f.idApp && (f.idApp.result || f.idApp.confidence != null) ? `<div class="section"><h3>Identification</h3><div class="facts" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))"><div class="fact"><span class="eyebrow">${esc(f.idApp.source || "Shroom ID")} says</span><span class="v">${esc(f.idApp.result || "—")}</span></div><div class="fact"><span class="eyebrow">Confidence</span><span class="v num">${f.idApp.confidence != null ? esc(f.idApp.confidence) + "<small> %</small>" : "—"}</span></div></div><p class="hint">An app's suggestion, not a confirmed identification.</p></div>` : ""}
    ${f.lookalikes.length ? `<div class="section"><h3>Lookalikes</h3><div class="settings-list">${f.lookalikes.map(l => `<div class="panel" style="gap:6px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><b style="min-width:0">${esc(l.name)}</b><span class="edib ${esc(l.danger || "unknown")}" style="flex:none">${esc({ deadly: "Deadly", toxic: "Toxic", inedible: "Inedible" }[l.danger] || "Check")}</span></div>${l.how ? `<p>${esc(l.how)}</p>` : ""}<p style="color:${l.ruledOut ? "var(--plant)" : "var(--danger)"};font-weight:700">${l.ruledOut ? "Ruled out" : "Not ruled out yet"}${l.note ? `<span style="font-weight:400;color:var(--muted)">: ${esc(l.note)}</span>` : ""}</p></div>`).join("")}</div><p class="hint">This list isn't complete. Ruling these out doesn't make a find safe to eat.</p></div>` : ""}
    ${f.idReview ? `<div class="section" id="revBox"><h3>Suggested ID change</h3>${idReviewHTML(f)}</div>` : ""}
    ${(f.idHistory || []).length ? `<details class="panel"><summary style="cursor:pointer;font-weight:700">ID history</summary><ul style="margin:8px 0 0;padding-left:20px">${f.idHistory.map(h => `<li>${esc(h.name || "Not named")} → ${esc(h.replacedBy)}, ${esc(fmtDate(new Date(h.at).toISOString()))} (${esc(h.source)})</li>`).join("")}</ul></details>` : ""}
    ${f.tripId && tripById(f.tripId) ? `<p class="coords">Part of the trip <a href="#trip-${esc(f.tripId)}" style="color:var(--plant)">${esc(tripById(f.tripId).name)}</a>.</p>` : ""}
    ${f.trailId ? `<p class="coords">Found while recording a trail. <a href="#map" style="color:var(--plant)">See trails on the map</a></p>` : ""}
    ${f.inat && f.inat.id ? `<div class="panel" id="inatPanel"><h3>iNaturalist</h3>
        <p><span class="${f.inat.quality === "research" ? "due" : ""}">${esc(inatQualityLabel(f.inat.quality))}</span></p>
        ${f.inat.taxon ? `<p style="color:var(--fg)">Community ID: <b>${esc(f.inat.common ? f.inat.common + " (" + f.inat.taxon + ")" : f.inat.taxon)}</b>${f.inat.rank && f.inat.rank !== "species" ? ` · ${esc(f.inat.rank)}` : ""}${f.inat.idCount ? ` · ${f.inat.agree} of ${f.inat.idCount} ${f.inat.idCount === 1 ? "person agrees" : "people agree"}` : ""}</p>` : `<p>No IDs yet. Experts usually look within a few days.</p>`}
        <div class="btn-row"><a class="btn small" href="${esc(f.inat.url)}" target="_blank" rel="noopener">Open on iNaturalist</a><button class="btn small ghost" type="button" id="inatSync">Check for new IDs</button></div>
        ${f.inat.syncedAt ? `<p class="hint">Checked ${esc(ago(f.inat.syncedAt))}. Even a research-grade ID doesn't mean it's safe to eat.</p>` : ""}</div>`
      : f.inatQueued ? `<div class="panel"><h3>iNaturalist</h3><p>Waiting to upload. It goes as soon as you have signal${f.lat == null ? ", once the find has a location" : ""}.</p></div>` : ""}
    ${nv ? `<div class="panel"><h3>Revisit this spot</h3><p><span class="due">${esc(visitLabel(nv.days))}</span>. Check around ${esc(fmtDate(nv.date.toISOString(), { day: "numeric", month: "long" }))}${nv.date.getFullYear() !== new Date().getFullYear() ? " next year" : ""}.</p></div>` : ""}
    <div class="facts">
      <div class="fact"><span class="eyebrow">Width</span><span class="v num">${measureVal(f.width)}</span></div>
      <div class="fact"><span class="eyebrow">Height</span><span class="v num">${measureVal(f.height)}</span></div>
      <div class="fact"><span class="eyebrow">Length</span><span class="v num">${measureVal(f.length)}</span></div>
      <div class="fact"><span class="eyebrow">Stem height</span><span class="v num">${measureVal(f.stem)}</span></div>
    </div>
    ${idBits.length ? `<div class="facts" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${idBits.join("")}</div>` : ""}
    ${colours || f.colourNote ? `<div class="section"><h3>Colour</h3>${colours ? `<div class="chips">${colours}</div>` : ""}${f.colourNote ? `<p>${esc(f.colourNote)}</p>` : ""}</div>` : ""}
    ${f.description ? `<div class="section"><h3>Description</h3><p>${esc(f.description)}</p></div>` : ""}
    ${f.notes ? `<div class="section"><h3>Notes</h3><p style="white-space:pre-wrap">${esc(f.notes)}</p></div>` : ""}
    ${f.kitchen ? `<div class="section"><h3>Kitchen notes</h3><div class="panel" style="gap:8px">${(f.kitchen.ways || []).length || f.kitchen.rating ? `<div class="chips">${(f.kitchen.ways || []).map(x => `<span class="chip" style="cursor:default">${esc(x)}</span>`).join("")}${f.kitchen.rating ? `<span class="edib edible">${esc(f.kitchen.rating)}</span>` : ""}</div>` : ""}${f.kitchen.text ? `<p style="margin:0;white-space:pre-wrap">${esc(f.kitchen.text)}</p>` : ""}<p class="hint" style="margin:0">Only ever cook what an expert has confirmed in person.</p></div></div>` : ""}
    <div class="section"><h3>Weather</h3>
      <div class="facts" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        <div class="fact"><span class="eyebrow">On the day</span><span class="v">${esc((f.weather || []).join(", ") || "—")}</span></div>
        <div class="fact"><span class="eyebrow">Recent rain</span><span class="v">${esc(f.rainRecent || "—")}</span></div>
        <div class="fact"><span class="eyebrow">Temperature</span><span class="v num">${f.temp != null ? esc(f.temp) + "<small> °C</small>" : "—"}</span></div>
        <div class="fact"><span class="eyebrow">Soil moisture</span><span class="v">${esc(f.soil || "—")}${f.soil && f.soilAuto ? "<small> estimate</small>" : ""}</span></div>
        <div class="fact"><span class="eyebrow">Moon</span><span class="v">${(() => { const m = f.moon || moonPhase(f.foundAt); return `${moonIcon(m.age)} ${esc(m.name)}<small> ${m.illum}% lit</small>`; })()}</span></div>
      </div>
      ${f.weatherNote ? `<p class="hint">${esc(f.weatherNote)}</p>` : ""}
    </div>
    <div class="section"><h3>Location</h3>
      ${f.lat != null ? `<div class="mini-map" id="miniMap"></div>
        <div class="coords num">${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}${f.acc ? ` · ±${esc(f.acc)} m` : ""} · ${esc(src)}${dist ? ` · ${esc(dist)} from your last known location` : ""}</div>`
      : `<p style="color:var(--muted)">No location saved. <a href="#edit-${esc(f.id)}" style="color:var(--shroom)">Pin it on the map</a>.</p>`}
    </div>
    <div class="section"><h3>Entry</h3><p class="coords num">Logged ${esc(fmtDate(f.createdAt))} at ${esc(fmtTime(f.createdAt))}${f.updatedAt && f.updatedAt !== f.createdAt ? ` · last edited ${esc(fmtDate(f.updatedAt))} at ${esc(fmtTime(f.updatedAt))}` : ""}</p></div>
    <div id="voiceBox" class="section"></div>
    ${f.photos.length ? `<div class="btn-row"><button class="btn" type="button" id="cmpBtn"><svg><use href="#i-img"/></svg>Compare with a reference photo</button></div>` : ""}
    <div class="btn-row">${f.lat != null ? '<button class="btn plant" type="button" id="compassBtn"><svg><use href="#i-gps"/></svg>Guide me here</button>' : ""}<button class="btn" type="button" id="shareOne"><svg><use href="#i-share"/></svg>Share with a buddy</button></div>
    ${f.blurred ? `<p class="hint">${esc(f.sharedFrom || "Your buddy")} hid the exact spot, so the location is only accurate to about 1 km.</p>` : ""}
    <div class="btn-row" id="delRow"><a class="btn" href="#edit-${esc(f.id)}"><svg><use href="#i-edit"/></svg>Edit</a><a class="btn" href="#label-${esc(f.id)}">Label</a><button class="btn danger" type="button" id="delBtn">Move to trash</button></div>
  </div>`;
  if (nb.n > 1) {
    $("#fPrev").addEventListener("click", () => goFind(nb.prev, -1));
    $("#fNext").addEventListener("click", () => goFind(nb.next, 1));
    wireSwipe($("#detailView"), () => goFind(nb.next, 1), () => goFind(nb.prev, -1));
  }
  if (f.photos.length) {
    const hero = $("#heroImg");
    const show = async i => { const u = await photoURL(f.photos[i].key); if (u) hero.src = u; };
    show(0);
    $$("#strip button").forEach(b => b.addEventListener("click", () => { $$("#strip button").forEach(x => x.setAttribute("aria-pressed", x === b)); show(+b.dataset.i); }));
    hydrateThumbs(main);
  }
  if (f.lat != null && hasLeaflet) {
    const m = makeMap($("#miniMap"), [f.lat, f.lng], 15, { dragging: !L.Browser.mobile, scrollWheelZoom: false });
    L.marker([f.lat, f.lng], { icon: pinIcon(f.type) }).addTo(m);
  }
  const cmp = $("#cmpBtn"); if (cmp) cmp.addEventListener("click", () => openCompare(f));
  voicePlayersHTML(f.voice).then(h => { const vb = $("#voiceBox"); if (vb && h) vb.innerHTML = `<h3>Voice notes</h3>${h}`; });
  const isb = $("#inatSync");
  if (isb) isb.addEventListener("click", async () => { isb.disabled = true; try { await inatSyncOne(f); await loadFinds(); toast("Checked iNaturalist"); renderDetail(id); } catch (e) { toast(e.message === "token_expired" ? "Your iNaturalist sign-in has expired. Reconnect under More." : "Couldn't reach iNaturalist"); isb.disabled = false; } });
  const rb = $("#revBox"); if (rb) wireIdReview(rb, () => renderDetail(id));
  const iu = null;
  if (iu) iu.addEventListener("click", async () => { f.name = f.inat.common ? `${f.inat.common}, ${f.inat.taxon}` : f.inat.taxon; f.updatedAt = new Date().toISOString(); await store.put("finds", f); await loadFinds(); toast("Name updated"); renderDetail(id); });
  const cb = $("#compassBtn"); if (cb) cb.addEventListener("click", () => openCompass(f));
  $("#shareOne").addEventListener("click", () => {
    const row = $("#shareOne").parentElement;
    row.outerHTML = `<div class="panel" id="sharePanel"><h3>Share this find</h3><label class="switch" for="blurOne"><span>Hide the exact spot (about 1 km)</span><input type="checkbox" id="blurOne" checked></label><div class="btn-row"><button class="btn small primary" type="button" id="shareGo"><svg><use href="#i-share"/></svg>Share</button></div><p class="hint">Sends a file by message, email or Drive. Your buddy opens it in Shroom Log under More.</p></div>`;
    $("#shareGo").addEventListener("click", () => sendShare([f], $("#blurOne").checked));
  });
  $("#delBtn").addEventListener("click", () => trashFind(f, () => { location.hash = "log"; }));
  if (false) $("#delBtn").addEventListener("click", () => {
    $("#delRow").innerHTML = `<div class="banner danger" style="width:100%"><div class="grow">Delete this find and its ${f.photos.length === 1 ? "photo" : "photos"}? This can't be undone.</div></div><button class="btn danger" type="button" id="delYes">Yes, delete</button><button class="btn ghost" type="button" id="delNo">Keep it</button>`;
    $("#delNo").addEventListener("click", () => renderDetail(id));
    $("#delYes").addEventListener("click", async () => {
      await store.del("finds", f.id);
      for (const p of [...f.photos, ...f.voice]) await store.del("photos", p.key);
      await loadFinds(); toast("Find deleted"); location.hash = "log";
    });
  });
}

/* ============================================================
   New / edit form
   ============================================================ */
const COOK_WAYS = ["Sautéed", "Fried", "Roasted", "Grilled", "Soup or stew", "Sauce", "Dried", "Frozen", "Pickled", "Powder", "Tea"];
const COOK_RATINGS = ["Loved it", "Good", "Okay", "Not for me"];
const chipGroup = (id, items, selected, attr = "c") => `<div class="chips" id="${id}" role="group">${items.map(it => { const [n, c] = Array.isArray(it) ? it : [it, null]; return `<button type="button" class="chip" data-${attr}="${esc(n)}" aria-pressed="${selected.includes(n)}">${c ? `<span class="sw" style="background:${c}"></span>` : ""}${esc(n)}</button>`; }).join("")}</div>`;
const picked = (root, id, attr = "c") => $$(`#${id} .chip[aria-pressed=true]`, root).map(b => b.dataset[attr]);
function singleSelect(root, id) {
  $(`#${id}`, root).addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    $$(`#${id} .chip`, root).forEach(x => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", on);
  });
}
function multiSelect(root, id) {
  $(`#${id}`, root).addEventListener("click", e => { const b = e.target.closest(".chip"); if (b) b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); });
}

async function renderForm(id) {
  const existing = id ? finds.find(x => x.id === id) : null;
  if (id && !existing) { location.hash = "log"; return; }
  const f = existing ? structuredClone(existing) : normalise({
    id: uid(), type: lsGet("lastType", "mushroom"), name: "", photos: [],
    lat: null, lng: null, acc: null, locSource: null,
    foundAt: new Date().toISOString(), createdAt: null,
    width: null, height: null, length: null, stem: null,
    colours: [], colourNote: "", description: "", weather: [], rainRecent: "", temp: null, weatherNote: "",
    spore: "", gills: "", substrate: "", habitat: [], trees: "", edibility: "unknown", revisit: false, tags: [], idApp: { source: "Shroom ID", result: "", confidence: null },
    smell: [], texture: [], bruise: "", bruiseNote: "", lookalikes: []
  });
  f.idApp = f.idApp || { source: "Shroom ID", result: "", confidence: null };
  // Photos being edited: existing keys plus new blobs waiting to be saved.
  let photos = f.photos.map(p => ({ ...p }));
  const removedKeys = [];
  let photoExif = null;
  const canShare = !!(navigator.canShare && navigator.share);
  setChrome({ title: existing ? (existing.needsDetails ? "Add details" : "Edit find") : "New find", back: true });
  const u = unitLabel();
  // One notes box now: fold any older description, bruising and kitchen text into it so nothing is lost.
  const foldedNotes = [f.notes, f.description && !(f.notes || "").includes(f.description) ? f.description : "", f.bruiseNote && "Bruising: " + f.bruiseNote, f.kitchen && f.kitchen.text && "Kitchen: " + f.kitchen.text].filter(Boolean).join("\n\n");
  const dd = (id, label, body, extra = "") => `<details class="qdd" id="${id}" ${extra}><summary><span>${label}</span><small id="${id}Sum"></small></summary><div class="qbody">${body}</div></details>`;
  main.innerHTML = `<div class="wrap view"><form id="findForm" class="qform" novalidate>
    <div class="seg small" role="group" aria-label="What did you find?">
      <button type="button" data-v="mushroom" aria-pressed="${f.type === "mushroom"}"><svg width="16" height="16"><use href="#i-shroom"/></svg>Mushroom</button>
      <button type="button" data-v="plant" aria-pressed="${f.type === "plant"}"><svg width="16" height="16"><use href="#i-leaf"/></svg>Plant</button>
    </div>

    <div class="qsec">
      <div class="photo-grid" id="photoGrid"></div>
      <div class="photo-actions">
        <label class="btn primary small" for="camIn"><svg><use href="#i-cam"/></svg>Take photo</label>
        <label class="btn small" for="galIn"><svg><use href="#i-img"/></svg>Gallery</label>
      </div>
      <input class="sr" type="file" id="camIn" accept="image/*" capture="environment">
      <input class="sr" type="file" id="galIn" accept="image/*" multiple>
    </div>

    <input type="text" id="name" autocomplete="off" aria-label="Name" placeholder="Name, if you know it" value="${esc(f.name)}">

    <div class="qsec"><div class="qlbl">Colour</div>
      <div class="chips swatches" id="colourChips" role="group">${COLOURS.map(([n, c]) => `<button type="button" class="chip swatch" data-c="${esc(n)}" aria-pressed="${f.colours.includes(n)}" aria-label="${esc(n)}" title="${esc(n)}" style="--sw:${c}"></button>`).join("")}</div>
      <input type="text" id="colourNote" class="qsmall" aria-label="Other colour" placeholder="Other colour, e.g. orange fading to cream" value="${esc(f.colourNote)}">
    </div>

    <div class="qsec" id="gillRow"><div class="qlbl">Gills or ridges</div>${chipGroup("gillChips", GILLS, f.gills ? [f.gills] : [])}</div>

    <div class="qsec"><div class="qlbl">Size <span class="hint" style="font-weight:400">· tap Measure on a photo to fill these in</span></div>
      <div class="qsize">
        ${[["width", "Width"], ["height", "Height"], ["length", "Length"], ["stem", "Stem"]].map(([k, l]) => `<label class="qnum"><span>${l}</span><div class="unit-in"><input type="number" inputmode="decimal" step="any" min="0" id="${k}" value="${toDisp(f[k])}"><span>${u}</span></div></label>`).join("")}
      </div>
    </div>

    <div class="qsec"><div class="qlbl">Smell</div>${chipGroup("smellChips", SMELL, f.smell)}</div>
    <div class="qsec"><div class="qlbl">Texture</div>${chipGroup("texChips", TEXTURE, f.texture)}</div>

    <div class="qsec">
      <div class="qnotes-head"><div class="qlbl">Notes</div>
        <div class="qnotes-btns">
          ${canDictate() ? '<button class="btn small ghost" type="button" id="dictBtn" aria-pressed="false"><svg><use href="#i-mic"/></svg><span>Dictate</span></button>' : ""}
          ${canRecord() ? '<button class="btn small ghost" type="button" id="recBtn"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="#e0604f"/></svg><span>Record</span></button>' : ""}
        </div></div>
      <textarea id="notes" rows="2" placeholder="Anything worth remembering">${esc(foldedNotes)}</textarea>
      <div id="voiceList" class="settings-list"></div>
    </div>

    <div class="qdds">
      ${dd("ddWhere", "Where and when", `
        <div class="loc-box">
          <div class="loc-status" id="locStatus"></div>
          <div class="coords num" id="locCoords"></div>
          <div class="btn-row">
            <button class="btn small" type="button" id="gpsBtn"><svg><use href="#i-gps"/></svg>My location</button>
            <button class="btn small" type="button" id="pinBtn"><svg><use href="#i-pin"/></svg>Pin on map</button>
            <button class="btn small" type="button" id="exifBtn" hidden><svg><use href="#i-img"/></svg>Photo's location</button>
            <button class="btn small ghost" type="button" id="clearLoc" hidden>Clear</button>
          </div>
        </div>
        <div class="coords num" id="terrainLine"></div>
        <div class="field"><label for="foundAt">Date and time found</label><input type="datetime-local" id="foundAt" value="${toLocalInput(new Date(f.foundAt))}"></div>
        <div class="hint" id="moonLine" style="color:var(--fg)"></div>`)}
      ${dd("ddLooks", "Lookalikes to rule out", `
        <p class="hint" id="laHint" style="margin:0"></p>
        <div class="lalist" id="laList"></div>
        <div style="display:flex;gap:8px"><input type="text" id="laAdd" class="qsmall" aria-label="Add a lookalike" placeholder="Add a lookalike"><button class="btn small" type="button" id="laAddBtn">Add</button></div>`)}
      ${dd("ddEdib", "Edibility" + (inat.connected() ? " and iNaturalist" : ""), `
        <select id="edib">${EDIBILITY.map(([v, l]) => `<option value="${v}" ${f.edibility === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <span class="hint" id="edibHint"></span>
        ${inat.connected() ? `<label class="switch" for="inatQ"><span><b>Send to iNaturalist</b><br><span class="hint">${f.inat && f.inat.id ? "Already on iNaturalist." : "Uploads when you have signal. Needs a location."}</span></span><input type="checkbox" id="inatQ" ${f.inat && f.inat.id ? "checked disabled" : (f.inatQueued || (!existing && lsGet("inatAuto", true))) ? "checked" : ""}></label>` : ""}`)}
      <div id="shroomFields">${dd("ddSpore", "Spore print and bruising", `
        <div class="qlbl">Spore print</div>${chipGroup("sporeChips", SPORE, f.spore ? [f.spore] : [])}
        <div class="qlbl">Bruises or changes colour when cut</div>${chipGroup("bruiseChips", BRUISE, f.bruise ? [f.bruise] : [])}`)}</div>
      ${dd("ddHab", "Habitat", `
        <div class="qlbl">Growing on</div>${chipGroup("subChips", SUBSTRATE, f.substrate ? [f.substrate] : [])}
        <div class="qlbl">Habitat</div>${chipGroup("habChips", HABITAT, f.habitat)}
        <input type="text" id="trees" class="qsmall" aria-label="Nearby trees or plants" placeholder="Nearby trees or plants, e.g. birch, beech" value="${esc(f.trees)}">
        <details class="edmore"><summary>Habitat log</summary>
          ${HAB_LOG.map(([k, l, opts]) => `<div class="hablog"><span>${l}</span>${chipGroup("hab_" + k, opts, f.hablog && f.hablog[k] ? [f.hablog[k]] : [])}</div>`).join("")}
        </details>`)}
      ${dd("ddWx", "Weather", `
        <div class="loc-status none" id="wxStatus"><svg><use href="#i-cloud"/></svg><span></span></div>
        <div class="btn-row" id="wxAutoRow"><button class="btn small" type="button" id="wxAuto"><svg><use href="#i-cloud"/></svg>Fill in from weather records</button></div>
        ${chipGroup("wxChips", WEATHER, f.weather, "w")}
        <div class="grid-2">
          <div class="field"><label for="rainRecent">Last few days</label><select id="rainRecent"><option value="">Choose</option>${RAIN_RECENT.map(r => `<option ${f.rainRecent === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
          <div class="field"><label for="temp">Temperature</label><div class="unit-in"><input type="number" inputmode="decimal" step="any" id="temp" value="${f.temp ?? ""}"><span>°C</span></div></div>
        </div>
        <div class="field"><label for="soil">Soil moisture <span style="font-weight:400">(estimate)</span></label><select id="soil"><option value="">Choose</option>${SOIL.map(s => `<option ${f.soil === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          <span class="hint" id="soilHint">${f.soilAuto && f.soilVwc != null ? `Estimated from weather models: ${f.soilVwc} m³ of water per m³ of soil.` : "Filled in from weather models when you have signal."}</span></div>
        <input type="text" id="wxNote" class="qsmall" aria-label="Weather notes" placeholder="Weather notes, e.g. first frost two nights ago" value="${esc(f.weatherNote)}">`)}
      ${tripList().length ? dd("ddTrip", "Trip", `<select id="tripPick" aria-label="Part of a trip"><option value="">No trip</option>${tripList().map(t => `<option value="${esc(t.id)}" ${(f.tripId || (!id && activeTripId())) === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`) : ""}
    </div>

    <label class="switch qrevisit" for="revisit"><span>Revisit this spot next year</span><input type="checkbox" id="revisit" ${f.revisit ? "checked" : ""}></label>

    <div class="savebar"><a class="btn ghost" href="${existing ? "#find-" + esc(f.id) : "#log"}">Cancel</a>${existing && navNeighbors(f.id).next ? `<button class="btn" type="submit" id="saveNext" data-next="${esc(navNeighbors(f.id).next)}">Save, next ›</button>` : ""}<button class="btn primary" type="submit" id="saveBtn">Save find</button></div>
  </form></div>`;

  const form = $("#findForm");
  // Type toggle and type-specific bits
  function applyType() {
    $$(".seg button", form).forEach(x => x.setAttribute("aria-pressed", x.dataset.v === f.type));
    $("#shroomFields").hidden = f.type !== "mushroom";
    $("#gillRow").hidden = f.type !== "mushroom";
  }
  $$(".seg button", form).forEach(b => b.addEventListener("click", () => { f.type = b.dataset.v; applyType(); }));
  applyType();
  multiSelect(form, "colourChips"); multiSelect(form, "wxChips"); multiSelect(form, "habChips");
  singleSelect(form, "sporeChips"); singleSelect(form, "gillChips"); singleSelect(form, "subChips");
  HAB_LOG.forEach(([k]) => singleSelect(form, "hab_" + k));
  multiSelect(form, "smellChips"); multiSelect(form, "texChips"); singleSelect(form, "bruiseChips");

  // Lookalikes: suggested from the name and Shroom ID result, plus your own.
  let looks = f.lookalikes.map(l => ({ ...l }));
  const dangerLabel = { deadly: "Deadly", toxic: "Toxic", inedible: "Inedible", unknown: "Check" };
  function syncLooks() {
    if (!document.body.contains(form)) return;
    const sugg = suggestLookalikes($("#name").value + " " + ((f.idApp && f.idApp.result) || ""));
    // Drop untouched suggestions that no longer match, then add new ones.
    looks = looks.filter(l => !l.suggested || l.ruledOut || l.note || sugg.some(s => s.name === l.name));
    for (const s of sugg) if (!looks.some(l => l.name === s.name)) looks.push({ ...s, suggested: true, ruledOut: false, note: "" });
    drawLooks();
  }
  function drawLooks() {
    $("#laHint").textContent = looks.length
      ? "Check each one and say how you ruled it out. This list isn't complete, so an expert should still check your find."
      : "Type a name above and common dangerous lookalikes appear here. You can add your own too.";
    $("#laList").innerHTML = looks.map((l, i) => `<div class="larow">
        <div class="latop"><label class="latick"><input type="checkbox" data-lr="${i}" ${l.ruledOut ? "checked" : ""} aria-label="Ruled out ${esc(l.name)}"><b>${esc(l.name)}</b></label><span class="edib ${esc(l.danger || "unknown")}">${esc(dangerLabel[l.danger] || "Check")}</span>${l.suggested ? "" : `<button type="button" class="laX" data-lx="${i}" aria-label="Remove ${esc(l.name)}">×</button>`}</div>
        ${l.how ? `<p class="hint" style="margin:0">${esc(l.how)}</p>` : ""}
        <input type="text" class="qsmall" data-ln="${i}" placeholder="How you ruled it out" value="${esc(l.note || "")}" aria-label="How you ruled out ${esc(l.name)}">
      </div>`).join("");
    looksSum();
  }
  function looksSum() {
    const el = $("#ddLooksSum"); if (!el) return;
    const done = looks.filter(l => l.ruledOut).length, bad = looks.some(l => !l.ruledOut && (l.danger === "deadly" || l.danger === "toxic"));
    el.textContent = looks.length ? `${done} of ${looks.length} ruled out` : "None yet";
    el.className = bad ? "warn" : "";
  }
  $("#laList").addEventListener("change", e => { const c = e.target.closest("[data-lr]"); if (c) { looks[+c.dataset.lr].ruledOut = c.checked; looksSum(); } });
  $("#laList").addEventListener("input", e => { const n = e.target.closest("[data-ln]"); if (n) looks[+n.dataset.ln].note = n.value; });
  $("#laList").addEventListener("click", e => { const x = e.target.closest("[data-lx]"); if (x) { looks.splice(+x.dataset.lx, 1); drawLooks(); } });
  const addLook = () => { const v = $("#laAdd").value.trim(); if (!v) return; looks.push({ name: v, danger: "unknown", how: "", ruledOut: false, note: "" }); $("#laAdd").value = ""; drawLooks(); };
  $("#laAddBtn").addEventListener("click", addLook);
  $("#laAdd").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addLook(); } });
  let laTimer = null;
  const laLater = () => { clearTimeout(laTimer); laTimer = setTimeout(syncLooks, 300); };
  $("#name").addEventListener("input", laLater);
  syncLooks();

  // Edibility warning
  const edibHint = () => {
    const v = $("#edib").value;
    $("#edibHint").textContent = v === "edible"
      ? "Marked edible. Only keep this if an expert checked this exact find in person. The app will still warn you not to eat it based on the log."
      : "Only mark a find edible once an expert has checked it in person. Never eat anything based on an app.";
    $("#edibHint").style.color = v === "edible" ? "var(--warn-fg)" : "";
    $("#ddEdibSum").textContent = (EDIBILITY.find(x => x[0] === v) || [, ""])[1];
  };
  $("#edib").addEventListener("change", edibHint); edibHint();

  // Time
  const todLabel = () => wwSum();
  todLabel();
  const moonLine = () => { const m = moonPhase($("#foundAt").value ? new Date($("#foundAt").value) : f.foundAt); $("#moonLine").innerHTML = `${moonIcon(m.age)} ${esc(m.name)}, ${m.illum}% lit`; };
  moonLine();
  $("#foundAt").addEventListener("input", todLabel);
  $("#foundAt").addEventListener("input", moonLine);

  // Photos
  async function drawPhotos() {
    const g = $("#photoGrid");
    g.hidden = !photos.length;
    g.innerHTML = photos.map((p, i) => `<div class="ph-item">${i === 0 ? '<span class="cover">Cover</span>' : ""}<img data-i="${i}" alt="${esc(p.label || "Photo")}"><button type="button" class="rm" data-rm="${i}" aria-label="Remove photo">×</button><select data-lbl="${i}" aria-label="What this photo shows">${PHOTO_LABELS.map(l => `<option ${p.label === l ? "selected" : ""}>${l}</option>`).join("")}</select><button type="button" class="btn small ghost" data-ms="${i}" style="border-radius:0;border:0;border-top:1px solid var(--line)">Measure</button>${i > 0 ? `<button type="button" class="btn small ghost" data-cv="${i}" style="border-radius:0;border:0;border-top:1px solid var(--line)">Make cover</button>` : ""}</div>`).join("");
    for (const img of $$("img[data-i]", g)) {
      const p = photos[+img.dataset.i];
      img.src = p.blob ? (p.url ||= URL.createObjectURL(p.blob)) : (await photoURL(p.key)) || "";
    }
  }
  $("#photoGrid").addEventListener("click", e => {
    const rm = e.target.closest("[data-rm]"), cv = e.target.closest("[data-cv]"), ms = e.target.closest("[data-ms]");
    if (ms) {
      const img = $(`img[data-i="${ms.dataset.ms}"]`, $("#photoGrid"));
      // Fills the size box right away; returns what was there so a wrong guess can be undone.
      if (img && img.src) openScaleSheet(img.src, (field, cm, raw) => { const el = $("#" + field); if (!el) return ""; const old = el.value; el.value = raw != null ? raw : toDisp(cm); el.dispatchEvent(new Event("input", { bubbles: true })); return old; }, photos[+ms.dataset.ms] && photos[+ms.dataset.ms].label);
      return;
    }
    if (rm) { const [p] = photos.splice(+rm.dataset.rm, 1); if (p.key) removedKeys.push(p.key); drawPhotos(); }
    if (cv) { const [p] = photos.splice(+cv.dataset.cv, 1); photos.unshift(p); drawPhotos(); }
  });
  $("#photoGrid").addEventListener("change", e => { const s = e.target.closest("[data-lbl]"); if (s) photos[+s.dataset.lbl].label = s.value; });
  drawPhotos();
  async function onFiles(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    for (const file of files) {
      try {
        const gps = await exifGPS(file);
        if (gps && !photoExif) photoExif = gps;
        const blob = await resizeImage(file);
        const defaultLabel = photos.length === 0 ? "Whole" : (f.type === "mushroom" ? ["Gills or underside", "Stem base", "Spore print"][Math.min(photos.length - 1, 2)] : "Leaf");
        photos.push({ blob, label: defaultLabel });
      } catch (err) { toast(err.message || "That photo couldn't be loaded"); }
    }
    drawPhotos();
    if (photoExif) { $("#exifBtn").hidden = false; if (f.lat == null) setLoc({ ...photoExif, acc: null }, "photo"); }
  }
  $("#camIn").addEventListener("change", onFiles);
  $("#galIn").addEventListener("change", onFiles);

  // Location
  function wwSum(msg) {
    const el = $("#ddWhereSum"); if (!el) return;
    const d = new Date($("#foundAt").value || f.foundAt);
    const when = d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const where = f.lat != null ? ({ gps: "GPS", photo: "From photo", pin: "Pinned" }[f.locSource] || "Saved") + (f.acc ? ` ±${f.acc} m` : "") : (msg && /Finding/.test(msg) ? "Finding…" : "No location");
    el.textContent = where + " · " + when;
    el.className = f.lat == null && !(msg && /Finding/.test(msg)) ? "warn" : "";
  }
  function showLoc(msg) {
    const ok = f.lat != null;
    $("#locStatus").className = "loc-status " + (ok ? "ok" : "none");
    const srcText = { gps: "Location from GPS", photo: "Location from the photo", pin: "Pinned on the map" }[f.locSource] || "Location saved";
    $("#locStatus").innerHTML = `<svg><use href="#i-pin"/></svg><span></span>`;
    $("#locStatus span").textContent = msg || (ok ? srcText : "No location yet");
    $("#locCoords").textContent = ok ? `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}${f.acc ? ` · accurate to about ${f.acc} m` : ""}` : (geoAvailable() ? "" : "GPS isn't available here. Pin the spot on the map instead.");
    $("#clearLoc").hidden = !ok;
    wwSum(msg);
    wxRow();
  }
  function setLoc(loc, src) {
    const moved = f.lat == null || haversine({ lat: f.lat, lng: f.lng }, loc) > 0.03;
    f.lat = loc.lat; f.lng = loc.lng; f.acc = loc.acc ?? null; f.locSource = src;
    if (moved) { f.slope = null; f.aspect = null; f.elev = loc.alt ?? null; f.elevSrc = loc.alt != null ? "gps" : null; }
    showLoc(); if (typeof fillTerrain === "function") { showTerrain(); fillTerrain(); }
  }
  async function tryGPS(auto) {
    showLoc("Finding your location…");
    $("#gpsBtn").disabled = true;
    try { const loc = await getPosition(); setLoc(loc, "gps"); if (!auto) toast("Location saved"); }
    catch (e) {
      showLoc(e && e.code === 1 ? "Location permission is off. Pin the spot on the map instead." : "Couldn't get a GPS fix. Pin the spot on the map instead.");
      if (f.lat != null) showLoc();
    }
    $("#gpsBtn").disabled = false;
  }
  $("#gpsBtn").addEventListener("click", () => tryGPS(false));
  $("#pinBtn").addEventListener("click", () => openPinSheet(f, loc => setLoc(loc, "pin")));
  $("#exifBtn").addEventListener("click", () => photoExif && setLoc({ ...photoExif, acc: null }, "photo"));
  $("#clearLoc").addEventListener("click", () => { f.lat = f.lng = f.acc = null; f.locSource = null; showLoc(); });

  // Weather fills in by itself once the spot is known and there's signal.
  let wxDoneFor = null, wxBusy = false, soilAuto = !!f.soilAuto, soilVwc = f.soilVwc ?? null;
  const wxEmpty = () => !picked(form, "wxChips", "w").length && $("#temp").value === "" && !$("#rainRecent").value;
  function wxStatus(msg, ok) {
    $("#wxStatus").className = "loc-status " + (ok ? "ok" : "none");
    $("#wxStatus span").textContent = msg;
  }
  function wxRow() {
    const can = netOK() && f.lat != null;
    $("#wxAutoRow").hidden = !can;
    if (wxBusy) return;
    const ws = $("#ddWxSum"); if (ws) ws.textContent = wxDoneFor ? "Filled in" : picked(form, "wxChips", "w").join(", ");
    if (!netOK()) wxStatus("No signal. Fill in the weather by hand, or edit this find later to fill it in.", false);
    else if (f.lat == null) wxStatus("Weather fills in by itself once the location is set.", false);
    else if (wxDoneFor) wxStatus("Weather filled in from Open-Meteo. You can change anything below.", true);
    else wxStatus("Ready to fill in the weather.", false);
    // Fill automatically the first time a spot is known, if nothing's been entered yet.
    const sig = f.lat != null ? `${f.lat.toFixed(3)},${f.lng.toFixed(3)},${$("#foundAt").value}` : null;
    if (can && sig && sig !== wxDoneFor && wxEmpty()) fillWeather(true);
  }
  async function fillWeather(auto) {
    if (wxBusy || f.lat == null) return;
    wxBusy = true; $("#wxAuto").disabled = true;
    wxStatus("Getting the weather for this time and place…", false);
    const sig = `${f.lat.toFixed(3)},${f.lng.toFixed(3)},${$("#foundAt").value}`;
    try {
      const w = await fetchWeather(f.lat, f.lng, new Date($("#foundAt").value || f.foundAt).toISOString());
      $$("#wxChips .chip", form).forEach(c => c.setAttribute("aria-pressed", w.chips.includes(c.dataset.w)));
      if (w.temp != null) $("#temp").value = w.temp;
      $("#rainRecent").value = w.rainRecent;
      if (!$("#wxNote").value || /From Open-Meteo\.$/.test($("#wxNote").value)) $("#wxNote").value = w.note;
      if (w.soil) {
        $("#soil").value = w.soil; soilAuto = true; soilVwc = w.soilVwc;
        $("#soilHint").textContent = `Estimated from weather models: ${w.soilVwc} m³ of water per m³ of soil, near the surface. Change it if the ground felt different.`;
      }
      wxDoneFor = sig; wxBusy = false;
      wxStatus("Weather filled in from Open-Meteo. You can change anything below.", true);
      { const ws = $("#ddWxSum"); if (ws) ws.textContent = [w.temp != null ? w.temp + "°C" : "", ...w.chips].filter(Boolean).slice(0, 3).join(", "); }
      if (!auto) toast("Weather filled in");
    } catch (e) {
      wxDoneFor = sig; wxBusy = false;
      wxStatus(e.message === "future" ? "That time is in the future, so there's no weather to fill in." : "Couldn't reach the weather service. Fill it in by hand.", false);
    }
    $("#wxAuto").disabled = false;
  }
  $("#soil").addEventListener("change", () => { soilAuto = false; });
  let wxTimer = null;
  $("#foundAt").addEventListener("change", () => { clearTimeout(wxTimer); wxTimer = setTimeout(wxRow, 400); });
  $("#wxAuto").addEventListener("click", () => fillWeather(false));
  window.addEventListener("online", wxRow, { once: true });
  showLoc();
  if (!existing && geoAvailable()) tryGPS(true);
  else if (!geoAvailable()) $("#gpsBtn").hidden = true;

  // Voice notes and dictation
  let voices = f.voice.map(v => ({ ...v }));
  const removedVoice = [];
  async function drawVoices() {
    const vl = $("#voiceList"); if (!vl) return;
    const rows = [];
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i];
      const src = v.blob ? (v.url ||= URL.createObjectURL(v.blob)) : await store.get("photos", v.key).then(r => r ? URL.createObjectURL(r) : "").catch(() => "");
      rows.push(`<div class="vrow"><audio controls preload="metadata" src="${src}"></audio><button type="button" class="laX" data-vx="${i}" aria-label="Remove voice note">×</button></div>`);
    }
    vl.innerHTML = rows.join("");
  }
  drawVoices();
  const vlist = $("#voiceList");
  if (vlist) vlist.addEventListener("click", e => { const x = e.target.closest("[data-vx]"); if (x) { const [v] = voices.splice(+x.dataset.vx, 1); if (v.key) removedVoice.push(v.key); drawVoices(); } });
  const recBtn = $("#recBtn");
  if (recBtn) recBtn.addEventListener("click", async () => {
    if (recBtn._rec) { const { blob, secs } = await recBtn._rec.stop(); recBtn._rec = null; $("span", recBtn).textContent = "Record"; recBtn.setAttribute("aria-pressed", "false"); voices.push({ blob, secs, at: new Date().toISOString() }); drawVoices(); return; }
    try { recBtn._rec = await recordVoice(s => { $("span", recBtn).textContent = `Stop ${s}s`; }); $("span", recBtn).textContent = "Stop"; recBtn.setAttribute("aria-pressed", "true"); }
    catch (e) { micHelp(e); }
  });
  const dictBtn = $("#dictBtn");
  if (dictBtn) dictBtn.addEventListener("click", () => { if (dictBtn._r) dictBtn._r.stop(); else dictateInto($("#notes"), dictBtn); });

  // Terrain: GPS height straight away, slope from the elevation model when there's signal.
  function showTerrain() { $("#terrainLine").textContent = terrainText(f) ? "Terrain: " + terrainText(f) : ""; }
  let terrainFor = null;
  async function fillTerrain() {
    if (f.lat == null || !netOK()) return;
    const sig = `${f.lat.toFixed(4)},${f.lng.toFixed(4)}`;
    if (sig === terrainFor) return;
    terrainFor = sig;
    try { Object.assign(f, await fetchTerrain(f.lat, f.lng)); f.elevSrc = "model"; } catch (e) {}
    showTerrain();
  }
  showTerrain();

  // Save
  form.addEventListener("submit", async e => {
    e.preventDefault();
    $("#saveBtn").disabled = true;
    const nowISO = new Date().toISOString();
    f.name = $("#name").value.trim();
    f.foundAt = new Date($("#foundAt").value || f.foundAt).toISOString();
    for (const k of ["width", "height", "length", "stem"]) f[k] = fromDisp($("#" + k).value);
    f.colours = picked(form, "colourChips");
    f.colourNote = $("#colourNote").value.trim();
    f.description = "";
    f.notes = $("#notes").value.trim() || undefined;
    if (f.kitchen) { f.kitchen = { ...f.kitchen, text: "" }; if (!(f.kitchen.ways || []).length && !f.kitchen.rating) delete f.kitchen; }
    f.weather = picked(form, "wxChips", "w");
    f.rainRecent = $("#rainRecent").value;
    f.temp = $("#temp").value === "" ? null : +$("#temp").value;
    f.weatherNote = $("#wxNote").value.trim();
    f.soil = $("#soil").value;
    f.soilAuto = soilAuto && !!f.soil;
    f.soilVwc = f.soilAuto ? soilVwc : null;
    f.moon = moonPhase(f.foundAt);
    const iq = $("#inatQ"); if (iq && !(f.inat && f.inat.id)) { if (iq.checked) f.inatQueued = true; else delete f.inatQueued; }
    const savedVoice = [];
    for (const v of voices) {
      if (v.blob) { const key = "v-" + uid(); await store.put("photos", v.blob, key); savedVoice.push({ key, secs: v.secs, at: v.at }); }
      else savedVoice.push({ key: v.key, secs: v.secs, at: v.at });
    }
    f.voice = savedVoice;
    for (const k of removedVoice) await store.del("photos", k);
    f.spore = f.type === "mushroom" ? (picked(form, "sporeChips")[0] || "") : "";
    f.gills = f.type === "mushroom" ? (picked(form, "gillChips")[0] || "") : "";
    f.substrate = picked(form, "subChips")[0] || "";
    f.habitat = picked(form, "habChips");
    { const hl = {}; HAB_LOG.forEach(([k]) => { const v = picked(form, "hab_" + k)[0]; if (v) hl[k] = v; }); f.hablog = Object.keys(hl).length ? hl : undefined; }
    f.trees = $("#trees").value.trim();
    f.edibility = $("#edib").value;
    f.revisit = $("#revisit").checked;
    f.smell = picked(form, "smellChips");
    f.texture = picked(form, "texChips");
    f.bruise = f.type === "mushroom" ? (picked(form, "bruiseChips")[0] || "") : "";
    f.bruiseNote = "";
    f.lookalikes = looks.map(({ name, danger, how, ruledOut, note, suggested }) => ({ name, danger, how, ruledOut, note: note.trim(), suggested: !!suggested }));
    if (activeTrail && !f.trailId) f.trailId = activeTrail.id;
    const tripPick = $("#tripPick"); if (tripPick) { if (tripPick.value) f.tripId = tripPick.value; else delete f.tripId; }
    f.updatedAt = nowISO;
    if (!f.createdAt) f.createdAt = nowISO;
    delete f.needsDetails;
    delete f.sample;
    try {
      const saved = [];
      for (const p of photos) {
        if (p.blob) { const key = "p-" + uid(); await store.put("photos", p.blob, key); saved.push({ key, label: p.label }); }
        else saved.push({ key: p.key, label: p.label });
      }
      f.photos = saved;
      for (const k of removedKeys) { await store.del("photos", k); photoURLs.delete(k); }
      await store.put("finds", f);
      lsSet("lastType", f.type);
      if (!existing && finds.some(x => x.sample)) await removeExamples();
      await loadFinds();
      toast(existing ? "Changes saved" : "Find saved");
      if (f.inatQueued) setTimeout(inatProcess, 500);
      if (e.submitter && e.submitter.id === "saveNext") { swipeDir = 1; location.hash = "edit-" + e.submitter.dataset.next; }
      else location.hash = "find-" + f.id;
    } catch (err) {
      $("#saveBtn").disabled = false;
      toast("Couldn't save. Your phone may be out of storage.");
    }
  });
}

function openPinSheet(f, onPick) {
  if (!hasLeaflet) { toast("The map couldn't load"); return; }
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pinTitle">
    <h2 id="pinTitle">Pin where you found it</h2>
    <p class="hint" style="margin:0">Tap the map to drop the pin, then drag it to adjust. Areas you've saved for offline use load with no signal.</p>
    <div class="pick-map" id="pickMap"></div>
    <div class="btn-row"><button class="btn ghost" type="button" id="pinCancel">Cancel</button><button class="btn primary" type="button" id="pinOk" disabled style="flex:1">Use this spot</button></div>
  </div>`;
  document.body.appendChild(bg);
  const start = f.lat != null ? [f.lat, f.lng] : defaultCenter();
  const m = makeMap($("#pickMap", bg), start, f.lat != null || lastLoc ? 15 : 6);
  let marker = null, pick = null;
  const place = ll => {
    pick = { lat: ll.lat, lng: ll.lng, acc: null };
    if (!marker) { marker = L.marker(ll, { icon: pinIcon("new"), draggable: true }).addTo(m); marker.on("dragend", () => place(marker.getLatLng())); }
    else marker.setLatLng(ll);
    $("#pinOk", bg).disabled = false;
  };
  if (f.lat != null) place(L.latLng(f.lat, f.lng));
  if (lastLoc) L.marker([lastLoc.lat, lastLoc.lng], { icon: pinIcon("me"), interactive: false }).addTo(m);
  m.on("click", e => place(e.latlng));
  const close = () => { try { m.remove(); } catch (e) {} maps = maps.filter(x => x !== m); bg.remove(); };
  $("#pinCancel", bg).addEventListener("click", close);
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  $("#pinOk", bg).addEventListener("click", () => { if (pick) onPick(pick); close(); });
}


/* ============================================================
   Terrain: elevation and which way the slope faces.
   ============================================================ */
const COMPASS16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const compassName = deg => COMPASS16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
async function fetchTerrain(lat, lng) {
  // Five heights around the spot from a 90 m elevation model, roughly 100 m apart.
  const dLat = 0.0009, dLng = 0.0009 / Math.cos(lat * Math.PI / 180);
  const pts = [[lat, lng], [lat + dLat, lng], [lat - dLat, lng], [lat, lng + dLng], [lat, lng - dLng]];
  const u = `https://api.open-meteo.com/v1/elevation?latitude=${pts.map(q => q[0].toFixed(5)).join(",")}&longitude=${pts.map(q => q[1].toFixed(5)).join(",")}`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  let r; try { r = await fetch(u, { signal: ctl.signal }); } finally { clearTimeout(t); }
  if (!r.ok) throw new Error("elevation " + r.status);
  const [c, n, s, e, w] = (await r.json()).elevation;
  const dist = 0.0009 * 111320;
  const dzdx = (e - w) / (2 * dist), dzdy = (n - s) / (2 * dist);
  const slope = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
  const aspect = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;
  return { elev: Math.round(c), slope: Math.round(slope), aspect: slope < 2 ? null : Math.round(aspect) };
}
function terrainText(f) {
  const bits = [];
  if (f.elev != null) bits.push(`${settings.units === "in" ? Math.round(f.elev * 3.281) + " ft" : f.elev + " m"} up`);
  if (f.slope != null) bits.push(f.aspect == null ? "flat ground" : `${f.slope}° slope facing ${compassName(f.aspect)}`);
  return bits.join(" · ");
}

/* ============================================================
   Fruiting now: past mushroom spots, in season, that just got rain.
   ============================================================ */
const dayOfYear = d => { const x = new Date(d); return Math.floor((x - new Date(x.getFullYear(), 0, 0)) / DAY); };
function inSeason(f, now = new Date()) { const diff = Math.abs(dayOfYear(f.foundAt) - dayOfYear(now)); return Math.min(diff, 365 - diff) <= 21; }
// Past mushroom spots coming back into season, plus any spot you marked to revisit.
function fruitingCandidates() { return finds.filter(f => f.type === "mushroom" && f.lat != null && !f.sample && inSeason(f) && ((Date.now() - new Date(f.foundAt)) / DAY > 200 || (f.revisit && (Date.now() - new Date(f.foundAt)) / DAY > 21))); }
const alertsOn = () => lsGet("fruitAlerts", false) && (NATIVE || ("Notification" in window && Notification.permission === "granted"));
function sendAlert(title, body) {
  if (NATIVE) { nat("showAlert", { title, body }).catch(() => {}); return; }
  try { new Notification(title, { body, icon: "icon.svg" }); } catch (e) {}
}
// Rain and warmth over the past week where you are, as a simple Good / Fair / Poor.
async function fruitOutlook() {
  const c = lsGet("outlook", null);
  const here = lastLoc || (c && { lat: c.lat, lng: c.lng });
  if (!here) return null;
  const fresh = c && Date.now() - c.ts < 3 * 3600000 && haversine(here, c) < 20;
  if (fresh || !netOK()) return c ? { ...c, stale: !fresh } : null;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${here.lat.toFixed(2)}&longitude=${here.lng.toFixed(2)}&daily=precipitation_sum,temperature_2m_mean&past_days=7&forecast_days=1&timezone=auto`);
  if (!r.ok) throw new Error("weather");
  const d = (await r.json()).daily; if (!d) return null;
  const rain = d.precipitation_sum.slice(0, 7).reduce((a, x) => a + (x || 0), 0);
  const ts = d.temperature_2m_mean.slice(0, 7).filter(x => x != null), temp = ts.reduce((a, x) => a + x, 0) / (ts.length || 1);
  const level = temp < 2 ? "Off season" : rain >= 15 && temp >= 5 && temp <= 22 ? "Good" : rain >= 6 && temp >= 3 && temp <= 26 ? "Fair" : "Poor";
  const o = { ts: Date.now(), lat: here.lat, lng: here.lng, rain: Math.round(rain), temp: Math.round(temp), level };
  lsSet("outlook", o); return o;
}
async function checkFruiting(force) {
  const cached = lsGet("fruiting", null);
  if (!force && cached && Date.now() - cached.ts < 6 * 3600000) return cached;
  if (!netOK()) return cached;
  const cands = fruitingCandidates();
  const groups = new Map();
  for (const f of cands) { const k = `${f.lat.toFixed(2)},${f.lng.toFixed(2)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
  const keys = [...groups.keys()].slice(0, 40);
  const out = { ts: Date.now(), hits: [] };
  if (keys.length) {
    const lat = keys.map(k => k.split(",")[0]).join(","), lng = keys.map(k => k.split(",")[1]).join(",");
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,temperature_2m_mean&past_days=7&forecast_days=1&timezone=auto`);
    if (!r.ok) throw new Error("weather " + r.status);
    let j = await r.json(); if (!Array.isArray(j)) j = [j];
    keys.forEach((k, i) => {
      const d = j[i] && j[i].daily; if (!d) return;
      const rain = d.precipitation_sum.slice(0, 7).reduce((s, x) => s + (x || 0), 0);
      const temps = d.temperature_2m_mean.slice(0, 7).filter(x => x != null);
      const temp = temps.reduce((s, x) => s + x, 0) / (temps.length || 1);
      if (rain >= 10 && temp >= 4 && temp <= 24) for (const f of groups.get(k)) out.hits.push({ id: f.id, rain: +rain.toFixed(1), temp: Math.round(temp) });
    });
  }
  const before = new Set((cached && cached.hits || []).map(h => h.id));
  lsSet("fruiting", out);
  const fresh = out.hits.filter(h => !before.has(h.id));
  if (fresh.length && alertsOn()) sendAlert("Fruiting alert", `${fresh.length} of your spots ${fresh.length === 1 ? "looks" : "look"} good right now: in season, with rain this week. ${fresh.map(h => (finds.find(f => f.id === h.id) || {}).name).filter(Boolean).slice(0, 3).join(", ")}`);
  return out;
}

/* ============================================================
   Compass back to a pin, with calibration.
   ============================================================ */
function bearingTo(a, b) {
  const rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
function openCompass(f) {
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cpTitle" style="overflow-y:auto">
    <h2 id="cpTitle">Back to ${esc(f.name || "this find")}</h2>
    <div style="display:grid;place-items:center;padding:8px 0">
      <svg id="cpDial" viewBox="-110 -110 220 220" width="240" height="240" style="max-width:100%">
        <circle r="104" fill="var(--surface-2)" stroke="var(--line)" stroke-width="2"/>
        <g id="cpRose">${COMPASS16.filter((_, i) => i % 4 === 0).map((n, i) => `<text x="0" y="-84" transform="rotate(${i * 90})" text-anchor="middle" font-size="16" font-weight="700" fill="${n === "N" ? "var(--danger)" : "var(--muted)"}">${n}</text>`).join("")}${Array.from({ length: 36 }, (_, i) => `<line y1="-104" y2="${i % 3 ? -98 : -94}" transform="rotate(${i * 10})" stroke="var(--faint)" stroke-width="2"/>`).join("")}</g>
        <g id="cpArrow"><path d="M0 -72 L18 10 L0 0 L-18 10Z" fill="var(--shroom)"/><circle r="6" fill="var(--fg)"/></g>
      </svg>
    </div>
    <div style="text-align:center"><div class="num" id="cpDist" style="font-family:var(--font-display);font-size:34px;font-weight:650">…</div><div class="hint num" id="cpDir"></div></div>
    <div class="banner warn" id="cpAcc"><svg><use href="#i-warn"/></svg><div class="grow" id="cpAccText">Waiting for the compass…</div></div>
    <details class="panel" id="cpCal"><summary style="cursor:pointer;font-weight:700">Calibrate the compass</summary>
      <p>1. Move away from cars, metal and power lines. Hold the phone flat and draw a big figure 8 in the air three times, turning your wrist as you go.</p>
      <p>2. For the most accurate result, tap Calibrate by walking. Then walk about 30 m in a straight line with the top of the phone pointing the way you're walking. GPS works out true north and corrects the compass.</p>
      <div class="btn-row"><button class="btn small plant" type="button" id="cpWalk">Calibrate by walking</button><button class="btn small ghost" type="button" id="cpReset">Reset</button></div>
      <p id="cpWalkMsg" class="num"></p>
      <div class="field"><label for="cpOff">Manual correction</label><input type="range" id="cpOff" min="-40" max="40" step="1" value="${lsGet("compassOffset", 0)}"><span class="hint num" id="cpOffTxt"></span>
        <span class="hint">Add your area's magnetic declination here (east is +, west is −) if you know it, or nudge it until the arrow matches a landmark.</span></div>
    </details>
    <div class="btn-row"><button class="btn primary" type="button" id="cpDone" style="flex:1">Done</button></div>
  </div>`;
  document.body.appendChild(bg);
  let here = lastLoc ? { lat: lastLoc.lat, lng: lastLoc.lng, acc: lastLoc.acc } : null, heading = null, iosAcc = null;
  const recent = [];   // last headings, to judge how steady the sensor is
  let offset = +lsGet("compassOffset", 0);
  let walk = null;
  const offTxt = () => { $("#cpOffTxt", bg).textContent = `Correction ${offset > 0 ? "+" : ""}${offset}°`; };
  offTxt();
  function render() {
    const target = { lat: f.lat, lng: f.lng };
    if (here) {
      const km = haversine(here, target), brg = bearingTo(here, target);
      $("#cpDist", bg).textContent = km < 0.01 ? "You're there" : fmtDist(km);
      $("#cpDir", bg).textContent = `Head ${compassName(brg)} (${Math.round(brg)}°)${here.acc ? ` · GPS ±${here.acc} m` : ""}`;
      const h = heading == null ? 0 : heading;
      $("#cpRose", bg).setAttribute("transform", `rotate(${-h})`);
      $("#cpArrow", bg).setAttribute("transform", `rotate(${brg - h})`);
    } else { $("#cpDist", bg).textContent = "Finding you…"; }
    // Accuracy from the sensor if it reports one, otherwise from how much it jitters.
    let msg, ok = false;
    if (heading == null) msg = "No compass reading. Point the arrow using the direction above, with N on a paper map or the sun as a guide.";
    else {
      let spread = null;
      if (recent.length >= 8) { const m = recent.reduce((s, x) => s + x, 0) / recent.length; spread = Math.sqrt(recent.reduce((s, x) => s + x * x, 0) / recent.length - m * m); }
      const acc = iosAcc != null ? iosAcc : spread;
      if (acc == null) msg = "Checking compass accuracy…";
      else if (acc <= 10) { msg = "Compass accuracy is good."; ok = true; }
      else if (acc <= 25) msg = "Compass accuracy is fair. Calibrate it for a better reading.";
      else msg = "Compass accuracy is poor. Calibrate it below.";
    }
    $("#cpAcc", bg).className = "banner " + (ok ? "" : "warn");
    $("#cpAcc", bg).style.background = ok ? "color-mix(in srgb, var(--plant) 15%, var(--surface))" : "";
    $("#cpAccText", bg).textContent = msg;
    if (!ok && heading != null && recent.length >= 8 && !$("#cpCal", bg).open && !bg._opened) { $("#cpCal", bg).open = true; bg._opened = true; }
  }
  let last = null;
  function onOrient(e) {
    let h = null;
    if (e.webkitCompassHeading != null) { h = e.webkitCompassHeading; iosAcc = e.webkitCompassAccuracy >= 0 ? e.webkitCompassAccuracy : null; }
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
    if (h == null) return;
    // Screen rotation: the arrow is drawn for portrait.
    const so = (screen.orientation && screen.orientation.angle) || 0;
    h = (h + so + offset + 360) % 360;
    heading = heading == null ? h : (heading + angDiff(h, heading) * 0.25 + 360) % 360;   // smooth
    if (last != null) { recent.push(angDiff(h, last)); if (recent.length > 20) recent.shift(); }
    last = h;
    if (walk) walk.headings.push(h - offset);
    render();
  }
  const evName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
  const startSensors = async () => {
    try { if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") await DeviceOrientationEvent.requestPermission(); } catch (e) {}
    window.addEventListener(evName, onOrient);
  };
  startSensors();
  let watch = null;
  if (geoAvailable()) watch = navigator.geolocation.watchPosition(pos => {
    here = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) };
    lastLoc = { ...here, ts: Date.now() }; lsSet("lastLoc", lastLoc);
    if (walk) {
      if (!walk.start && pos.coords.accuracy <= 20) walk.start = here;
      if (walk.start) {
        const moved = haversine(walk.start, here) * 1000;
        $("#cpWalkMsg", bg).textContent = `Walked ${Math.round(moved)} m of 30 m…`;
        if (moved >= 30 && walk.headings.length > 5) {
          const gpsBrg = bearingTo(walk.start, here);
          // Average the compass headings as vectors.
          const sx = walk.headings.reduce((s, x) => s + Math.sin(x * Math.PI / 180), 0), sy = walk.headings.reduce((s, x) => s + Math.cos(x * Math.PI / 180), 0);
          const compassBrg = (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
          offset = Math.round(angDiff(gpsBrg, compassBrg));
          lsSet("compassOffset", offset); $("#cpOff", bg).value = offset; offTxt();
          $("#cpWalkMsg", bg).textContent = `Calibrated. Correction set to ${offset > 0 ? "+" : ""}${offset}°.`;
          walk = null; recent.length = 0;
        }
      }
    }
    render();
  }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  $("#cpWalk", bg).addEventListener("click", () => {
    if (heading == null) { $("#cpWalkMsg", bg).textContent = "This phone isn't giving compass readings, so it can't be calibrated."; return; }
    walk = { start: null, headings: [] };
    $("#cpWalkMsg", bg).textContent = "Waiting for a good GPS fix, then start walking straight…";
  });
  $("#cpReset", bg).addEventListener("click", () => { offset = 0; lsSet("compassOffset", 0); $("#cpOff", bg).value = 0; offTxt(); walk = null; $("#cpWalkMsg", bg).textContent = "Correction reset."; });
  $("#cpOff", bg).addEventListener("input", e => { offset = +e.target.value; lsSet("compassOffset", offset); offTxt(); });
  holdScreen();
  const close = () => { window.removeEventListener(evName, onOrient); if (watch != null) navigator.geolocation.clearWatch(watch); bg.remove(); };
  $("#cpDone", bg).addEventListener("click", close);
  render();
}

/* ============================================================
   Sharing with a foraging buddy: a file you send any way you like.
   ============================================================ */
const slug = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "buddy";
async function buildShare(list, blur) {
  const media = {};
  const out = [];
  for (const f of list) {
    const c = structuredClone(f);
    delete c.sharedFrom; delete c.sample;
    if (blur && c.lat != null) { c.lat = +c.lat.toFixed(2); c.lng = +c.lng.toFixed(2); c.acc = 1000; c.blurred = true; c.trailId = null; }
    for (const p of [...(c.photos || []), ...(c.voice || [])]) {
      const rec = await store.get("photos", p.key).catch(() => null);
      if (rec) media[p.key] = typeof rec === "string" ? rec : await blobToDataURL(rec);
    }
    out.push(c);
  }
  return { app: "spore-and-leaf-share", version: 1, from: lsGet("buddyName", "") || "A friend", sharedAt: new Date().toISOString(), finds: out, photos: media };
}
async function sendShare(list, blur) {
  if (!list.length) { toast("Nothing to share"); return; }
  toast("Getting the file ready…");
  const data = JSON.stringify(await buildShare(list, blur));
  const name = `shroom-log-from-${slug(lsGet("buddyName", "me"))}-${stamp()}.json`;
  try {
    const file = new File([data], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: "Shroom Log finds", text: `${list.length} ${list.length === 1 ? "find" : "finds"} from Shroom Log. Open the app, go to More, and tap Open a shared file.` }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  if (await saveFile(name, data, "application/json")) toast("Share file saved. Send it to your buddy.");
}
async function importShared(j) {
  const from = String(j.from || "A friend").slice(0, 40);
  let added = 0, updated = 0;
  for (const raw of j.finds) {
    const f = normalise(raw);
    f.id = "sh-" + slug(from) + "-" + raw.id;
    f.sharedFrom = from;
    const tag = "from-" + slug(from);
    if (!f.tags.includes(tag)) f.tags.push(tag);
    const remap = p => { const key = "sh-" + p.key; const d = j.photos && j.photos[p.key]; return { ...p, key, _d: d }; };
    f.photos = f.photos.map(remap); f.voice = (f.voice || []).map(remap);
    for (const p of [...f.photos, ...f.voice]) { if (p._d) await store.put("photos", p._d.startsWith("data:image/svg") ? p._d : await dataURLToBlob(p._d), p.key); delete p._d; }
    const exists = finds.some(x => x.id === f.id);
    await store.put("finds", f); exists ? updated++ : added++;
  }
  await loadFinds();
  toast(`${added} new and ${updated} updated ${added + updated === 1 ? "find" : "finds"} from ${from}`);
}

/* ============================================================
   Voice: recorded notes (work offline) and dictation (needs signal on most phones).
   ============================================================ */
const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
// In the Android app, dictation uses the phone's own speech recogniser; the WebView has none.
const canDictate = () => NATIVE || !!SpeechRec;
function micHelp(e) {
  const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError" || e.error === "not-allowed" || /permission/i.test(e.message || ""));
  if (NATIVE) toast(denied ? "Microphone is off for Shroom Log." : "Couldn't use the microphone.", denied ? { label: "Open settings", run: () => nat("openAppSettings").catch(() => {}) } : null);
  else toast(denied ? "Microphone is blocked for this site. Tap the icon left of the web address, then Permissions, and allow Microphone." : "Couldn't use the microphone.");
}
async function recordVoice(onState, maxMs = 120000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks = [];
  const t0 = Date.now();
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const done = new Promise(res => { rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); res({ blob: new Blob(chunks, { type: rec.mimeType || "audio/webm" }), secs: Math.round((Date.now() - t0) / 1000) }); }; });
  rec.start();
  const timer = setTimeout(() => rec.state === "recording" && rec.stop(), maxMs);
  const tick = setInterval(() => onState && onState(Math.round((Date.now() - t0) / 1000)), 500);
  return { stop: () => { clearTimeout(timer); clearInterval(tick); if (rec.state === "recording") rec.stop(); return done; } };
}
function dictateInto(textarea, btn) {
  if (NATIVE) {
    const lab = $("span", btn) || btn;
    btn._r = { stop() {} }; lab.textContent = "Listening…"; btn.setAttribute("aria-pressed", "true");
    nat("dictate", { lang: navigator.language || "en-CA" }).then(r => {
      const t = (r && r.text || "").trim();
      if (t) { textarea.value = (textarea.value ? textarea.value.replace(/\s*$/, " ") : "") + t; textarea.dispatchEvent(new Event("input", { bubbles: true })); }
    }).catch(e => { const m = String(e && e.message || e); if (/permission/i.test(m)) micHelp({ error: "not-allowed" }); else if (!/cancel/i.test(m)) toast(/available/i.test(m) ? "This phone has no speech recogniser. Use Record instead." : "Dictation stopped"); })
      .finally(() => { lab.textContent = "Dictate"; btn.setAttribute("aria-pressed", "false"); btn._r = null; });
    return;
  }
  if (!SpeechRec) return;
  const r = new SpeechRec();
  r.lang = navigator.language || "en-CA"; r.interimResults = true; r.continuous = true;
  const base = textarea.value ? textarea.value.replace(/\s*$/, " ") : "";
  let finalText = "";
  r.onresult = e => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finalText += t; else interim += t; }
    textarea.value = base + finalText + interim;
  };
  r.onerror = e => { if (e.error === "not-allowed" || e.error === "service-not-allowed") micHelp({ error: "not-allowed" }); else toast(e.error === "network" ? "Dictation needs signal on this phone. Record a voice note instead." : "Dictation stopped"); };
  const lab = $("span", btn) || btn;
  r.onend = () => { lab.textContent = "Dictate"; btn.setAttribute("aria-pressed", "false"); btn._r = null; };
  r.start(); btn._r = r; lab.textContent = "Stop"; btn.setAttribute("aria-pressed", "true");
}
async function voiceQuickLog(btn) {
  if (btn._rec) { const { blob, secs } = await btn._rec.stop(); btn._rec = null; saveVoiceFind(blob, secs); return; }
  try {
    btn._rec = await recordVoice(s => { $("b", btn).textContent = `Recording ${s}s · tap to save`; });
    $("b", btn).textContent = "Recording · tap to save";
  } catch (e) { micHelp(e); }
}
async function saveVoiceFind(blob, secs) {
  toast("Saving…");
  let loc = null; try { loc = await getPosition(8000); } catch (e) {}
  const key = "v-" + uid(), nowISO = new Date().toISOString();
  await store.put("photos", blob, key);
  const f = normalise({ id: uid(), type: lsGet("lastType", "mushroom"), name: "", photos: [], voice: [{ key, secs, at: nowISO }],
    lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, acc: loc ? loc.acc : null, locSource: loc ? "gps" : null, elev: loc ? loc.alt : null,
    foundAt: nowISO, createdAt: nowISO, updatedAt: nowISO, needsDetails: true, moon: moonPhase(nowISO),
    width: null, height: null, length: null, stem: null, colours: [], colourNote: "", description: "", weather: [], rainRecent: "", temp: null, weatherNote: "" });
  if (activeTripId() && !f.tripId) f.tripId = activeTripId();
  await store.put("finds", f);
  if (finds.some(x => x.sample)) await removeExamples();
  await loadFinds();
  toast(loc ? "Voice note saved with location" : "Voice note saved. No location yet.");
  renderLog();
}
async function voicePlayersHTML(list) {
  if (!list || !list.length) return "";
  const parts = [];
  for (const v of list) {
    const rec = await store.get("photos", v.key).catch(() => null);
    if (!rec) continue;
    parts.push(`<div class="switch"><audio controls preload="metadata" src="${URL.createObjectURL(rec)}" style="width:100%;min-width:0"></audio><span class="hint num" style="flex:none">${v.secs || "?"}s</span></div>`);
  }
  return parts.join("");
}


/* ============================================================
   Sunset countdown, worked out on the phone (NOAA formula).
   ============================================================ */
function sunTimes(date, lat, lng) {
  const rad = Math.PI / 180;
  const d = new Date(date); d.setHours(12, 0, 0, 0);
  const n = Math.floor((d - new Date(Date.UTC(2000, 0, 1, 12))) / DAY) + 0.0008;   // days since J2000
  const Js = n - lng / 360;
  const M = (357.5291 + 0.98560028 * Js) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lam = (M + C + 180 + 102.9372) % 360;
  const Jt = 2451545 + Js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
  const dec = Math.asin(Math.sin(lam * rad) * Math.sin(23.4397 * rad));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if (cosW > 1) return { polar: "night" };
  if (cosW < -1) return { polar: "day" };
  const w = Math.acos(cosW) / rad;
  const toDate = j => new Date((j - 2440587.5) * DAY);
  return { rise: toDate(Jt - w / 360), set: toDate(Jt + w / 360) };
}
function sunsetInfo() {
  if (!lastLoc) return null;
  const now = new Date();
  const t = sunTimes(now, lastLoc.lat, lastLoc.lng);
  if (t.polar) return { text: t.polar === "day" ? "The sun doesn't set here today" : "The sun doesn't rise here today", level: "ok" };
  const mins = Math.round((t.set - now) / 60000);
  const at = t.set.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (mins < 0) {
    const tm = sunTimes(new Date(now.getTime() + DAY), lastLoc.lat, lastLoc.lng);
    return { text: `The sun set at ${at}. Sunrise is at ${tm.rise ? tm.rise.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—"}`, level: "dark", mins };
  }
  const h = Math.floor(mins / 60), m = mins % 60;
  return { text: `Sunset in ${h ? h + " h " : ""}${m} min, at ${at}`, level: mins <= 45 ? "soon" : mins <= 90 ? "warn" : "ok", mins };
}
function sunsetHTML() {
  const s = sunsetInfo();
  if (!s) return "";
  const col = s.level === "soon" || s.level === "dark" ? "var(--danger)" : s.level === "warn" ? "var(--warn-fg)" : "var(--muted)";
  return `<div class="context-note num" style="display:flex;gap:8px;align-items:center;color:${col}"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 7V4M5.6 10.6 4 9M18.4 10.6 20 9"/></g></svg><span>${esc(s.text)}${s.level === "soon" ? ". Time to head back." : ""}</span></div>`;
}
let sunsetWarned = false;
setInterval(() => {
  const s = sunsetInfo();
  if (!s || s.mins == null) return;
  if (s.mins <= 45 && s.mins > 0 && !sunsetWarned && (activeTrail || document.visibilityState === "visible")) {
    sunsetWarned = true;
    toast(`Sunset in ${s.mins} min. Time to head back.`);
    if ("Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") { try { new Notification("Sunset soon", { body: `Sunset in ${s.mins} minutes. Time to head back.`, icon: "icon.svg" }); } catch (e) {} }
  }
  const el = $("#sunLine"); if (el) el.innerHTML = sunsetHTML();
}, 60000);

/* ============================================================
   PIN lock. Hides the app behind a PIN. The log itself isn't encrypted.
   ============================================================ */
async function sha(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
const pinSet = () => !!lsGet("pinHash", null);
let unlocked = false, hiddenAt = 0;
function showLock() {
  if (!pinSet() || $("#lockScreen")) return;
  unlocked = false;
  const el = document.createElement("div");
  el.id = "lockScreen";
  el.style.cssText = "position:fixed;inset:0;z-index:100;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px max(16px, env(safe-area-inset-left, 0px))";
  el.innerHTML = `<svg width="56" height="56" viewBox="0 0 32 32" aria-hidden="true"><path fill="#e9a75e" d="M16 4C9 4 4 8.8 4 13.8c0 1.2.9 2.2 2.1 2.2h19.8c1.2 0 2.1-1 2.1-2.2C28 8.8 23 4 16 4Z"/><path fill="#ede6d8" d="M13 17h6l.8 9a2 2 0 0 1-2 2.2h-3.6a2 2 0 0 1-2-2.2L13 17Z"/></svg>
    <h2 style="font-size:24px">Enter your PIN</h2>
    <div id="pinDots" style="display:flex;gap:12px" aria-hidden="true"></div>
    <input id="pinIn" type="password" inputmode="numeric" autocomplete="off" maxlength="8" aria-label="PIN" style="max-width:220px;text-align:center;font-size:24px;letter-spacing:.4em">
    <p class="hint" id="pinMsg" style="min-height:20px;margin:0"></p>
    <div style="display:grid;grid-template-columns:repeat(3,72px);gap:12px">${[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map(k => k === "" ? "<span></span>" : `<button type="button" class="btn" data-k="${k}" style="min-height:64px;font-size:22px;border-radius:50%">${k}</button>`).join("")}</div>
    <button type="button" class="btn small ghost" id="pinForgot">Forgot PIN</button>`;
  document.body.appendChild(el);
  const inp = $("#pinIn", el);
  let fails = 0;
  const check = async () => {
    const v = inp.value;
    if (v.length < 4) return;
    if (await sha(lsGet("pinSalt", "") + v) === lsGet("pinHash", "")) { unlocked = true; el.remove(); return; }
    if (v.length >= lsGet("pinLen", 4)) {
      fails++; inp.value = "";
      $("#pinMsg", el).textContent = fails >= 5 ? "Too many tries. Wait 30 seconds." : "That PIN isn't right.";
      if (fails >= 5) { $$("button", el).forEach(b => b.disabled = true); setTimeout(() => { $$("button", el).forEach(b => b.disabled = false); fails = 0; $("#pinMsg", el).textContent = ""; }, 30000); }
    }
  };
  inp.addEventListener("input", check);
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    if (b.dataset.k === "⌫") inp.value = inp.value.slice(0, -1); else inp.value += b.dataset.k;
    check();
  });
  $("#pinForgot", el).addEventListener("click", () => {
    $("#pinMsg", el).innerHTML = `The PIN can't be recovered. To start over, type ERASE to delete everything in the app on this phone. <input id="eraseIn" type="text" style="margin-top:8px" aria-label="Type ERASE"><button type="button" class="btn small danger" id="eraseGo" style="margin-top:8px">Erase and start over</button>`;
    $("#eraseGo", el).addEventListener("click", async () => {
      if ($("#eraseIn", el).value.trim() !== "ERASE") { toast("Type ERASE to confirm"); return; }
      for (const s of ["finds", "photos", "trails", "kv", "tiles"]) await store.clear(s).catch(() => {});
      try { Object.keys(localStorage).filter(k => k.startsWith("sl:")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
      location.reload();
    });
  });
  setTimeout(() => inp.focus(), 50);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") hiddenAt = Date.now();
  else if (pinSet() && Date.now() - hiddenAt > lsGet("pinAfter", 5) * 60000) showLock();
});
async function setPin(pin) {
  const salt = uid();
  lsSet("pinSalt", salt); lsSet("pinHash", await sha(salt + pin)); lsSet("pinLen", pin.length);
}

/* ============================================================
   iNaturalist: upload finds so experts can confirm the ID,
   then bring the community ID back into the log.
   ============================================================ */
const INAT = "https://www.inaturalist.org", INAT_API = "https://api.inaturalist.org/v1";
const inat = {
  get clientId() { return lsGet("inatClient", ""); },
  get access() { return lsGet("inatAccess", ""); },
  get jwt() { const j = lsGet("inatJwt", null); return j && Date.now() - j.ts < 20 * 3600000 ? j.token : null; },
  get user() { return lsGet("inatUser", null); },
  connected() { return !!(this.access || lsGet("inatJwt", null)); }
};
const redirectURI = () => location.origin + location.pathname;
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function inatSignIn() {
  if (!inat.clientId) { toast("Add your iNaturalist app ID first"); return; }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  lsSet("inatVerifier", verifier);
  location.href = `${INAT}/oauth/authorize?client_id=${encodeURIComponent(inat.clientId)}&redirect_uri=${encodeURIComponent(redirectURI())}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256`;
}
async function inatFinishSignIn() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code");
  if (!code) return;
  history.replaceState(null, "", location.pathname + "#more");
  try {
    const body = new URLSearchParams({ client_id: inat.clientId, code, redirect_uri: redirectURI(), grant_type: "authorization_code", code_verifier: lsGet("inatVerifier", "") });
    const r = await fetch(`${INAT}/oauth/token`, { method: "POST", body });
    if (!r.ok) throw new Error("token " + r.status);
    const j = await r.json();
    lsSet("inatAccess", j.access_token);
    await inatRefreshJwt();
    await inatWhoAmI();
    toast("Connected to iNaturalist");
  } catch (e) {
    toast("iNaturalist sign-in didn't finish. You can paste an API token instead.");
  }
}
async function inatRefreshJwt() {
  if (!inat.access) throw new Error("not signed in");
  const r = await fetch(`${INAT}/users/api_token`, { headers: { Authorization: "Bearer " + inat.access } });
  if (!r.ok) throw new Error("api_token " + r.status);
  const j = await r.json();
  lsSet("inatJwt", { token: j.api_token, ts: Date.now() });
  return j.api_token;
}
async function inatToken() {
  if (inat.jwt) return inat.jwt;
  if (inat.access) return inatRefreshJwt();
  throw new Error("token_expired");
}
async function inatFetch(path, opts = {}) {
  const tok = await inatToken();
  const r = await fetch(INAT_API + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: tok } });
  if (r.status === 401) { lsSet("inatJwt", null); throw new Error("token_expired"); }
  if (!r.ok) throw new Error("inat " + r.status);
  return r.json();
}
async function inatWhoAmI() {
  const j = await inatFetch("/users/me");
  const u = j.results && j.results[0];
  if (u) lsSet("inatUser", { login: u.login, id: u.id });
  return u;
}
let inatBusy = false;
async function inatUpload(f) {
  const geopriv = lsGet("inatGeo", "obscured");
  const notes = [f.notes, f.description, f.colourNote && "Colour: " + f.colourNote, (f.colours || []).length && "Colours: " + f.colours.join(", "),
    f.spore && "Spore print: " + f.spore, f.gills && "Underside: " + f.gills, f.smell.length && "Smell: " + f.smell.join(", "), f.texture.length && "Texture: " + f.texture.join(", "),
    f.bruise && "Bruising: " + f.bruise + (f.bruiseNote ? " (" + f.bruiseNote + ")" : ""), f.substrate && "Growing on: " + f.substrate, f.habitat.length && "Habitat: " + f.habitat.join(", "), f.trees && "Nearby: " + f.trees,
    f.width != null && `Cap/width ${(+f.width).toFixed(1)} cm`, f.stem != null && `Stem ${(+f.stem).toFixed(1)} cm`].filter(Boolean).join("\n");
  // Remember the observation as soon as it exists, so a dropped connection mid-upload
  // carries on with the photos next time instead of posting the find twice.
  if (!f.inatUuid) { f.inatUuid = (crypto.randomUUID ? crypto.randomUUID() : uid()); await store.put("finds", f); }
  let obsId = f.inatPending && f.inatPending.id;
  if (!obsId) {
  const obs = await inatFetch("/observations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observation: {
    uuid: f.inatUuid, species_guess: f.name || (f.idApp && f.idApp.result) || "", observed_on_string: f.foundAt, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    description: notes, latitude: f.lat, longitude: f.lng, positional_accuracy: f.acc || undefined, geoprivacy: geopriv, owners_identification_from_vision: false
  } }) });
  obsId = obs.id || (obs.results && obs.results[0] && obs.results[0].id);
  if (!obsId) throw new Error("no id");
  f.inatPending = { id: obsId, done: [] }; await store.put("finds", f);
  }
  for (const ph of f.photos) {
    if (f.inatPending.done.includes(ph.key)) continue;
    const rec = await store.get("photos", ph.key).catch(() => null);
    if (!rec || typeof rec === "string") continue;
    const fd = new FormData();
    fd.append("observation_photo[observation_id]", obsId);
    fd.append("file", rec, "photo.jpg");
    await inatFetch("/observation_photos", { method: "POST", body: fd });
    f.inatPending.done.push(ph.key); await store.put("finds", f);
  }
  delete f.inatPending;
  return obsId;
}
function idDiffers(name, taxon, common) {
  const n = (name || "").toLowerCase();
  if (!n) return true;
  return !(n.includes(taxon.toLowerCase()) || (common && n.includes(common.toLowerCase())));
}
async function acceptID(f) {
  const r = f.idReview; if (!r) return;
  f.idHistory = [...(f.idHistory || []), { name: r.from, replacedBy: r.to, at: Date.now(), source: "iNaturalist" }];
  f.name = r.to; delete f.idReview; f.updatedAt = new Date().toISOString();
  await store.put("finds", f); await loadFinds();
}
async function keepID(f) {
  const r = f.idReview; if (!r) return;
  f.idDismissed = r.taxon; delete f.idReview; await store.put("finds", f); await loadFinds();
}
function idReviewHTML(f) {
  const r = f.idReview;
  return `<div class="panel" style="gap:8px">
    <a href="#find-${esc(f.id)}" style="color:var(--fg);text-decoration:none;font-weight:700">${esc(fmtDate(f.foundAt))} · ${f.type === "plant" ? "Plant" : "Mushroom"} ›</a>
    <div class="facts" style="grid-template-columns:1fr 1fr">
      <div class="fact"><span class="eyebrow">Your ID now</span><span class="v">${esc(r.from || "Not named")}</span></div>
      <div class="fact"><span class="eyebrow">iNaturalist suggests</span><span class="v" style="color:var(--plant)">${esc(r.to)}</span></div>
    </div>
    <p class="hint" style="margin:0">${esc(inatQualityLabel(r.quality))}. ${r.agree} of ${r.idCount} ${r.idCount === 1 ? "identifier agrees" : "identifiers agree"}.</p>
    <div class="btn-row"><button class="btn small plant" type="button" data-acc="${esc(f.id)}">Use the new ID</button><button class="btn small ghost" type="button" data-keep="${esc(f.id)}">Keep mine</button></div>
  </div>`;
}
function wireIdReview(root, after) {
  $$("[data-acc]", root).forEach(b => b.addEventListener("click", async () => { const f = finds.find(x => x.id === b.dataset.acc); if (f) { await acceptID(f); toast("ID updated. The old one is kept in its history."); after(); } }));
  $$("[data-keep]", root).forEach(b => b.addEventListener("click", async () => { const f = finds.find(x => x.id === b.dataset.keep); if (f) { await keepID(f); toast("Kept your ID"); after(); } }));
}
function renderReview() {
  setChrome({ title: "Review ID changes", back: true });
  const list = finds.filter(f => f.idReview);
  main.innerHTML = `<div class="wrap view">
    <p class="hint">When experts on iNaturalist settle on a different ID from yours, it waits here. Nothing changes until you choose. Even a confirmed ID doesn't make anything safe to eat.</p>
    ${list.length ? list.map(idReviewHTML).join("") : `<div class="empty"><h2>Nothing to review</h2><p>New suggestions from iNaturalist show up here.</p></div>`}
  </div>`;
  wireIdReview(main, renderReview);
}
async function inatSyncOne(f) {
  const j = await inatFetch(`/observations/${f.inat.id}`);
  const o = j.results && j.results[0];
  if (!o) return;
  const t = o.community_taxon || o.taxon;
  const ids = (o.identifications || []).filter(i => i.current);
  const agree = t ? ids.filter(i => i.taxon && (i.taxon.id === t.id || (i.taxon.ancestor_ids || []).includes(t.id))).length : 0;
  f.inat = { ...f.inat, quality: o.quality_grade, taxon: t ? t.name : "", common: t ? (t.preferred_common_name || "") : "", rank: t ? t.rank : "", idCount: ids.length, agree, syncedAt: Date.now(), url: `${INAT}/observations/${f.inat.id}` };
  // Never rename a find here. A different ID goes to the review list for Henry to confirm.
  if (t && ids.length && idDiffers(f.name, t.name, f.inat.common) && f.idDismissed !== t.name) {
    f.idReview = { from: f.name || "", to: f.inat.common ? `${f.inat.common}, ${t.name}` : t.name, taxon: t.name, quality: o.quality_grade, agree, idCount: ids.length, at: Date.now() };
  } else if (!t || !idDiffers(f.name, t.name, f.inat.common)) delete f.idReview;
  await store.put("finds", f);
}
async function inatProcess() {
  if (inatBusy || !netOK() || !inat.connected()) return;
  inatBusy = true;
  let up = 0, changed = 0, expired = false;
  try {
    const dupIds = lsGet("inatDups", {});
    for (const f of finds.filter(x => x.inatQueued && !(x.inat && x.inat.id) && !dupIds[x.id] && x.lat != null && !x.sample && !x.sharedFrom)) {
      try { const id = await inatUpload(f); f.inat = { id, url: `${INAT}/observations/${id}`, uploadedAt: Date.now(), quality: "needs_id" }; delete f.inatQueued; await store.put("finds", f); up++; }
      catch (e) { if (e.message === "token_expired") { expired = true; break; } }
    }
    if (!expired) for (const f of finds.filter(x => x.inat && x.inat.id && (!x.inat.syncedAt || Date.now() - x.inat.syncedAt > 3 * 3600000))) {
      const before = f.inat.quality + f.inat.taxon;
      try { await inatSyncOne(f); if (f.inat.quality + f.inat.taxon !== before) changed++; } catch (e) { if (e.message === "token_expired") { expired = true; break; } }
    }
  } finally { inatBusy = false; }
  if (up) toast(`Uploaded ${up} ${up === 1 ? "find" : "finds"} to iNaturalist`);
  const nRev = finds.filter(f => f.idReview).length;
  if (changed) toast(nRev ? `${nRev} ID ${nRev === 1 ? "change" : "changes"} to review` : `iNaturalist updated ${changed} ${changed === 1 ? "find" : "finds"}`);
  if (expired) lsSet("inatExpired", true); else lsSet("inatExpired", false);
  if (up || changed) { await loadFinds(); if ((location.hash || "#log").startsWith("#find-") || location.hash === "#log" || !location.hash) route(); }
}
window.addEventListener("online", () => inatProcess());
const inatQualityLabel = q => ({ research: "Research grade: confirmed by the community", needs_id: "Needs ID: waiting for experts", casual: "Casual: missing details, so experts may not review it" }[q] || "Uploaded");

/* ============================================================
   Trails: record the walking route while foraging.
   ============================================================ */
let activeTrail = lsGet("trailLive", null);   // {id, start, points: [[lat, lng, ts]]}
let trailWatch = null, wakeLock = null;
const trailListeners = new Set();
function trailKm(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += haversine({ lat: pts[i-1][0], lng: pts[i-1][1] }, { lat: pts[i][0], lng: pts[i][1] }); return d; }
function fmtDur(ms) { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; }
async function holdScreen() { try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && activeTrail && !settings.camp && !NATIVE) holdScreen(); });
let trailTimer = null;
const TRAIL_RATES = [[30, "Every 30 seconds"], [60, "Every minute"], [120, "Every 2 minutes"], [180, "Every 3 minutes"], [240, "Every 4 minutes"], [300, "Every 5 minutes"]];
const trailRate = () => lsGet("trailRate", 120);
// GPS stays off between fixes, so a longer gap means much less battery.
function trailBatteryText(sec) {
  if (NATIVE) return sec <= 30 ? "Roughly 3 to 5% battery an hour with the screen off." : sec <= 60 ? "Roughly 2 to 4% an hour with the screen off." : sec <= 180 ? "Roughly 1 to 3% an hour with the screen off." : "Roughly 1 to 2% an hour with the screen off.";
  return sec <= 30 ? "Roughly 6 to 10% battery an hour with the screen on." : sec <= 60 ? "Roughly 5 to 8% an hour with the screen on." : sec <= 180 ? "Roughly 4 to 6% an hour with the screen on." : "Roughly 3 to 5% an hour with the screen on.";
}
function addTrailFix(lat, lng, accuracy, altitude, ts, quiet) {
  if (!activeTrail) return;
  lastLoc = { lat, lng, acc: Math.round(accuracy), alt: altitude != null ? Math.round(altitude) : null, ts }; lsSet("lastLoc", lastLoc);
  if (accuracy > 60 || ts < activeTrail.start) return;
  const pts = activeTrail.points, prev = pts[pts.length - 1];
  const alt = altitude != null ? Math.round(altitude) : null;
  activeTrail.lastFix = Math.max(activeTrail.lastFix || 0, ts);
  if (!(prev && (ts <= prev[2] || haversine({ lat: prev[0], lng: prev[1] }, { lat, lng }) < 0.006))) pts.push([+lat.toFixed(6), +lng.toFixed(6), ts, alt]);
  if (!quiet) { lsSet("trailLive", activeTrail); trailListeners.forEach(fn => fn()); }
}
// Collects the fixes the Android app recorded while the screen was off.
async function drainNativeTrail() {
  if (!NATIVE) return;
  try {
    const r = await nat("drain");
    const list = (r && r.points) || [];
    list.forEach(p => addTrailFix(p.lat, p.lng, p.acc, p.alt, p.t, true));
    if (activeTrail && (list.length || true)) { lsSet("trailLive", activeTrail); trailListeners.forEach(fn => fn()); }
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && activeTrail) drainNativeTrail(); });
function watchTrail() {
  if (!geoAvailable() || trailWatch != null || trailTimer != null) return;
  if (NATIVE) {
    nat("start", { interval: trailRate() }).catch(e => toast((e && e.message) || "Couldn't start GPS tracking."));
    drainNativeTrail(); trailTimer = setInterval(drainNativeTrail, 15000);
    return;
  }
  const onFix = p => { const { latitude, longitude, accuracy, altitude } = p.coords; addTrailFix(latitude, longitude, accuracy, altitude, Date.now()); };
  const once = () => navigator.geolocation.getCurrentPosition(onFix, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  once(); trailTimer = setInterval(once, trailRate() * 1000);
  if (!settings.camp) holdScreen();
}
function restartTrailWatch() { if (!activeTrail) return; if (NATIVE) nat("stop").catch(() => {}); if (trailWatch != null) { navigator.geolocation.clearWatch(trailWatch); trailWatch = null; } if (trailTimer != null) { clearInterval(trailTimer); trailTimer = null; } try { if (wakeLock) wakeLock.release(); } catch (e) {} watchTrail(); }
// Distance, elevation gain and loss, moving time and pace, like a fitness app.
function trailStats(t) {
  const pts = t.points || [];
  const km = trailKm(pts);
  let up = 0, down = 0, moving = 0, ref = null;
  const alts = pts.map(p => p[3]).filter(a => a != null);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i][3];
    // Only count climbs over 4 m, so GPS height wobble doesn't add up.
    if (a != null) { if (ref == null) ref = a; else if (a - ref >= 4) { up += a - ref; ref = a; } else if (ref - a >= 4) { down += ref - a; ref = a; } }
    if (i) { const d = haversine({ lat: pts[i-1][0], lng: pts[i-1][1] }, { lat: pts[i][0], lng: pts[i][1] }), dt = pts[i][2] - pts[i-1][2]; if (d / (dt / 3600000) > 0.8) moving += dt; }
  }
  const total = (t.end || t.lastFix || Date.now()) - t.start;
  return { km, up: Math.round(up), down: Math.round(down), moving, total, pace: km > 0.05 && moving ? moving / 60000 / km : null, hi: alts.length ? Math.max(...alts) : null, lo: alts.length ? Math.min(...alts) : null, n: pts.length };
}
function fmtPace(minPerKm) { if (minPerKm == null) return "—"; const v = settings.units === "in" ? minPerKm * 1.609 : minPerKm; const m = Math.floor(v), s2 = Math.round((v - m) * 60); return `${m}:${String(s2 === 60 ? 0 : s2).padStart(2, "0")}${settings.units === "in" ? " /mi" : " /km"}`; }
function fmtElev(m) { return m == null ? "—" : settings.units === "in" ? `${Math.round(m * 3.281)} ft` : `${m} m`; }
function elevProfileSVG(t) {
  const pts = (t.points || []).filter(p => p[3] != null);
  if (pts.length < 3) return `<p class="hint" style="margin:0">The elevation profile appears after a few GPS fixes with height.</p>`;
  let d = 0; const xs = [0];
  for (let i = 1; i < pts.length; i++) { d += haversine({ lat: pts[i-1][0], lng: pts[i-1][1] }, { lat: pts[i][0], lng: pts[i][1] }); xs.push(d); }
  const lo = Math.min(...pts.map(p => p[3])), hi = Math.max(...pts.map(p => p[3])), span = Math.max(10, hi - lo), W = 320, H = 90;
  const path = pts.map((p, i) => `${(xs[i] / (d || 1) * W).toFixed(1)},${(H - 6 - (p[3] - lo) / span * (H - 16)).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Elevation profile from ${fmtElev(lo)} to ${fmtElev(hi)}" style="display:block"><polygon points="0,${H} ${path} ${W},${H}" fill="color-mix(in srgb, var(--plant) 22%, transparent)"/><polyline points="${path}" fill="none" stroke="var(--plant)" stroke-width="2" stroke-linejoin="round"/><text x="4" y="12" fill="var(--muted)" font-size="11">${fmtElev(hi)}</text><text x="4" y="${H - 4}" fill="var(--muted)" font-size="11">${fmtElev(lo)}</text><text x="${W - 4}" y="${H - 4}" fill="var(--muted)" font-size="11" text-anchor="end">${esc(fmtDist(d))}</text></svg>`;
}
// Battery: sample the phone's level while a hike records, and project time left from the recent drain.
let battery = null, battLog = lsGet("battLog", []);
if (navigator.getBattery) navigator.getBattery().then(b => { battery = b; b.addEventListener("levelchange", logBattery); b.addEventListener("chargingchange", () => { battLog = []; lsSet("battLog", battLog); }); }).catch(() => {});
function logBattery() {
  if (!battery || !activeTrail || battery.charging) return;
  battLog.push([Date.now(), battery.level]);
  battLog = battLog.filter(x => Date.now() - x[0] < 90 * 60000);
  lsSet("battLog", battLog);
}
function batteryHTML() {
  if (!battery) return "";
  const pct = Math.round(battery.level * 100);
  if (battery.charging) return `<p class="hint num" style="margin:0">Battery ${pct}%, charging.</p>`;
  const log = battLog.filter(x => activeTrail && x[0] >= activeTrail.start);
  const first = log[0], last = [Date.now(), battery.level];
  const mins = first ? (last[0] - first[0]) / 60000 : 0, used = first ? first[1] - last[1] : 0;
  if (!first || mins < 15 || used < 0.02) return `<p class="hint num" style="margin:0">Battery ${pct}%. A time-left estimate appears after about 15 minutes of recording.</p>`;
  const perHour = used / mins * 60, hrs = battery.level / perHour;
  return `<p class="num" style="margin:0"><b>Battery ${pct}%</b>, about ${hrs >= 1 ? `${Math.floor(hrs)} h ${Math.round((hrs % 1) * 60)} min` : `${Math.round(hrs * 60)} min`} left at this rate <span class="hint">(estimate: ${Math.round(perHour * 100)}% an hour for the whole phone)</span></p>`;
}
function trailStatsHTML(t) {
  const st = trailStats(t);
  return `<div class="facts" style="grid-template-columns:repeat(3,1fr)">
    <div class="fact"><span class="eyebrow">Distance</span><span class="v num">${esc(fmtDist(st.km))}</span></div>
    <div class="fact"><span class="eyebrow">Climb</span><span class="v num">${esc(fmtElev(st.up))}</span></div>
    <div class="fact"><span class="eyebrow">Descent</span><span class="v num">${esc(fmtElev(st.down))}</span></div>
    <div class="fact"><span class="eyebrow">Moving</span><span class="v num">${esc(fmtDur(st.moving))}</span></div>
    <div class="fact"><span class="eyebrow">Total time</span><span class="v num">${esc(fmtDur(st.total))}</span></div>
    <div class="fact"><span class="eyebrow">Pace</span><span class="v num">${esc(fmtPace(st.pace))}</span></div>
  </div>${elevProfileSVG(t)}`;
}
function startTrail() {
  battLog = []; lsSet("battLog", battLog); setTimeout(logBattery, 2000);
  activeTrail = { id: "t-" + uid(), start: Date.now(), points: [] };
  lsSet("trailLive", activeTrail);
  watchTrail();
}
async function stopTrail() {
  if (NATIVE) { await drainNativeTrail(); await nat("stop").catch(() => {}); await drainNativeTrail(); }
  if (trailWatch != null) { navigator.geolocation.clearWatch(trailWatch); trailWatch = null; }
  if (trailTimer != null) { clearInterval(trailTimer); trailTimer = null; }
  try { if (wakeLock) await wakeLock.release(); } catch (e) {}
  const t = activeTrail; activeTrail = null; lsSet("trailLive", null);
  if (t && t.points.length >= 2) { const done = { ...t, end: Date.now() }; const st = trailStats(done); await store.put("trails", { ...done, km: st.km, up: st.up, down: st.down, moving: st.moving, tripId: activeTripId() || undefined }); return true; }
  return false;
}

/* ============================================================
   Map tab: every find, plus saving an area for offline use
   ============================================================ */
async function renderMap() {
  setChrome({ title: "Map", tab: "map" });
  const tileCount = await store.count("tiles").catch(() => 0);
  const shown = { mushroom: true, plant: true };
  main.innerHTML = `<div class="wrap view">
    <div class="legend" style="justify-content:space-between"><span style="gap:14px;display:inline-flex;flex-wrap:wrap">
      <button type="button" class="chip" data-k="mushroom" aria-pressed="true"><span class="dot mushroom"></span>Mushrooms</button>
      <button type="button" class="chip" data-k="plant" aria-pressed="true"><span class="dot plant"></span>Plants</button>
      <button type="button" class="chip" id="heatBtn" aria-pressed="${lsGet("heat", false)}">Hotspots</button></span></div>
    <div class="map-full" id="bigMap"></div>
    <div class="panel" id="trailPanel"></div>
    <div class="panel">
      <h3>Offline map</h3>
      <p id="offMsg">While you have signal, move the map to the area you forage in, pick Street or Topo (and Hiking trails if you want them) with the layers button, then save it. It will load with no signal later. <span class="num">${tileCount}</span> map tiles are saved on this phone.</p>
      <div class="progress" id="prog" hidden><i></i></div>
      <div class="btn-row"><button class="btn plant" type="button" id="drawBtn"><svg><use href="#i-edit"/></svg>Draw an area</button><button class="btn" type="button" id="dlBtn"><svg><use href="#i-down"/></svg><span>Save what's on screen</span></button><button class="btn ghost" type="button" id="meBtn"><svg><use href="#i-gps"/></svg>Find me</button></div>
      <div id="drawBox" class="settings-list" hidden></div>
    </div>
  </div>`;
  const m = makeMap($("#bigMap"), defaultCenter(), lastLoc ? 13 : (finds.some(f => f.lat != null) ? 12 : 6));
  if (!m) return;
  const layers = { mushroom: L.layerGroup().addTo(m), plant: L.layerGroup().addTo(m) };
  const pts = [];
  for (const f of finds) {
    if (f.lat == null) continue;
    pts.push([f.lat, f.lng]);
    const mk = L.marker([f.lat, f.lng], { icon: pinIcon(f.type) }).addTo(layers[f.type]);
    const pop = document.createElement("div");
    const a = document.createElement("a"); a.href = "#find-" + f.id; a.style.cssText = "color:var(--fg);font-weight:700";
    a.textContent = f.name || "Not yet identified";
    const s = document.createElement("div"); s.style.cssText = "color:var(--muted);font-size:13px"; s.textContent = fmtDate(f.foundAt);
    pop.append(a, s); mk.bindPopup(pop);
  }
  // Hotspots: a heatmap of where finds cluster.
  let heat = null;
  const drawHeat = () => {
    if (heat) { heat.remove(); heat = null; }
    if (!lsGet("heat", false) || !L.heatLayer) return;
    const hp = finds.filter(f => f.lat != null && shown[f.type]).map(f => [f.lat, f.lng, 1]);
    heat = L.heatLayer(hp, { radius: 28, blur: 22, maxZoom: 15, minOpacity: 0.3, gradient: { 0.2: "#1f4f45", 0.45: "#2fa58a", 0.7: "#9ed9b8", 1: "#ede6d8" } }).addTo(m);
  };
  drawHeat();
  $("#heatBtn").addEventListener("click", e => { e.stopPropagation(); const on = !lsGet("heat", false); lsSet("heat", on); $("#heatBtn").setAttribute("aria-pressed", on); drawHeat(); });
  $$(".legend .chip[data-k]").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.k; shown[k] = !shown[k]; b.setAttribute("aria-pressed", shown[k]);
    shown[k] ? layers[k].addTo(m) : layers[k].remove();
    drawHeat();
  }));
  // Trails
  const css = getComputedStyle(document.documentElement);
  const trailLayer = L.layerGroup().addTo(m);
  const saved = ((await store.all("trails").catch(() => [])) || []).sort((x, y) => y.start - x.start);
  const hiddenTrails = new Set(lsGet("hiddenTrails", []));
  let livePath = null, armDelete = null;
  function drawTrails() {
    trailLayer.clearLayers(); livePath = null;
    for (const t of saved) if (!hiddenTrails.has(t.id)) L.polyline(t.points.map(p => [p[0], p[1]]), { color: css.getPropertyValue("--plant").trim(), weight: 3, opacity: 0.75, dashArray: "6 6" }).addTo(trailLayer);
    if (activeTrail && activeTrail.points.length) livePath = L.polyline(activeTrail.points.map(p => [p[0], p[1]]), { color: css.getPropertyValue("--shroom").trim(), weight: 4 }).addTo(trailLayer);
  }
  function drawTrailPanel() {
    const tp = $("#trailPanel"); if (!tp) return;
    if (activeTrail) {
      const km = trailKm(activeTrail.points);
      tp.innerHTML = `<h3>Recording a hike</h3>${trailStatsHTML(activeTrail)}${batteryHTML()}<p class="hint num" style="margin:0">GPS checks ${esc(TRAIL_RATES.find(r => r[0] === trailRate())[1].toLowerCase())}${activeTrail.lastFix ? `, last ${esc(ago(activeTrail.lastFix))}` : ""}. ${esc(trailBatteryText(trailRate()))}</p>${sunsetHTML()}<p class="hint" style="margin:0">${NATIVE ? "You can lock the phone: it keeps recording, and a notification shows while it does." : settings.camp ? "Camping mode: the screen can turn off, but the web version only records while the app is open." : "The screen stays on while recording. The web version can't track while the phone is locked; the Android app will."}</p><div class="btn-row"><button class="btn primary" type="button" id="trailStop">Stop and save trail</button></div>`;
      $("#trailStop").addEventListener("click", async () => { const ok = await stopTrail(); toast(ok ? "Trail saved" : "Trail too short to save"); renderMap(); });
    } else {
      tp.innerHTML = `<h3>Hikes</h3><p>Record your route with distance, climb, moving time, pace and an elevation profile. Finds you log while recording are linked to it.</p>
        <div class="field"><label for="trailRate">Check GPS</label><select id="trailRate">${TRAIL_RATES.map(([v, l]) => `<option value="${v}" ${trailRate() === v ? "selected" : ""}>${l}</option>`).join("")}</select><span class="hint"><span id="rateHint">${esc(trailBatteryText(trailRate()))}</span> GPS is off between checks. Longer gaps cut corners on winding trails, so distance and climb read a little low.</span></div>
        <div class="btn-row"><button class="btn plant" type="button" id="trailStart"${geoAvailable() ? "" : " disabled"}><svg><use href="#i-gps"/></svg>Start recording</button></div>
        ${saved.length ? `<a href="#hikes" class="btn small ghost" style="align-self:flex-start">All ${saved.length} saved ${saved.length === 1 ? "hike" : "hikes"} ›</a>` : ""}${saved.length ? `<div class="settings-list">${saved.slice(0, 10).map(t => `<div class="switch" style="font-size:15px"><span class="num"><b>${esc(fmtDate(new Date(t.start).toISOString(), { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}</b><br><span class="hint">${esc(fmtDist(t.km || 0))} · ${esc(fmtDur((t.end || t.start) - t.start))}${t.up != null ? ` · ${esc(fmtElev(t.up))} climb` : ""}</span><br><a href="#hike-${esc(t.id)}" style="color:var(--plant);font-weight:700;text-decoration:none">Route and full stats ›</a></span><span style="display:flex;gap:6px;align-items:center"><button type="button" class="btn small ghost" data-del="${esc(t.id)}">${armDelete === t.id ? "Tap to delete" : "Delete"}</button><input type="checkbox" data-show="${esc(t.id)}" ${hiddenTrails.has(t.id) ? "" : "checked"} aria-label="Show on map"></span></div>`).join("")}</div>` : ""}`;
      const tr = $("#trailRate"); if (tr) tr.addEventListener("change", () => { lsSet("trailRate", +tr.value); $("#rateHint").textContent = trailBatteryText(+tr.value); });
      const st = $("#trailStart");
      if (st) st.addEventListener("click", () => { startTrail(); toast("Recording your trail"); setChrome({ title: "Map", tab: "map" }); drawTrailPanel(); drawTrails(); });
      $$("[data-show]", tp).forEach(c => c.addEventListener("change", () => { if (c.checked) hiddenTrails.delete(c.dataset.show); else hiddenTrails.add(c.dataset.show); lsSet("hiddenTrails", [...hiddenTrails]); drawTrails(); }));
      $$("[data-del]", tp).forEach(b => b.addEventListener("click", async () => {
        const id = b.dataset.del;
        if (armDelete !== id) { armDelete = id; drawTrailPanel(); return; }
        await store.del("trails", id); saved.splice(saved.findIndex(t => t.id === id), 1); armDelete = null; drawTrails(); drawTrailPanel(); toast("Trail deleted");
      }));
    }
  }
  drawTrails(); drawTrailPanel();
  const onPoint = () => {
    if (!document.body.contains($("#trailPanel"))) { trailListeners.delete(onPoint); return; }
    if (livePath && activeTrail) livePath.setLatLngs(activeTrail.points.map(p => [p[0], p[1]])); else drawTrails();
    drawTrailPanel(); showMe();
  };
  trailListeners.add(onPoint);
  const tick = setInterval(() => { if (!document.body.contains($("#trailPanel"))) { clearInterval(tick); return; } if (activeTrail && document.visibilityState === "visible") drawTrailPanel(); }, 60000);

  let meMarker = null;
  const showMe = () => { if (!lastLoc) return; if (meMarker) meMarker.setLatLng([lastLoc.lat, lastLoc.lng]); else meMarker = L.marker([lastLoc.lat, lastLoc.lng], { icon: pinIcon("me"), interactive: false }).addTo(m); };
  showMe();
  if (pts.length > 1 && !lastLoc) m.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
  $("#meBtn").addEventListener("click", async () => {
    try { await getPosition(); showMe(); m.setView([lastLoc.lat, lastLoc.lng], 14); } catch (e) { toast("Location isn't available here"); }
  });
  // Draw a box on the map, then pick detail and layers, with a size estimate before downloading.
  const TILE_KB = { osm: 18, topo: 32, hike: 6 };
  let rect = null;
  $("#drawBtn").addEventListener("click", () => {
    if (!netOK()) { toast(settings.camp ? "Turn off camping mode to download maps" : "Downloading maps needs signal"); return; }
    const box = $("#drawBox"); box.hidden = false;
    box.innerHTML = `<p class="banner"><b>Drag a box over the area on the map.</b></p><div class="btn-row"><button class="btn small ghost" type="button" id="drawCancel">Cancel</button></div>`;
    const el = $("#bigMap"); el.scrollIntoView({ block: "center" });
    m.dragging.disable(); if (m.tap) m.tap.disable(); el.style.touchAction = "none"; el.style.cursor = "crosshair";
    let a = null;
    const ll = ev => m.mouseEventToLatLng(ev);
    const down = ev => { a = ll(ev); if (rect) rect.remove(); rect = L.rectangle([a, a], { color: "#e9a75e", weight: 2, fillOpacity: 0.12 }).addTo(m); ev.preventDefault(); };
    const move = ev => { if (a) rect.setBounds(L.latLngBounds(a, ll(ev))); };
    const up = () => { if (!a) return; a = null; finish(); };
    const off = () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); m.dragging.enable(); if (m.tap) m.tap.enable(); el.style.touchAction = ""; el.style.cursor = ""; };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    $("#drawCancel").addEventListener("click", () => { off(); if (rect) { rect.remove(); rect = null; } box.hidden = true; });
    function finish() {
      off();
      const b = rect.getBounds();
      if (b.getNorthEast().distanceTo(b.getSouthWest()) < 200) { toast("Drag a bigger box"); rect.remove(); rect = null; box.hidden = true; return; }
      m.fitBounds(b, { padding: [20, 20] });
      const ids0 = m._layerIds();
      box.innerHTML = `<div class="field"><label for="dlZoom">Detail</label><select id="dlZoom"><option value="13">Overview: lakes, roads and big trails</option><option value="15" selected>Trails and clearings</option><option value="16">Street level</option><option value="17">Most detail</option></select></div>
        <div class="chips" role="group" aria-label="Layers">${["osm", "topo", "hike"].map(id => `<label class="chip" style="gap:6px"><input type="checkbox" data-lay="${id}" ${ids0.includes(id) ? "checked" : ""}> ${id === "osm" ? "Street" : id === "topo" ? "Topo" : "Hiking trails"}</label>`).join("")}</div>
        <p class="num" id="dlEst" style="font-weight:700"></p>
        <div class="btn-row"><button class="btn plant" type="button" id="dlGo"><svg><use href="#i-down"/></svg><span>Download</span></button><button class="btn ghost" type="button" id="dlCancel">Cancel</button></div>`;
      const plan = () => {
        const zMax = +$("#dlZoom").value, lays = $$("[data-lay]", box).filter(c => c.checked).map(c => c.dataset.lay);
        const list = lays.flatMap(id => tilesFor(b, 8, Math.min(zMax, TILE_LAYERS[id].max)).map(t => [id, ...t]));
        const mb = list.reduce((acc, t) => acc + TILE_KB[t[0]], 0) / 1024;
        return { list, mb, lays };
      };
      const est = () => {
        const { list, mb, lays } = plan();
        $("#dlEst").textContent = !lays.length ? "Pick at least one layer." : `About ${list.length.toLocaleString()} tiles, roughly ${mb < 1 ? "under 1" : Math.round(mb)} MB. ${list.length > 25000 ? "That's too big: pick less detail or a smaller box." : `Takes about ${Math.max(1, Math.round(list.length / 25 / 60))} min on good signal.`}`;
        $("#dlGo").disabled = !lays.length || list.length > 25000;
      };
      est();
      $("#dlZoom").addEventListener("change", est); $$("[data-lay]", box).forEach(c => c.addEventListener("change", est));
      $("#dlCancel").addEventListener("click", () => { if (downloading) { downloading = false; return; } rect.remove(); rect = null; box.hidden = true; });
      $("#dlGo").addEventListener("click", async () => {
        const { list } = plan();
        const prog = $("#prog"), bar = prog.firstElementChild; prog.hidden = false; $("#dlGo").disabled = true; $("#dlCancel").textContent = "Stop";
        const { done, failed } = await downloadTiles(list, d => { bar.style.width = (d / list.length * 100) + "%"; $("#offMsg").textContent = `Saving map tiles: ${d.toLocaleString()} of ${list.length.toLocaleString()}`; });
        const total = await store.count("tiles").catch(() => 0);
        $("#offMsg").textContent = done && failed === done ? "The map couldn't be downloaded. Check you have signal and try again." : `Saved the area. ${total.toLocaleString()} map tiles are now on this phone${failed ? `, and ${failed} couldn't be downloaded` : ""}.`;
        if (rect) { rect.remove(); rect = null; } box.hidden = true;
      });
    }
  });
  $("#dlBtn").addEventListener("click", async () => {
    if (!netOK()) { toast(settings.camp ? "Turn off camping mode to download maps" : "Downloading maps needs signal"); return; }
    const label = $("#dlBtn span");
    if (downloading) { downloading = false; return; }
    const z = m.getZoom();
    if (z < 10) { toast("Zoom in closer first, to a few kilometres across"); return; }
    const ids = m._layerIds();
    const build = zMax => ids.flatMap(id => tilesFor(m.getBounds(), Math.max(8, z - 2), Math.min(zMax, TILE_LAYERS[id].max)).map(t => [id, ...t]));
    let zMax = Math.min(17, z + 3), list = build(zMax);
    while (list.length > MAX_TILES * ids.length && zMax > z) { zMax--; list = build(zMax); }
    if (list.length > MAX_TILES * ids.length) { toast("That area is too big. Zoom in a little."); return; }
    const prog = $("#prog"), bar = prog.firstElementChild;
    prog.hidden = false; label.textContent = "Stop";
    const { done, failed } = await downloadTiles(list, d => { bar.style.width = (d / list.length * 100) + "%"; $("#offMsg").textContent = `Saving map tiles: ${d} of ${list.length}`; });
    label.textContent = "Save what's on screen";
    const total = await store.count("tiles").catch(() => 0);
    $("#offMsg").textContent = done && failed === done
      ? "The map couldn't be downloaded. Check you have signal and try again."
      : `Saved this area (${ids.map(id => TILE_LAYERS[id].name.toLowerCase()).join(" and ")} map) down to street level. ${total} map tiles are now on this phone${failed ? `, and ${failed} couldn't be downloaded` : ""}.`;
  });
}


/* ============================================================
   In season: edibles likely to be found in an area in a given month.
   Bundled months work offline; iNaturalist records refine them online.
   ============================================================ */
let edView = { month: new Date().getMonth() + 1, kind: lsGet("edKind", "all"), q: "", place: lsGet("edPlace", null), radius: lsGet("edRadius", 50), useArea: lsGet("edUseArea", true) };
const ED_RADII = [5, 10, 25, 50, 100, 150];
// A searched place uses its own boundary unless a radius is picked; "Near you" always uses a radius.
function edUsesBoundary(place) { return !!(place && place.placeId && edView.useArea); }   // place: {name, lat, lng, placeId?}
const MONTHS3 = MONTHS.map(m => m.slice(0, 3));
function regionFor(lng) { return lng == null ? lsGet("edRegion", "na") : lng < -30 ? "na" : "eu"; }
async function inatPublic(path) {
  const r = await fetch(INAT_API + path);
  if (!r.ok) throw new Error("inat " + r.status);
  return r.json();
}
// Each entry: {id, photo, big, attr, url} from iNaturalist, or null when not found.
async function taxonIds(list) {
  const cache = lsGet("taxa2", {});
  for (const e of list) {
    if (cache[e.latin] !== undefined) continue;
    try {
      const j = await inatPublic(`/taxa?q=${encodeURIComponent(e.latin)}&is_active=true&per_page=5`);
      const hit = (j.results || []).find(t => t.name.toLowerCase() === e.latin.toLowerCase()) || (j.results || [])[0];
      const ph = hit && hit.default_photo;
      cache[e.latin] = hit ? { id: hit.id, photo: ph ? ph.square_url.replace("/square.", "/small.") : null, big: ph ? ph.medium_url : null, attr: ph ? ph.attribution : "", url: `https://www.inaturalist.org/taxa/${hit.id}` } : null;
      lsSet("taxa2", cache);
    } catch (err) { break; }
    await new Promise(r => setTimeout(r, 250));
  }
  return cache;
}
async function areaCounts(place, onProgress) {
  const boundary = edUsesBoundary(place);
  const key = (boundary ? "p" + place.placeId : `${place.lat.toFixed(1)},${place.lng.toFixed(1)},r${edView.radius}`) + "/n" + EDIBLES.length;
  const all = lsGet("edCounts", {});
  if (all[key] && Date.now() - all[key].ts < 14 * DAY) return all[key].counts;
  onProgress && onProgress("Looking up species on iNaturalist…");
  const ids = await taxonIds(EDIBLES);
  const byId = {};
  EDIBLES.forEach(e => { const t = ids[e.latin]; if (t && t.id) byId[t.id] = e.id; });
  const idList = Object.keys(byId);
  if (!idList.length) throw new Error("no taxa");
  const where = boundary ? `place_id=${place.placeId}` : `lat=${place.lat.toFixed(3)}&lng=${place.lng.toFixed(3)}&radius=${edView.radius}`;
  const counts = {};
  EDIBLES.forEach(e => counts[e.id] = Array(12).fill(0));
  for (let m = 1; m <= 12; m++) {
    onProgress && onProgress(`Checking records for ${MONTHS[m - 1]}…`);
    const j = await inatPublic(`/observations/species_counts?${where}&month=${m}&quality_grade=research&per_page=200&taxon_id=${idList.join(",")}`);
    for (const r of j.results || []) {
      // species_counts reports species. Roll each up to the entry it belongs to, genus entries included.
      const t = r.taxon || {};
      const anc = [t.id, ...(t.ancestor_ids || [])];
      for (const tid of anc) if (byId[tid]) { counts[byId[tid]][m - 1] += r.count; break; }
    }
    await new Promise(r => setTimeout(r, 300));
  }
  all[key] = { ts: Date.now(), counts };
  // Keep the cache small.
  const keys = Object.keys(all).sort((x, y) => all[y].ts - all[x].ts).slice(0, 8);
  lsSet("edCounts", Object.fromEntries(keys.map(k => [k, all[k]])));
  return counts;
}
let edWeather = lsGet("edWeather", null);
async function areaWeather(place) {
  if (edWeather && edWeather.key === `${place.lat.toFixed(1)},${place.lng.toFixed(1)}` && Date.now() - edWeather.ts < 3 * 3600000) return edWeather;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat.toFixed(3)}&longitude=${place.lng.toFixed(3)}&daily=precipitation_sum,temperature_2m_mean&past_days=7&forecast_days=1&timezone=auto`);
  if (!r.ok) throw new Error("weather");
  const j = await r.json();
  const rain = j.daily.precipitation_sum.slice(0, 7).reduce((s, x) => s + (x || 0), 0);
  const t = j.daily.temperature_2m_mean.slice(0, 7).filter(x => x != null);
  edWeather = { key: `${place.lat.toFixed(1)},${place.lng.toFixed(1)}`, ts: Date.now(), rain: +rain.toFixed(1), temp: Math.round(t.reduce((s, x) => s + x, 0) / (t.length || 1)) };
  lsSet("edWeather", edWeather);
  return edWeather;
}
function edPlace() {
  if (edView.place) return edView.place;
  if (lastLoc) return { name: "Near you", lat: lastLoc.lat, lng: lastLoc.lng, near: true };
  return null;
}
const ED_LEVELS = ["No records", "Possible", "Common", "Peak"];
function edLevel(v) { return v >= 0.6 ? 3 : v >= 0.25 ? 2 : v > 0 ? 1 : 0; }
// Plants get their own fixed ramp: dark moss, leaf green, bright lime, so each step reads apart.
const PLANT_RAMP = ["var(--surface-2)", "#3d6b3a", "#6fbf4a", "#d6f56b"];
function edSwatch(L, col) { if (col === "var(--chart-plant)") return PLANT_RAMP[L]; return [ "var(--surface-2)", `color-mix(in srgb, ${col} 35%, var(--surface))`, `color-mix(in srgb, ${col} 65%, var(--surface))`, col ][L]; }
function monthRanges(idx) {
  if (!idx.length) return "";
  if (idx.length === 12) return "all year";
  const set = new Set(idx), out = [];
  // Start a run at a month whose previous month is not in the set, so runs can wrap Dec to Jan.
  for (const i of idx) {
    if (set.has((i + 11) % 12)) continue;
    let j = i; while (set.has((j + 1) % 12)) j = (j + 1) % 12;
    out.push(i === j ? MONTHS3[i] : `${MONTHS3[i]}–${MONTHS3[j]}`);
  }
  return out.join(", ");
}
async function renderEdibles() {
  setChrome({ title: "In season", tab: "edibles" });
  const place = edPlace();
  main.innerHTML = `<div class="wrap view">
    ${Date.now() - lsGet("edWarnHid", 0) > 7 * DAY ? `<div class="slimwarn" id="edWarn"><svg><use href="#i-warn"/></svg><span class="grow"><b>Not permission to eat.</b> Every one has lookalikes, some deadly.</span><button type="button" class="icon-btn" id="edWarnX" aria-label="Hide for a week">×</button></div>` : ""}
    <details class="edarea" id="edArea"><summary><svg><use href="#i-gps"/></svg><span class="grow"><b>${esc(place ? place.name : "Choose an area")}</b>${place ? ` · ${edUsesBoundary(place) ? "whole area" : edView.radius + " km"}` : ""}</span><span class="hint">Change</span></summary>
    <div class="panel" style="gap:12px;margin-top:8px">
      <div class="switch" style="align-items:flex-start"><span style="min-width:0"><span class="eyebrow">Area</span><br><b id="edPlaceName" style="font-size:18px">${esc(place ? place.name : "Choose an area")}</b></span>
        ${edView.place ? `<button class="btn small ghost" type="button" id="edNear"><svg><use href="#i-gps"/></svg>Near me</button>` : ""}</div>
      <div class="search"><svg><use href="#i-search"/></svg><input type="text" id="edSearch" placeholder="Search another area, e.g. Algonquin Park" autocomplete="off" aria-label="Search for an area"></div>
      <div id="edResults" class="settings-list"></div>
      ${place ? `<div><span class="eyebrow">Search radius</span><div class="chips" id="edRadius" role="group" aria-label="Search radius" style="margin-top:6px">${place.placeId ? `<button type="button" class="chip" data-r="area" aria-pressed="${edUsesBoundary(place)}">Whole area</button>` : ""}${ED_RADII.map(r => `<button type="button" class="chip" data-r="${r}" aria-pressed="${!edUsesBoundary(place) && edView.radius === r}">${r} km</button>`).join("")}</div></div>` : ""}
    </div>
    </details>
    <div class="chips" id="edMonths" role="group" aria-label="Month" style="flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;scrollbar-width:none">${MONTHS3.map((m, i) => `<button type="button" class="chip" data-m="${i + 1}" aria-pressed="${edView.month === i + 1}" style="flex:none">${m}</button>`).join("")}</div>
    <div class="toprow"><div class="search" style="flex:1;min-width:0"><svg><use href="#i-search"/></svg><input type="text" id="edFilter" placeholder="Filter species" value="${esc(edView.q)}" autocomplete="off" aria-label="Filter species"></div>
      <div class="seg small" role="group" aria-label="Show" id="edKind">${[["all", "All"], ["mushroom", "Fungi"], ["plant", "Plants"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${edView.kind === v}">${l}</button>`).join("")}</div></div>
    <div id="edNoData"></div>
    <div class="context-note" id="edStatus"></div>
    <div class="list" id="edList" style="grid-template-columns:1fr"></div>
    <p class="hint" style="margin:0">Never eat anything based on this app. Have each find checked in person by an expert. <a href="#guides" style="color:var(--plant)">Beginner guides</a> · <a href="#pack" style="color:var(--plant)">Packing list</a></p>
  </div>`;
  { const x = $("#edWarnX"); if (x) x.addEventListener("click", () => { lsSet("edWarnHid", Date.now()); $("#edWarn").remove(); }); }
  // Open the area picker straight away if no area is known yet.
  if (!place) $("#edArea").open = true;
  let counts = null, wx = null, noData = false, taxa = lsGet("taxa2", {});
  const scope = () => edUsesBoundary(place) ? `in ${place.name}` : `within ${edView.radius} km`;
  const biggerHint = () => edUsesBoundary(place) ? "Try a radius instead of the area boundary." : edView.radius < 150 ? "Try a bigger radius." : "";
  const draw = () => {
    const region = regionFor(place ? place.lng : null);
    const m = edView.month, nowM = new Date().getMonth() + 1;
    let list = EDIBLES.filter(e => (edView.kind === "all" || e.kind === edView.kind) && (!edView.q || (e.name + " " + e.latin).toLowerCase().includes(edView.q.toLowerCase())));
    const score = e => {
      if (counts) { const c = counts[e.id] || []; const tot = c.reduce((s, x) => s + x, 0); return tot ? c[m - 1] / Math.max(...c) + (c[m - 1] ? 1 : 0) : -1; }
      return (e[region] || []).includes(m) ? 1 : (e[region] || []).length ? 0 : -1;
    };
    list = list.map(e => ({ e, s: score(e) })).sort((x, y) => y.s - x.s || x.e.name.localeCompare(y.e.name));
    const inS = list.filter(x => x.s > 0.15 || (!counts && x.s === 1));
    const rest = list.filter(x => !inS.includes(x));
    const favoured = e => e.wx && wx && m === nowM && wx.rain >= 10 && wx.temp >= e.wx[0] && wx.temp <= e.wx[1];
    const card = ({ e, s }) => {
      const c = counts && counts[e.id];
      const mx = c ? Math.max(1, ...c) : 1;
      const col = e.kind === "plant" ? "var(--chart-plant)" : "var(--chart-shroom)";
      const lv = MONTHS3.map((mm, i) => c ? edLevel(c[i] / mx) : ((e[region] || []).includes(i + 1) ? 3 : 0));
      const bars = MONTHS3.map((mm, i) => {
        const L = lv[i];
        const name = c ? ED_LEVELS[L] : (L ? "Typical season" : "Not usual");
        return `<span title="${MONTHS[i]}: ${name}${c ? " (" + c[i] + " records)" : ""}" style="display:flex;align-items:flex-end;height:26px;${i + 1 === m ? "outline:2px solid var(--fg);outline-offset:2px;border-radius:3px" : ""}"><span style="display:block;width:100%;height:${[4, 9, 17, 26][L]}px;border-radius:3px;background:${edSwatch(L, col)}"></span></span>`;
      }).join("");
      const summary = c
        ? [[3, "Peak"], [2, "Common"], [1, "Possible"]].map(([L, n]) => { const r = monthRanges(lv.map((x, i) => x === L ? i : -1).filter(i => i >= 0)); return r ? `<b>${n}:</b> ${r}` : ""; }).filter(Boolean).join(" · ")
        : (() => { const r = monthRanges(lv.map((x, i) => x ? i : -1).filter(i => i >= 0)); return r ? `<b>Typical season:</b> ${r}` : ""; })();
      const tot = c ? c.reduce((x, y) => x + y, 0) : null;
      const tx = taxa[e.latin], g = GUIDES[e.id];
      return `<div class="panel edcard" style="gap:8px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${tx && tx.photo ? `<a href="${esc(tx.url)}" target="_blank" rel="noopener" style="flex:none"><img src="${esc(tx.photo)}" alt="${esc(e.name)}" loading="lazy" title="${esc(tx.attr)}, via iNaturalist" style="width:76px;height:76px;object-fit:cover;border-radius:12px;background:var(--surface-2);display:block" onerror="this.closest('a').remove()"></a>` : ""}
          <div style="min-width:0;flex:1"><b style="font-family:var(--font-display);font-size:19px">${esc(e.name)}</b><div class="hint"><i>${esc(e.latin)}</i> · <span class="dot ${e.kind}"></span> ${e.kind === "plant" ? "Plant" : "Mushroom"}</div>
            ${favoured(e) ? `<span class="edib edible" style="display:inline-block;margin-top:4px">Weather favours it</span>` : ""}</div></div>
        <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:3px">${bars}</div>
        <div style="display:grid;grid-template-columns:repeat(12,1fr);gap:3px;font-size:10px;color:var(--muted);text-align:center">${MONTHS3.map((x, i) => `<span style="${i + 1 === m ? "color:var(--fg);font-weight:700" : ""}">${x[0]}</span>`).join("")}</div>
        ${summary ? `<p class="hint" style="margin:0;color:var(--fg)">${summary}</p>` : ""}
        <p class="hint num" style="margin:0">${c ? (tot ? `${c[m - 1]} confirmed iNaturalist ${c[m - 1] === 1 ? "record" : "records"} ${scope()} in ${MONTHS[m - 1]}, ${tot} all year.` : `No iNaturalist data for this one ${scope()}. ${biggerHint()}`) : `Typical months for ${region === "na" ? "eastern and central North America" : "Britain and Europe"}.`}</p>
        <p style="margin:0;color:#f6c2b6"><b>Lookalikes:</b> ${esc(e.look)}</p>
        <details class="edmore"><summary>${g ? "How to identify, where, full guide" : "How to identify and where"}</summary>
          <div class="settings-list" style="gap:10px;margin-top:8px">
          ${tx && tx.big ? `<figure style="margin:0"><img src="${esc(tx.big)}" alt="${esc(e.name)}" loading="lazy" style="width:100%;max-height:260px;object-fit:cover;border-radius:var(--r-md);background:var(--surface-2);display:block" onerror="this.closest('figure').remove()"><figcaption class="hint" style="font-size:11px;margin-top:4px">${esc(tx.attr)}, via iNaturalist. A typical example: yours may look different.</figcaption></figure>` : ""}
          ${EDIBLE_ID[e.id] ? `<div><b>How to identify</b><ul style="margin:4px 0 0;padding-left:20px;display:grid;gap:3px">${EDIBLE_ID[e.id].map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
          <p style="margin:0"><b>Where:</b> ${esc(e.where)}</p>
          ${HOSTS[e.id] ? `<p style="margin:0"><b>${e.kind === "plant" ? "Grows with" : "Host trees"}:</b> ${HOSTS[e.id].trees.length ? HOSTS[e.id].trees.map(t => { const tr = TREES.find(x => x.id === t); return tr ? `<a href="#tree-${t}" style="color:var(--plant)">${esc(tr.name)}</a>` : ""; }).join(", ") + ". " : ""}${esc(HOSTS[e.id].note)}</p>` : ""}
          ${g ? `<div class="panel" style="gap:8px;background:var(--surface-2)"><h3 style="margin:0">Beginner guide</h3><p style="margin:0">${esc(g.why)}</p>
            <div><b>Check every one of these</b><ol style="margin:4px 0 0;padding-left:22px;display:grid;gap:4px">${g.steps.map(x => `<li>${esc(x)}</li>`).join("")}</ol></div>
            <div><b>Lookalikes in detail</b>${g.vs.map(([n, d, how]) => `<p style="margin:6px 0 0"><b>${esc(n)}</b> <span class="edib ${/deadly/i.test(d) ? "deadly" : /toxic|avoid/i.test(d) ? "toxic" : "unknown"}">${esc(d)}</span><br>${esc(how)}</p>`).join("")}</div>
            <p style="margin:0"><b>Picking and cooking:</b> ${esc(g.harvest)}</p><p style="margin:0"><b>Keeping:</b> ${esc(g.keep)}</p>
            <p class="hint" style="margin:0">Never eat anything based on this app. Have it checked in person by an expert.</p></div>` : ""}
          </div></details>
      </div>`;
    };
    const legCol = edView.kind === "plant" ? "var(--chart-plant)" : "var(--chart-shroom)";
    const legend = `<details class="panel edmore" style="gap:6px;padding:10px 14px"><summary>How to read the month bars</summary><div style="display:flex;flex-wrap:wrap;gap:10px 16px;font-size:13px">${(counts ? [[3, "Peak: its busiest months here"], [2, "Common"], [1, "Possible, but few records"], [0, "No records"]] : [[3, "Typical season"], [0, "Not usual"]]).map(([L, n]) => `<span style="display:inline-flex;align-items:flex-end;gap:6px"><span style="display:inline-block;width:12px;height:${[4, 9, 17, 22][L]}px;border-radius:2px;background:${edSwatch(L, legCol)}"></span>${n}</span>`).join("")}</div><span class="hint">Taller and brighter means more likely. The outlined month is the one you picked.</span></details>`;
    $("#edList").innerHTML = legend + (inS.length ? `<h3 style="font-size:18px">Likely in ${MONTHS[m - 1]}</h3>` + inS.map(card).join("") : `<p class="hint">Nothing on this list is usually found here in ${MONTHS[m - 1]}.</p>`)
      + (rest.length ? `<details class="panel"><summary style="cursor:pointer;font-weight:700">Not usually found in ${MONTHS[m - 1]} (${rest.length})</summary><div class="settings-list" style="margin-top:10px">${rest.map(card).join("")}</div></details>` : "");
    let st = "";
    if (wx && m === nowM) st = `Last 7 days here: ${wx.rain} mm of rain, average ${wx.temp} °C. "Weather favours it" means rain and temperature suit that mushroom right now. `;
    const nd = $("#edNoData");
    if (nd) {
      const next = edUsesBoundary(place) ? null : ED_RADII.find(r => r > edView.radius);
      nd.innerHTML = noData ? `<div class="banner"><svg><use href="#i-warn"/></svg><div class="grow"><b>No iNaturalist data exists here ${scope()}.</b> ${biggerHint()} Until then, the months below are the general guide.</div>${next ? `<button type="button" class="btn small" data-r="${next}">Try ${next} km</button>` : ""}</div>` : "";
      const nb = nd.querySelector("button"); if (nb) nb.addEventListener("click", () => { edView.useArea = false; edView.radius = +nb.dataset.r; lsSet("edRadius", edView.radius); lsSet("edUseArea", false); renderEdibles(); });
    }
    st += counts ? `Months are from confirmed iNaturalist records ${scope()}.` : noData ? "" : `Months are a general guide for ${region === "na" ? "eastern and central North America" : "Britain and Europe"}.${netOK() && place ? "" : " Connect to see local records from iNaturalist."}`;
    $("#edStatus").textContent = st;
  };
  draw();
  $$("#edMonths .chip").forEach(b => b.addEventListener("click", () => { edView.month = +b.dataset.m; $$("#edMonths .chip").forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); }));
  $$("#edKind button").forEach(b => b.addEventListener("click", () => { edView.kind = b.dataset.v; lsSet("edKind", edView.kind); $$("#edKind button").forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); }));
  $("#edFilter").addEventListener("input", e => { edView.q = e.target.value.trim(); draw(); });
  const cur = $(`#edMonths .chip[data-m="${edView.month}"]`); if (cur) cur.scrollIntoView({ block: "nearest", inline: "center" });
  $$("#edRadius .chip").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.r === "area") { edView.useArea = true; } else { edView.useArea = false; edView.radius = +b.dataset.r; lsSet("edRadius", edView.radius); }
    lsSet("edUseArea", edView.useArea); renderEdibles();
  }));
  const nearBtn = $("#edNear");
  if (nearBtn) nearBtn.addEventListener("click", async () => { edView.place = null; lsSet("edPlace", null); try { await getPosition(); } catch (e) {} renderEdibles(); });
  // Area search, through iNaturalist places.
  let t = null;
  $("#edSearch").addEventListener("input", e => {
    clearTimeout(t);
    const q = e.target.value.trim();
    if (q.length < 3) { $("#edResults").innerHTML = ""; return; }
    t = setTimeout(async () => {
      if (!netOK()) { $("#edResults").innerHTML = `<p class="hint">Searching areas needs signal.</p>`; return; }
      try {
        const j = await inatPublic(`/places/autocomplete?q=${encodeURIComponent(q)}&per_page=6`);
        const res = (j.results || []).filter(r => r.location);
        $("#edResults").innerHTML = res.length ? res.map((r, i) => `<button type="button" class="btn small ghost" data-i="${i}" style="justify-content:flex-start;text-align:left">${esc(r.display_name || r.name)}</button>`).join("") : `<p class="hint">No areas found.</p>`;
        $$("#edResults [data-i]").forEach(b => b.addEventListener("click", () => {
          const r = res[+b.dataset.i], [la, ln] = r.location.split(",").map(Number);
          edView.place = { name: r.display_name || r.name, lat: la, lng: ln, placeId: r.id };
          lsSet("edPlace", edView.place); edView.useArea = true; lsSet("edUseArea", true); renderEdibles();
        }));
      } catch (err) { $("#edResults").innerHTML = `<p class="hint">Couldn't reach iNaturalist.</p>`; }
    }, 350);
  });
  if (!place && geoAvailable()) { getPosition().then(() => { if (location.hash === "#edibles") renderEdibles(); }).catch(() => {}); }
  if (netOK() && EDIBLES.some(e => taxa[e.latin] === undefined)) taxonIds(EDIBLES).then(t => { taxa = t; if (document.body.contains($("#edList"))) draw(); }).catch(() => {});
  if (place && netOK()) {
    areaWeather(place).then(w => { wx = w; if (document.body.contains($("#edList"))) draw(); }).catch(() => {});
    areaCounts(place, msg => { const s = $("#edStatus"); if (s) s.textContent = msg; })
      .then(c => { const tot = Object.values(c).reduce((a, arr) => a + arr.reduce((x, y) => x + y, 0), 0); if (tot) counts = c; else noData = true; if (document.body.contains($("#edList"))) draw(); })
      .catch(() => { const s = $("#edStatus"); if (s) { draw(); s.textContent += " Couldn't load local records from iNaturalist."; } });
  }
}

/* ============================================================
   Season: revisit list and season stats
   ============================================================ */
function monthCalHTML(off) {
  const now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth() + off, 1);
  const y = d0.getFullYear(), m = d0.getMonth(), days = new Date(y, m + 1, 0).getDate(), lead = (d0.getDay() + 6) % 7; // weeks start Monday
  const by = {};
  finds.filter(f => !f.sample).forEach(f => { const d = new Date(f.foundAt); if (d.getFullYear() === y && d.getMonth() === m) (by[d.getDate()] = by[d.getDate()] || []).push(f); });
  let cells = "";
  for (let i = 0; i < lead; i++) cells += `<span></span>`;
  for (let d = 1; d <= days; d++) {
    const l = by[d] || [], today = off === 0 && d === now.getDate();
    cells += `<button type="button" class="mday${l.length ? " has" : ""}${today ? " today" : ""}" data-day="${d}" ${l.length ? "" : "disabled"} aria-label="${d} ${MONTHS[m]}: ${l.length} finds"><b class="num">${d}</b>${l.length ? `<span class="mdots">${l.slice(0, 3).map(f => `<i class="dot ${f.type}"></i>`).join("")}${l.length > 3 ? `<small>+${l.length - 3}</small>` : ""}</span>` : ""}</button>`;
  }
  const n = Object.values(by).reduce((a, l) => a + l.length, 0);
  return { html: `<div class="mcal-head"><button class="icon-btn" type="button" id="mPrev" aria-label="Previous month">‹</button><b>${MONTHS[m]} ${y}</b><span class="hint num">${n} ${n === 1 ? "find" : "finds"}</span><button class="icon-btn" type="button" id="mNext" aria-label="Next month">›</button></div>
    <div class="mcal">${["M", "T", "W", "T", "F", "S", "S"].map(x => `<span class="mwk">${x}</span>`).join("")}${cells}</div>`, by };
}
function seasonChartHTML() {
  const named = {};
  finds.filter(f => f.name && !f.sample).forEach(f => { const k = f.name.trim(); (named[k] = named[k] || { type: f.type, m: Array(12).fill(0) }).m[new Date(f.foundAt).getMonth()]++; });
  const rows = Object.entries(named).sort((a, b) => b[1].m.reduce((x, y) => x + y) - a[1].m.reduce((x, y) => x + y)).slice(0, 15);
  if (!rows.length) return `<p class="hint">Name some finds and your own season chart builds up here.</p>`;
  const now = new Date().getMonth();
  return `<div class="schart"><span></span>${MONTHS.map((x, i) => `<span class="sm${i === now ? " now" : ""}">${x[0]}</span>`).join("")}
    ${rows.map(([n, v]) => { const mx = Math.max(...v.m); return `<a class="sname" href="#species-${encodeURIComponent(n.toLowerCase())}"><span class="dot ${v.type}"></span>${esc(n)}</a>${v.m.map((c, i) => `<i title="${esc(n)}, ${MONTHS[i]}: ${c}" style="background:${c ? `color-mix(in srgb, var(${v.type === "plant" ? "--chart-plant" : "--chart-shroom"}) ${Math.round(35 + 65 * c / mx)}%, var(--surface))` : "var(--surface-2)"}"></i>`).join("")}`; }).join("")}</div>`;
}
let calOff = 0;
function renderSeason(sub) {
  sub = sub || lsGet("calSub", "cal"); lsSet("calSub", sub);
  setChrome({ title: sub === "stats" ? "Stats" : "Calendar", tab: "season" });
  const now = new Date(), thisMonth = now.getMonth();
  const rv = finds.filter(f => f.revisit).map(f => ({ f, nv: nextVisit(f) })).sort((a, b) => a.nv.days - b.nv.days);
  const per = Array.from({ length: 12 }, () => ({ mushroom: 0, plant: 0 }));
  finds.forEach(f => per[new Date(f.foundAt).getMonth()][f.type]++);
  const maxM = Math.max(1, ...per.map(p => p.mushroom + p.plant));
  const yearAgo = finds.filter(f => (now - new Date(f.foundAt)) / DAY <= 365).length;
  const named = {};
  finds.forEach(f => { if (f.name) { const k = f.name.replace(/\s*\(example\)$/i, ""); named[k] = named[k] || { n: 0, type: f.type }; named[k].n++; } });
  const top = Object.entries(named).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  const topMax = top.length ? top[0][1].n : 1;
  const busiest = per.map((p, i) => [i, p.mushroom + p.plant]).sort((a, b) => b[1] - a[1])[0];

  const mc = monthCalHTML(calOff);
  const hideIf = which => sub === which ? "" : "hidden";
  main.innerHTML = `<div class="wrap view">
    <div class="seg" role="tablist" aria-label="Calendar or stats"><button type="button" data-sub="cal" aria-pressed="${sub === "cal"}">Calendar</button><button type="button" data-sub="stats" aria-pressed="${sub === "stats"}">Stats</button></div>
    <div class="settings-list" ${hideIf("cal")} style="gap:16px">
    <div class="panel" id="mcalPanel">${mc.html}<div id="mDayList" class="list"></div></div>
    <div class="section" id="fruitSec"><h3>Fruiting alerts</h3><p class="hint" id="fruitMsg">Checking your past spots…</p><div class="list" id="fruitList"></div>
      <div class="btn-row"><button class="btn small ghost" type="button" id="fruitRefresh">Check again</button><label class="switch" style="flex:1;min-width:220px" for="fruitAlertsSw"><span>Notify me when a spot looks good</span><input type="checkbox" id="fruitAlertsSw" ${alertsOn() ? "checked" : ""}></label>${"" && "Notification" in window && Notification.permission !== "granted" ? '<button class="btn small" type="button" id="fruitNotify">Alert me when the app opens</button>' : ""}</div></div>
    <div class="section"><h3>Spots to revisit</h3>
      ${rv.length ? `<div class="list">${rv.map(({ f, nv }) => `<a class="card" href="#find-${esc(f.id)}"><img class="thumb" data-photo="${esc(cover(f) || "")}" alt=""><div class="card-body"><div class="card-title ${f.name ? "" : "unnamed"}">${esc(f.name || "Not yet identified")}</div><div class="meta"><span class="${nv.days <= 21 ? "due" : ""}">${esc(visitLabel(nv.days))}</span></div><div class="meta num"><span>Found ${esc(fmtDate(f.foundAt))}</span>${lastLoc && f.lat != null ? `<span class="sep">${esc(fmtDist(haversine(lastLoc, f)))} away</span>` : ""}</div></div></a>`).join("")}</div>`
      : `<p class="hint">Turn on "Revisit this spot" when you log a find, and it shows up here as that date comes round again.</p>`}
    </div>

    <div class="panel"><h3>Your season chart</h3><p>What you've found in each month, across all years. Brighter means more finds.</p><div style="overflow-x:auto">${seasonChartHTML()}</div></div>
    </div>
    <div class="settings-list" ${hideIf("stats")} style="gap:16px">
    <div class="statrow num">
      <div><b>${finds.length}</b><span>finds in total</span></div>
      <div><b>${yearAgo}</b><span>in the last 12 months</span></div>
      <div><b>${Object.keys(named).length}</b><span>different species named</span></div>
    </div>

    <div class="panel">
      <h3>Finds by month</h3>
      <p>${busiest && busiest[1] ? `${MONTHS[busiest[0]]} is your busiest month so far.` : "Log some finds to see your seasons."} All years combined.</p>
      <div class="legend"><span><i style="background:var(--chart-shroom)"></i>Mushrooms</span><span><i style="background:var(--chart-plant)"></i>Plants</span></div>
      <div class="chart" role="group" aria-label="Finds by month, mushrooms and plants">
        ${per.map((p, i) => { const tot = p.mushroom + p.plant; const hM = p.mushroom / maxM * 100, hP = p.plant / maxM * 100;
          return `<button type="button" class="bar ${i === thisMonth ? "now" : ""}" data-m="${i}" aria-label="${MONTHS[i]}: ${p.mushroom} mushrooms, ${p.plant} plants">${p.mushroom ? `<i style="height:calc(${hM}% - 1px);background:var(--chart-shroom)"></i>` : ""}${p.plant ? `<i style="height:calc(${hP}% - 1px);background:var(--chart-plant)"></i>` : ""}${tot ? `<span class="tot num" style="bottom:calc(${hM + hP}% + 2px)">${tot}</span>` : ""}</button>`; }).join("")}
      </div>
      <div class="xlabels">${MONTHS.map((m, i) => `<span class="${i === thisMonth ? "now" : ""}">${m[0]}</span>`).join("")}</div>
      <div class="chart-tip num" id="chartTip">Tap a month to see its numbers.</div>
    </div>

    </div>
    <div class="settings-list" ${hideIf("cal")} style="gap:16px">
    <div class="panel"><h3>Year by year</h3>
      <p>Each square is one month. Brighter means more finds, so you can compare seasons across years.</p>
      <div class="seg" role="group" aria-label="Show in calendar" id="calSeg">
        <button type="button" data-v="all" aria-pressed="true">All</button><button type="button" data-v="mushroom" aria-pressed="false">Mushrooms</button><button type="button" data-v="plant" aria-pressed="false">Plants</button>
      </div>
      <div style="overflow-x:auto"><div id="calGrid"></div></div>
      <div class="legend" id="calLegend"></div>
      <div id="calDetail" class="settings-list"></div>
    </div>

    </div>
    <div class="settings-list" ${hideIf("stats")} style="gap:16px">
    <div class="panel"><h3>Most found</h3>
      ${top.length ? `<ul class="rank">${top.map(([n, v]) => `<li><a href="#species-${encodeURIComponent(n.toLowerCase().trim())}" style="color:inherit;text-decoration:none">${esc(n)} ›</a><span class="num" style="color:var(--muted)">${v.n}</span><span class="track"><i style="width:${v.n / topMax * 100}%;background:var(--chart-${v.type === "plant" ? "plant" : "shroom"})"></i></span></li>`).join("")}</ul>` : `<p>Name your finds to see which you come across most.</p>`}
      ${top.length ? `<a class="btn small" href="#species" style="align-self:flex-start">All species pages</a>` : ""}
    </div>
  </div>`;
  drawCalendar("all");
  $$("[data-sub]").forEach(b => b.addEventListener("click", () => { if (b.dataset.sub !== sub) renderSeason(b.dataset.sub); }));
  const wireMonth = () => {
    $("#mPrev").addEventListener("click", () => { calOff--; redrawMonth(); });
    $("#mNext").addEventListener("click", () => { calOff++; redrawMonth(); });
    $$(".mday.has").forEach(b => b.addEventListener("click", () => {
      $$(".mday").forEach(x => x.classList.toggle("sel", x === b));
      const l = monthCalHTML(calOff).by[+b.dataset.day] || [];
      $("#mDayList").innerHTML = l.map(cardHTML).join(""); hydrateThumbs($("#mDayList"));
    }));
  };
  const redrawMonth = () => { $("#mcalPanel").innerHTML = monthCalHTML(calOff).html + `<div id="mDayList" class="list"></div>`; wireMonth(); };
  wireMonth();
  $("#fruitAlertsSw").addEventListener("change", async e => {
    if (!e.target.checked) { lsSet("fruitAlerts", false); return; }
    if (!NATIVE) {
      if (!("Notification" in window)) { e.target.checked = false; toast("Alerts aren't available in this browser"); return; }
      const r = await Notification.requestPermission().catch(() => "denied");
      if (r !== "granted") { e.target.checked = false; toast("Alerts are blocked. Allow notifications for this site first."); return; }
    } else await nat("notifyPermission").catch(() => {});
    lsSet("fruitAlerts", true);
    toast(settings.camp ? "Alerts are on. They wait while camping mode is on." : "Alerts are on. Spots are checked when you open the app, at most every 6 hours.");
  });
  const showFruit = async force => {
    const msg = $("#fruitMsg"); if (!msg) return;
    const cands = fruitingCandidates();
    if (!cands.length) { msg.textContent = "When a mushroom spot you logged in an earlier year comes back into season, it's checked for rain here. Nothing is in season yet."; $("#fruitList").innerHTML = ""; return; }
    if (!netOK() && !lsGet("fruiting", null)) { msg.textContent = "Needs signal to check recent rain at your spots."; return; }
    try {
      const r = await checkFruiting(force);
      const hits = (r && r.hits || []).map(h => ({ ...h, f: finds.find(x => x.id === h.id) })).filter(h => h.f);
      msg.textContent = hits.length
        ? `In season, with at least 10 mm of rain this past week and mild temperatures. Checked ${ago(r.ts)}. A good sign, not a promise.`
        : `${cands.length} of your spots ${cands.length === 1 ? "is" : "are"} in season, but none have had enough rain this week. Checked ${ago(r.ts)}.`;
      $("#fruitList").innerHTML = hits.map(({ f, rain, temp }) => `<a class="card" href="#find-${esc(f.id)}"><img class="thumb" data-photo="${esc(cover(f) || "")}" alt=""><div class="card-body"><div class="card-title ${f.name ? "" : "unnamed"}">${esc(f.name || "Not yet identified")}</div><div class="meta num"><span class="due">${rain} mm rain this week</span><span class="sep">${temp} °C</span></div><div class="meta num"><span>Found ${esc(fmtDate(f.foundAt))}</span>${lastLoc ? `<span class="sep">${esc(fmtDist(haversine(lastLoc, f)))} away</span>` : ""}</div></div></a>`).join("");
      hydrateThumbs($("#fruitList"));
    } catch (e) { msg.textContent = "Couldn't reach the weather service. Try again with signal."; }
  };
  showFruit(false);
  $("#fruitRefresh").addEventListener("click", () => showFruit(true));
  const fn = $("#fruitNotify");
  if (fn) fn.addEventListener("click", async () => { try { const r = await Notification.requestPermission(); toast(r === "granted" ? "You'll get an alert when the app opens and a spot looks good" : "Alerts are off"); fn.remove(); } catch (e) { toast("Alerts aren't available here"); } });
  $$("#calSeg button").forEach(b => b.addEventListener("click", () => { $$("#calSeg button").forEach(x => x.setAttribute("aria-pressed", x === b)); drawCalendar(b.dataset.v); }));
  $$(".bar").forEach(b => {
    const show = () => { const i = +b.dataset.m, p = per[i]; $$(".bar").forEach(x => x.setAttribute("aria-pressed", x === b)); $("#chartTip").textContent = `${MONTHS[i]}: ${p.mushroom} ${p.mushroom === 1 ? "mushroom" : "mushrooms"}, ${p.plant} ${p.plant === 1 ? "plant" : "plants"}`; };
    b.addEventListener("click", show); b.addEventListener("mouseenter", show); b.addEventListener("focus", show);
  });
  hydrateThumbs(main);
}

function drawCalendar(kind) {
  const list = finds.filter(f => kind === "all" || f.type === kind);
  const now = new Date();
  const years = [...new Set([now.getFullYear(), ...list.map(f => new Date(f.foundAt).getFullYear())])].sort((x, y) => y - x);
  const grid = {};
  list.forEach(f => { const d = new Date(f.foundAt), k = d.getFullYear() + "-" + d.getMonth(); (grid[k] = grid[k] || []).push(f); });
  const max = Math.max(1, ...Object.values(grid).map(g => g.length));
  const hue = kind === "plant" ? "var(--chart-plant)" : kind === "mushroom" ? "var(--chart-shroom)" : "var(--chart-plant)";
  // Single-hue ramp, dark (few) to bright (many), on the panel surface.
  const shade = n => n ? `color-mix(in srgb, ${hue} ${Math.round(28 + 72 * n / max)}%, var(--surface))` : "var(--surface-2)";
  const cell = "width:100%;aspect-ratio:1;border-radius:4px;border:0;padding:0;cursor:pointer;font-size:11px;font-variant-numeric:tabular-nums";
  let html = `<div style="display:grid;grid-template-columns:44px repeat(12,minmax(18px,1fr));gap:3px;min-width:300px;align-items:center">`;
  html += `<span></span>` + MONTHS.map((m, i) => `<span style="font-size:11px;text-align:center;color:${i === now.getMonth() ? "var(--fg)" : "var(--muted)"};font-weight:${i === now.getMonth() ? 700 : 400}">${m[0]}</span>`).join("");
  for (const y of years) {
    html += `<span class="num" style="font-size:13px;color:var(--muted)">${y}</span>`;
    for (let mo = 0; mo < 12; mo++) {
      const g = grid[y + "-" + mo] || [];
      const future = y === now.getFullYear() && mo > now.getMonth();
      html += g.length
        ? `<button type="button" data-k="${y}-${mo}" style="${cell};background:${shade(g.length)};color:${g.length / max > 0.55 ? "var(--bg)" : "var(--fg)"}" aria-label="${MONTHS[mo]} ${y}: ${g.length} ${g.length === 1 ? "find" : "finds"}">${g.length}</button>`
        : `<span style="${cell.replace("cursor:pointer;", "")};display:block;background:${future ? "transparent" : "var(--surface-2)"};${future ? "border:1px dashed var(--line);" : ""}" aria-hidden="true"></span>`;
    }
  }
  html += `</div>`;
  $("#calGrid").innerHTML = html;
  $("#calLegend").innerHTML = `<span>Fewer</span>${[1, Math.ceil(max / 2), max].filter((v, i, arr) => arr.indexOf(v) === i).map(n => `<span><i style="background:${shade(n)}"></i>${n}</span>`).join("")}<span>More</span>`;
  $("#calDetail").innerHTML = "";
  $$("#calGrid button").forEach(b => b.addEventListener("click", () => {
    const [y, mo] = b.dataset.k.split("-").map(Number);
    const g = (grid[b.dataset.k] || []).sort((p, q) => new Date(p.foundAt) - new Date(q.foundAt));
    $("#calDetail").innerHTML = `<h3 style="font-size:16px">${MONTHS[mo]} ${y}</h3>` + g.map(f => `<a href="#find-${esc(f.id)}" class="switch" style="text-decoration:none;color:var(--fg);font-size:15px"><span><span class="dot ${f.type}"></span> ${esc(f.name || "Not yet identified")}</span><span class="hint num">${esc(fmtDate(f.foundAt, { day: "numeric", month: "short" }))}</span></a>`).join("");
  }));
}

/* ============================================================
   Photo scale helper: measure against a coin or card in the shot.
   ============================================================ */
const SIZE_FIELDS = [["width", "Width"], ["height", "Height"], ["length", "Length"], ["stem", "Stem height"]];
// Guesses which size a line is from its direction and what the photo shows.
function guessSizeField(p, q, label) {
  const dx = Math.abs(p[0] - q[0]), dy = Math.abs(p[1] - q[1]);
  const stemPhoto = /stem/i.test(label || ""), topView = /^(cap|leaf|flower|spore)/i.test(label || "");
  if (dx >= dy * 1.6) return "width";
  if (dy >= dx * 1.6) return stemPhoto ? "stem" : topView ? "length" : "height";
  return null; // diagonal: ask
}
function openScaleSheet(src, onUse, photoLabel) {
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  const refId = SCALE_REFS.some(r => r[0] === lsGet("scaleRef", "tape")) ? lsGet("scaleRef", "tape") : "tape";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="scTitle" style="overflow-y:auto">
    <h2 id="scTitle">Measure from the photo</h2>
    <div class="field"><label for="scRef">What's in the photo for scale?</label><select id="scRef">${SCALE_REFS.map(([id, l, mm]) => `<option value="${id}" ${id === refId ? "selected" : ""}>${esc(l)}${mm ? ` (${mm >= 100 ? mm / 10 + " cm" : mm + " mm"})` : ""}</option>`).join("")}</select></div>
    <div id="tapeBox" class="settings-list" hidden>
      <div class="btn-row" style="align-items:flex-end"><div class="field" style="flex:1;min-width:120px"><label for="tapeLen">Distance between the two marks you tap</label><input type="number" id="tapeLen" inputmode="decimal" min="0.1" step="0.1" value="${esc(lsGet("tapeLen", 10))}"></div>
        <select id="tapeUnit" aria-label="Unit" style="min-height:44px"><option value="cm">cm</option><option value="in">in</option></select></div>
      <details><summary style="cursor:pointer;font-weight:700">Or let the app find the tick marks</summary>
        <p class="hint">Tap two points along the edge of the tape where the small marks are, a few centimetres apart, then tap Find marks. It looks for evenly spaced lines between your two taps.</p>
        <div class="btn-row"><select id="tickUnit" aria-label="Smallest marks are"><option value="1">Smallest marks are 1 mm</option><option value="1.5875">Smallest marks are 1/16 in</option><option value="3.175">Smallest marks are 1/8 in</option><option value="5">Smallest marks are 5 mm</option></select><button class="btn small plant" type="button" id="tickFind">Find marks</button></div>
        <p class="hint" id="tickMsg" style="margin:0"></p></details>
    </div>
    <p class="hint" id="scStep" style="margin:0;color:var(--fg)"></p>
    <div id="scWrap" style="flex:none;position:relative;overflow:hidden;border-radius:var(--r-md);touch-action:none;background:var(--surface-2)">
      <canvas id="scCanvas" style="width:100%;display:block;transform-origin:0 0"></canvas>
      <canvas id="scLoupe" width="240" height="240" style="position:absolute;width:120px;height:120px;border-radius:50%;border:3px solid #fff;box-shadow:0 4px 16px rgb(0 0 0 / .5);pointer-events:none;display:none"></canvas>
      <div style="position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:6px"><button type="button" class="icon-btn" id="zIn" aria-label="Zoom in" style="background:rgb(0 0 0 / .55);font-size:22px;font-weight:700">+</button><button type="button" class="icon-btn" id="zOut" aria-label="Zoom out" style="background:rgb(0 0 0 / .55);font-size:22px;font-weight:700">−</button></div>
    </div>
    <p class="hint" style="margin:0">Pinch or use + to zoom, drag with one finger to move around. Tap to place a point, then drag a point to fine-tune it; a magnifier shows exactly where it sits.</p>
    <div class="banner warn" id="scResult" hidden></div>
    <div class="panel" id="scUse" hidden style="gap:8px;background:var(--surface-2);padding:12px 14px"></div>
    <div class="btn-row"><button class="btn ghost" type="button" id="scRedo">Start again</button><button class="btn primary" type="button" id="scDone" style="flex:1">Done</button></div>
    <p class="hint" style="margin:0">Works best with the tape, coin or card lying right next to the find, photographed from straight above or straight on.</p>
  </div>`;
  document.body.appendChild(bg);
  const cv = $("#scCanvas", bg), ctx = cv.getContext("2d");
  const img = new Image();
  let pts = [], lastCm = null, auto = null;   // auto: {pxPerMm, ticks: [[x,y]...]} from tick detection
  const isTape = () => $("#scRef", bg).value === "tape";
  const syncTape = () => { $("#tapeBox", bg).hidden = !isTape(); };
  const step = () => {
    const s = $("#scStep", bg);
    if (pts.length < 2) s.textContent = isTape()
      ? (pts.length ? "Now tap the second mark on the tape." : "Tap a mark on the tape, for example 0 or 10 cm.")
      : (pts.length ? "Now tap the other edge of the coin or card." : "Tap one edge of the coin, or one end of the card edge you picked, straight across.");
    else if (pts.length < 4) s.textContent = pts.length === 2 ? "Now tap one end of what you want to measure." : "Tap the other end.";
    else s.textContent = "Tap again to measure something else. Each one fills in its own size.";
  };
  function draw() {
    if (!img.naturalWidth) return;
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const per = cv.width / (cv.getBoundingClientRect().width || cv.width); // canvas px per screen px
    const r = 11 * per, lw = Math.max(1, 2.5 * per);
    const seg = (p, q, col) => { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); };
    const dot = (p, col) => { ctx.fillStyle = col + "99"; ctx.strokeStyle = "#000"; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.moveTo(p[0] - r * 0.6, p[1]); ctx.lineTo(p[0] + r * 0.6, p[1]); ctx.moveTo(p[0], p[1] - r * 0.6); ctx.lineTo(p[0], p[1] + r * 0.6); ctx.stroke(); };
    if (pts.length >= 2) seg(pts[0], pts[1], "#7fb5e6");
    if (pts.length >= 4) seg(pts[2], pts[3], "#e9a75e");
    pts.forEach((p, i) => dot(p, i < 2 ? "#7fb5e6" : "#e9a75e"));
    if (auto) { ctx.strokeStyle = "#ffe066"; ctx.lineWidth = lw; for (const [x, y, nx, ny] of auto.ticks) { ctx.beginPath(); ctx.moveTo(x - nx * r * 1.6, y - ny * r * 1.6); ctx.lineTo(x + nx * r * 1.6, y + ny * r * 1.6); ctx.stroke(); } }
  }
  // Find evenly spaced tick marks along the line between the first two taps, by autocorrelation of brightness.
  function findTicks() {
    const msg = $("#tickMsg", bg);
    if (pts.length < 2) { msg.textContent = "Tap two points along the tape first."; return; }
    const [a, b] = pts, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 60) { msg.textContent = "Tap points further apart, covering at least a few centimetres of the tape."; return; }
    pts.length = 2; draw(); // redraw without the old overlay, then sample the clean image
    const clean = document.createElement("canvas"); clean.width = cv.width; clean.height = cv.height; const cc = clean.getContext("2d"); cc.drawImage(img, 0, 0, cv.width, cv.height);
    const px = cc.getImageData(0, 0, cv.width, cv.height).data;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, nx = -uy, ny = ux;
    const N = Math.floor(len), prof = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) { // average a short strip across the tape to cut noise
        const x = Math.round(a[0] + ux * i + nx * k * 2), y = Math.round(a[1] + uy * i + ny * k * 2);
        if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) continue;
        const o = (y * cv.width + x) * 4; sum += px[o] * 0.3 + px[o + 1] * 0.59 + px[o + 2] * 0.11;
      }
      prof[i] = sum / 5;
    }
    const win = 15, det = new Float64Array(N);
    for (let i = 0; i < N; i++) { let s2 = 0, c = 0; for (let j = Math.max(0, i - win); j <= Math.min(N - 1, i + win); j++) { s2 += prof[j]; c++; } det[i] = prof[i] - s2 / c; }
    let e0 = 0; for (let i = 0; i < N; i++) e0 += det[i] * det[i];
    if (e0 < 1) { msg.textContent = "No marks found there. Try tapping right along the tick marks."; return; }
    const maxLag = Math.min(Math.floor(N / 3), 300), ac = [];
    for (let L = 3; L <= maxLag; L++) { let s3 = 0; for (let i = 0; i + L < N; i++) s3 += det[i] * det[i + L]; ac[L] = s3 / e0 * N / (N - L); }
    let best = 0, lag = 0;
    for (let L = 4; L < maxLag; L++) if (ac[L] > ac[L - 1] && ac[L] >= ac[L + 1] && ac[L] > best) { best = ac[L]; lag = L; }
    // The first strong peak is the spacing; later peaks are just 2, 3 or 4 marks apart.
    for (let L = 4; L < lag; L++) if (ac[L] > ac[L - 1] && ac[L] >= ac[L + 1] && ac[L] > best * 0.5) { lag = L; break; }
    if (!lag || best < 0.25) { auto = null; draw(); msg.textContent = "Couldn't find evenly spaced marks. Use the two-mark method above."; return; }
    // Refine the period to sub-pixel accuracy with a parabola through the peak.
    const y0 = ac[lag - 1], y1 = ac[lag], y2 = ac[lag + 1] ?? y1;
    const period = lag + (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
    const unitMm = +$("#tickUnit", bg).value;
    const ticks = []; for (let d = 0; d < len; d += period) ticks.push([a[0] + ux * d, a[1] + uy * d, nx, ny]);
    auto = { pxPerMm: period / unitMm, ticks, conf: best };
    draw(); compute();
    msg.innerHTML = `Found marks every <b>${period.toFixed(1)} px</b> (${best > 0.55 ? "clear" : "faint, so check them"}). The yellow lines should sit on the tape's marks. If they don't, use the two-mark method.`;
    step();
  }
  function compute() {
    if (pts.length < 4) { $("#scResult", bg).hidden = true; $("#scUse", bg).hidden = true; cur = null; return; }
    const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const ref = SCALE_REFS.find(r => r[0] === $("#scRef", bg).value) || SCALE_REFS[0];
    const refPx = d(pts[0], pts[1]);
    if (refPx < 4) { $("#scResult", bg).hidden = false; $("#scResult", bg).textContent = "The two scale points are too close together. Start again."; return; }
    let refMm = ref[2], pxPerMm = refPx / (refMm || 1);
    if (isTape()) {
      if (auto) pxPerMm = auto.pxPerMm;
      else { const v = parseFloat($("#tapeLen", bg).value); if (!(v > 0)) { $("#scResult", bg).hidden = false; $("#scResult", bg).textContent = "Enter the distance between the two marks."; return; } pxPerMm = refPx / (v * ($("#tapeUnit", bg).value === "in" ? 25.4 : 10)); }
    }
    lastCm = d(pts[2], pts[3]) / pxPerMm / 10;
    const shown = settings.units === "in" ? `${(lastCm / 2.54).toFixed(2)} in` : `${lastCm.toFixed(1)} cm`;
    $("#scResult", bg).hidden = false; $("#scResult", bg).innerHTML = `<div class="grow">About <b class="num">${esc(shown)}</b>. Treat this as an estimate.</div>`;
    // Fill the find's size straight away, guessing which one from the line's direction.
    if (!cur) { cur = { field: guessSizeField(pts[2], pts[3], photoLabel), old: "" }; if (cur.field) cur.old = onUse(cur.field, lastCm); }
    else if (cur.field) onUse(cur.field, lastCm);
    showUse();
  }
  let cur = null; // the size box this measurement is filling: {field, old}
  function assign(field) {
    if (cur.field === field) return;
    if (cur.field) onUse(cur.field, null, cur.old); // put back what the wrong box had
    cur.field = field; cur.old = onUse(field, lastCm); showUse();
  }
  function showUse() {
    const box = $("#scUse", bg); box.hidden = false;
    const name = cur.field && SIZE_FIELDS.find(f => f[0] === cur.field)[1];
    box.innerHTML = cur.field
      ? `<div><b style="color:var(--plant)">✓ Filled in as ${esc(name)}.</b> <span class="hint">Wrong one? Tap the right size:</span></div><div class="btn-row">${SIZE_FIELDS.filter(f => f[0] !== cur.field).map(([k, l]) => `<button class="btn small" type="button" data-use="${k}">${l}</button>`).join("")}</div>`
      : `<div><b>Which size is this?</b> <span class="hint">The line is at an angle, so I can't tell.</span></div><div class="btn-row">${SIZE_FIELDS.map(([k, l]) => `<button class="btn small plant" type="button" data-use="${k}">${l}</button>`).join("")}</div>`;
  }
  img.onload = () => { const w = Math.min(1600, img.naturalWidth); cv.width = w; cv.height = Math.round(img.naturalHeight * w / img.naturalWidth); draw(); };
  img.src = src;
  // Zoom and pan with a CSS transform; points stay in image (canvas) coordinates.
  const wrap = $("#scWrap", bg), loupe = $("#scLoupe", bg), lctx = loupe.getContext("2d");
  let k = 1, tx = 0, ty = 0;
  const clampView = () => { const W = wrap.clientWidth, H = wrap.clientHeight; k = Math.max(1, Math.min(8, k)); tx = Math.min(0, Math.max(W - W * k, tx)); ty = Math.min(0, Math.max(H - H * k, ty)); cv.style.transform = `translate(${tx}px,${ty}px) scale(${k})`; draw(); };
  const zoomAt = (f, cx, cy) => { const nk = Math.max(1, Math.min(8, k * f)); tx = cx - (cx - tx) * nk / k; ty = cy - (cy - ty) * nk / k; k = nk; clampView(); };
  $("#zIn", bg).addEventListener("click", () => zoomAt(1.6, wrap.clientWidth / 2, wrap.clientHeight / 2));
  $("#zOut", bg).addEventListener("click", () => zoomAt(1 / 1.6, wrap.clientWidth / 2, wrap.clientHeight / 2));
  const toImg = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  const toScreen = p => { const r = cv.getBoundingClientRect(); return [r.left + p[0] * r.width / cv.width, r.top + p[1] * r.height / cv.height]; };
  function showLoupe(e, p) {
    const wr = wrap.getBoundingClientRect(), per = cv.width / cv.getBoundingClientRect().width, R = 60 * per / 3; // 3x the on-screen size
    lctx.clearRect(0, 0, 240, 240); lctx.drawImage(cv, p[0] - R, p[1] - R, R * 2, R * 2, 0, 0, 240, 240);
    lctx.strokeStyle = "#fff"; lctx.lineWidth = 2; lctx.beginPath(); lctx.moveTo(120, 96); lctx.lineTo(120, 144); lctx.moveTo(96, 120); lctx.lineTo(144, 120); lctx.stroke();
    let x = e.clientX - wr.left - 60, y = e.clientY - wr.top - 150;
    if (y < 4) y = e.clientY - wr.top + 40;
    loupe.style.left = Math.max(4, Math.min(wr.width - 124, x)) + "px"; loupe.style.top = y + "px"; loupe.style.display = "block";
  }
  const touches = new Map();
  let drag = null; // {type: "point", i} | {type: "pan", x, y} | {type: "tap", x, y}
  let pinch = null;
  wrap.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return;
    wrap.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()], wr = wrap.getBoundingClientRect();
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2 - wr.left, cy: (a[1] + b[1]) / 2 - wr.top };
      drag = null; loupe.style.display = "none"; return;
    }
    // Grab the nearest point within 32 screen px, so handles are easy to hit.
    let best = -1, bd = 32;
    pts.forEach((p, i) => { const q = toScreen(p), d = Math.hypot(q[0] - e.clientX, q[1] - e.clientY); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { drag = { type: "point", i: best, ox: pts[best][0] - toImg(e)[0], oy: pts[best][1] - toImg(e)[1] }; showLoupe(e, pts[best]); }
    else drag = { type: "tap", x: e.clientX, y: e.clientY };
  });
  wrap.addEventListener("pointermove", e => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt(d / pinch.d, pinch.cx, pinch.cy); pinch.d = d; return;
    }
    if (!drag) return;
    if (drag.type === "point") { const q = toImg(e); pts[drag.i] = [q[0] + drag.ox, q[1] + drag.oy]; draw(); compute(); showLoupe(e, pts[drag.i]); return; }
    if (drag.type === "tap" && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) drag = { type: "pan", x: e.clientX, y: e.clientY };
    if (drag.type === "pan") { tx += e.clientX - drag.x; ty += e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; clampView(); }
  });
  const end = e => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    loupe.style.display = "none";
    if (drag && drag.type === "tap" && touches.size === 0) {
      const p = toImg(e);
      if (pts.length >= 4) pts = pts.slice(0, 2);
      pts.push(p); auto = pts.length > 2 ? auto : null; draw(); compute(); step();
    }
    if (touches.size === 0) drag = null;
  };
  wrap.addEventListener("pointerup", end); wrap.addEventListener("pointercancel", e => { touches.delete(e.pointerId); drag = null; pinch = null; loupe.style.display = "none"; });
  $("#scRef", bg).addEventListener("change", e => { lsSet("scaleRef", e.target.value); auto = null; syncTape(); draw(); compute(); step(); });
  $("#tapeUnit", bg).value = lsGet("tapeUnit", settings.units === "in" ? "in" : "cm");
  $("#tickUnit", bg).value = settings.units === "in" ? "1.5875" : "1";
  $("#tapeLen", bg).addEventListener("input", e => { lsSet("tapeLen", e.target.value); auto = null; draw(); compute(); });
  $("#tapeUnit", bg).addEventListener("change", e => { lsSet("tapeUnit", e.target.value); compute(); });
  $("#tickUnit", bg).addEventListener("change", () => { if (auto) findTicks(); });
  $("#tickFind", bg).addEventListener("click", findTicks);
  syncTape();
  $("#scRedo", bg).addEventListener("click", () => { pts = []; auto = null; k = 1; tx = 0; ty = 0; clampView(); $("#tickMsg", bg).textContent = ""; draw(); compute(); step(); });
  $("#scUse", bg).addEventListener("click", e => { const b = e.target.closest("[data-use]"); if (b && lastCm != null && cur) assign(b.dataset.use); });
  const close = () => bg.remove();
  $("#scDone", bg).addEventListener("click", close);
  bg.addEventListener("click", e => { if (e.target === bg) close(); });
  step();
}

/* ============================================================
   Backup and export
   ============================================================ */
function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
async function saveFile(filename, data, type) {
  // Inside a claude.ai preview, downloads go through the viewer.
  try {
    if (window.claude && window.claude.use) {
      const d = await window.claude.use("downloads");
      if (d) { await d.save({ filename, data: new Blob([data], { type }) }); return true; }
    }
  } catch (e) { if (e && e.code === "declined") return false; }
  // The Android app saves straight into the phone's Downloads folder.
  if (NATIVE) {
    try { const r = await nat("saveText", { filename, data: String(data), type }); toast(`Saved to ${r.where || "Downloads"}`); return true; }
    catch (e) { toast("Couldn't save the file: " + ((e && e.message) || "unknown error")); return false; }
  }
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
const stamp = () => new Date().toISOString().slice(0, 10);
async function exportBackup() {
  const photos = {};
  const nbVoice = notebook().flatMap(n => n.voice || []);
  for (const p of [...finds.flatMap(f => [...f.photos, ...f.voice]), ...nbVoice]) {
    const rec = await store.get("photos", p.key).catch(() => null);
    if (rec) photos[p.key] = typeof rec === "string" ? rec : await blobToDataURL(rec);
  }
  const json = JSON.stringify({ app: "spore-and-leaf", version: 1, exportedAt: new Date().toISOString(), finds, photos, trips: lsGet("trips", []), notebook: notebook() });
  const ok = await saveFile(`shroom-log-backup-${stamp()}.json`, json, "application/json");
  if (ok) { lsSet("lastBackup", Date.now()); toast("Backup saved"); }
}
async function exportCSV() {
  const cols = ["name","type","foundAt","timeOfDay","lat","lng","locSource","width_cm","height_cm","length_cm","stem_cm","colours","colourNote","spore","gills","substrate","habitat","trees","edibility","shroomId","shroomIdConfidence","weather","rainRecent","temp_c","soilMoisture","elevation_m","slope_deg","slopeFaces","moonPhase","moonLitPercent","weatherNote","tags","revisit","smell","texture","bruising","lookalikes","notes","photos","createdAt","updatedAt"];
  const q = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = finds.map(f => [f.name, f.type, f.foundAt, timeOfDay(new Date(f.foundAt)), f.lat, f.lng, f.locSource, f.width, f.height, f.length, f.stem, (f.colours || []).join("; "), f.colourNote, f.spore, f.gills, f.substrate, f.habitat.join("; "), f.trees, f.edibility, f.idApp && f.idApp.result, f.idApp && f.idApp.confidence, (f.weather || []).join("; "), f.rainRecent, f.temp, f.soil ? f.soil + (f.soilAuto ? " (estimate)" : "") : "", f.elev, f.slope, f.aspect == null ? "" : compassName(f.aspect), (f.moon || moonPhase(f.foundAt)).name, (f.moon || moonPhase(f.foundAt)).illum, f.weatherNote, f.tags.join("; "), f.revisit ? "yes" : "", f.smell.join("; "), f.texture.join("; "), [f.bruise, f.bruiseNote].filter(Boolean).join(": "), f.lookalikes.map(l => l.name + (l.ruledOut ? " (ruled out)" : "")).join("; "), [f.notes, f.description].filter(Boolean).join("\n\n"), f.photos.length, f.createdAt, f.updatedAt].map(q).join(","));
  const ok = await saveFile(`shroom-log-${stamp()}.csv`, "﻿" + [cols.join(","), ...rows].join("\n"), "text/csv");
  if (ok) toast("Spreadsheet saved");
}
async function importBackup(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app === "spore-and-leaf-share" && Array.isArray(j.finds)) return await importShared(j);
    if (j.app !== "spore-and-leaf" || !Array.isArray(j.finds)) throw new Error("That file isn't a Shroom Log backup.");
    const have = new Set(finds.map(f => f.id));
    let added = 0;
    if (Array.isArray(j.trips)) { const mine = lsGet("trips", []); const ids = new Set(mine.map(t => t.id)); saveTrips([...mine, ...j.trips.filter(t => !ids.has(t.id))]); }
    if (Array.isArray(j.notebook)) {
      const mine = notebook(); const ids = new Set(mine.map(n => n.id)); const add = j.notebook.filter(n => !ids.has(n.id));
      for (const n of add) for (const v of n.voice || []) { const d = j.photos && j.photos[v.key]; if (d) await store.put("photos", await dataURLToBlob(d), v.key); }
      if (add.length) saveNotebook([...mine, ...add]);
    }
    for (const f of j.finds) {
      if (have.has(f.id)) continue;
      const nf = normalise(f);
      for (const p of [...nf.photos, ...nf.voice]) { const d = j.photos && j.photos[p.key]; if (d) await store.put("photos", d.startsWith("data:image/svg") ? d : await dataURLToBlob(d), p.key); }
      await store.put("finds", nf); added++;
    }
    await loadFinds();
    toast(added ? `Restored ${added} ${added === 1 ? "find" : "finds"}` : "Everything in that backup is already here");
  } catch (e) { toast(e.message && e.message.startsWith("That") ? e.message : "That backup couldn't be read."); }
}

/* ============================================================
   Settings and safety
   ============================================================ */
function renderSafety() {
  setChrome({ title: "Safety", back: true });
  main.innerHTML = `<div class="wrap view">
    <div class="banner danger"><svg><use href="#i-warn"/></svg><div class="grow"><b>This app is a field log, not an identification guide.</b> Never eat a wild mushroom or plant based on this app, a photo, or any identification app, Shroom ID included.</div></div>
    <div class="settings-list">
      <div class="panel"><h3>Get every find checked</h3><p>Before eating anything, have it identified in person by an experienced forager or a local mycological society. Photos and apps miss details like spore colour, smell and the base of the stem.</p></div>
      <div class="panel"><h3>Deadly lookalikes are common</h3><p>Death cap and destroying angel can look like edible field mushrooms or puffballs when young. Hemlock water dropwort and lily of the valley grow near wild garlic and look similar. A small amount can kill.</p></div>
      <div class="panel"><h3>Dig up the whole mushroom</h3><p>The base of the stem, a sac-like volva or a ring, is often what tells a deadly Amanita apart. Photograph it and note it in the description.</p></div>
      <div class="panel"><h3>If someone feels unwell</h3><p>Call emergency services or poison control straight away, and keep a sample of what was eaten. Symptoms from the most dangerous species can take 6 to 24 hours to appear.</p></div>
      <div class="panel"><h3>Forage responsibly</h3><p>Check local rules and get the landowner's permission, take only a little, and leave plenty behind for wildlife.</p></div>
    </div>
  </div>`;
}
async function renderSettings() {
  setChrome({ title: "More", tab: "more" });
  const tiles = await store.count("tiles").catch(() => 0);
  const lb = lsGet("lastBackup", null);
  const hasEx = finds.some(f => f.sample);
  main.innerHTML = `<div class="wrap view"><div class="settings-list">
    <a class="banner danger" href="#safety" style="text-decoration:none"><svg><use href="#i-warn"/></svg><div class="grow"><b>Safety first.</b> Never eat anything based on this app. Read the safety notes.</div></a>
    <div class="panel"><h3>Your log</h3><div class="btn-row"><a class="btn small" href="#import"><svg><use href="#i-img"/></svg>Import old photos</a><a class="btn small" href="#trips">Trips</a><a class="btn small" href="#hikes">Hikes</a><a class="btn small" href="#labels">Specimen labels</a><a class="btn small" href="#guides">Guides and tree ID</a><a class="btn small" href="#pack">Packing list</a><a class="btn small" href="#species">Species</a><a class="btn small" href="#review">Review ID changes${finds.some(f => f.idReview) ? ` (${finds.filter(f => f.idReview).length})` : ""}</a><a class="btn small ghost" href="#trash">Trash${trash.length ? ` (${trash.length})` : ""}</a></div></div>
    <div class="panel"><label class="switch" for="campMode"><span><h3>Camping mode</h3><p>Makes the battery last as long as possible.</p></span><input type="checkbox" id="campMode" ${settings.camp ? "checked" : ""}></label>
      <ul class="hint" style="margin:0;padding-left:20px"><li>Nothing goes online: weather, iNaturalist and map downloads wait until you turn it off. Saved maps still work.</li><li>Pure black screen and no animations.</li><li>GPS only wakes when you log a find, and photo locations are used first.</li><li>Hikes don't keep the screen on${NATIVE ? " (the Android app records with the screen off anyway)" : ""}.</li></ul></div>
    ${NATIVE ? `<div class="panel"><h3>App updates</h3><p>You have build <b class="num">${APP_BUILD}</b>.${lsGet("updLatest", 0) > APP_BUILD ? ` <b style="color:var(--plant)">Build ${lsGet("updLatest", 0)} is available.</b>` : ""}</p>
      <div class="btn-row"><button class="btn small" type="button" id="updCheck">Check for update</button><button class="btn small plant" type="button" id="updGet" ${lsGet("updLatest", 0) > APP_BUILD ? "" : "hidden"}><svg><use href="#i-down"/></svg>Download update</button></div>
      <p class="hint" id="updMsg" style="margin:0">Your finds stay on the phone when you update. After the download, tap the file to install it over this one.</p></div>` : /claude\.ai|claudeusercontent/.test(location.host) ? "" : `<a class="panel" href="android.html" style="text-decoration:none;color:inherit"><h3>Get the Android app</h3><p>Works fully offline and keeps recording hikes with the screen off. Tap for the download and install steps.</p></a>`}
    <label class="panel switch" for="nightMode"><span><h3>Red night light</h3><p>Turns the whole screen red so it doesn't spoil your night vision. Also on the moon button at the top.</p></span><input type="checkbox" id="nightMode" ${settings.night ? "checked" : ""}></label>
    <label class="panel switch" for="fieldMode"><span><h3>Field mode</h3><p>Bigger text and buttons for cold or muddy hands.</p></span><input type="checkbox" id="fieldMode" ${settings.field ? "checked" : ""}></label>
    <div class="panel"><h3>iNaturalist</h3>
      ${inat.connected() ? `<p>Connected${inat.user ? ` as <b>${esc(inat.user.login)}</b>` : ""}. ${finds.filter(f => f.inatQueued).length} waiting to upload, ${finds.filter(f => f.inat && f.inat.id).length} uploaded.${lsGet("inatExpired", false) ? ` <b style="color:var(--danger)">Your sign-in has expired. Reconnect below.</b>` : ""}</p>
        <label class="switch" for="inatAuto"><span>Send new finds automatically</span><input type="checkbox" id="inatAuto" ${lsGet("inatAuto", true) ? "checked" : ""}></label>
        <div class="field"><label for="inatGeo">Location shown publicly</label><select id="inatGeo"><option value="obscured">Blurred to about 20 km (recommended)</option><option value="private">Hidden completely</option><option value="open">Exact spot</option></select><span class="hint">Experts still see the region, which helps them identify it.</span></div>
        <div class="btn-row"><a class="btn small plant" href="#inat-past">Upload past finds${finds.filter(f => inatState(f) === "unsent").length ? ` (${finds.filter(f => inatState(f) === "unsent").length})` : ""}</a><button class="btn small" type="button" id="inatNow">Upload and check now</button><button class="btn small ghost" type="button" id="inatOut">Disconnect</button></div>`
      : `<p>Upload finds so experts on iNaturalist can confirm what they are. Their IDs come back into your log. You need a free iNaturalist account.</p>`}
      <details ${inat.connected() && !lsGet("inatExpired", false) ? "" : "open"}><summary style="cursor:pointer;font-weight:700">${inat.connected() ? "Reconnect" : "Connect"}</summary>
        <p><b>Option 1, stay signed in:</b> create an app at <a href="https://www.inaturalist.org/oauth/applications/new" target="_blank" rel="noopener" style="color:var(--plant)">inaturalist.org/oauth/applications/new</a>. Tick "Confidential: no", and set the Redirect URI to <code style="overflow-wrap:anywhere">${esc(redirectURI())}</code>. Paste its Application ID here, then tap Sign in.</p>
        <div class="field"><label for="inatClient">Application ID</label><input type="text" id="inatClient" value="${esc(inat.clientId)}" autocomplete="off"></div>
        <div class="btn-row"><button class="btn small plant" type="button" id="inatSignIn">Sign in to iNaturalist</button></div>
        <p><b>Option 2, quick but daily:</b> while signed in on iNaturalist, open <a href="https://www.inaturalist.org/users/api_token" target="_blank" rel="noopener" style="color:var(--plant)">inaturalist.org/users/api_token</a>, copy the long code, and paste it here. It lasts 24 hours.</p>
        <div class="field"><label for="inatPaste">API token</label><input type="text" id="inatPaste" autocomplete="off" placeholder="eyJ…"></div>
        <div class="btn-row"><button class="btn small" type="button" id="inatPasteGo">Use this token</button></div>
      </details></div>
    <div class="panel"><h3>PIN lock</h3><p>${pinSet() ? "The app asks for your PIN when you open it." : "Ask for a PIN when the app opens, so others can't see your spots."} It hides the app. The log itself isn't encrypted, so keep your phone's own lock on too.</p>
      ${pinSet() ? `<div class="field"><label for="pinAfter">Lock again after</label><select id="pinAfter">${[[1, "1 minute away"], [5, "5 minutes away"], [15, "15 minutes away"], [60, "1 hour away"]].map(([v, l]) => `<option value="${v}" ${lsGet("pinAfter", 5) === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="btn-row"><button class="btn small" type="button" id="pinChange">Change PIN</button><button class="btn small danger" type="button" id="pinOff">Turn off PIN</button></div>`
      : `<div class="btn-row"><button class="btn small" type="button" id="pinChange">Set a PIN</button></div>`}
      <div id="pinSetBox" hidden class="settings-list"><input type="password" inputmode="numeric" id="pin1" placeholder="New PIN, 4 to 8 digits" maxlength="8" autocomplete="new-password"><input type="password" inputmode="numeric" id="pin2" placeholder="Same PIN again" maxlength="8" autocomplete="new-password"><div class="btn-row"><button class="btn small primary" type="button" id="pinSave">Save PIN</button></div></div></div>
    <div class="panel"><h3>Share with a buddy</h3><p>Send finds as a file by message, email or Drive. Your buddy opens it here with Open a shared file. Each send is a snapshot. Send again to share changes.</p>
      <div class="field"><label for="buddyName">Your name, shown to your buddy</label><input type="text" id="buddyName" value="${esc(lsGet("buddyName", ""))}" placeholder="e.g. Henry"></div>
      <div class="field"><label for="shareWhich">Which finds</label><select id="shareWhich"><option value="all">All my finds</option><option value="mushroom">Mushrooms only</option><option value="plant">Plants only</option><option value="edible">Marked edible</option>${tripList().map(t => `<option value="trip:${esc(t.id)}">Trip: ${esc(t.name)}</option>`).join("")}</select></div>
      <label class="switch" for="shareBlur"><span>Hide exact spots (rounds to about 1 km)</span><input type="checkbox" id="shareBlur" checked></label>
      <div class="btn-row"><button class="btn small primary" type="button" id="shareBtnAll"><svg><use href="#i-share"/></svg>Share finds</button><label class="btn small ghost" for="sharedIn">Open a shared file</label></div>
      <input class="sr" type="file" id="sharedIn" accept="application/json,.json"></div>
    <div class="panel"><h3>Backup</h3><p>${lb ? `Last backup ${esc(ago(lb))}.` : "You haven't made a backup yet."} A backup is one file with every find and photo. Keep it somewhere safe, like Google Drive.</p>
      <div class="btn-row"><button class="btn small plant" type="button" id="bkBtn"><svg><use href="#i-down"/></svg>Save backup</button><button class="btn small" type="button" id="csvBtn">Export spreadsheet (CSV)</button><label class="btn small ghost" for="restoreIn">Restore from backup</label></div>
      <input class="sr" type="file" id="restoreIn" accept="application/json,.json"></div>
    <div class="panel"><h3>Units</h3><p>Sizes and distances are shown in this unit.</p>
      <div class="seg" role="group" aria-label="Units"><button type="button" data-u="cm" aria-pressed="${settings.units === "cm"}">Centimetres, km</button><button type="button" data-u="in" aria-pressed="${settings.units === "in"}">Inches, miles</button></div></div>
    <div class="panel"><h3>Last known location</h3><p>${lastLoc ? `${lastLoc.lat.toFixed(4)}, ${lastLoc.lng.toFixed(4)}, updated ${esc(ago(lastLoc.ts))}.` : "Not known yet."} Used to sort finds by distance.</p>
      <div class="btn-row"><button class="btn small" type="button" id="locNow"><svg><use href="#i-gps"/></svg>Update now</button></div></div>
    <div class="panel"><h3>Offline map</h3><p><span class="num">${tiles}</span> map tiles saved on this phone.</p>
      <div class="btn-row"><a class="btn small" href="#map"><svg><use href="#i-down"/></svg>Save an area</a>${tiles ? '<button class="btn small danger" type="button" id="clrTiles">Remove saved map</button>' : ""}</div></div>
    ${hasEx ? `<div class="panel"><h3>Example finds</h3><p>Three examples show how the log looks.</p><div class="btn-row"><button class="btn small" type="button" id="clrEx">Remove examples</button></div></div>` : ""}
    <div class="panel"><h3>Where your log is kept</h3><p>Everything stays on this phone, in this browser. Nothing is uploaded. Clearing the browser's site data deletes the log, so save a backup now and then.</p></div>
  </div></div>`;
  $("#campMode").addEventListener("change", e => { settings.camp = e.target.checked; lsSet("camp", settings.camp); applyModes(); restartTrailWatch(); toast(settings.camp ? "Camping mode on" : "Camping mode off"); if (!settings.camp) inatProcess(); });
  $("#nightMode").addEventListener("change", e => { settings.night = e.target.checked; lsSet("night", settings.night); applyModes(); });
  if (NATIVE) {
    $("#updGet").addEventListener("click", () => openExternal(APK_URL));
    $("#updCheck").addEventListener("click", async () => {
      const msg = $("#updMsg"); msg.textContent = "Checking…";
      const r = await checkForUpdate(true);
      if (r.err) { msg.textContent = r.err; return; }
      $("#updGet").hidden = !r.newer;
      msg.textContent = r.newer ? `Build ${r.latest} is ready. Tap Download update, then open the file to install it. Your finds stay on the phone.` : "You have the latest version.";
    });
  }
  $("#fieldMode").addEventListener("change", e => { settings.field = e.target.checked; lsSet("field", settings.field); document.body.classList.toggle("field", settings.field); });
  // iNaturalist
  const ig = $("#inatGeo"); if (ig) { ig.value = lsGet("inatGeo", "obscured"); ig.addEventListener("change", () => lsSet("inatGeo", ig.value)); }
  const ia = $("#inatAuto"); if (ia) ia.addEventListener("change", () => lsSet("inatAuto", ia.checked));
  const inw = $("#inatNow"); if (inw) inw.addEventListener("click", async () => { inw.disabled = true; await inatProcess(); renderSettings(); });
  const io = $("#inatOut"); if (io) io.addEventListener("click", () => { ["inatAccess", "inatJwt", "inatUser"].forEach(k => lsSet(k, null)); toast("Disconnected from iNaturalist"); renderSettings(); });
  $("#inatClient").addEventListener("change", e => lsSet("inatClient", e.target.value.trim()));
  $("#inatSignIn").addEventListener("click", () => { lsSet("inatClient", $("#inatClient").value.trim()); inatSignIn(); });
  $("#inatPasteGo").addEventListener("click", async () => {
    const v = $("#inatPaste").value.trim().replace(/^.*"api_token"\s*:\s*"([^"]+)".*$/s, "$1");
    if (v.split(".").length !== 3) { toast("That doesn't look like an iNaturalist API token"); return; }
    lsSet("inatJwt", { token: v, ts: Date.now() });
    try { await inatWhoAmI(); lsSet("inatExpired", false); toast("Connected to iNaturalist"); } catch (e) { lsSet("inatJwt", null); toast("iNaturalist didn't accept that token"); }
    renderSettings();
  });
  // PIN
  $("#pinChange").addEventListener("click", () => { $("#pinSetBox").hidden = false; $("#pin1").focus(); });
  $("#pinSave").addEventListener("click", async () => {
    const a1 = $("#pin1").value, a2 = $("#pin2").value;
    if (!/^\d{4,8}$/.test(a1)) { toast("Use 4 to 8 digits"); return; }
    if (a1 !== a2) { toast("The two PINs don't match"); return; }
    await setPin(a1); unlocked = true; toast("PIN saved"); renderSettings();
  });
  const po = $("#pinOff"); if (po) po.addEventListener("click", () => { ["pinHash", "pinSalt", "pinLen"].forEach(k => lsSet(k, null)); toast("PIN turned off"); renderSettings(); });
  const pa = $("#pinAfter"); if (pa) pa.addEventListener("change", () => lsSet("pinAfter", +pa.value));
  $("#buddyName").addEventListener("change", e => lsSet("buddyName", e.target.value.trim()));
  $("#shareBtnAll").addEventListener("click", () => {
    lsSet("buddyName", $("#buddyName").value.trim());
    const w = $("#shareWhich").value;
    const list = finds.filter(f => !f.sample && !f.sharedFrom && (w === "all" || (w.startsWith("trip:") ? f.tripId === w.slice(5) : w === "edible" ? f.edibility === "edible" : f.type === w)));
    sendShare(list, $("#shareBlur").checked);
  });
  $("#sharedIn").addEventListener("change", async e => { const file = e.target.files && e.target.files[0]; e.target.value = ""; if (file) { await importBackup(file); renderSettings(); } });
  $("#bkBtn").addEventListener("click", async e => { e.target.disabled = true; await exportBackup(); renderSettings(); });
  $("#csvBtn").addEventListener("click", exportCSV);
  $("#restoreIn").addEventListener("change", async e => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) { await importBackup(f); renderSettings(); } });
  $$("[data-u]").forEach(b => b.addEventListener("click", () => { settings.units = b.dataset.u; lsSet("units", settings.units); renderSettings(); }));
  $("#locNow").addEventListener("click", async () => { try { await getPosition(); toast("Location updated"); } catch (e) { toast("Location isn't available here"); } renderSettings(); });
  const ct = $("#clrTiles"); if (ct) ct.addEventListener("click", async () => { await store.clear("tiles"); toast("Saved map removed"); renderSettings(); });
  const ce = $("#clrEx"); if (ce) ce.addEventListener("click", async () => { await removeExamples(); toast("Examples removed"); renderSettings(); });
}

/* ============================================================
   Boot
   ============================================================ */
(async function start() {
  showLock();
  await openDB();
  try { await seedExamples(); } catch (e) {}
  await loadFinds();
  route();
  // One fix at start for sorting and sunset, skipped in camping mode when a recent one is known.
  if (geoAvailable() && !(settings.camp && lastLoc && Date.now() - lastLoc.ts < 6 * 3600000)) getPosition().then(() => { const el = $("#sunLine"); if (el) el.innerHTML = sunsetHTML(); }).catch(() => {});
  if (activeTrail) watchTrail();
  if (new URLSearchParams(location.search).get("code")) inatFinishSignIn().then(() => { route(); inatProcess(); });
  else setTimeout(inatProcess, 1500);
  if (NATIVE) setTimeout(() => checkForUpdate(false), 4000);
  if (!NATIVE && "serviceWorker" in navigator && location.protocol === "https:" && !/claude\.ai|claudeusercontent/.test(location.host)) {
    try { navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => reg.update()).catch(() => {}); const hadSW = !!navigator.serviceWorker.controller; navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadSW && !window.__swReloaded) { window.__swReloaded = true; location.reload(); } }); } catch (e) {}
  }
})();
