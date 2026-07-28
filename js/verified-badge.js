(function () {
  function isVerified(profile = {}) {
    return String(profile?.verification_status || "").toLowerCase().trim() === "verified";
  }

  function render(profile = {}, options = {}) {
    if (!isVerified(profile)) return "";
    const label = options.short ? "Verified" : "Verified by Placely";
    return `<span class="placely-verified-badge" title="Verified by Placely" aria-label="Verified by Placely">${escapeHTML(label)}</span>`;
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  window.PlacelyVerifiedBadge = {
    isVerified,
    render
  };
})();
