// public/js/trending.js
(function () {
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function cardHTML(s) {
    const href = "/s/" + s.slug;
    const title = escapeHtml(s.title || s.slug);
    return `
      <div class="border border-[var(--line)] rounded-xl p-3 bg-white flex items-start justify-between gap-4" data-card data-slug="${escapeHtml(s.slug)}">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <a class="font-semibold hover:underline" href="${href}">${title}</a>
            <span class="chip">trending</span>
          </div>
        </div>
        <div class="shrink-0">
          <a class="btn" href="${href}">View</a>
        </div>
      </div>`;
  }

  ready(async function () {
    const card  = document.getElementById("trending-card");
    const list  = document.getElementById("trending-list");
    const empty = document.getElementById("trending-empty");
    const count = document.getElementById("trending-count");
    if (!card || !list || !empty || !count) return;

    try {
      const r = await fetch("/api/studies/trending?limit=8", { cache: "no-store" });
      if (!r.ok) throw new Error("trending_failed");
      const data = await r.json();
      const items = Array.isArray(data.items) ? data.items : [];

      if (items.length === 0) {
        list.style.display = "none";
        empty.style.display = "";
        count.textContent = "0";
        card.style.display = "";
        return;
      }

      list.innerHTML = items.map(cardHTML).join("");
      list.style.display = "";
      empty.style.display = "none";
      count.textContent = String(items.length);
      card.style.display = "";
    } catch (e) {
      // Fail silent – just keep the card hidden
      // console.warn("[trending] failed", e);
    }
  });
})();
