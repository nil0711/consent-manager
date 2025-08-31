// public/js/participant_search.js
(function () {
  if (window.__participantSearchBound) return;
  window.__participantSearchBound = true;

  const DEBUG = false;
  const log = (...a) => { if (DEBUG) console.log("[search-ui]", ...a); };

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
  }

  function renderCard(s, actionText) {
    const href = "/s/" + s.slug;
    const summary = s.summary ? `<div class="muted truncate max-w-[60ch]">${escapeHtml(s.summary)}</div>` : "";
    return `
      <div class="border border-[var(--line)] rounded-xl p-3 bg-white flex items-start justify-between gap-4" data-card data-slug="${escapeHtml(s.slug)}">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <a class="font-semibold hover:underline" href="${href}">${escapeHtml(s.title || s.slug)}</a>
          </div>
          ${summary}
        </div>
        <div class="shrink-0">
          <a class="btn" href="${href}">${actionText}</a>
        </div>
      </div>`;
  }

  ready(function () {
    const input        = document.getElementById("global-search");
    const btnSearch    = document.getElementById("search-btn");
    const btnClear     = document.getElementById("clear-btn");

    const trendingCard = document.getElementById("trending-card");
    const trendingList = document.getElementById("trending-list");
    const trendingEmpty= document.getElementById("trending-empty");
    const trendingCnt  = document.getElementById("trending-count");

    const myPanel      = document.getElementById("panel-my");
    const exPanel      = document.getElementById("panel-explore");
    const exList       = document.getElementById("explore-list");
    const exEmpty      = document.getElementById("explore-empty");
    const exCnt        = document.getElementById("explore-count");

    if (!input) { log("no input present"); return; }

    // ---------- Trending (load once) ----------
    (async function loadTrending() {
      try {
        const r = await fetch("/api/studies/trending");
        const json = await r.json().catch(() => ({ items: [] }));
        const items = Array.isArray(json.items) ? json.items : [];
        if (items.length) {
          trendingList.innerHTML = items.map(s => renderCard(s, "View")).join("");
          trendingList.style.display = "";
          trendingEmpty.style.display = "none";
          trendingCnt.textContent = String(items.length);
        } else {
          trendingList.innerHTML = "";
          trendingList.style.display = "none";
          trendingEmpty.textContent = "No trending studies yet.";
          trendingEmpty.style.display = "";
          trendingCnt.textContent = "0";
        }
      } catch (_) {
        // keep silent; UI already shows placeholder
      }
    })();

    // ---------- Helpers ----------
    function showHome() {
      if (myPanel) myPanel.style.display = "";
      if (trendingCard) trendingCard.style.display = "";
      if (exPanel) exPanel.style.display = "none";
    }
    function showResults() {
      if (myPanel) myPanel.style.display = "none";
      if (trendingCard) trendingCard.style.display = "none";
      if (exPanel) exPanel.style.display = "";
    }
    function resetResultsUI() {
      exList.innerHTML = "";
      exList.style.display = "none";
      exEmpty.textContent = "Type to search.";
      exEmpty.style.display = "";
      exCnt.textContent = "0";
    }

    // Initial state
    showHome();
    resetResultsUI();

    // ---------- Remote search ----------
    let t; // debounce timer
    async function doSearchNow(query) {
      const q = String(query || "").trim();
      if (q.length < 2) { showHome(); resetResultsUI(); return; }

      showResults();
      exEmpty.textContent = "Searching…";
      exEmpty.style.display = "";
      exList.style.display = "none";

      try {
        const r = await fetch(`/api/studies/search?q=${encodeURIComponent(q)}&per=50`);
        if (!r.ok) throw new Error("search_failed");
        const data = await r.json();
        const items = Array.isArray(data.items) ? data.items : [];

        if (items.length === 0) {
          exList.innerHTML = "";
          exList.style.display = "none";
          exEmpty.textContent = `No matches for “${q}”.`;
          exEmpty.style.display = "";
          exCnt.textContent = "0";
        } else {
          exList.innerHTML = items.map(s => renderCard(s, "View &amp; enroll")).join("");
          exList.style.display = "";
          exEmpty.style.display = "none";
          exCnt.textContent = String(items.length);
        }
      } catch (e) {
        exList.innerHTML = "";
        exList.style.display = "none";
        exEmpty.textContent = "Search failed. Try again.";
        exEmpty.style.display = "";
        exCnt.textContent = "0";
      }
    }

    function doSearchDebounced(query) {
      clearTimeout(t);
      t = setTimeout(() => doSearchNow(query), 250);
    }

    // ---------- Wiring ----------
    input.addEventListener("input", (e) => {
      const q = e.target.value;
      if (q.trim().length === 0) { showHome(); resetResultsUI(); return; }
      if (q.trim().length >= 2) doSearchDebounced(q);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doSearchNow(input.value);
      }
    });

    btnSearch && btnSearch.addEventListener("click", () => doSearchNow(input.value));

    btnClear && btnClear.addEventListener("click", () => {
      input.value = "";
      showHome();
      resetResultsUI();
      input.focus();
    });

    // "/" focuses search
    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && !/input|textarea|select/i.test(e.target.tagName)) {
        e.preventDefault();
        input.focus();
      }
    });
  });
})();
