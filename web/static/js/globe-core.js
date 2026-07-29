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

  return {
    escapeHTML: escapeHTML,
    selectionContent: selectionContent,
    createTapTracker: createTapTracker,
    snapshotView: snapshotView,
    restoreView: restoreView,
    createHistory: createHistory,
  };
});
