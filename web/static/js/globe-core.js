(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GlobeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function countryByCode(footprints, code) {
    return (footprints || []).find(function (item) { return item.code === code; }) || null;
  }

  function unionMomentIds(cities, cityName) {
    var result = [];
    var seen = Object.create(null);
    (cities || []).forEach(function (city) {
      if (cityName && city.name !== cityName) return;
      (city.momentIds || []).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        result.push(id);
      });
    });
    return result;
  }

  function notesForCities(cities, cityName) {
    var result = [];
    (cities || []).forEach(function (city) {
      if (cityName && city.name !== cityName) return;
      if (!city.note || !city.note.trim()) return;
      result.push({ city: city.name, note: city.note });
    });
    return result;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char];
    });
  }

  function selectionContent(footprints, view) {
    if (!view || !view.selected) return { notes: [], momentIds: [] };
    if (view.layer === "globe") {
      var selectedCountry = countryByCode(footprints, view.selected);
      var countryCities = [];
      if (selectedCountry) {
        (selectedCountry.provinces || []).forEach(function (province) {
          countryCities = countryCities.concat(province.cities || []);
        });
      }
      return { notes: [], momentIds: unionMomentIds(countryCities, null) };
    }

    var country = countryByCode(footprints, view.country && view.country.code);
    if (!country) return { notes: [], momentIds: [] };
    var province = (country.provinces || []).find(function (item) {
      return item.name === (view.layer === "country" ? view.selected : view.province && view.province.name);
    });
    if (!province) return { notes: [], momentIds: [] };
    var cityName = view.layer === "city" ? view.selected : null;
    return {
      notes: notesForCities(province.cities, cityName),
      momentIds: unionMomentIds(province.cities, cityName),
    };
  }

  function createTapTracker(windowMs) {
    var previous = null;
    return {
      register: function (layer, key, now, gestureEpoch) {
        var isDouble = !!previous &&
          previous.layer === layer &&
          previous.key === key &&
          previous.gestureEpoch === gestureEpoch &&
          now - previous.time <= windowMs;
        previous = isDouble ? null : {
          layer: layer,
          key: key,
          time: now,
          gestureEpoch: gestureEpoch,
        };
        return isDouble;
      },
      cancel: function () { previous = null; },
    };
  }

  function snapshotView(state) {
    return {
      layer: state.layer,
      country: state.country && Object.assign({}, state.country),
      province: state.province && Object.assign({}, state.province),
      regionData: state.regionData,
      selected: state.selected,
      hover: state.hover,
      rot: Object.assign({}, state.rot),
      vel: Object.assign({}, state.vel),
      gz: state.gz,
      rv: Object.assign({}, state.rv),
    };
  }

  function restoreView(state, snap) {
    state.layer = snap.layer;
    state.country = snap.country && Object.assign({}, snap.country);
    state.province = snap.province && Object.assign({}, snap.province);
    state.regionData = snap.regionData;
    state.selected = snap.selected;
    state.hover = snap.hover;
    state.rot = Object.assign({}, snap.rot);
    state.vel = Object.assign({}, snap.vel);
    state.gz = snap.gz;
    state.rv = Object.assign({}, snap.rv);
    return state;
  }

  function createHistory() {
    var stack = [];
    return {
      push: function (state) { stack.push(snapshotView(state)); },
      pop: function () { return stack.length ? stack.pop() : null; },
      popTo: function (layer) {
        while (stack.length) {
          var snap = stack.pop();
          if (snap.layer === layer) return snap;
        }
        return null;
      },
      size: function () { return stack.length; },
      clear: function () { stack.length = 0; },
    };
  }

  function createMapLoader(fetchJSON, maxConcurrent) {
    var active = 0;
    var paused = false;
    var entries = Object.create(null);
    var queue = [];
    var limit = Math.max(1, maxConcurrent || 1);

    function run(entry) {
      entry.status = "pending";
      active++;
      Promise.resolve().then(function () {
        return fetchJSON(entry.url);
      }).then(function (data) {
        entry.status = "fulfilled";
        entry.data = data;
        active--;
        pump();
        entry.resolve(data);
      }, function (error) {
        delete entries[entry.url];
        active--;
        pump();
        entry.reject(error);
      });
    }

    function pump() {
      queue.sort(function (a, b) { return b.priority - a.priority; });
      while (active < limit) {
        var index = queue.findIndex(function (entry) {
          return !paused || !entry.background;
        });
        if (index < 0) return;
        run(queue.splice(index, 1)[0]);
      }
    }

    function request(url, priority, background) {
      var existing = entries[url];
      if (existing) {
        if (existing.status === "fulfilled") return Promise.resolve(existing.data);
        if (!background) existing.background = false;
        existing.priority = Math.max(existing.priority, priority);
        pump();
        return existing.promise;
      }
      var resolve;
      var reject;
      var promise = new Promise(function (res, rej) {
        resolve = res;
        reject = rej;
      });
      var entry = {
        url: url,
        priority: priority,
        background: background,
        status: "queued",
        promise: promise,
        resolve: resolve,
        reject: reject,
      };
      entries[url] = entry;
      queue.push(entry);
      pump();
      return promise;
    }

    return {
      load: function (url) { return request(url, 100, false); },
      prefetch: function (url, priority) { return request(url, priority || 1, true); },
      setPaused: function (value) {
        paused = !!value;
        pump();
      },
      peek: function (url) {
        var entry = entries[url];
        return entry && entry.status === "fulfilled" ? entry.data : null;
      },
    };
  }

  // ============================================================
  // Place names, origin resolution, stats and great-circle routes (spec 5.4)
  // ============================================================

  // Capital / administrative centre [lon, lat] of every province-level region,
  // keyed by the exact `name` fields of regions/CN.json (minus 100000_JD). The
  // region polys are projected viewBox coordinates, not lon/lat, so the centres
  // cannot be derived from the geo files and live here instead.
  var CN_PROVINCE_CENTERS = {
    "北京市": [116.40, 39.90],
    "天津市": [117.20, 39.13],
    "河北省": [114.51, 38.04],
    "山西省": [112.55, 37.87],
    "内蒙古自治区": [111.75, 40.84],
    "辽宁省": [123.43, 41.80],
    "吉林省": [125.32, 43.88],
    "黑龙江省": [126.53, 45.80],
    "上海市": [121.47, 31.23],
    "江苏省": [118.80, 32.06],
    "浙江省": [120.15, 30.27],
    "安徽省": [117.23, 31.82],
    "福建省": [119.30, 26.08],
    "江西省": [115.86, 28.68],
    "山东省": [117.12, 36.65],
    "河南省": [113.63, 34.75],
    "湖北省": [114.31, 30.59],
    "湖南省": [112.94, 28.23],
    "广东省": [113.27, 23.13],
    "广西壮族自治区": [108.37, 22.82],
    "海南省": [110.35, 20.02],
    "重庆市": [106.55, 29.56],
    "四川省": [104.07, 30.66],
    "贵州省": [106.63, 26.65],
    "云南省": [102.83, 24.88],
    "西藏自治区": [91.12, 29.65],
    "陕西省": [108.94, 34.34],
    "甘肃省": [103.83, 36.06],
    "青海省": [101.78, 36.62],
    "宁夏回族自治区": [106.23, 38.49],
    "新疆维吾尔自治区": [87.62, 43.83],
    "台湾省": [121.56, 25.04],
    "香港特别行政区": [114.17, 22.32],
    "澳门特别行政区": [113.54, 22.19],
  };

  var hasOwn = Object.prototype.hasOwnProperty;

  // Length in code points (CJK is BMP, but stay correct for astral chars).
  function charLength(s) {
    return s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;
  }

  // Normalize a free-form place string for fuzzy matching: drop whitespace and
  // administrative suffixes (wherever they appear), then lowercase.
  function normalizePlace(s) {
    return String(s == null ? "" : s)
      .replace(/\s+/g, "")
      .replace(/特别行政区|自治区|壮族|回族|维吾尔|省|市|province|city|state/gi, "")
      .toLowerCase();
  }

  // Display-only short name: 广东省→广东, 广西壮族自治区→广西, 香港特别行政区→香港.
  // Names without CJK characters are returned unchanged.
  function displayRegionName(name) {
    var s = String(name == null ? "" : name);
    if (!/[\u3400-\u9fff\uf900-\ufaff]/.test(s)) return s;
    var short = s.replace(/(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市)$/, "");
    return short || s;
  }

  function placeMatches(a, b) {
    if (!a || !b) return false;
    if (Math.min(charLength(a), charLength(b)) < 2) return false;
    return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  }

  // Resolve Profile.Location against the grouped footprints. Countries are
  // scanned in order; within a country its province names first, then its
  // city names. First hit wins. Falls back to Beijing.
  function resolveOrigin(location, footprints, world) {
    var loc = normalizePlace(location);
    var hit = null;
    if (loc) {
      (footprints || []).some(function (country) {
        if (!country || !country.code) return false;
        var provinces = country.provinces || [];
        var i, j;
        for (i = 0; i < provinces.length; i++) {
          if (provinces[i] && placeMatches(loc, normalizePlace(provinces[i].name))) {
            hit = { country: country, province: provinces[i], name: provinces[i].name };
            return true;
          }
        }
        for (i = 0; i < provinces.length; i++) {
          var cities = (provinces[i] && provinces[i].cities) || [];
          for (j = 0; j < cities.length; j++) {
            if (cities[j] && placeMatches(loc, normalizePlace(cities[j].name))) {
              hit = { country: country, province: provinces[i], name: cities[j].name };
              return true;
            }
          }
        }
        return false;
      });
    }
    if (hit) {
      var coords = null;
      if (hit.country.code === "CN" && hasOwn.call(CN_PROVINCE_CENTERS, hit.province.name)) {
        coords = CN_PROVINCE_CENTERS[hit.province.name];
      } else {
        var meta = world && world.countries && world.countries[hit.country.code];
        if (meta && meta.c) coords = meta.c;
      }
      if (coords) {
        return {
          lon: coords[0],
          lat: coords[1],
          code: hit.country.code,
          label: displayRegionName(hit.name),
          matched: true,
        };
      }
    }
    return { lon: 116.40, lat: 39.90, code: "CN", label: "北京", matched: false };
  }

  // Counting rules shared with the Go footprintStats: countries = distinct
  // codes; provinces = distinct (code, province) with a non-empty name;
  // places = Σ per province max(distinct city names, 1).
  function footprintStats(grouped) {
    var countries = Object.create(null);
    var provinces = Object.create(null);
    var order = [];
    var nCountries = 0;
    (grouped || []).forEach(function (country) {
      if (!country || !country.code) return;
      if (!countries[country.code]) {
        countries[country.code] = true;
        nCountries++;
      }
      (country.provinces || []).forEach(function (province) {
        if (!province || !province.name) return;
        var key = country.code + "\u0000" + province.name;
        var entry = provinces[key];
        if (!entry) {
          entry = provinces[key] = { cities: Object.create(null), count: 0 };
          order.push(entry);
        }
        (province.cities || []).forEach(function (city) {
          if (!city || !city.name || entry.cities[city.name]) return;
          entry.cities[city.name] = true;
          entry.count++;
        });
      });
    });
    var places = 0;
    order.forEach(function (entry) { places += Math.max(entry.count, 1); });
    return { countries: nCountries, provinces: order.length, places: places };
  }

  // Stats scoped to a layer: "globe" (everything), "country" (one country),
  // "province" (one province of one country). Anything else counts nothing.
  function footprintStatsFor(grouped, layer, countryCode, provinceName) {
    if (layer === "globe") return footprintStats(grouped);
    var country = countryByCode(grouped, countryCode);
    if (!country || (layer !== "country" && layer !== "province")) return footprintStats([]);
    if (layer === "country") return footprintStats([country]);
    var province = (country.provinces || []).filter(function (item) {
      return item && item.name === provinceName;
    });
    return footprintStats([{ code: country.code, provinces: province }]);
  }

  // F3 text segments per layer. {num} counts up, {unit}/{sep} are static,
  // {text} is a plain label (the country name).
  function statsSegments(layer, stats, countryName) {
    stats = stats || {};
    var provinces = [{ num: stats.provinces || 0 }, { unit: "省/州" }];
    var places = [{ num: stats.places || 0 }, { unit: "处" }];
    var sep = [{ sep: "·" }];
    if (layer === "globe") {
      return [{ num: stats.countries || 0 }, { unit: "国" }].concat(sep, provinces, sep, places);
    }
    if (layer === "country") {
      return [{ text: String(countryName || "") }].concat(sep, provinces, sep, places);
    }
    if (layer === "province") return places;
    return [];
  }

  // Plain-text rendering of statsSegments, identical to the DOM textContent
  // globe.js produces: "1 国 · 1 省/州 · 2 处".
  function statsText(segments) {
    return (segments || []).map(function (seg) {
      if (hasOwn.call(seg, "num")) return String(seg.num);
      if (hasOwn.call(seg, "unit")) return " " + seg.unit;
      if (hasOwn.call(seg, "sep")) return " " + seg.sep + " ";
      return String(seg.text == null ? "" : seg.text);
    }).join("");
  }

  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  function toVector(ll) {
    var lon = ll[0] * D2R;
    var lat = ll[1] * D2R;
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  }

  function toLonLat(v) {
    return [
      Math.atan2(v[1], v[0]) * R2D,
      Math.atan2(v[2], Math.sqrt(v[0] * v[0] + v[1] * v[1])) * R2D,
    ];
  }

  // n+1 [lon, lat] points along the great circle from a to b (slerp). The
  // endpoints are the inputs verbatim. Identical points yield a degenerate
  // line; antipodal points pick a deterministic perpendicular plane.
  function greatCircle(a, b, n) {
    n = Math.max(1, Math.floor(n) || 1);
    var va = toVector(a);
    var vb = toVector(b);
    var dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    var omega = Math.acos(dot);
    var sinOmega = Math.sin(omega);
    var perp = null;
    if (sinOmega < 1e-9 && dot < 0) {
      var axis = Math.abs(va[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      var d = axis[0] * va[0] + axis[1] * va[1] + axis[2] * va[2];
      perp = [axis[0] - d * va[0], axis[1] - d * va[1], axis[2] - d * va[2]];
      var len = Math.sqrt(perp[0] * perp[0] + perp[1] * perp[1] + perp[2] * perp[2]);
      perp = [perp[0] / len, perp[1] / len, perp[2] / len];
    }
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      if (i === 0) { out.push([a[0], a[1]]); continue; }
      if (i === n) { out.push([b[0], b[1]]); continue; }
      if (perp) {
        var ang = Math.PI * t;
        var c = Math.cos(ang), s = Math.sin(ang);
        out.push(toLonLat([va[0] * c + perp[0] * s, va[1] * c + perp[1] * s, va[2] * c + perp[2] * s]));
      } else if (sinOmega < 1e-9) {
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      } else {
        var s1 = Math.sin((1 - t) * omega) / sinOmega;
        var s2 = Math.sin(t * omega) / sinOmega;
        out.push(toLonLat([s1 * va[0] + s2 * vb[0], s1 * va[1] + s2 * vb[1], s1 * va[2] + s2 * vb[2]]));
      }
    }
    return out;
  }

  return {
    escapeHTML: escapeHTML,
    selectionContent: selectionContent,
    createTapTracker: createTapTracker,
    snapshotView: snapshotView,
    restoreView: restoreView,
    createHistory: createHistory,
    createMapLoader: createMapLoader,
    CN_PROVINCE_CENTERS: CN_PROVINCE_CENTERS,
    normalizePlace: normalizePlace,
    displayRegionName: displayRegionName,
    resolveOrigin: resolveOrigin,
    footprintStats: footprintStats,
    footprintStatsFor: footprintStatsFor,
    statsSegments: statsSegments,
    statsText: statsText,
    greatCircle: greatCircle,
  };
});
