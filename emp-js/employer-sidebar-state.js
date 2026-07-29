(function () {
  const storageKey = "placelyEmployerSidebarCollapsed";

  try {
    if (localStorage.getItem(storageKey) === "true") {
      document.documentElement.classList.add("employer-sidebar-collapsed");
    }
  } catch {}

  window.PLACELY_EMPLOYER_SIDEBAR_KEY = storageKey;
})();
