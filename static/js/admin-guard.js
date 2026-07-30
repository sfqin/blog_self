// admin-guard.js — warn before losing unsaved edits in the admin panel.
//
// Any typing/selection in an edit form marks the page "dirty". Leaving the page
// then asks for confirmation:
//   • in-app navigation (sidebar / cancel / brand links)  → styled modal
//   • browser refresh / tab close / typed URL            → native "leave?" prompt
// Submitting the edit form is a save, so it clears the flag and never nags.
//
// Included on every admin page via admin_foot; it self-disables on pages that
// have no editable form (dashboard, list views).
(function () {
  "use strict";

  var main = document.querySelector(".admin-main");
  if (!main) return;

  // An "edit form" is a form in the main area with at least one editable
  // control. This naturally excludes per-row delete forms (hidden csrf + button).
  var editForms = Array.prototype.slice.call(main.querySelectorAll("form")).filter(function (f) {
    return f.querySelector(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select"
    );
  });
  if (!editForms.length) return;

  var dirty = false;   // user has changed something
  var leaving = false; // we are intentionally navigating/saving — don't nag

  function markDirty() { dirty = true; }

  editForms.forEach(function (f) {
    f.addEventListener("input", markDirty);
    f.addEventListener("change", markDirty);
    // Saving is intentional: drop the flag and let navigation proceed.
    f.addEventListener("submit", function () { dirty = false; leaving = true; });
  });

  // --- confirmation modal (injected once) -----------------------------------
  var modal = document.createElement("div");
  modal.className = "guard-modal";
  modal.hidden = true;
  modal.innerHTML =
    '<div class="guard-box" role="dialog" aria-modal="true" aria-labelledby="guard-title">' +
      '<div class="guard-title" id="guard-title">⚠ 有未保存的修改</div>' +
      '<div class="guard-msg">当前页面有尚未保存的内容，离开会丢失这些修改。<br>要先返回保存，还是放弃修改直接离开？</div>' +
      '<div class="guard-actions">' +
        '<button type="button" class="btn-ghost" data-act="stay">留在本页</button>' +
        '<button type="button" class="btn-danger" data-act="leave">不保存，离开</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  var pending = null; // action to run if the user confirms leaving
  function openModal(onConfirm) {
    pending = onConfirm;
    modal.hidden = false;
    var stay = modal.querySelector('[data-act="stay"]');
    if (stay) stay.focus();
  }
  function closeModal() { modal.hidden = true; pending = null; }

  modal.addEventListener("click", function (e) {
    var act = e.target.getAttribute && e.target.getAttribute("data-act");
    if (e.target === modal || act === "stay") { closeModal(); return; }
    if (act === "leave") {
      var run = pending;
      leaving = true;
      closeModal();
      if (run) run();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (!modal.hidden && e.key === "Escape") closeModal();
  });

  // --- intercept in-app navigation links ------------------------------------
  document.addEventListener("click", function (e) {
    if (leaving || !dirty || !modal.hidden) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href");
    if (!href || href.charAt(0) === "#") return;         // in-page anchors
    if (/^(javascript|mailto|tel):/i.test(href)) return; // non-navigations
    if (a.target === "_blank") return;                   // opens a new tab, no loss
    e.preventDefault();
    openModal(function () { window.location.href = a.href; });
  }, true);

  // --- native guard for refresh / tab close / typed URL ---------------------
  window.addEventListener("beforeunload", function (e) {
    if (leaving || !dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
})();
