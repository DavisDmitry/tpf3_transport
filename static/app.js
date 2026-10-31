"use strict";

// Theme: "system" follows prefers-color-scheme, "light"/"dark" override it.
(() => {
  const MODES = ["system", "light", "dark"];
  const picker = document.getElementById("theme-picker");
  if (!picker) return;
  const button = picker.querySelector(".theme-toggle");
  const menu = picker.querySelector(".theme-menu");
  const items = Array.from(menu.querySelectorAll("[role=menuitemradio]"));

  const read = () => {
    try {
      const value = localStorage.getItem("theme");
      return MODES.includes(value) ? value : "system";
    } catch (e) {
      return "system";
    }
  };

  const apply = (mode) => {
    const root = document.documentElement;
    if (mode === "system") delete root.dataset.theme;
    else root.dataset.theme = mode;
    try {
      if (mode === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", mode);
    } catch (e) {}
    picker.dataset.mode = mode;
    items.forEach((item) => item.setAttribute("aria-checked", item.dataset.mode === mode));
  };

  const open = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    items.find((item) => item.dataset.mode === picker.dataset.mode).focus();
  };

  const close = (refocus) => {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  };

  // Crossfade between the old and new theme where the View Transitions API exists;
  // switch instantly otherwise or when the user prefers reduced motion.
  const choose = (mode) => {
    const update = () => {
      apply(mode);
      close(true);
    };
    const animate =
      mode !== picker.dataset.mode &&
      document.startViewTransition &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate) document.startViewTransition(update);
    else update();
  };

  apply(read());

  button.addEventListener("click", () => (menu.hidden ? open() : close(false)));
  items.forEach((item) => item.addEventListener("click", () => choose(item.dataset.mode)));
  menu.addEventListener("keydown", (e) => {
    const index = items.indexOf(document.activeElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      items[(index + step + items.length) % items.length].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1].focus();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close(true);
  });
  document.addEventListener("click", (e) => {
    if (!picker.contains(e.target)) close(false);
  });
  picker.addEventListener("focusout", (e) => {
    if (!picker.contains(e.relatedTarget)) close(false);
  });
})();

// Category nav: remember whether the clicked category is right or left of the
// current one, so the next page slides in from that side (read in <head>).
(() => {
  const links = Array.from(document.querySelectorAll(".category-nav a"));
  const current = links.findIndex((a) => a.getAttribute("aria-current") === "page");
  if (current < 0) return;
  links.forEach((link, index) =>
    link.addEventListener("click", (e) => {
      if (index === current || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      try {
        sessionStorage.setItem("nav-dir", index > current ? "forward" : "back");
      } catch (err) {}
    })
  );
})();

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
