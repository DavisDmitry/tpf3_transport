"use strict";

// Theme: "system" follows prefers-color-scheme, "light"/"dark" override it.
// The menu is plain radios in a native popover, so switching works without JS
// (CSS follows the checked radio). With JS, the theme lives in data-theme on
// <html> instead: it's remembered across pages and crossfaded on change.
(() => {
  const menu = document.getElementById("theme-menu");
  if (!menu) return;
  const radios = Array.from(menu.querySelectorAll('input[name="theme"]'));

  let saved = "system";
  try {
    saved = localStorage.getItem("theme") || "system";
  } catch (e) {}
  (radios.find((radio) => radio.value === saved) || radios[0]).checked = true;

  const apply = (mode) => {
    const root = document.documentElement;
    if (mode === "system") delete root.dataset.theme;
    else root.dataset.theme = mode;
    try {
      if (mode === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", mode);
    } catch (e) {}
  };

  // Crossfade where the View Transitions API exists; switch instantly otherwise
  // or when the user prefers reduced motion. Arrow keys move between radios and
  // preview each theme right away.
  menu.addEventListener("change", (e) => {
    const mode = e.target.value;
    const animate =
      document.startViewTransition &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate) document.startViewTransition(() => apply(mode));
    else apply(mode);
  });

  menu.addEventListener("toggle", (e) => {
    if (e.newState === "open") radios.find((radio) => radio.checked)?.focus();
  });

  // A mouse click picks and closes, leaving no focus behind; Enter closes from
  // the keyboard, returning focus to the toggle (as Esc does natively). The
  // label's own click has detail > 0; its forwarded click on the radio has 0.
  menu.addEventListener("click", (e) => {
    if (e.detail > 0 && e.target.closest(".theme-option")) {
      menu.hidePopover();
      document.activeElement?.blur();
    }
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      menu.hidePopover();
    }
  });
})();

// Category nav (a row or a dropdown, same element): remember whether the clicked
// category is right or left of the current one, so the next page slides in from
// that side (read in <head>).
document.querySelectorAll(".category-nav").forEach((list) => {
  const links = Array.from(list.querySelectorAll("a"));
  const current = links.findIndex((a) => a.getAttribute("aria-current") === "page");
  if (current < 0) return;
  links.forEach((link, index) =>
    link.addEventListener("click", (e) => {
      if (index === current || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const dir = index > current ? "forward" : "back";
      // Also mark this page, so its heading icon isn't captured on its own and
      // leaves together with the content (see .vt-icon in style.css).
      document.documentElement.dataset.navDir = dir;
      try {
        sessionStorage.setItem("nav-dir", dir);
      } catch (err) {}
    })
  );
});

// Vehicle table: sorting and filtering.
(() => {
  const table = document.getElementById("vehicles");
  const form = document.getElementById("filters");
  if (!table || !form) return;

  const tbody = table.tBodies[0];
  const cardList = document.getElementById("cards");
  // Table rows and cards are rendered in the same order; item i pairs them.
  const items = Array.from(tbody.rows, (row, i) => ({ row, card: cardList.children[i] }));
  const headers = Array.from(table.tHead.rows[0].cells);
  const numeric = headers.map((th) => th.querySelector("button").dataset.numeric === "true");
  const sortSelect = document.getElementById("sort-select");
  const sortDir = document.getElementById("sort-dir");
  const count = document.getElementById("count");
  const empty = document.getElementById("empty");

  // Numbers start descending (biggest first), text starts A→Z.
  const firstDir = (index) => (numeric[index] ? "descending" : "ascending");
  const otherDir = (dir) => (dir === "ascending" ? "descending" : "ascending");

  const cellValue = (row, index) => {
    const cell = row.cells[index];
    if (!numeric[index]) return cell.textContent.trim().toLowerCase();
    const value = parseFloat(cell.dataset.sort);
    return Number.isNaN(value) ? null : value;
  };

  let sort = { index: -1, dir: null };

  // index -1 restores the original order.
  const applySort = (index, dir) => {
    sort = { index, dir };
    headers.forEach((th, i) => th.setAttribute("aria-sort", i === index ? dir : "none"));
    sortSelect.value = index < 0 ? "" : String(index);
    sortDir.disabled = index < 0;
    sortDir.dataset.dir = dir || "";

    let ordered = items;
    if (index >= 0) {
      const sign = dir === "ascending" ? 1 : -1;
      ordered = items.slice().sort((a, b) => {
        const x = cellValue(a.row, index);
        const y = cellValue(b.row, index);
        if (x === y) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return (numeric[index] ? x - y : x.localeCompare(y)) * sign;
      });
    }
    tbody.append(...ordered.map((item) => item.row));
    cardList.append(...ordered.map((item) => item.card));
  };

  // Header clicks cycle: first direction → other direction → original order.
  headers.forEach((th, index) => {
    th.querySelector("button").addEventListener("click", () => {
      if (sort.index !== index) applySort(index, firstDir(index));
      else if (sort.dir === firstDir(index)) applySort(index, otherDir(sort.dir));
      else applySort(-1, null);
    });
  });

  sortSelect.addEventListener("change", () => {
    const index = sortSelect.value === "" ? -1 : Number(sortSelect.value);
    applySort(index, index < 0 ? null : firstDir(index));
  });

  sortDir.addEventListener("click", () => {
    if (sort.index >= 0) applySort(sort.index, otherDir(sort.dir));
  });

  const filterSelects = Array.from(form.querySelectorAll("select")).filter(
    (s) => s !== sortSelect
  );

  const filter = () => {
    const query = form.elements.q.value.trim().toLowerCase();
    const year = parseInt(form.elements.year.value, 10);
    let visible = 0;
    for (const { row, card } of items) {
      const show =
        (!query || row.dataset.name.includes(query)) &&
        (Number.isNaN(year) ||
          (Number(row.dataset.start) <= year && year <= Number(row.dataset.end))) &&
        filterSelects.every(
          (s) => !s.value || row.getAttribute(`data-${s.name}`).split("|").includes(s.value)
        );
      row.hidden = !show;
      card.hidden = !show;
      if (show) visible++;
    }
    count.textContent = `${visible} of ${items.length} vehicles`;
    empty.hidden = visible > 0;
  };

  form.addEventListener("input", (e) => {
    if (e.target !== sortSelect) filter();
  });
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("reset", () => {
    applySort(-1, null);
    setTimeout(filter);
  });

  // Table / cards view switch; the initial view is set by the script in <head>.
  const viewButtons = Array.from(form.querySelectorAll(".view-switch button"));
  const setView = (view, save) => {
    document.documentElement.dataset.view = view;
    viewButtons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view));
    if (save) {
      try {
        localStorage.setItem("view", view);
      } catch (e) {}
    }
  };
  setView(document.documentElement.dataset.view || "table", false);

  // Animate the switch where the View Transitions API exists. The list gets its
  // transition name only while switching (see .view-switching in style.css).
  const switchView = (view) => {
    const root = document.documentElement;
    const animate =
      view !== root.dataset.view &&
      document.startViewTransition &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate) {
      setView(view, true);
      return;
    }
    root.classList.add("view-switching");
    const transition = document.startViewTransition(() => setView(view, true));
    transition.finished.finally(() => root.classList.remove("view-switching"));
  };
  viewButtons.forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
})();
