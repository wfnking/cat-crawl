const siteListEl = document.querySelector("#site-list");
const searchEl = document.querySelector("#search");
const emptyStateEl = document.querySelector("#empty-state");
const detailEl = document.querySelector("#detail");

let sites = [];

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildPageHtml(site, page) {
  const screenshotUrl = page.screenshots?.[0]
    ? `/sites/${site.slug}/pages/${page.slug}/${page.screenshots[0]}`
    : "";
  const copySections = [
    ["Hero", page.copySummary?.hero],
    ["Proof", page.copySummary?.proof],
    ["Mechanism", page.copySummary?.mechanism],
    ["Pricing", page.copySummary?.pricing],
  ].filter(([, value]) => value);

  return `
    <div class="panel">
      <div class="eyebrow">${escapeHtml(site.title || site.slug)} / ${escapeHtml(page.pageType)}</div>
      <h1>${escapeHtml(page.title)}</h1>
      <p class="summary">${escapeHtml(page.summary || "")}</p>
      <div class="meta-grid">
        <div><strong>Auth</strong><span>${escapeHtml(page.auth)}</span></div>
        <div><strong>URL</strong><a href="${escapeHtml(page.url)}" target="_blank" rel="noreferrer">${escapeHtml(page.url)}</a></div>
        <div><strong>Site</strong><span>${escapeHtml(site.slug)}</span></div>
        <div><strong>Pages</strong><span>${escapeHtml(String(site.pageCount || site.pages?.length || 0))}</span></div>
      </div>
    </div>
    <div class="grid two">
      <div class="panel">
        <h2>Components</h2>
        <div class="chip-row">${(page.componentSummary || []).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>
      </div>
      <div class="panel">
        <h2>Tokens</h2>
        <div class="token-group">
          ${(page.tokenSummary?.colors || []).map((color) => `<span class="color-chip"><span class="swatch" style="background:${escapeHtml(color)}"></span>${escapeHtml(color)}</span>`).join("")}
        </div>
        <div class="token-group">${(page.tokenSummary?.fontFamilies || []).map((font) => `<span class="chip">${escapeHtml(font)}</span>`).join("")}</div>
      </div>
    </div>
    <div class="grid two">
      <div class="panel">
        <h2>Copy Framework</h2>
        <div class="copy-stack">
          ${copySections
            .map(
              ([label, value]) => `
                <div class="copy-block">
                  <strong>${escapeHtml(label)}</strong>
                  <p>${escapeHtml(value)}</p>
                </div>
              `,
            )
            .join("") || "<p>No copy blocks extracted.</p>"}
        </div>
      </div>
      <div class="panel">
        <h2>CTA</h2>
        <div class="chip-row">${(page.cta || []).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>
      </div>
    </div>
    <div class="panel">
      <h2>Screenshot</h2>
      ${screenshotUrl ? `<img class="screenshot" src="${escapeHtml(screenshotUrl)}" alt="${escapeHtml(page.title)}" />` : `<p>No screenshot captured.</p>`}
    </div>
  `;
}

function renderSites(filterText = "") {
  const normalized = filterText.trim().toLowerCase();
  const filteredSites = sites
    .map((site) => ({
      ...site,
      pages: site.pages.filter((page) => {
        if (!normalized) {
          return true;
        }
        return (
          site.slug.toLowerCase().includes(normalized) ||
          page.slug.toLowerCase().includes(normalized) ||
          page.title.toLowerCase().includes(normalized) ||
          (page.summary || "").toLowerCase().includes(normalized)
        );
      }),
    }))
    .filter((site) => site.pages.length > 0);

  siteListEl.innerHTML = filteredSites
    .map(
      (site) => `
        <div class="site-block">
          <div class="site-title">${escapeHtml(site.title || site.slug)}</div>
          <div class="site-meta">${escapeHtml(site.slug)} · ${escapeHtml(String(site.pageCount || site.pages.length))} pages</div>
          ${site.pages
            .map(
              (page) => `
                <button class="page-link" data-site="${escapeHtml(site.slug)}" data-page="${escapeHtml(page.slug)}">
                  <span>${escapeHtml(page.title)}</span>
                  <small>${escapeHtml(page.pageType)}</small>
                </button>
              `,
            )
            .join("")}
        </div>
      `,
    )
    .join("");

  siteListEl.querySelectorAll(".page-link").forEach((button) => {
    button.addEventListener("click", () => {
      const site = filteredSites.find((item) => item.slug === button.dataset.site);
      const page = site?.pages.find((item) => item.slug === button.dataset.page);
      if (!site || !page) {
        return;
      }
      emptyStateEl.classList.add("hidden");
      detailEl.classList.remove("hidden");
      detailEl.innerHTML = buildPageHtml(site, page);
    });
  });
}

async function bootstrap() {
  const response = await fetch("/generated/index.json");
  const payload = await response.json();
  sites = payload.sites || [];
  renderSites();
}

searchEl.addEventListener("input", () => {
  renderSites(searchEl.value);
});

bootstrap().catch((error) => {
  emptyStateEl.innerHTML = `<h1>Failed to load case studies</h1><p>${escapeHtml(String(error))}</p>`;
});
