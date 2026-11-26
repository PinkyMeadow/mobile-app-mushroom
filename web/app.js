"use strict";
/* Spore & Leaf: an offline-first field log for mushrooms and plants. */

/* ============================================================
   Storage: IndexedDB, with an in-memory fallback.
   ============================================================ */
const DB_NAME = "spore-leaf", DB_VER = 1;
const mem = { finds: new Map(), photos: new Map(), tiles: new Map(), kv: new Map() };
let idb = null;
function openDB() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains("finds")) d.createObjectStore("finds", { keyPath: "id" });
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
function toast(msg) {
  $$(".toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
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
const HABITAT = ["Broadleaf woods","Conifer woods","Mixed woods","Grassland","Heath or moor","Wetland","Hedgerow","Garden or park","Roadside","Coast"];
const EDIBILITY = [
  ["unknown", "Unknown"],
  ["edible", "Edible: confirmed in person by an expert"],
  ["inedible", "Inedible"],
  ["toxic", "Toxic"],
  ["deadly", "Deadly"]
];
const PHOTO_LABELS = ["Whole", "Cap", "Gills or underside", "Stem", "Stem base", "Spore print", "Leaf", "Flower", "Habitat", "Other"];
const WEATHER = ["Sunny","Partly cloudy","Overcast","Drizzle","Rain","Heavy rain","Fog","Windy","Frost","Snow"];
const RAIN_RECENT = ["Dry for days","Light rain recently","Heavy rain recently","Not sure"];

/* ============================================================
   State
   ============================================================ */
let settings = { units: lsGet("units", "cm"), field: lsGet("field", false) };
let lastLoc = lsGet("lastLoc", null);  // {lat,lng,acc,ts}
let finds = [];
const photoURLs = new Map();
let view = { filter: lsGet("filter", "all"), sort: lsGet("sort", "newest"), q: "", tag: null };
let maps = [];
document.body.classList.toggle("field", !!settings.field);

/* Older entries stored a single photo key. */
function normalise(f) {
  if (!f.photos) f.photos = f.photo ? [{ key: f.photo, label: "Whole" }] : [];
  delete f.photo;
  f.tags = f.tags || [];
  f.habitat = f.habitat || [];
  f.edibility = f.edibility || "unknown";
  return f;
}
const cover = f => f.photos && f.photos[0] ? f.photos[0].key : null;
async function loadFinds() { finds = ((await store.all("finds").catch(() => [])) || []).map(normalise); }
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
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), ts: Date.now() };
        lastLoc = loc; lsSet("lastLoc", loc);
        res(loc);
      }, e => rej(e), { enableHighAccuracy: true, timeout, maximumAge: 30000 });
    } catch (e) { rej(e); }
  });
}

/* Read GPS from a JPEG's EXIF block, when the camera kept it. */
async function exifGPS(file) {
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
        let gpsOff = null;
        for (let i = 0, n = u16(ifd0); i < n; i++) { const e = ifd0 + 2 + i * 12; if (u16(e) === 0x8825) gpsOff = tiff + u32(e + 8); }
        if (!gpsOff) return null;
        const tags = {};
        for (let i = 0, n = u16(gpsOff); i < n; i++) {
          const e = gpsOff + 2 + i * 12, tag = u16(e), type = u16(e + 2);
          if (type === 2) tags[tag] = String.fromCharCode(v.getUint8(e + 8));
          else if (type === 5) { const p = tiff + u32(e + 8), r = []; for (let k = 0; k < 3; k++) r.push(u32(p + k * 8) / (u32(p + k * 8 + 4) || 1)); tags[tag] = r; }
        }
        if (!tags[2] || !tags[4]) return null;
        const dms = a => a[0] + a[1] / 60 + a[2] / 3600;
        let lat = dms(tags[2]), lng = dms(tags[4]);
        if (tags[1] === "S") lat = -lat;
        if (tags[3] === "W") lng = -lng;
        if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
        return { lat, lng };
      }
      if ((marker & 0xFF00) !== 0xFF00) break;
      off += 2 + len;
    }
  } catch (e) {}
  return null;
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
async function fetchWeather(lat, lng) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,weather_code,wind_speed_10m&daily=precipitation_sum,temperature_2m_min&past_days=3&forecast_days=1&timezone=auto`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000);
  const r = await fetch(u, { signal: ctl.signal }); clearTimeout(t);
  if (!r.ok) throw new Error("weather " + r.status);
  const j = await r.json();
  const rain = (j.daily.precipitation_sum || []).slice(0, 3).reduce((a, b) => a + (b || 0), 0);
  const minT = Math.min(...(j.daily.temperature_2m_min || []).slice(0, 3).filter(x => x != null));
  return {
    chips: wmoToChips(j.current.weather_code, j.current.wind_speed_10m),
    temp: Math.round(j.current.temperature_2m),
    rainRecent: rain < 1 ? "Dry for days" : rain < 10 ? "Light rain recently" : "Heavy rain recently",
    note: `${rain.toFixed(1)} mm of rain over the last 3 days${isFinite(minT) ? `, lowest ${Math.round(minT)} °C` : ""}. From Open-Meteo.`
  };
}

/* ============================================================
   Maps: OpenStreetMap tiles, cached on the device for offline use.
   ============================================================ */
const hasLeaflet = typeof L !== "undefined";
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const OfflineTiles = hasLeaflet ? L.TileLayer.extend({
  createTile(coords, done) {
    const img = document.createElement("img");
    img.alt = ""; img.setAttribute("role", "presentation");
    const key = `${coords.z}/${coords.x}/${coords.y}`;
    const net = () => { img.onload = () => done(null, img); img.onerror = () => done(new Error("tile"), img); img.src = TILE_URL(coords.z, coords.x, coords.y); };
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
  new OfflineTiles("", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(m);
  m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  maps.push(m);
  setTimeout(() => m.invalidateSize(), 60);
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
  downloading = true;
  let done = 0, failed = 0, i = 0;
  async function worker() {
    while (i < list.length && downloading) {
      const [z, x, y] = list[i++], key = `${z}/${x}/${y}`;
      try {
        if (!(await store.get("tiles", key))) {
          const r = await fetch(TILE_URL(z, x, y), { mode: "cors" });
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
      edibility: e.edib, revisit: !!e.revisit, tags: e.tags, idApp: e.idApp || null
    });
  }
}
async function removeExamples() {
  for (const f of finds.filter(f => f.sample)) {
    await store.del("finds", f.id);
    for (const p of f.photos) await store.del("photos", p.key);
  }
  await loadFinds();
}

/* ============================================================
   Router
   ============================================================ */
const titleEl = $("#title"), backBtn = $("#backBtn"), brand = $("#brandMark"), main = $("#main"), topActions = $("#topActions");
backBtn.addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "log"; });
function setChrome({ title, back = false, tab = null, actions = "" }) {
  titleEl.textContent = title;
  backBtn.hidden = !back; brand.style.display = back ? "none" : "";
  topActions.innerHTML = actions;
  $$(".tab").forEach(t => t.removeAttribute("aria-current"));
  if (tab) { const t = $(`.tab[data-tab="${tab}"]`); if (t) t.setAttribute("aria-current", "page"); }
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
  if (h === "map") return renderMap();
  if (h === "season") return renderSeason();
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
    try { loc = await getPosition(8000); src = "gps"; } catch (e) { if (exif) { loc = { ...exif, acc: null }; src = "photo"; } }
    const key = "p-" + uid(), nowISO = new Date().toISOString();
    await store.put("photos", blob, key);
    const f = normalise({
      id: uid(), type: lsGet("lastType", "mushroom"), name: "", photos: [{ key, label: "Whole" }],
      lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, acc: loc ? loc.acc ?? null : null, locSource: src,
      foundAt: nowISO, createdAt: nowISO, updatedAt: nowISO, needsDetails: true,
      width: null, height: null, length: null, stem: null, colours: [], colourNote: "", description: "",
      weather: [], rainRecent: "", temp: null, weatherNote: ""
    });
    await store.put("finds", f);
    if (finds.some(x => x.sample)) await removeExamples();
    await loadFinds();
    toast(loc ? "Saved with location. Add details later." : "Saved. No location yet, so pin it when you add details.");
    renderLog();
    // Fill weather quietly if there's signal.
    if (loc && navigator.onLine) fetchWeather(loc.lat, loc.lng).then(async w => {
      const cur = finds.find(x => x.id === f.id); if (!cur || cur.weather.length) return;
      Object.assign(cur, { weather: w.chips, temp: w.temp, rainRecent: w.rainRecent, weatherNote: w.note });
      await store.put("finds", cur);
    }).catch(() => {});
  } catch (e) { toast(e.message || "Couldn't save that photo"); }
}

/* ============================================================
   Finds list
   ============================================================ */
function matches(f) {
  if (view.filter === "todo") { if (!f.needsDetails) return false; }
  else if (view.filter !== "all" && f.type !== view.filter) return false;
  if (view.tag && !f.tags.includes(view.tag)) return false;
  if (view.q) {
    const hay = [f.name, f.description, f.colourNote, f.trees, f.substrate, f.weatherNote, ...(f.habitat || []), ...(f.tags || []), ...(f.colours || []), f.idApp && f.idApp.result].join(" ").toLowerCase();
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
function cardHTML(f) {
  const dist = lastLoc && f.lat != null ? fmtDist(haversine(lastLoc, f)) : null;
  const dateStr = view.sort === "season" ? fmtDate(f.foundAt) : fmtDate(f.foundAt, { weekday: "short", day: "numeric", month: "short" });
  return `<a class="card" href="#find-${esc(f.id)}">
    <img class="thumb" data-photo="${esc(cover(f) || "")}" alt="">
    <div class="card-body">
      <div class="card-title ${f.name ? "" : "unnamed"}">${esc(f.name || "Not yet identified")}</div>
      <div class="meta"><span class="dot ${f.type}"></span><span>${f.type === "plant" ? "Plant" : "Mushroom"}</span>${f.needsDetails ? '<span class="badge-todo">Add details</span>' : ""}${f.revisit ? '<span class="badge-rv">Revisit</span>' : ""}${f.sample ? '<span class="badge-ex">Example</span>' : ""}</div>
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
  setChrome({ title: "Spore & Leaf", tab: "log" });
  main.innerHTML = `<div class="wrap view">
    ${finds.some(f => f.sample) ? `<div class="banner warn"><svg><use href="#i-warn"/></svg><div class="grow">The finds marked <b>Example</b> show how the log looks. They'll disappear when you save your first find.</div></div>` : ""}
    <label class="quick" for="quickIn"><span class="qi"><svg><use href="#i-bolt"/></svg></span><span><b>Quick log</b><span>One tap: photo, location and time saved now. Add the details later.</span></span></label>
    <input class="sr" type="file" id="quickIn" accept="image/*" capture="environment">
    <div class="toolbar">
      <div class="search"><svg><use href="#i-search"/></svg><input type="text" id="q" placeholder="Search names, notes and #tags" value="${esc(view.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search finds"></div>
      <div class="seg" role="group" aria-label="Show" id="filterSeg"></div>
      <div class="chips" id="tagRow"></div>
      <div class="sortrow"><label for="sortSel">Sort</label>
        <select id="sortSel">
          <option value="newest">Newest first, by month</option>
          <option value="oldest">Oldest first, by month</option>
          <option value="season">Month of the year</option>
          <option value="nearest">Nearest to me</option>
          <option value="name">Name, A to Z</option>
        </select></div>
      <div id="sortNote"></div>
    </div>
    <div id="results" style="display:flex;flex-direction:column;gap:16px"></div>
  </div>`;
  $("#sortSel").value = view.sort;
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
  finds.forEach(f => { counts[f.type]++; if (f.needsDetails) counts.todo++; });
  if (view.filter === "todo" && !counts.todo) view.filter = "all";
  const segs = [["all", "All"], ["mushroom", "Mushrooms"], ["plant", "Plants"]];
  if (counts.todo) segs.push(["todo", "To finish"]);
  $("#filterSeg").innerHTML = segs.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${view.filter === v}">${l} <span class="num" style="opacity:.7">${counts[v]}</span></button>`).join("");
  $$("#filterSeg button").forEach(b => b.addEventListener("click", () => { view.filter = b.dataset.v; lsSet("filter", view.filter); renderResults(); }));

  const tagCounts = {};
  finds.forEach(f => f.tags.forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1));
  const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  $("#tagRow").innerHTML = tags.map(([t]) => `<button type="button" class="tag" data-t="${esc(t)}" aria-pressed="${view.tag === t}">#${esc(t)}</button>`).join("");
  $("#tagRow").hidden = !tags.length;
  $$("#tagRow .tag").forEach(b => b.addEventListener("click", () => { view.tag = view.tag === b.dataset.t ? null : b.dataset.t; renderResults(); }));

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
  const groupCounts = {};
  list.forEach(f => { const k = groupKey(f); if (k) groupCounts[k] = (groupCounts[k] || 0) + 1; });
  let cur = null, html = "", items = [];
  const flush = () => { if (items.length) { html += `<div class="list">${items.join("")}</div>`; items = []; } };
  for (const f of list) {
    const k = groupKey(f);
    if (k && k !== cur) { flush(); cur = k; html += `<div class="group-h"><h2>${esc(k)}</h2><span class="num">${groupCounts[k]} ${groupCounts[k] === 1 ? "find" : "finds"}</span></div>`; }
    items.push(cardHTML(f));
  }
  flush();
  res.innerHTML = html;
  hydrateThumbs(res);
}

/* ============================================================
   Detail
   ============================================================ */
const measureVal = cm => cm == null ? "—" : `${toDisp(cm)}<small> ${unitLabel()}</small>`;
const edibLabel = v => (EDIBILITY.find(e => e[0] === v) || EDIBILITY[0])[1];
function chipSwatch(name, list) { const s = list.find(x => x[0] === name); return `<span class="chip" style="cursor:default"><span class="sw" style="background:${s ? s[1] : "transparent"}"></span>${esc(name)}</span>`; }
async function renderDetail(id) {
  const f = finds.find(x => x.id === id);
  if (!f) { location.hash = "log"; return; }
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
  if (f.trees) idBits.push(`<div class="fact"><span class="eyebrow">Nearby trees</span><span class="v">${esc(f.trees)}</span></div>`);

  main.innerHTML = `<div class="wrap view">
    ${f.needsDetails ? `<div class="banner warn"><svg><use href="#i-bolt"/></svg><div class="grow">Saved with Quick log. <a href="#edit-${esc(f.id)}" style="color:inherit;font-weight:700">Add the details</a> while you remember them.</div></div>` : ""}
    ${f.photos.length ? `<img class="hero-photo" id="heroImg" alt="Photo of ${esc(f.name || "this find")}">` : ""}
    ${f.photos.length > 1 ? `<div class="strip" id="strip">${f.photos.map((p, i) => `<button type="button" data-i="${i}" aria-pressed="${i === 0}" aria-label="Show ${esc(p.label || "photo " + (i + 1))}"><img data-photo="${esc(p.key)}" alt=""><small>${esc(p.label || "Photo")}</small></button>`).join("")}</div>` : ""}
    <div class="detail-head">
      <div class="btn-row" style="gap:8px"><span class="type-pill ${f.type}"><span class="dot ${f.type}"></span>${isShroom ? "Mushroom" : "Plant"}${f.sample ? " · Example" : ""}</span><span class="edib ${esc(f.edibility)}">${esc(edibLabel(f.edibility))}</span></div>
      <h2>${esc(f.name || "Not yet identified")}</h2>
      <div class="meta num" style="font-size:15px"><span>${esc(fmtDate(f.foundAt, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</span><span class="sep">${esc(fmtTime(f.foundAt))}</span><span class="sep">${esc(timeOfDay(new Date(f.foundAt)))}</span></div>
      ${f.tags.length ? `<div class="chips" style="gap:6px">${f.tags.map(t => `<span class="tag" style="cursor:default">#${esc(t)}</span>`).join("")}</div>` : ""}
    </div>
    <div class="banner danger"><svg><use href="#i-warn"/></svg><div class="grow"><b>Never eat anything based on this log or any app${f.edibility === "edible" ? ", even when it's marked edible" : ""}.</b> Many deadly species look like edible ones. Have every find checked in person by an expert.</div></div>
    ${f.idApp && (f.idApp.result || f.idApp.confidence != null) ? `<div class="section"><h3>Identification</h3><div class="facts" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))"><div class="fact"><span class="eyebrow">${esc(f.idApp.source || "Shroom ID")} says</span><span class="v">${esc(f.idApp.result || "—")}</span></div><div class="fact"><span class="eyebrow">Confidence</span><span class="v num">${f.idApp.confidence != null ? esc(f.idApp.confidence) + "<small> %</small>" : "—"}</span></div></div><p class="hint">An app's suggestion, not a confirmed identification.</p></div>` : ""}
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
    <div class="section"><h3>Weather</h3>
      <div class="facts" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        <div class="fact"><span class="eyebrow">On the day</span><span class="v">${esc((f.weather || []).join(", ") || "—")}</span></div>
        <div class="fact"><span class="eyebrow">Recent rain</span><span class="v">${esc(f.rainRecent || "—")}</span></div>
        <div class="fact"><span class="eyebrow">Temperature</span><span class="v num">${f.temp != null ? esc(f.temp) + "<small> °C</small>" : "—"}</span></div>
      </div>
      ${f.weatherNote ? `<p class="hint">${esc(f.weatherNote)}</p>` : ""}
    </div>
    <div class="section"><h3>Location</h3>
      ${f.lat != null ? `<div class="mini-map" id="miniMap"></div>
        <div class="coords num">${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}${f.acc ? ` · ±${esc(f.acc)} m` : ""} · ${esc(src)}${dist ? ` · ${esc(dist)} from your last known location` : ""}</div>`
      : `<p style="color:var(--muted)">No location saved. <a href="#edit-${esc(f.id)}" style="color:var(--shroom)">Pin it on the map</a>.</p>`}
    </div>
    <div class="section"><h3>Entry</h3><p class="coords num">Logged ${esc(fmtDate(f.createdAt))} at ${esc(fmtTime(f.createdAt))}${f.updatedAt && f.updatedAt !== f.createdAt ? ` · last edited ${esc(fmtDate(f.updatedAt))} at ${esc(fmtTime(f.updatedAt))}` : ""}</p></div>
    <div class="btn-row" id="delRow"><a class="btn" href="#edit-${esc(f.id)}"><svg><use href="#i-edit"/></svg>Edit</a><button class="btn danger" type="button" id="delBtn">Delete</button></div>
  </div>`;
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
  $("#delBtn").addEventListener("click", () => {
    $("#delRow").innerHTML = `<div class="banner danger" style="width:100%"><div class="grow">Delete this find and its ${f.photos.length === 1 ? "photo" : "photos"}? This can't be undone.</div></div><button class="btn danger" type="button" id="delYes">Yes, delete</button><button class="btn ghost" type="button" id="delNo">Keep it</button>`;
    $("#delNo").addEventListener("click", () => renderDetail(id));
    $("#delYes").addEventListener("click", async () => {
      await store.del("finds", f.id);
      for (const p of f.photos) await store.del("photos", p.key);
      await loadFinds(); toast("Find deleted"); location.hash = "log";
    });
  });
}

/* ============================================================
   New / edit form
   ============================================================ */
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
    spore: "", gills: "", substrate: "", habitat: [], trees: "", edibility: "unknown", revisit: false, tags: [], idApp: { source: "Shroom ID", result: "", confidence: null }
  });
  f.idApp = f.idApp || { source: "Shroom ID", result: "", confidence: null };
  // Photos being edited: existing keys plus new blobs waiting to be saved.
  let photos = f.photos.map(p => ({ ...p }));
  const removedKeys = [];
  let photoExif = null;
  const canShare = !!(navigator.canShare && navigator.share);
  setChrome({ title: existing ? (existing.needsDetails ? "Add details" : "Edit find") : "New find", back: true });
  const u = unitLabel();
  main.innerHTML = `<div class="wrap view"><form id="findForm" novalidate>
    <div class="seg" role="group" aria-label="What did you find?">
      <button type="button" data-v="mushroom" aria-pressed="${f.type === "mushroom"}"><svg width="18" height="18"><use href="#i-shroom"/></svg>Mushroom</button>
      <button type="button" data-v="plant" aria-pressed="${f.type === "plant"}"><svg width="18" height="18"><use href="#i-leaf"/></svg>Plant</button>
    </div>

    <fieldset><legend>Photos</legend>
      <div class="photo-grid" id="photoGrid"></div>
      <div class="photo-actions">
        <label class="btn primary" for="camIn"><svg><use href="#i-cam"/></svg>Take photo</label>
        <label class="btn" for="galIn"><svg><use href="#i-img"/></svg>From gallery</label>
      </div>
      <span class="hint" id="photoHint"></span>
      <input class="sr" type="file" id="camIn" accept="image/*" capture="environment">
      <input class="sr" type="file" id="galIn" accept="image/*" multiple>
    </fieldset>

    <fieldset><legend>Name and identification</legend>
      <div class="field"><label for="name">What is it?</label>
        <input type="text" id="name" autocomplete="off" placeholder="e.g. Chanterelle, Cantharellus cibarius" value="${esc(f.name)}">
        <span class="hint">Leave it blank if you haven't identified it yet.</span></div>
      <div class="panel" style="background:var(--surface-2)">
        <h3>Shroom ID</h3>
        <p>${canShare ? "Send the first photo to Shroom ID from the share menu, then note what it suggests here." : "Run your photo through Shroom ID, then note what it suggests here."}</p>
        ${canShare ? `<div class="btn-row"><button class="btn small" type="button" id="shareBtn"><svg><use href="#i-share"/></svg>Send photo to Shroom ID</button></div>` : ""}
        <div class="grid-2">
          <div class="field"><label for="idResult">Its suggestion</label><input type="text" id="idResult" value="${esc(f.idApp.result)}" placeholder="e.g. Cantharellus cibarius"></div>
          <div class="field"><label for="idConf">Confidence</label><div class="unit-in"><input type="number" inputmode="numeric" min="0" max="100" id="idConf" value="${f.idApp.confidence ?? ""}"><span>%</span></div></div>
        </div>
        <div class="btn-row"><button class="btn small ghost" type="button" id="useIdName">Use as name</button></div>
      </div>
      <div class="field"><label for="edib">Edibility</label>
        <select id="edib">${EDIBILITY.map(([v, l]) => `<option value="${v}" ${f.edibility === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <span class="hint" id="edibHint">Only mark a find edible once an expert has checked it in person. Never eat anything based on an app.</span></div>
    </fieldset>

    <fieldset><legend>When</legend>
      <div class="auto-time"><div><div class="eyebrow">Found</div><div class="big num" id="todLabel"></div></div>
        <button class="btn small ghost" type="button" id="editTime"><svg><use href="#i-edit"/></svg>Change</button></div>
      <div class="field" id="timeField" hidden><label for="foundAt">Date and time found</label><input type="datetime-local" id="foundAt" value="${toLocalInput(new Date(f.foundAt))}"></div>
      <span class="hint">Filled in from your phone's clock. The entry's own date and time are saved when you tap Save.</span>
    </fieldset>

    <fieldset><legend>Location</legend>
      <div class="loc-box">
        <div class="loc-status" id="locStatus"></div>
        <div class="coords num" id="locCoords"></div>
        <div class="btn-row">
          <button class="btn small" type="button" id="gpsBtn"><svg><use href="#i-gps"/></svg>Use my location</button>
          <button class="btn small" type="button" id="pinBtn"><svg><use href="#i-pin"/></svg>Pin on map</button>
          <button class="btn small" type="button" id="exifBtn" hidden><svg><use href="#i-img"/></svg>Use photo's location</button>
          <button class="btn small ghost" type="button" id="clearLoc" hidden>Clear</button>
        </div>
      </div>
      <label class="switch panel" for="revisit"><span><b>Revisit this spot</b><br><span class="hint">Remind me to check here around this date next year.</span></span><input type="checkbox" id="revisit" ${f.revisit ? "checked" : ""}></label>
    </fieldset>

    <fieldset><legend>Size</legend>
      <div class="grid-2">
        <div class="field"><label for="width">Width</label><div class="unit-in"><input type="number" inputmode="decimal" step="any" min="0" id="width" value="${toDisp(f.width)}"><span>${u}</span></div></div>
        <div class="field"><label for="height">Height</label><div class="unit-in"><input type="number" inputmode="decimal" step="any" min="0" id="height" value="${toDisp(f.height)}"><span>${u}</span></div></div>
        <div class="field"><label for="length">Length</label><div class="unit-in"><input type="number" inputmode="decimal" step="any" min="0" id="length" value="${toDisp(f.length)}"><span>${u}</span></div></div>
        <div class="field"><label for="stem">Stem height</label><div class="unit-in"><input type="number" inputmode="decimal" step="any" min="0" id="stem" value="${toDisp(f.stem)}"><span>${u}</span></div></div>
      </div>
      <span class="hint" id="sizeHint"></span>
    </fieldset>

    <fieldset><legend>Colour</legend>
      ${chipGroup("colourChips", COLOURS, f.colours)}
      <div class="field"><label for="colourNote">Colour notes</label><input type="text" id="colourNote" placeholder="e.g. cap orange fading to cream at the edge, bruises blue" value="${esc(f.colourNote)}"></div>
    </fieldset>

    <fieldset id="shroomFields"><legend>Spore print and underside</legend>
      <div class="lbl">Spore print colour</div>
      ${chipGroup("sporeChips", SPORE, f.spore ? [f.spore] : [])}
      <span class="hint">Leave the cap gills-down on white and dark paper for a few hours.</span>
      <div class="lbl">Under the cap</div>
      ${chipGroup("gillChips", GILLS, f.gills ? [f.gills] : [])}
    </fieldset>

    <fieldset><legend>Habitat</legend>
      <div class="lbl">Growing on</div>
      ${chipGroup("subChips", SUBSTRATE, f.substrate ? [f.substrate] : [])}
      <div class="lbl">Habitat</div>
      ${chipGroup("habChips", HABITAT, f.habitat)}
      <div class="field"><label for="trees">Nearby trees or plants</label><input type="text" id="trees" placeholder="e.g. birch, beech, under bracken" value="${esc(f.trees)}"></div>
    </fieldset>

    <fieldset><legend>Description</legend>
      <div class="field"><label for="desc">Describe it</label><textarea id="desc">${esc(f.description)}</textarea></div>
      <div class="field"><label for="tags">Tags</label><input type="text" id="tags" placeholder="e.g. #oak-woods, #autumn, #river-walk" value="${esc(f.tags.map(t => "#" + t).join(", "))}"><span class="hint">Separate tags with commas. Tap a tag on the Finds screen to filter by it.</span></div>
    </fieldset>

    <fieldset><legend>Recent weather</legend>
      <div class="btn-row" id="wxAutoRow"><button class="btn small" type="button" id="wxAuto"><svg><use href="#i-cloud"/></svg>Fill in from the forecast</button></div>
      <div class="lbl">On the day</div>
      ${chipGroup("wxChips", WEATHER, f.weather, "w")}
      <div class="grid-2">
        <div class="field"><label for="rainRecent">Last few days</label><select id="rainRecent"><option value="">Choose</option>${RAIN_RECENT.map(r => `<option ${f.rainRecent === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        <div class="field"><label for="temp">Temperature</label><div class="unit-in"><input type="number" inputmode="decimal" step="any" id="temp" value="${f.temp ?? ""}"><span>°C</span></div></div>
      </div>
      <div class="field"><label for="wxNote">Weather notes</label><input type="text" id="wxNote" placeholder="e.g. first frost two nights ago" value="${esc(f.weatherNote)}"></div>
    </fieldset>

    <div class="savebar"><a class="btn ghost" href="${existing ? "#find-" + esc(f.id) : "#log"}">Cancel</a><button class="btn primary" type="submit" id="saveBtn">Save find</button></div>
  </form></div>`;

  const form = $("#findForm");
  // Type toggle and type-specific bits
  function applyType() {
    $$(".seg button", form).forEach(x => x.setAttribute("aria-pressed", x.dataset.v === f.type));
    $("#shroomFields").hidden = f.type !== "mushroom";
    $("#desc").placeholder = f.type === "plant" ? "Leaf shape, flowers, smell, what it's growing near…" : "Cap shape and texture, ring, smell, how the stem base looks, bruising…";
    $("#sizeHint").textContent = f.type === "plant" ? "For plants, stem height is the main stalk from the ground to the first leaves or flower." : "Width is the cap's widest point. Stem height is from the ground to the underside of the cap.";
    $("#photoHint").textContent = f.type === "plant" ? "Add the leaves, flowers and the whole plant. The first photo is the cover." : "Add the cap, the underside, the stem base and a spore print. The first photo is the cover.";
  }
  $$(".seg button", form).forEach(b => b.addEventListener("click", () => { f.type = b.dataset.v; applyType(); }));
  applyType();
  multiSelect(form, "colourChips"); multiSelect(form, "wxChips"); multiSelect(form, "habChips");
  singleSelect(form, "sporeChips"); singleSelect(form, "gillChips"); singleSelect(form, "subChips");

  // Edibility warning
  const edibHint = () => {
    const v = $("#edib").value;
    $("#edibHint").textContent = v === "edible"
      ? "Marked edible. Only keep this if an expert checked this exact find in person. The app will still warn you not to eat it based on the log."
      : "Only mark a find edible once an expert has checked it in person. Never eat anything based on an app.";
    $("#edibHint").style.color = v === "edible" ? "var(--warn-fg)" : "";
  };
  $("#edib").addEventListener("change", edibHint); edibHint();

  // Shroom ID
  $("#useIdName").addEventListener("click", () => { const v = $("#idResult").value.trim(); if (v) { $("#name").value = v; toast("Name filled in"); } });
  const sb = $("#shareBtn");
  if (sb) sb.addEventListener("click", async () => {
    const first = photos[0];
    if (!first) { toast("Add a photo first"); return; }
    try {
      const blob = first.blob || await store.get("photos", first.key);
      if (typeof blob === "string") { toast("Example photos can't be shared"); return; }
      const file = new File([blob], "find.jpg", { type: "image/jpeg" });
      if (!navigator.canShare({ files: [file] })) { toast("Sharing photos isn't supported here"); return; }
      await navigator.share({ files: [file], title: "Mushroom photo" });
    } catch (e) { if (e && e.name !== "AbortError") toast("Couldn't open the share menu"); }
  });

  // Time
  const todLabel = () => { const d = new Date($("#foundAt").value || f.foundAt); $("#todLabel").textContent = `${timeOfDay(d)} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`; };
  todLabel();
  $("#foundAt").addEventListener("input", todLabel);
  $("#editTime").addEventListener("click", () => { $("#timeField").hidden = false; $("#editTime").hidden = true; $("#foundAt").focus(); });

  // Photos
  async function drawPhotos() {
    const g = $("#photoGrid");
    g.hidden = !photos.length;
    g.innerHTML = photos.map((p, i) => `<div class="ph-item">${i === 0 ? '<span class="cover">Cover</span>' : ""}<img data-i="${i}" alt="${esc(p.label || "Photo")}"><button type="button" class="rm" data-rm="${i}" aria-label="Remove photo">×</button><select data-lbl="${i}" aria-label="What this photo shows">${PHOTO_LABELS.map(l => `<option ${p.label === l ? "selected" : ""}>${l}</option>`).join("")}</select>${i > 0 ? `<button type="button" class="btn small ghost" data-cv="${i}" style="border-radius:0;border:0;border-top:1px solid var(--line)">Make cover</button>` : ""}</div>`).join("");
    for (const img of $$("img[data-i]", g)) {
      const p = photos[+img.dataset.i];
      img.src = p.blob ? (p.url ||= URL.createObjectURL(p.blob)) : (await photoURL(p.key)) || "";
    }
  }
  $("#photoGrid").addEventListener("click", e => {
    const rm = e.target.closest("[data-rm]"), cv = e.target.closest("[data-cv]");
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
  function showLoc(msg) {
    const ok = f.lat != null;
    $("#locStatus").className = "loc-status " + (ok ? "ok" : "none");
    const srcText = { gps: "Location from GPS", photo: "Location from the photo", pin: "Pinned on the map" }[f.locSource] || "Location saved";
    $("#locStatus").innerHTML = `<svg><use href="#i-pin"/></svg><span></span>`;
    $("#locStatus span").textContent = msg || (ok ? srcText : "No location yet");
    $("#locCoords").textContent = ok ? `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}${f.acc ? ` · accurate to about ${f.acc} m` : ""}` : (geoAvailable() ? "" : "GPS isn't available here. Pin the spot on the map instead.");
    $("#clearLoc").hidden = !ok;
    wxRow();
  }
  function setLoc(loc, src) { f.lat = loc.lat; f.lng = loc.lng; f.acc = loc.acc ?? null; f.locSource = src; showLoc(); }
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

  // Auto weather: only when online, the spot is known and the find is recent.
  function wxRow() {
    const recent = Math.abs(Date.now() - new Date($("#foundAt").value || f.foundAt)) < 6 * 3600000;
    $("#wxAutoRow").hidden = !(navigator.onLine && f.lat != null && recent);
  }
  $("#foundAt").addEventListener("input", wxRow);
  $("#wxAuto").addEventListener("click", async () => {
    const b = $("#wxAuto"); b.disabled = true;
    try {
      const w = await fetchWeather(f.lat, f.lng);
      $$("#wxChips .chip", form).forEach(c => c.setAttribute("aria-pressed", w.chips.includes(c.dataset.w)));
      $("#temp").value = w.temp; $("#rainRecent").value = w.rainRecent;
      if (!$("#wxNote").value) $("#wxNote").value = w.note;
      toast("Weather filled in");
    } catch (e) { toast("Couldn't reach the weather service. Fill it in by hand."); }
    b.disabled = false;
  });
  showLoc();
  if (!existing && geoAvailable()) tryGPS(true);
  else if (!geoAvailable()) $("#gpsBtn").hidden = true;

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
    f.description = $("#desc").value.trim();
    f.weather = picked(form, "wxChips", "w");
    f.rainRecent = $("#rainRecent").value;
    f.temp = $("#temp").value === "" ? null : +$("#temp").value;
    f.weatherNote = $("#wxNote").value.trim();
    f.spore = f.type === "mushroom" ? (picked(form, "sporeChips")[0] || "") : "";
    f.gills = f.type === "mushroom" ? (picked(form, "gillChips")[0] || "") : "";
    f.substrate = picked(form, "subChips")[0] || "";
    f.habitat = picked(form, "habChips");
    f.trees = $("#trees").value.trim();
    f.tags = parseTags($("#tags").value);
    f.edibility = $("#edib").value;
    f.revisit = $("#revisit").checked;
    const conf = $("#idConf").value;
    f.idApp = { source: "Shroom ID", result: $("#idResult").value.trim(), confidence: conf === "" ? null : Math.max(0, Math.min(100, Math.round(+conf))) };
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
      location.hash = "find-" + f.id;
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
   Map tab: every find, plus saving an area for offline use
   ============================================================ */
async function renderMap() {
  setChrome({ title: "Map", tab: "map" });
  const tileCount = await store.count("tiles").catch(() => 0);
  const shown = { mushroom: true, plant: true };
  main.innerHTML = `<div class="wrap view">
    <div class="legend" style="justify-content:space-between"><span style="gap:14px;display:inline-flex;flex-wrap:wrap">
      <button type="button" class="chip" data-k="mushroom" aria-pressed="true"><span class="dot mushroom"></span>Mushrooms</button>
      <button type="button" class="chip" data-k="plant" aria-pressed="true"><span class="dot plant"></span>Plants</button></span></div>
    <div class="map-full" id="bigMap"></div>
    <div class="panel">
      <h3>Offline map</h3>
      <p id="offMsg">While you have signal, move the map to the area you forage in, then save it. It will load with no signal later. <span class="num">${tileCount}</span> map tiles are saved on this phone.</p>
      <div class="progress" id="prog" hidden><i></i></div>
      <div class="btn-row"><button class="btn plant" type="button" id="dlBtn"><svg><use href="#i-down"/></svg><span>Save this area</span></button><button class="btn ghost" type="button" id="meBtn"><svg><use href="#i-gps"/></svg>Find me</button></div>
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
  $$(".legend .chip").forEach(b => b.addEventListener("click", () => {
    const k = b.dataset.k; shown[k] = !shown[k]; b.setAttribute("aria-pressed", shown[k]);
    shown[k] ? layers[k].addTo(m) : layers[k].remove();
  }));
  let meMarker = null;
  const showMe = () => { if (!lastLoc) return; if (meMarker) meMarker.setLatLng([lastLoc.lat, lastLoc.lng]); else meMarker = L.marker([lastLoc.lat, lastLoc.lng], { icon: pinIcon("me"), interactive: false }).addTo(m); };
  showMe();
  if (pts.length > 1 && !lastLoc) m.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
  $("#meBtn").addEventListener("click", async () => {
    try { await getPosition(); showMe(); m.setView([lastLoc.lat, lastLoc.lng], 14); } catch (e) { toast("Location isn't available here"); }
  });
  $("#dlBtn").addEventListener("click", async () => {
    const label = $("#dlBtn span");
    if (downloading) { downloading = false; return; }
    const z = m.getZoom();
    if (z < 10) { toast("Zoom in closer first, to a few kilometres across"); return; }
    let zMax = Math.min(17, z + 3), list = tilesFor(m.getBounds(), Math.max(8, z - 2), zMax);
    while (list.length > MAX_TILES && zMax > z) { zMax--; list = tilesFor(m.getBounds(), Math.max(8, z - 2), zMax); }
    if (list.length > MAX_TILES) { toast("That area is too big. Zoom in a little."); return; }
    const prog = $("#prog"), bar = prog.firstElementChild;
    prog.hidden = false; label.textContent = "Stop";
    const { done, failed } = await downloadTiles(list, d => { bar.style.width = (d / list.length * 100) + "%"; $("#offMsg").textContent = `Saving map tiles: ${d} of ${list.length}`; });
    label.textContent = "Save this area";
    const total = await store.count("tiles").catch(() => 0);
    $("#offMsg").textContent = done && failed === done
      ? "The map couldn't be downloaded. Check you have signal and try again."
      : `Saved this area down to street level. ${total} map tiles are now on this phone${failed ? `, and ${failed} couldn't be downloaded` : ""}.`;
  });
}

/* ============================================================
   Season: revisit list and season stats
   ============================================================ */
function renderSeason() {
  setChrome({ title: "Season", tab: "season" });
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

  main.innerHTML = `<div class="wrap view">
    <div class="section"><h3>Spots to revisit</h3>
      ${rv.length ? `<div class="list">${rv.map(({ f, nv }) => `<a class="card" href="#find-${esc(f.id)}"><img class="thumb" data-photo="${esc(cover(f) || "")}" alt=""><div class="card-body"><div class="card-title ${f.name ? "" : "unnamed"}">${esc(f.name || "Not yet identified")}</div><div class="meta"><span class="${nv.days <= 21 ? "due" : ""}">${esc(visitLabel(nv.days))}</span></div><div class="meta num"><span>Found ${esc(fmtDate(f.foundAt))}</span>${lastLoc && f.lat != null ? `<span class="sep">${esc(fmtDist(haversine(lastLoc, f)))} away</span>` : ""}</div></div></a>`).join("")}</div>`
      : `<p class="hint">Turn on "Revisit this spot" when you log a find, and it shows up here as that date comes round again.</p>`}
    </div>

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

    <div class="panel"><h3>Most found</h3>
      ${top.length ? `<ul class="rank">${top.map(([n, v]) => `<li><span>${esc(n)}</span><span class="num" style="color:var(--muted)">${v.n}</span><span class="track"><i style="width:${v.n / topMax * 100}%;background:var(--chart-${v.type === "plant" ? "plant" : "shroom"})"></i></span></li>`).join("")}</ul>` : `<p>Name your finds to see which you come across most.</p>`}
    </div>
  </div>`;
  $$(".bar").forEach(b => {
    const show = () => { const i = +b.dataset.m, p = per[i]; $$(".bar").forEach(x => x.setAttribute("aria-pressed", x === b)); $("#chartTip").textContent = `${MONTHS[i]}: ${p.mushroom} ${p.mushroom === 1 ? "mushroom" : "mushrooms"}, ${p.plant} ${p.plant === 1 ? "plant" : "plants"}`; };
    b.addEventListener("click", show); b.addEventListener("mouseenter", show); b.addEventListener("focus", show);
  });
  hydrateThumbs(main);
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
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}
const stamp = () => new Date().toISOString().slice(0, 10);
async function exportBackup() {
  const photos = {};
  for (const f of finds) for (const p of f.photos) {
    const rec = await store.get("photos", p.key).catch(() => null);
    if (rec) photos[p.key] = typeof rec === "string" ? rec : await blobToDataURL(rec);
  }
  const json = JSON.stringify({ app: "spore-and-leaf", version: 1, exportedAt: new Date().toISOString(), finds, photos });
  const ok = await saveFile(`spore-and-leaf-backup-${stamp()}.json`, json, "application/json");
  if (ok) { lsSet("lastBackup", Date.now()); toast("Backup saved"); }
}
async function exportCSV() {
  const cols = ["name","type","foundAt","timeOfDay","lat","lng","locSource","width_cm","height_cm","length_cm","stem_cm","colours","colourNote","spore","gills","substrate","habitat","trees","edibility","shroomId","shroomIdConfidence","weather","rainRecent","temp_c","weatherNote","tags","revisit","description","photos","createdAt","updatedAt"];
  const q = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = finds.map(f => [f.name, f.type, f.foundAt, timeOfDay(new Date(f.foundAt)), f.lat, f.lng, f.locSource, f.width, f.height, f.length, f.stem, (f.colours || []).join("; "), f.colourNote, f.spore, f.gills, f.substrate, f.habitat.join("; "), f.trees, f.edibility, f.idApp && f.idApp.result, f.idApp && f.idApp.confidence, (f.weather || []).join("; "), f.rainRecent, f.temp, f.weatherNote, f.tags.join("; "), f.revisit ? "yes" : "", f.description, f.photos.length, f.createdAt, f.updatedAt].map(q).join(","));
  const ok = await saveFile(`spore-and-leaf-${stamp()}.csv`, "﻿" + [cols.join(","), ...rows].join("\n"), "text/csv");
  if (ok) toast("Spreadsheet saved");
}
async function importBackup(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app !== "spore-and-leaf" || !Array.isArray(j.finds)) throw new Error("That file isn't a Spore & Leaf backup.");
    const have = new Set(finds.map(f => f.id));
    let added = 0;
    for (const f of j.finds) {
      if (have.has(f.id)) continue;
      const nf = normalise(f);
      for (const p of nf.photos) { const d = j.photos && j.photos[p.key]; if (d) await store.put("photos", d.startsWith("data:image/svg") ? d : await dataURLToBlob(d), p.key); }
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
    <label class="panel switch" for="fieldMode"><span><h3>Field mode</h3><p>Bigger text and buttons for cold or muddy hands.</p></span><input type="checkbox" id="fieldMode" ${settings.field ? "checked" : ""}></label>
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
  $("#fieldMode").addEventListener("change", e => { settings.field = e.target.checked; lsSet("field", settings.field); document.body.classList.toggle("field", settings.field); });
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
  await openDB();
  try { await seedExamples(); } catch (e) {}
  await loadFinds();
  route();
  if (geoAvailable() && !lastLoc) getPosition().catch(() => {});
  if ("serviceWorker" in navigator && location.protocol === "https:" && !/claude\.ai|claudeusercontent/.test(location.host)) {
    try { navigator.serviceWorker.register("sw.js").catch(() => {}); } catch (e) {}
  }
})();
