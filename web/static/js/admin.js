// Admin post editor helpers: live-ish Markdown preview + slug hint.
(function () {
  "use strict";

  var toggle = document.getElementById("toggle-preview");
  var preview = document.getElementById("preview");
  var body = document.getElementById("post-body");

  // Minimal client-side Markdown -> HTML for preview only.
  // The authoritative render is server-side (goldmark); this is a rough approximation.
  function mdToHtml(src) {
    var esc = src
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // fenced code blocks
    esc = esc.replace(/```([\s\S]*?)```/g, function (_, code) {
      return "<pre><code>" + code.replace(/^\n/, "") + "</code></pre>";
    });
    var lines = esc.split(/\n/);
    var out = [];
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/^\s*```/.test(l)) { out.push(l); continue; }
      var h = l.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        if (inList) { out.push("</ul>"); inList = false; }
        var n = h[1].length;
        out.push("<h" + n + ">" + h[2] + "</h" + n + ">");
        continue;
      }
      if (/^\s*[-*]\s+/.test(l)) {
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push("<li>" + l.replace(/^\s*[-*]\s+/, "") + "</li>");
        continue;
      }
      if (inList) { out.push("</ul>"); inList = false; }
      if (/^\s*>\s?/.test(l)) { out.push("<blockquote>" + l.replace(/^\s*>\s?/, "") + "</blockquote>"); continue; }
      if (l.trim() === "") { out.push(""); continue; }
      out.push("<p>" + l + "</p>");
    }
    if (inList) out.push("</ul>");
    var html = out.join("\n");
    // inline: bold, italics, code, links
    html = html
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return html;
  }

  if (toggle && preview && body) {
    toggle.addEventListener("click", function () {
      if (preview.style.display === "none") {
        preview.innerHTML = mdToHtml(body.value);
        preview.style.display = "block";
        toggle.textContent = "隐藏预览";
      } else {
        preview.style.display = "none";
        toggle.textContent = "预览";
      }
    });
    body.addEventListener("input", function () {
      if (preview.style.display !== "none") preview.innerHTML = mdToHtml(body.value);
    });
  }
})();
