// gen_geo.mjs — build-time geographic data generator (run: node scripts/gen_geo.mjs)
//
// Fetches public-domain / open geodata, simplifies with Douglas-Peucker, projects
// admin maps to a normalized viewBox, and writes compact JSON into web/static/geo/.
// Output is committed so the running server needs ZERO network (PRD §5.5).
//
// Sources:
//   - World land + country boundaries: Natural Earth 110m (public domain)
//   - China provinces/cities: DataV aliyun (adcode-based, has parent hierarchy)
//   - Japan / Malaysia / Singapore ADM1 (+ ADM2 where clean): geoBoundaries gbOpen
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "web", "static", "geo");

async function fetchJSON(url, tries = 4) {
  // The large geoBoundaries GitHub-raw downloads occasionally drop with
  // ECONNRESET / "terminated"; retry with backoff so a single flaky read does
  // not abort a multi-minute full regeneration.
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "dev-home-blog/1.0" } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) {
        const wait = 1500 * (i + 1);
        console.log(`  (retry ${i + 1}/${tries - 1} in ${wait}ms: ${e.message} — ${url})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

function write(rel, obj) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj));
  console.log(`  wrote ${rel} (${(JSON.stringify(obj).length / 1024).toFixed(1)} KB)`);
}

// Remove a country's drill-file directory so provinces that lost their drill
// status (or cities that were curated out) don't leave stale orphans behind.
// write() only ever creates/overwrites, so without this a rerun accumulates
// files from previous generations.
function cleanDir(rel) {
  rmSync(join(OUT, rel), { recursive: true, force: true });
}

// --- Douglas-Peucker simplification on [x,y] point arrays ---
function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}
function dpLine(points, eps) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = dpLine(points.slice(0, idx + 1), eps);
    const right = dpLine(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

// simplify handles closed rings: plain Douglas-Peucker degenerates when the
// first and last vertices coincide (every perpendicular distance is 0). Split
// the ring at its farthest vertex from the start and simplify each half.
function simplify(points, eps) {
  const n = points.length;
  const closed = n > 2 &&
    Math.abs(points[0][0] - points[n - 1][0]) < 1e-9 &&
    Math.abs(points[0][1] - points[n - 1][1]) < 1e-9;
  if (!closed) return dpLine(points, eps);

  const open = points.slice(0, -1); // drop duplicate closing vertex
  if (open.length < 4) return points;
  // Farthest vertex from the anchor becomes the split point.
  let far = 1, farD = -1;
  for (let i = 1; i < open.length; i++) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const half1 = dpLine(open.slice(0, far + 1), eps);
  const half2 = dpLine(open.slice(far).concat([open[0]]), eps);
  const ring = half1.slice(0, -1).concat(half2);
  // If the ring collapses below a triangle it is smaller than our detail
  // threshold; return the collapsed ring (callers drop rings with < 3 points)
  // rather than the full-resolution original.
  return ring;
}
function round(pts, dp = 2) {
  const f = 10 ** dp;
  return pts.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
}

// --- geometry helpers ---
// Flatten a GeoJSON geometry into an array of rings (each ring = [[lon,lat],...]).
function geomRings(geom) {
  if (!geom) return [];
  const rings = [];
  const push = (poly) => { for (const ring of poly) rings.push(ring); };
  if (geom.type === "Polygon") push(geom.coordinates);
  else if (geom.type === "MultiPolygon") for (const poly of geom.coordinates) push(poly);
  return rings;
}
function ringCentroid(ring) {
  let x = 0, y = 0, a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross; x += (x0 + x1) * cross; y += (y0 + y1) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    // fallback: average of vertices
    let sx = 0, sy = 0;
    for (const [px, py] of ring) { sx += px; sy += py; }
    return [sx / ring.length, sy / ring.length];
  }
  return [x / (6 * a), y / (6 * a)];
}
function largestRing(rings) {
  let best = rings[0], bestA = -1;
  for (const r of rings) {
    let a = 0;
    for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
    a = Math.abs(a);
    if (a > bestA) { bestA = a; best = r; }
  }
  return best;
}
// Signed-area magnitude of a ring, used to drop negligible islands/slivers.
function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a) / 2;
}
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Assign each ADM2 (city) feature to its parent ADM1 (province) by testing the
// city's centroid against every province's rings; falls back to the nearest
// province centroid when simplification leaves a city just outside every ring.
// Returns Map<provinceName, cityFeature[]>.
function assignParents(adm1Features, adm2Features) {
  const groups = new Map();
  adm1Features.forEach((f) => groups.set(f.name, []));
  for (const city of adm2Features) {
    const c = ringCentroid(largestRing(city.rings));
    let parent = null;
    for (const prov of adm1Features) {
      if (prov.rings.some((ring) => pointInRing(c, ring))) { parent = prov.name; break; }
    }
    if (!parent) {
      let bestD = Infinity;
      for (const prov of adm1Features) {
        const pc = ringCentroid(largestRing(prov.rings));
        const d = (pc[0] - c[0]) ** 2 + (pc[1] - c[1]) ** 2;
        if (d < bestD) { bestD = d; parent = prov.name; }
      }
    }
    if (parent) groups.get(parent).push(city);
  }
  return groups;
}

// --- equirectangular projection of lon/lat regions into a normalized viewBox ---
const VIEW = 1000;
function projectRegions(features, eps) {
  // Compute bounds.
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const f of features) for (const ring of f.rings) for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  const lat0 = ((minLat + maxLat) / 2) * Math.PI / 180;
  const kx = Math.cos(lat0); // latitude cosine correction
  const w = (maxLon - minLon) * kx, h = maxLat - minLat;
  const scale = (VIEW - 40) / Math.max(w, h);
  const offX = (VIEW - w * scale) / 2, offY = (VIEW - h * scale) / 2;
  const viewW = Math.round(w * scale + 40), viewH = Math.round(h * scale + 40);
  const proj = ([lon, lat]) => [
    (lon - minLon) * kx * scale + offX,
    (maxLat - lat) * scale + offY, // flip Y for screen
  ];
  const out = features.map((f) => {
    let polys = f.rings
      .map((ring) => round(simplify(ring.map(proj), eps)))
      .filter((r) => r.length >= 3);
    // Drop tiny slivers/islands (< minArea viewBox units^2) but always keep the
    // largest ring so no region ever vanishes entirely.
    if (polys.length > 1) {
      const areas = polys.map(ringArea);
      const maxA = Math.max(...areas);
      polys = polys.filter((_, i) => areas[i] === maxA || areas[i] >= 6);
    }
    return { name: f.name, key: f.key, drill: !!f.drill, polys };
  });
  return { view: [viewW, viewH], regions: out };
}

// ============ World globe (layer 1) ============
async function buildWorld() {
  console.log("world (Natural Earth 110m)…");
  const land = await fetchJSON("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson");
  const countries = await fetchJSON("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson");

  const landRings = [];
  for (const f of land.features) for (const ring of geomRings(f.geometry)) {
    const s = round(simplify(ring, 0.5), 1);
    if (s.length >= 3) landRings.push(s);
  }
  const borders = [];
  const centroids = {};
  for (const f of countries.features) {
    const p = f.properties || {};
    const code = p.ISO_A2 && p.ISO_A2 !== "-99" ? p.ISO_A2 : (p.ISO_A2_EH || "");
    const rings = geomRings(f.geometry);
    for (const ring of rings) {
      const s = round(simplify(ring, 0.6), 1);
      if (s.length >= 3) borders.push(s);
    }
    if (code) {
      const big = largestRing(rings);
      centroids[code] = { name: p.NAME || p.ADMIN || code, c: round([ringCentroid(big)], 2)[0] };
    }
  }
  // Manual centroids for target countries too small / mislabeled at 110m scale.
  const manual = {
    SG: { name: "Singapore", c: [103.82, 1.35] },
  };
  for (const [k, v] of Object.entries(manual)) if (!centroids[k]) centroids[k] = v;
  write("world.json", { land: landRings, borders, countries: centroids });
}

// Taiwan (710000) county/city subdivisions. DataV does NOT publish a
// `710000_full.json`, so we source the 22 units (縣/市) from geoBoundaries TWN
// ADM1 and translate them to Chinese so they match the mainland convention
// (city files under regions/CN/ store the Chinese name as the matched value).
// Keyed by the exact geoBoundaries shapeName.
const ZH_TW = {
  "Taipei": "台北市", "New Taipei": "新北市", "Taoyuan": "桃园市", "Taichung": "台中市",
  "Tainan": "台南市", "Kaohsiung": "高雄市", "Keelung": "基隆市", "Hsinchu": "新竹市",
  "Chiayi": "嘉义市", "Hsinchu County": "新竹县", "Miaoli County": "苗栗县",
  "Changhua County": "彰化县", "Nantou County": "南投县", "Yunlin County": "云林县",
  "Chiayi County": "嘉义县", "Pingtung County": "屏东县", "Yilan County": "宜兰县",
  "Hualien County": "花莲县", "Taitung County": "台东县", "Penghu": "澎湖县",
  "Kinmen": "金门县", "Matsu Islands": "连江县",
};

// ============ China (DataV, full drill — every province → its cities) ============
async function buildChina() {
  console.log("China (DataV)…");
  cleanDir("regions/CN");
  const prov = await fetchJSON("https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json");
  const provFeatures = prov.features.map((f) => ({
    name: f.properties.name, code: String(f.properties.adcode), rings: geomRings(f.geometry),
  }));
  // Build a city drill file for EVERY province that has sub-divisions. The file
  // is named by the province adcode, which is also carried as region.key so the
  // client resolves the drill URL directly (no hardcoded name→adcode table).
  const withCities = new Set();
  for (const pf of provFeatures) {
    // Taiwan is absent from DataV's city endpoint; fill it from geoBoundaries.
    if (pf.code === "710000") {
      try {
        const tw = await gbGeoJSON("TWN", "ADM1");
        const cityFeatures = tw.features.map((f) => {
          const en = f.properties.shapeName;
          const zh = ZH_TW[en] || en;
          // Store the Chinese name as both the matched value and key so the city
          // layer renders/matches like every other mainland province.
          return { name: zh, key: zh, rings: geomRings(f.geometry) };
        });
        if (cityFeatures.length) {
          write(`regions/CN/710000.json`, { name: pf.name, ...projectRegions(cityFeatures, 0.6) });
          withCities.add("710000");
        }
      } catch (e) {
        console.log(`  (skip Taiwan 710000: ${e.message})`);
      }
      continue;
    }
    try {
      const data = await fetchJSON(`https://geo.datav.aliyun.com/areas_v3/bound/${pf.code}_full.json`);
      const cityFeatures = data.features
        .filter((f) => String(f.properties.adcode) !== pf.code) // drop the province outline itself
        .map((f) => ({ name: f.properties.name, key: String(f.properties.adcode), rings: geomRings(f.geometry) }));
      if (!cityFeatures.length) continue;
      write(`regions/CN/${pf.code}.json`, { name: pf.name, ...projectRegions(cityFeatures, 1.0) });
      withCities.add(pf.code);
    } catch (e) {
      console.log(`  (skip ${pf.name} ${pf.code}: ${e.message})`);
    }
  }
  const features = provFeatures.map((pf) => ({
    name: pf.name, key: pf.code, drill: withCities.has(pf.code), rings: pf.rings,
  }));
  write("regions/CN.json", { code: "CN", name: "中国", ...projectRegions(features, 1.6) });
}

// ============ geoBoundaries countries (ADM1 + optional ADM2 via point-in-polygon) ============
async function gbGeoJSON(iso, adm) {
  const meta = await fetchJSON(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/${adm}/`);
  return fetchJSON(meta.gjDownloadURL);
}

// Chinese labels for foreign ADM1 units. The public globe / admin form show
// "中文 · English" for foreign places (English names stay the stored key so the
// visited-set matching and any drill files keep working). Keyed by the exact
// geoBoundaries shapeName.
const ZH_ADM1 = {
  // Japan (47 prefectures)
  "Hokkaido": "北海道", "Aomori": "青森县", "Iwate": "岩手县", "Miyagi": "宫城县",
  "Akita": "秋田县", "Yamagata": "山形县", "Fukushima": "福岛县", "Ibaraki": "茨城县",
  "Tochigi": "栃木县", "Gunma": "群马县", "Saitama": "埼玉县", "Chiba": "千叶县",
  "Tokyo": "东京都", "Kanagawa": "神奈川县", "Niigata": "新潟县", "Toyama": "富山县",
  "Ishikawa Prefecture": "石川县", "Fukui Prefecture": "福井县", "Yamanashi": "山梨县",
  "Nagano": "长野县", "Gifu Prefecture": "岐阜县", "Shizuoka": "静冈县",
  "Aichi Prefecture": "爱知县", "Mie Prefecture": "三重县", "Shiga": "滋贺县",
  "Kyoto Prefecture": "京都府", "Osaka Prefecture": "大阪府", "Hyogo Prefecture": "兵库县",
  "Nara Prefecture": "奈良县", "Wakayama Prefecture": "和歌山县", "Tottori Prefecture": "鸟取县",
  "Shimane": "岛根县", "Okayama Prefecture": "冈山县", "Hiroshima": "广岛县",
  "Yamaguchi": "山口县", "Tokushima Prefecture": "德岛县", "Kagawa Prefecture": "香川县",
  "Ehime Prefecture": "爱媛县", "Kochi Prefecture": "高知县", "Fukuoka Prefecture": "福冈县",
  "Saga Prefecture": "佐贺县", "Nagasaki Prefecture": "长崎县", "Kumamoto": "熊本县",
  "Oita": "大分县", "Miyazaki Prefecture": "宫崎县", "Kagoshima Prefecture": "鹿儿岛县",
  "Okinawa Prefecture": "冲绳县",
  // Malaysia (16 states / federal territories)
  "Johor": "柔佛", "Kedah": "吉打", "Kelantan": "吉兰丹", "Malacca": "马六甲",
  "Negeri Sembilan": "森美兰", "Pahang": "彭亨", "Penang": "槟城", "Perak": "霹雳",
  "Perlis": "玻璃市", "Selangor": "雪兰莪", "Terengganu": "登嘉楼", "Sabah": "沙巴",
  "Sarawak": "砂拉越", "Kuala Lumpur": "吉隆坡", "Labuan": "纳闽", "Putrajaya": "布城",
  // Singapore (5 regions)
  "CENTRAL REGION": "中部地区", "EAST REGION": "东部地区", "NORTH-EAST REGION": "东北地区",
  "NORTH REGION": "北部地区", "WEST REGION": "西部地区",
  // Thailand (77 provinces). geoBoundaries suffixes most with " Province"
  // (Bangkok / Kalasin are bare); keys match the exact shapeName.
  "Bangkok": "曼谷", "Kalasin": "加拉信",
  "Amnat Charoen Province": "安纳乍伦", "Ang Thong Province": "红统",
  "Bueng Kan Province": "汶干", "Buri Ram Province": "武里南",
  "Chachoengsao Province": "北柳", "Chai Nat Province": "猜纳",
  "Chaiyaphum Province": "猜也奔", "Chanthaburi Province": "尖竹汶",
  "Chiang Mai Province": "清迈", "Chiang Rai Province": "清莱",
  "Chon Buri Province": "春武里", "Chumphon Province": "春蓬",
  "Kamphaeng Phet Province": "甘烹碧", "Kanchanaburi Province": "北碧",
  "Khon Kaen Province": "孔敬", "Krabi Province": "甲米",
  "Lampang Province": "南邦", "Lamphun Province": "南奔", "Loei Province": "黎府",
  "Lopburi Province": "华富里", "Mae Hong Son Province": "夜丰颂",
  "Maha Sarakham Province": "玛哈沙拉堪", "Mukdahan Province": "莫拉限",
  "Nakhon Nayok Province": "那空那育", "Nakhon Pathom Province": "佛统",
  "Nakhon Phanom Province": "那空帕侬", "Nakhon Ratchasima Province": "呵叻",
  "Nakhon Sawan Province": "北榄坡", "Nakhon Si Thammarat Province": "洛坤",
  "Nan Province": "楠府", "Narathiwat Province": "陶公",
  "Nong Bua Lam Phu Province": "廊莫", "Nong Khai Province": "廊开",
  "Nonthaburi Province": "暖武里", "Pathum Thani Province": "巴吞他尼",
  "Pattani Province": "北大年", "Phangnga Province": "攀牙",
  "Phatthalung Province": "博他仑", "Phayao Province": "帕尧",
  "Phetchabun Province": "碧差汶", "Phetchaburi Province": "佛丕",
  "Phichit Province": "披集", "Phitsanulok Province": "彭世洛",
  "Phra Nakhon Si Ayutthaya Province": "大城", "Phrae Province": "帕府",
  "Phuket Province": "普吉", "Prachin Buri Province": "巴真武里",
  "Prachuap Khiri Khan Province": "巴蜀", "Ranong Province": "拉廊",
  "Ratchaburi Province": "叻丕", "Rayong Province": "罗勇", "Roi Et Province": "黎逸",
  "Sa Kaeo Province": "沙缴", "Sakon Nakhon Province": "沙功那空",
  "Samut Prakan Province": "北榄", "Samut Sakhon Province": "龙仔厝",
  "Samut Songkhram Province": "夜功", "Saraburi Province": "北标",
  "Satun Province": "沙敦", "Si Sa Ket Province": "四色菊",
  "Sing Buri Province": "信武里", "Songkhla Province": "宋卡",
  "Sukhothai Province": "素可泰", "Suphan Buri Province": "素攀武里",
  "Surat Thani Province": "素叻他尼", "Surin Province": "素林",
  "Tak Province": "达府", "Trang Province": "董里", "Trat Province": "达叻",
  "Ubon Ratchathani Province": "乌汶", "Udon Thani Province": "乌隆",
  "Uthai Thani Province": "乌泰他尼", "Uttaradit Province": "程逸",
  "Yala Province": "也拉", "Yasothon Province": "益梭通",
};

// Chinese labels for ADM2 (city / district) units of the foreign countries.
// geoBoundaries has NO Chinese, and the lists run to hundreds of entries, so we
// translate the well-known, likely-visited places and leave the rest in the
// source language (English/romaji). Keyed by the exact geoBoundaries shapeName.
const ZH_ADM2 = {
  // Malaysia — major cities / tourist districts.
  "Johor Bahru": "新山", "Kuala Lumpur": "吉隆坡", "Kuching": "古晋", "Kota Kinabalu": "亚庇",
  "Kota Bharu": "哥打巴鲁", "Kuantan": "关丹", "Kuala Terengganu": "瓜拉登嘉楼", "Ipoh": "怡保",
  "Kinta": "怡保（近打）", "Melaka Tengah": "马六甲市", "Seremban": "芙蓉", "Klang": "巴生",
  "Petaling": "八打灵", "Sepang": "雪邦", "Langkawi": "浮罗交怡", "Miri": "美里",
  "Sibu": "诗巫", "Sandakan": "山打根", "Tawau": "斗湖", "Labuan": "纳闽",
  "Timur Laut": "槟岛东北（乔治市）", "Barat Daya": "槟岛西南", "Kota Setar": "亚罗士打",
  "Batu Pahat": "峇株巴辖", "Muar": "麻坡", "Kluang": "居銮", "Kota Tinggi": "哥打丁宜",
  "Cameron Highlands": "金马仑高原", "Bentong": "文冬", "Temerloh": "淡马鲁",
  // West Malaysia — Penang detail (island + mainland), Malacca, greater KL.
  "Seberang Perai Utara": "威省北（北海）", "Seberang Perai Tengah": "威省中",
  "Seberang Perai Selatan": "威省南", "Alor Gajah": "亚罗牙也", "Jasin": "野新",
  "Gombak": "鹅唛（黑风洞）", "Ulu Langat": "乌鲁冷岳", "Kuala Langat": "瓜拉冷岳",
  "Kuala Selangor": "瓜拉雪兰莪", "Hulu Selangor": "乌鲁雪兰莪", "Manjung": "曼绒（邦咯岛）",
  // East Malaysia — Sabah / Sarawak tourist areas.
  "Semporna": "仙本那", "Lahad Datu": "拿笃", "Kunak": "古纳", "Kinabatangan": "京那巴当岸",
  "Ranau": "兰瑙（神山）", "Kudat": "古达", "Tuaran": "斗亚兰", "Papar": "巴巴",
  "Kota Belud": "哥打毛律", "Bintulu": "民都鲁", "Limbang": "林梦",
  // Singapore — planning areas commonly referenced by travelers.
  "DOWNTOWN CORE": "市中心", "ORCHARD": "乌节", "MARINA SOUTH": "滨海南", "MARINA EAST": "滨海东",
  "OUTRAM": "欧南", "ROCHOR": "梧槽", "NEWTON": "纽顿", "NOVENA": "诺维娜", "KALLANG": "加冷",
  "GEYLANG": "芽笼", "MARINE PARADE": "马林百列", "BEDOK": "勿洛", "TAMPINES": "淡滨尼",
  "CHANGI": "樟宜", "PASIR RIS": "白沙", "PAYA LEBAR": "巴耶利峇", "HOUGANG": "后港",
  "SERANGOON": "实龙岗", "ANG MO KIO": "宏茂桥", "BISHAN": "碧山", "TOA PAYOH": "大巴窑",
  "SENGKANG": "盛港", "PUNGGOL": "榜鹅", "SEMBAWANG": "三巴旺", "WOODLANDS": "兀兰",
  "YISHUN": "义顺", "BUKIT MERAH": "红山", "QUEENSTOWN": "女皇镇", "CLEMENTI": "金文泰",
  "JURONG EAST": "裕廊东", "JURONG WEST": "裕廊西", "BUKIT BATOK": "武吉巴督",
  "BUKIT TIMAH": "武吉知马", "BUKIT PANJANG": "武吉班让", "CHOA CHU KANG": "蔡厝港",
  "TANGLIN": "东陵", "RIVER VALLEY": "里峇峇利", "SINGAPORE RIVER": "新加坡河",
  "MUSEUM": "博物馆区", "SOUTHERN ISLANDS": "南部群岛（含圣淘沙）",
  // Japan — major tourist cities / famous wards (geoBoundaries ADM2 shapeName).
  // Ambiguous names (repeated across prefectures) use a "Province/City" scoped
  // key so only the intended one is labeled; unique names use the bare key.
  "Sapporo": "札幌", "Hakodate": "函馆", "Otaru": "小樽", "Niseko": "二世古",
  "Furano": "富良野",
  "Sendai": "仙台", "Nikko": "日光", "Kamakura": "镰仓", "Yokohama": "横滨",
  "Hakone": "箱根", "Fujikawaguchiko": "富士河口湖", "Fujinomiya": "富士宫",
  "Fuji": "富士", "Ito": "伊东", "Atami": "热海", "Matsumoto": "松本",
  "Gifu Prefecture/Takayama": "高山（飞驒）", "Kanazawa": "金泽",
  "Nagoya": "名古屋", "Ise": "伊势", "Kyoto": "京都", "Uji": "宇治",
  "Osaka": "大阪", "Kobe": "神户", "Himeji": "姬路", "Nara": "奈良",
  "Wakayama Prefecture/Nachikatsuura": "那智胜浦",
  "Hiroshima": "广岛", "Higashi Hiroshima": "东广岛", "Hatsukaichi": "廿日市（宫岛）",
  "Fukuoka": "福冈", "Beppu": "别府", "Yufu": "由布院", "Nagasaki": "长崎",
  "Kagoshima": "鹿儿岛", "Naha": "那霸", "Ishigaki": "石垣岛", "Miyakojima": "宫古岛",
  "Chiba": "千叶", "Narashino": "习志野", "Shizuoka": "静冈", "Fujisawa": "藤泽",
  // Tokyo 23 special wards + key city areas. Scoped to Tokyo because several
  // names (Chuo, Chiyoda, Nakano, Toshima) also exist in other prefectures.
  "Tokyo/Chiyoda": "千代田区", "Tokyo/Chuo": "中央区", "Tokyo/Minato": "港区",
  "Tokyo/Shinjuku": "新宿区", "Tokyo/Bunkyo": "文京区", "Tokyo/Taito": "台东区",
  "Tokyo/Sumida": "墨田区", "Tokyo/Koto": "江东区", "Tokyo/Shinagawa": "品川区",
  "Tokyo/Meguro": "目黑区", "Tokyo/Ota": "大田区", "Tokyo/Setagaya": "世田谷区",
  "Tokyo/Shibuya": "涩谷区", "Tokyo/Nakano": "中野区", "Tokyo/Suginami": "杉并区",
  "Tokyo/Toshima": "丰岛区", "Tokyo/Kita": "北区", "Tokyo/Arakawa": "荒川区",
  "Tokyo/Itabashi": "板桥区", "Tokyo/Nerima": "练马区", "Tokyo/Adachi": "足立区",
  "Tokyo/Katsushika": "葛饰区", "Tokyo/Edogawa": "江户川区",
  "Tokyo/Hachioji": "八王子", "Tokyo/Musashino": "武藏野（吉祥寺）", "Tokyo/Tachikawa": "立川",
  // Thailand — famous tourist districts (geoBoundaries ADM2 shapeName). "Mueang"
  // prefixes the provincial capital district.
  "Bangkok": "曼谷", "Phra Nakhon": "大皇宫（帕那空）", "Pathum Wan": "暹罗（巴吞旺）",
  "Bang Rak": "是隆（挽叻）", "Watthana Nakhon": "瓦他那", "Mueang Chiang Mai": "清迈市",
  "Mueang Chiang Rai": "清莱市", "Pai": "拜县", "Mueang Phuket": "普吉市",
  "Thalang": "塔朗（普吉北）", "Kathu": "卡图（芭东）", "Mueang Krabi": "甲米市",
  "Ko Lanta": "兰塔岛", "Ko Samui": "苏梅岛", "Ko Pha-Ngan": "帕岸岛",
  "Ko Chang": "象岛", "Bang Lamung": "芭堤雅（挽拉蒙）", "Hua Hin": "华欣",
  "Mueang Kanchanaburi": "北碧市", "Phra Nakhon Si Ayutthaya": "大城古城",
  "Mueang Sukhothai": "素可泰市",
  // Bangkok downtown districts commonly visited by travelers.
  "Vadhana": "素坤逸（瓦他那）", "Sathon": "沙吞", "Khlong Toei": "空堤", "Dusit": "律实",
  "Chatuchak": "乍都乍（周末市场）", "Ratchathewi": "拉差贴威", "Phaya Thai": "披耶泰",
  "Huai Khwang": "辉皇", "Thon Buri": "吞武里", "Samphanthawong": "三攀他旺（唐人街）",
  "Pom Prap Sattru Phai": "邦拍",
  // Chiang Mai / Mae Hong Son 周边 tourist districts.
  "Mae Rim": "湄林", "Hang Dong": "杭东", "San Kamphaeng": "山甘烹", "Chiang Dao": "清道",
  "Doi Saket": "道沙革", "Mae Taeng": "湄登", "Mueang Mae Hong Son": "夜丰颂市",
  // Other famous spots.
  "Sattahip": "梭桃邑", "Cha-Am": "差安", "Sangkhla Buri": "桑卡拉武里",
  "Ko Tao": "龟岛", "Ko Si Chang": "是拉差岛",
};

// Build an ADM1 country map AND per-province ADM2 (city) drill files. Foreign
// ADM1/ADM2 names come from geoBoundaries in English/romaji; we attach Chinese
// labels (zh) from the ZH_ADM1 / ZH_ADM2 tables for bilingual "中文 · English"
// display where known. The stored/matched value stays the English name.
// City files are named by provinceKey (ADM1 name, spaces → underscores) to
// match globe.js provinceKey() and footprint-form.js exactly.
async function buildGB(iso, code, name) {
  console.log(`${name} (geoBoundaries ${iso})…`);
  cleanDir(`regions/${code}`);
  const adm1 = await gbGeoJSON(iso, "ADM1");
  const adm1Raw = adm1.features.map((f) => ({
    name: f.properties.shapeName, rings: geomRings(f.geometry),
  }));

  // Assign ADM2 (cities) to their parent ADM1 (province), then emit one drill
  // file per province that actually has cities. Skip cleanly if ADM2 is absent.
  //
  // Curation rule: a foreign city is emitted ONLY if it has a verified Chinese
  // name in ZH_ADM2. This keeps the list to well-known / tourist destinations
  // (geoBoundaries has hundreds of minor districts, none in Chinese) and
  // guarantees every listed city is bilingual "中文 · English", as required.
  //
  // Disambiguation: some ADM2 names repeat across provinces (e.g. Chuo/Chiyoda
  // exist in several Japanese prefectures; Takayama in three). ZH_ADM2 is keyed
  // by "Province/City" first and falls back to the bare "City", so a scoped
  // entry labels exactly the right one and unscoped names still work.
  const withCities = new Set();
  try {
    const adm2 = await gbGeoJSON(iso, "ADM2");
    const adm2All = adm2.features.map((f) => ({ name: f.properties.shapeName, rings: geomRings(f.geometry) }));
    const groups = assignParents(adm1Raw, adm2All);
    for (const [provName, cities] of groups) {
      // Resolve each city's zh via scoped key, then bare key; keep only labeled.
      let labeled = cities
        .map((c) => ({ ...c, zh: ZH_ADM2[`${provName}/${c.name}`] || ZH_ADM2[c.name] || "" }))
        .filter((c) => c.zh);
      if (!labeled.length) continue;
      // A few ADM2 names repeat even WITHIN one province (e.g. Tokyo has both
      // 豊島区 the ward and 利島 the island, both shapeName "Toshima"). The client
      // matches cities by name, so keep only the largest-area feature per name
      // to avoid two identically-labeled regions that select/highlight together.
      const byName = new Map();
      for (const c of labeled) {
        const a = Math.max(...c.rings.map(ringArea));
        const prev = byName.get(c.name);
        if (!prev || a > prev.a) byName.set(c.name, { c, a });
      }
      labeled = [...byName.values()].map((v) => v.c);
      const cityFeatures = labeled.map((c) => ({ name: c.name, key: c.name, rings: c.rings }));
      const projected = projectRegions(cityFeatures, 1.0);
      const zhByName = new Map(labeled.map((c) => [c.name, c.zh]));
      projected.regions.forEach((r) => { r.zh = zhByName.get(r.name) || ""; });
      const key = provName.replace(/\s+/g, "_");
      write(`regions/${code}/${key}.json`, { name: provName, ...projected });
      withCities.add(provName);
    }
  } catch (e) {
    console.log(`  (no ADM2 for ${name}: ${e.message})`);
  }

  const adm1Features = adm1Raw.map((f) => ({
    name: f.name, key: f.name, zh: ZH_ADM1[f.name] || "",
    drill: withCities.has(f.name), rings: f.rings,
  }));
  const projected = projectRegions(adm1Features, 1.4);
  // Carry zh + drill through projection (projectRegions keeps name/key/drill/polys).
  const zhByName = new Map(adm1Features.map((f) => [f.name, f.zh]));
  projected.regions.forEach((r) => { r.zh = zhByName.get(r.name) || ""; });
  write(`regions/${code}.json`, { code, name, ...projected });
}

async function main() {
  // Optional CLI filter: `node scripts/gen_geo.mjs SG TH` rebuilds only those
  // countries (plus always the shared world map). No args = full rebuild.
  const only = new Set(process.argv.slice(2).map((s) => s.toUpperCase()));
  const want = (code) => only.size === 0 || only.has(code);

  await buildWorld();
  if (want("CN")) await buildChina();
  // Foreign countries drill to a curated set of bilingual "中文 · English"
  // tourist cities/districts; every remaining province stays bilingual too.
  if (want("JP")) await buildGB("JPN", "JP", "日本");
  if (want("MY")) await buildGB("MYS", "MY", "马来西亚");
  if (want("SG")) await buildGB("SGP", "SG", "新加坡");
  if (want("TH")) await buildGB("THA", "TH", "泰国");
  console.log("done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
