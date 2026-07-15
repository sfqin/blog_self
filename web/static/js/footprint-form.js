// footprint-form.js — cascading country → province → city selects for the
// admin footprint editor.
//
// Options are sourced from the SAME geo files the public globe consumes
// (/static/geo/regions/*), so the values stored here always match what the
// globe can highlight/drill. The province→city-file key mapping mirrors
// globe.js's provinceKey() exactly (CN→adcode, JP/MY→English name with
// spaces turned into underscores).
(function () {
  "use strict";

  var form = document.getElementById("fp-form");
  if (!form) return;

  var countrySel = document.getElementById("fp-country");
  var provSel = document.getElementById("fp-province");
  var citySel = document.getElementById("fp-city");
  var countryName = document.getElementById("fp-country-name");
  var provHint = document.getElementById("fp-province-hint");
  var cityHint = document.getElementById("fp-city-hint");

  // Stored values for edit mode; drive the initial cascade.
  var initCC = form.getAttribute("data-cc") || "";
  var initProv = form.getAttribute("data-prov") || "";
  var initCity = form.getAttribute("data-city") || "";

  // Mirror of globe.js CN_ADCODE + provinceKey so city files resolve identically.
  var CN_ADCODE = {
    "北京市": "110000", "湖南省": "430000", "广东省": "440000",
    "浙江省": "330000", "四川省": "510000", "江苏省": "320000",
  };
  function provinceKey(code, name) {
    if (code === "CN") return CN_ADCODE[name] || null;
    return name.replace(/\s+/g, "_"); // JP/MY use English ADM1 name
  }

  function opt(value, label) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }
  function reset(sel, placeholder) {
    sel.innerHTML = "";
    sel.appendChild(opt("", placeholder));
  }
  function loadJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + url);
      return r.json();
    });
  }

  // Populate province select from the country's ADM1 file.
  function loadProvinces(code, preProv, preCity) {
    reset(provSel, "— 选择省/州 select province —");
    reset(citySel, "— 先选择省/州 —");
    provSel.disabled = true;
    citySel.disabled = true;
    provHint.textContent = "";
    cityHint.textContent = "";
    if (!code) return;
    loadJSON("/static/geo/regions/" + code + ".json").then(function (d) {
      (d.regions || []).forEach(function (r) {
        if (!r.name) return;
        var o = opt(r.name, r.name + (r.drill ? "  ▸" : ""));
        o.setAttribute("data-drill", r.drill ? "1" : "");
        provSel.appendChild(o);
      });
      provSel.disabled = false;
      if (preProv) {
        provSel.value = preProv;
        loadCities(code, preCity);
      }
    }).catch(function () {
      // No ADM1 data (e.g. Thailand) — record at country level only.
      provHint.textContent = "该国家暂无省/州数据，将只记录到国家级别。";
    });
  }

  // Populate city select from the province's ADM2 file, when drillable.
  function loadCities(code, preCity) {
    reset(citySel, "— 选择城市/区 select city —");
    citySel.disabled = true;
    cityHint.textContent = "";
    var selected = provSel.options[provSel.selectedIndex];
    if (!selected || !selected.value) return;
    if (selected.getAttribute("data-drill") !== "1") {
      cityHint.textContent = "该省/州暂无城市数据，将只记录到省/州级别。";
      return;
    }
    var key = provinceKey(code, selected.value);
    if (!key) {
      cityHint.textContent = "该省/州暂无城市数据，将只记录到省/州级别。";
      return;
    }
    loadJSON("/static/geo/regions/" + code + "/" + key + ".json").then(function (d) {
      (d.regions || []).forEach(function (r) {
        if (r.name) citySel.appendChild(opt(r.name, r.name));
      });
      citySel.disabled = false;
      if (preCity) citySel.value = preCity;
    }).catch(function () {
      cityHint.textContent = "该省/州城市数据缺失。";
    });
  }

  countrySel.addEventListener("change", function () {
    var o = countrySel.options[countrySel.selectedIndex];
    countryName.value = o ? (o.getAttribute("data-name") || "") : "";
    loadProvinces(countrySel.value, "", "");
  });
  provSel.addEventListener("change", function () {
    loadCities(countrySel.value, "");
  });

  // Edit mode: preselect country then cascade down to stored province/city.
  if (initCC) {
    countrySel.value = initCC;
    var o = countrySel.options[countrySel.selectedIndex];
    if (o && o.getAttribute("data-name")) countryName.value = o.getAttribute("data-name");
    loadProvinces(initCC, initProv, initCity);
  }
})();
