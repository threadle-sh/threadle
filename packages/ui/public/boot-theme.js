// Apply theme before paint to avoid a flash. Mirrors appearance.ts.
(function () {
  try {
    var a = localStorage.getItem("threadle.appearance");
    if (a !== "light" && a !== "dark" && a !== "system") a = "system";
    var theme =
      a === "light" || a === "dark"
        ? a
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (_) {
    document.documentElement.dataset.theme = "dark";
  }
})();
