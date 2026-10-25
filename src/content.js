// Affiche les « groupes » de Claude comme des dossiers : renommage et icônes de couleur.
const ext = globalThis.browser ?? globalThis.chrome;

(() => {
  const PALETTE = [
    "#e5484d",
    "#f76b15",
    "#ffc53d",
    "#46a758",
    "#12a594",
    "#0090ff",
    "#8e4ec6",
    "#d6409f",
    "#8d8d86",
  ];
  const DEFAULT_COLOR = "#0090ff";
  const NO_COLOR = "#8d8d86";
  const COLORS_KEY = "cfg_colors";
  const FOLDER_SVG =
    '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path fill="currentColor" d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.4a2 2 0 0 1 1.4.6L12 6.3h7.5A2.5 2.5 0 0 1 22 8.8v8.7a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5z"/></svg>';

  let dialogEl = null;
  let renameCount = 0;

  // ---------- utilitaires DOM ----------

  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "style") node.style.cssText = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    node.append(...children.flat().filter((c) => c != null && c !== false));
    return node;
  }

  function folderIcon(cls, color) {
    const span = h("span", { class: cls, style: `color:${color}` });
    span.innerHTML = FOLDER_SVG;
    return span;
  }

  function normalizeHex(value) {
    const m = String(value || "")
      .trim()
      .replace(/^#/, "")
      .match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return "#" + hex.toLowerCase();
  }

  function isDark() {
    for (const el of [document.body, document.documentElement]) {
      const m = getComputedStyle(el).backgroundColor.match(
        /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/,
      );
      if (m && m[4] !== "0")
        return 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3] < 128;
    }
    const html = document.documentElement;
    if (
      html.classList.contains("dark") ||
      /dark/i.test(html.dataset.theme || html.dataset.mode || "")
    )
      return true;
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }
  const themeClass = () => (isDark() ? "cf-theme-dark" : "cf-theme-light");

  // Les icônes de Claude sont des caractères d'une police d'icônes (zone Unicode privée)
  const cleanText = (s) =>
    s
      .replace(/[-▾▸▴▿]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  function findLabel(scope, re) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); )
      if (re.test(n.nodeValue.trim())) return n.parentElement;
    return null;
  }

  // Premier texte visible d'un élément, hors icônes et boutons de menu
  function labelNode(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      if (
        n.parentElement.closest(
          '[data-cds="Icon"], .cf-group-icon, kbd, [aria-haspopup]',
        )
      )
        continue;
      if (cleanText(n.nodeValue)) return n;
    }
    return null;
  }

  // ---------- renommage « groupe » → « dossier » ----------

  // Zones d'interface de Claude : le contenu des conversations n'est jamais modifié
  const RENAME_SCOPE =
    'aside, nav, [role="menu"], [role="dialog"], [role="alertdialog"], [role="tooltip"], [role="status"], [role="alert"], [data-cds-overlay]';
  // Titres de chats et zones de saisie : écrits par l'utilisateur
  const TEXT_SKIP =
    'a[href*="/chat/"], [contenteditable], textarea, script, style, .cf-overlay';
  const ATTR_SKIP = 'a[href*="/chat/"], [contenteditable], .cf-overlay';
  const RENAME_ATTRS = ["placeholder", "aria-label", "title"];
  // « groupe » et « dossier » sont tous deux masculins : les articles restent corrects.
  // Bornes Unicode plutôt que \b, qui prend « é » pour une fin de mot (« groupé »).
  const GROUP_WORD = /(?<![\p{L}\p{N}_])(groupe|group)(s?)(?![\p{L}\p{N}_])/giu;

  function matchCase(model, word) {
    if (model === model.toUpperCase()) return word.toUpperCase();
    if (model[0] === model[0].toUpperCase())
      return word[0].toUpperCase() + word.slice(1);
    return word;
  }

  const renamed = (text) =>
    text.replace(GROUP_WORD, (m, word, plural) =>
      matchCase(
        m,
        (word.toLowerCase() === "groupe" ? "dossier" : "folder") + plural,
      ),
    );

  function renameText(node) {
    const value = node.nodeValue;
    const parent = node.parentElement;
    if (!value || !/group/i.test(value) || !parent?.closest(RENAME_SCOPE))
      return;
    if (parent.closest(TEXT_SKIP)) return;
    const next = renamed(value);
    if (next !== value) {
      node.nodeValue = next;
      renameCount++;
    }
  }

  function renameAttrs(el) {
    if (!el.closest(RENAME_SCOPE) || el.closest(ATTR_SKIP)) return;
    for (const name of RENAME_ATTRS) {
      const value = el.getAttribute(name);
      if (!value || !/group/i.test(value)) continue;
      const next = renamed(value);
      if (next !== value) el.setAttribute(name, next);
    }
  }

  function renameIn(el) {
    if (!el.closest(RENAME_SCOPE) && !el.querySelector(RENAME_SCOPE)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) renameText(n);
    renameAttrs(el);
    for (const e of el.querySelectorAll("[placeholder], [aria-label], [title]"))
      renameAttrs(e);
  }

  // ---------- couleurs des dossiers ----------

  // clé du dossier → couleur ; clé = identifiant Claude si on le trouve, sinon « name:<nom> »
  let colors = {};
  let pendingCreation = null; // { name, color, at } : dossier en cours de création

  ext.storage.sync.get(COLORS_KEY).then((r) => {
    colors = r[COLORS_KEY] || {};
    schedule();
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[COLORS_KEY]) return;
    colors = changes[COLORS_KEY].newValue || {};
    schedule();
  });

  function saveColors(next) {
    colors = next;
    ext.storage.sync.set({ [COLORS_KEY]: colors });
    schedule();
  }
  const setColor = (key, color) => saveColors({ ...colors, [key]: color });

  // ---------- détection des dossiers dans la barre latérale ----------

  const BUILTIN_SECTIONS =
    /^(récents|recents|recent|sans dossier|sans groupe|ungrouped|no folder|épinglés|pinned|favoris|starred|projets|projects|artéfacts|artifacts|chats|design|personnalisation|plus|créer|nouveau chat|tâches planifiées)$/i;
  let currentGroups = [];

  function findGroups() {
    const aside = document.querySelector("aside");
    if (!aside) return [];
    const groups = [];
    const add = (row, key) => {
      if (groups.some((g) => g.row === row)) return;
      const label = labelNode(row);
      const name = label && cleanText(label.nodeValue);
      if (!name || BUILTIN_SECTIONS.test(name)) return;
      groups.push({ row, label, name, key: key || `name:${name}` });
    };
    // Lignes dont la clé React mentionne un groupe (« group:<id> »…)
    for (const row of aside.querySelectorAll("[data-row-key]")) {
      const key = row.dataset.rowKey;
      if (!key.startsWith("chat:") && /group|folder/i.test(key)) add(row, key);
    }
    // Sinon : en-têtes de section repliables (« Test ▾ »), hors lignes de chat et boutons de menu
    if (!groups.length)
      for (const el of aside.querySelectorAll("[aria-expanded]")) {
        if (
          el.closest('[data-row-key^="chat:"], a[href]') ||
          el.matches("[aria-haspopup]")
        )
          continue;
        add(el, null);
      }
    return groups;
  }

  function ensureIcon(g) {
    const color = colors[g.key] || NO_COLOR;
    let icon = g.row.querySelector(".cf-group-icon");
    if (!icon) {
      icon = folderIcon("cf-group-icon", color);
      icon.setAttribute("role", "button");
      icon.title = "Couleur du dossier";
      g.label.before(icon);
    }
    icon.dataset.key = g.key;
    icon.dataset.name = g.name;
    if (icon.dataset.color !== color) {
      icon.dataset.color = color;
      icon.style.color = color;
    }
  }

  // Un dossier qui apparaît avec le nom saisi à la création reçoit la couleur choisie
  function applyPendingCreation(g) {
    if (!pendingCreation || Date.now() - pendingCreation.at > 120000) return;
    if (g.name !== pendingCreation.name || colors[g.key]) return;
    setColor(g.key, pendingCreation.color);
    log("couleur appliquée au nouveau dossier", g.key.split(":")[0]);
    pendingCreation = null;
  }

  // Clic sur l'icône : choix de la couleur (sans replier la section)
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
    addEventListener(
      type,
      (e) => {
        if (e.target instanceof Element && e.target.closest(".cf-group-icon"))
          e.stopPropagation();
      },
      true,
    );
  addEventListener(
    "click",
    (e) => {
      const icon =
        e.target instanceof Element && e.target.closest(".cf-group-icon");
      if (!icon) return;
      e.preventDefault();
      e.stopPropagation();
      colorDialog(icon.dataset.key, icon.dataset.name);
    },
    true,
  );

  // ---------- sélecteur de couleur ----------

  function colorField(initial, onChange = null) {
    let color = normalizeHex(initial) || DEFAULT_COLOR;
    const preview = folderIcon("cf-preview", color);
    const hex = h("input", {
      class: "cf-hex",
      type: "text",
      maxlength: "7",
      spellcheck: "false",
      "aria-label": "Code couleur",
    });
    const picker = h("input", {
      class: "cf-picker",
      type: "color",
      title: "Choisir une couleur",
    });
    const swatches = PALETTE.map((c) =>
      h("button", {
        type: "button",
        class: "cf-swatch",
        style: `background:${c}`,
        title: c,
        "data-color": c,
        onclick: (e) => {
          e.preventDefault();
          set(c);
        },
      }),
    );

    function set(value, source = null) {
      color = normalizeHex(value);
      preview.style.color = color;
      if (source !== hex) hex.value = color;
      if (source !== picker) picker.value = color;
      hex.classList.remove("cf-invalid");
      for (const s of swatches)
        s.classList.toggle("cf-selected", s.dataset.color === color);
      onChange?.(color);
    }
    hex.addEventListener("input", () => {
      if (normalizeHex(hex.value)) set(hex.value, hex);
      else hex.classList.add("cf-invalid");
    });
    picker.addEventListener("input", () => set(picker.value, picker));
    // Les menus et fenêtres de Claude ne doivent pas intercepter la saisie
    hex.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== "Escape") e.stopPropagation();
    });

    const field = h(
      "div",
      { class: "cf-color-field" },
      h("div", { class: "cf-swatches" }, swatches),
      h("div", { class: "cf-hex-row" }, preview, picker, hex),
    );
    set(color);
    return { field, get: () => color };
  }

  function colorDialog(key, name) {
    dialogEl?.remove();
    const { field, get } = colorField(colors[key] || DEFAULT_COLOR);
    const close = () => {
      dialogEl?.remove();
      dialogEl = null;
    };
    dialogEl = h(
      "div",
      {
        class: `cf-overlay ${themeClass()}`,
        onmousedown: (e) => e.target === dialogEl && close(),
      },
      h(
        "form",
        {
          class: "cf-dialog cf-dialog-small",
          onsubmit: (e) => {
            e.preventDefault();
            setColor(key, get());
            close();
          },
        },
        h("div", { class: "cf-dialog-title", text: `Couleur de « ${name} »` }),
        field,
        h(
          "div",
          { class: "cf-actions" },
          h("button", {
            type: "button",
            class: "cf-btn",
            onclick: close,
            text: "Annuler",
          }),
          h("button", {
            type: "submit",
            class: "cf-btn cf-primary",
            text: "Enregistrer",
          }),
        ),
      ),
    );
    document.body.append(dialogEl);
    dialogEl.querySelector(".cf-primary").focus();
  }

  // ---------- menu ⋯ d'un dossier : « Couleur du dossier… » ----------

  const POPUP_SEL = '[role="menu"], [role="dialog"], [role="alertdialog"]';
  let menuGroup = null; // dossier dont le menu vient d'être ouvert
  let hoveredGroup = null;

  const groupAt = (target) =>
    target.closest('[data-row-key^="chat:"], a[href*="/chat/"]')
      ? null
      : currentGroups.find((g) => g.row.contains(target)) || null;

  addEventListener(
    "pointerover",
    (e) => {
      if (e.target instanceof Element && e.target.closest("aside"))
        hoveredGroup = groupAt(e.target);
    },
    true,
  );

  function rememberMenuGroup(e) {
    if (!(e.target instanceof Element) || e.target.closest(".cf-overlay"))
      return;
    lastPointerAt = Date.now();
    // Clic dans un menu ou une fenêtre déjà ouverts (ex. « Renommer ») : on garde le dossier
    if (e.target.closest(POPUP_SEL)) return;
    let group = groupAt(e.target);
    // Bouton ⋯ affiché à côté de l'en-tête plutôt que dedans
    if (
      !group &&
      e.target.closest("aside button") &&
      !e.target.closest('[data-row-key^="chat:"]')
    )
      group = hoveredGroup;
    menuGroup = group && { ...group, at: Date.now() };
  }
  addEventListener("pointerdown", rememberMenuGroup, true);
  addEventListener("contextmenu", rememberMenuGroup, true);

  function closeNativeMenu(menuItem, tries = 3) {
    menuItem.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        keyCode: 27,
        bubbles: true,
      }),
    );
    if (tries > 1)
      setTimeout(
        () => menuItem.isConnected && closeNativeMenu(menuItem, tries - 1),
        40,
      );
  }

  function enhanceGroupMenu(menu) {
    if (!menuGroup || Date.now() - menuGroup.at > 5000) return;
    if (menu.querySelector(".cf-native-item")) return;
    if (findLabel(menu, /^(archiver|archive)$/i)) return; // menu d'un chat
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const rename = items.find((i) =>
      /^(renommer|rename)/i.test(cleanText(i.textContent)),
    );
    const remove = items.find((i) =>
      /^(supprimer|delete)/i.test(cleanText(i.textContent)),
    );
    if (!rename && !remove) return; // sous-menu ou autre menu

    const group = menuGroup;
    // Copie d'une entrée existante pour reprendre exactement le style de Claude
    const item = (rename || remove).cloneNode(true);
    for (const el of [item, ...item.querySelectorAll("*")])
      for (const attr of [...el.attributes])
        if (
          /^(id|data-testid|data-highlighted|data-state|aria-(?!hidden))/.test(
            attr.name,
          )
        )
          el.removeAttribute(attr.name);
    item.classList.add("cf-native-item");
    item.tabIndex = -1;
    item
      .querySelectorAll("kbd, [data-cds='Shortcut'], [data-cds-mirror]")
      .forEach((k) => k.remove());
    const glyph = item.querySelector('[data-cds="Icon"]');
    if (glyph)
      glyph.replaceChildren(
        folderIcon("cf-menu-icon", colors[group.key] || NO_COLOR),
      );
    const label = labelNode(item);
    if (label) label.nodeValue = "Couleur du dossier…";
    if (remove && !rename) item.classList.remove("text-danger"); // copie de « Supprimer »

    item.addEventListener("pointerenter", () => {
      for (const i of menu.querySelectorAll("[data-highlighted]"))
        i.removeAttribute("data-highlighted");
      item.setAttribute("data-highlighted", "");
    });
    item.addEventListener("pointerleave", () =>
      item.removeAttribute("data-highlighted"),
    );
    // Bloque les gestionnaires de Claude (qui fermeraient le menu sans rien faire)
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"])
      item.addEventListener(type, (e) => e.stopPropagation());

    let done = false;
    const activate = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (done) return;
      done = true;
      closeNativeMenu(item);
      setTimeout(() => colorDialog(group.key, group.name), 60);
    };
    item.addEventListener("click", activate);
    item.addEventListener("pointerup", (e) => e.button === 0 && activate(e));

    if (rename) rename.after(item);
    else remove.before(item);
    log("entrée « Couleur du dossier » ajoutée");
  }

  // ---------- fenêtres de création / renommage d'un dossier ----------

  const dialogStates = new WeakMap(); // fenêtre de Claude → { input, get, renameOf }

  function popupTitle(popup) {
    const labelledBy = popup.getAttribute("aria-labelledby");
    return [
      popup.getAttribute("aria-label"),
      labelledBy && document.getElementById(labelledBy)?.textContent,
      popup.querySelector('h1, h2, h3, [role="heading"]')?.textContent,
    ].join(" ");
  }

  function enhanceFolderDialog(popup) {
    if (dialogStates.has(popup) || popup.querySelector(".cf-color-field"))
      return;
    const input = popup.querySelector(
      'input:not([type]):not(.cf-hex), input[type="text"]:not(.cf-hex)',
    );
    if (!input) return;
    const about = `${popupTitle(popup)} ${input.placeholder} ${input.getAttribute("aria-label") || ""}`;
    if (!/dossier|folder/i.test(about)) return;

    // Champ pré-rempli = renommage du dossier dont le menu a été ouvert
    const renameOf =
      input.value && menuGroup && Date.now() - menuGroup.at < 60000
        ? menuGroup
        : null;
    const { field, get } = colorField(
      renameOf ? colors[renameOf.key] || DEFAULT_COLOR : DEFAULT_COLOR,
    );
    field.classList.add("cf-in-claude");
    let block = input;
    while (
      block.parentElement &&
      block.parentElement !== popup &&
      block.parentElement.children.length === 1
    )
      block = block.parentElement;
    block.after(field);
    dialogStates.set(popup, { input, get, renameOf });
    log(
      renameOf
        ? "couleur ajoutée à la fenêtre de renommage"
        : "couleur ajoutée à la fenêtre de création",
    );
  }

  function commitDialog(popup) {
    const state = dialogStates.get(popup);
    const name = state && cleanText(state.input.value);
    if (!name) return;
    const color = state.get();
    if (state.renameOf) {
      // Une clé basée sur le nom suit le nouveau nom
      const oldKey = state.renameOf.key;
      const newKey = oldKey.startsWith("name:") ? `name:${name}` : oldKey;
      const next = { ...colors };
      if (newKey !== oldKey) delete next[oldKey];
      next[newKey] = color;
      saveColors(next);
    } else pendingCreation = { name, color, at: Date.now() };
  }

  const popupOf = (target) =>
    target instanceof Element && target.closest(POPUP_SEL);

  document.addEventListener(
    "click",
    (e) => {
      const popup = popupOf(e.target);
      const button =
        popup && dialogStates.has(popup) && e.target.closest("button");
      if (!button || button.closest(".cf-color-field")) return;
      const text = `${button.textContent} ${button.getAttribute("aria-label") || ""}`;
      if (/annuler|cancel|fermer|close/i.test(text)) return;
      commitDialog(popup);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      const popup = e.key === "Enter" && popupOf(e.target);
      if (popup && dialogStates.has(popup)) commitDialog(popup);
    },
    true,
  );
  document.addEventListener(
    "submit",
    (e) => {
      const popup = popupOf(e.target);
      if (popup && dialogStates.has(popup)) commitDialog(popup);
    },
    true,
  );

  // ---------- diagnostic ----------

  const debugLog = [];
  function log(...parts) {
    debugLog.push(
      `${new Date().toISOString().slice(11, 23)} ${parts.join(" ")}`,
    );
    if (debugLog.length > 60) debugLog.shift();
    console.debug("[Claude Folders]", ...parts);
  }

  // Menus et fenêtres ouverts juste après un clic, gardés pour le diagnostic
  let lastPointerAt = 0;
  const popupsHTML = [];

  function capturePopups(mutations) {
    if (Date.now() - lastPointerAt > 5000) return;
    for (const m of mutations)
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || n.closest("aside, .cf-overlay")) continue;
        const popup = n.matches(POPUP_SEL) ? n : n.querySelector(POPUP_SEL);
        if (!popup) continue;
        const html = popup.outerHTML.slice(0, 6000);
        if (popupsHTML.includes(html)) continue;
        popupsHTML.push(html);
        if (popupsHTML.length > 6) popupsHTML.shift();
      }
  }

  // Copie d'un élément avec les titres masqués
  function anonymized(el) {
    const clone = el.cloneNode(true);
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); )
      if (n.nodeValue.trim()) n.nodeValue = "Titre";
    for (const e of [
      clone,
      ...clone.querySelectorAll("[title], [aria-label]"),
    ]) {
      if (e.hasAttribute("title")) e.setAttribute("title", "Titre");
      if (e.hasAttribute("aria-label")) e.setAttribute("aria-label", "Titre");
    }
    return clone.outerHTML.slice(0, 5000);
  }

  // Arborescence de la barre latérale : balises et attributs data-*, sans les titres
  function skeleton(el, depth = 0, lines = []) {
    if (lines.length >= 300) return lines;
    const attrs = [...el.attributes]
      .filter(
        (a) =>
          a.name.startsWith("data-") ||
          a.name === "role" ||
          a.name === "aria-expanded",
      )
      .map((a) => {
        if (a.name === "data-row-key")
          return `data-row-key="${a.value.split(":")[0]}:…"`;
        return a.value ? `${a.name}="${a.value.slice(0, 30)}"` : a.name;
      })
      .join(" ");
    const cls =
      typeof el.className === "string"
        ? el.className.split(/\s+/).slice(0, 4).join(" ")
        : "";
    const text = el.children.length === 0 ? cleanText(el.textContent) : "";
    const shown = text
      ? BUILTIN_SECTIONS.test(text)
        ? ` « ${text} »`
        : " «texte»"
      : "";
    lines.push(
      `${"  ".repeat(depth)}<${el.tagName.toLowerCase()}${attrs ? " " + attrs : ""}${cls ? ` class="${cls}"` : ""}>${shown}`,
    );
    if (
      el.dataset?.rowKey?.startsWith("chat:") ||
      el.tagName.toLowerCase() === "svg"
    )
      return lines;
    for (const c of el.children) skeleton(c, depth + 1, lines);
    return lines;
  }

  function diagnosticText() {
    const aside = document.querySelector("aside");
    const nonChat =
      aside &&
      [...aside.querySelectorAll("[data-row-key]")].find(
        (r) => !r.dataset.rowKey.startsWith("chat:"),
      );
    return [
      "=== Claude Folders – diagnostic ===",
      `Navigateur : ${navigator.userAgent}`,
      `Page : ${location.pathname.replace(/[0-9a-f-]{36}/i, "<id>")}`,
      `Remplacements « groupe » → « dossier » : ${renameCount}`,
      `Dossiers détectés : ${currentGroups.length}`,
      ...currentGroups.map(
        (g) =>
          `  ${g.row.tagName.toLowerCase()} clé=${g.key.split(":")[0]} nom=${g.name.length} car. couleur=${colors[g.key] || "aucune"}`,
      ),
      `Couleurs enregistrées : ${Object.keys(colors).length}`,
      "",
      "--- Première ligne qui n'est pas un chat ---",
      nonChat ? anonymized(nonChat) : "(aucune)",
      "",
      "--- Menus et fenêtres ouverts récemment (les noms de dossiers peuvent y figurer) ---",
      ...(popupsHTML.length ? popupsHTML.flatMap((p) => [p, ""]) : ["(aucun)"]),
      "",
      "--- Structure de la barre latérale ---",
      ...(aside ? skeleton(aside) : ["(pas de barre latérale <aside>)"]),
      "",
      "--- Journal ---",
      ...debugLog,
    ].join("\n");
  }

  function openDiagnostic() {
    dialogEl?.remove();
    const text = h("textarea", {
      class: "cf-input cf-diag",
      readonly: true,
      spellcheck: "false",
    });
    text.value = diagnosticText();
    const close = () => {
      dialogEl?.remove();
      dialogEl = null;
    };
    const copy = h("button", {
      type: "button",
      class: "cf-btn cf-primary",
      text: "Copier",
      onclick: async () => {
        text.select();
        try {
          await navigator.clipboard.writeText(text.value);
        } catch {
          document.execCommand("copy");
        }
        copy.textContent = "Copié !";
      },
    });
    dialogEl = h(
      "div",
      {
        class: `cf-overlay ${themeClass()}`,
        onmousedown: (e) => e.target === dialogEl && close(),
      },
      h(
        "div",
        { class: "cf-dialog" },
        h("div", {
          class: "cf-dialog-title",
          text: "Diagnostic Claude Folders",
        }),
        h("p", {
          class: "cf-hint",
          text: "Avant : ouvre le menu ⋯ d'un dossier, puis la fenêtre « Nouveau dossier ». Ensuite copie ce texte et envoie-le. Les titres de tes chats sont masqués.",
        }),
        text,
        h(
          "div",
          { class: "cf-actions" },
          h("button", {
            type: "button",
            class: "cf-btn",
            onclick: close,
            text: "Fermer",
          }),
          copy,
        ),
      ),
    );
    document.body.append(dialogEl);
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && dialogEl) {
        dialogEl.remove();
        dialogEl = null;
      }
    },
    true,
  );

  // Ouvert depuis le bouton de l'extension dans la barre du navigateur
  ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "cf-diagnostic") return;
    openDiagnostic();
    sendResponse({ ok: true });
  });

  // ---------- démarrage ----------

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  function refresh() {
    scheduled = false;
    currentGroups = findGroups();
    for (const g of currentGroups) {
      applyPendingCreation(g);
      ensureIcon(g);
    }
    for (const popup of document.querySelectorAll(POPUP_SEL)) {
      if (popup.closest(".cf-overlay")) continue;
      if (popup.matches('[role="menu"]')) enhanceGroupMenu(popup);
      enhanceFolderDialog(popup);
    }
  }

  // Seuls la barre latérale et les menus / fenêtres comptent (pas une réponse en cours d'écriture)
  function isRelevant(mutations) {
    return mutations.some((m) => {
      const el =
        m.target.nodeType === Node.ELEMENT_NODE
          ? m.target
          : m.target.parentElement;
      return (
        !!el &&
        (el === document.body ||
          el.parentElement === document.body ||
          !!el.closest(`aside, ${POPUP_SEL}`))
      );
    });
  }

  // Nettoie les données de la première version (dossiers propres à l'extension)
  ext.storage.sync.get(null).then((all) => {
    const old = Object.keys(all).filter(
      (k) => k === "cf_meta" || k.startsWith("cf_chunk_"),
    );
    if (old.length) ext.storage.sync.remove(old);
  });
  ext.storage.local.remove("cf_open");

  renameIn(document.body);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") renameText(m.target);
      else if (m.type === "attributes") renameAttrs(m.target);
      else
        for (const n of m.addedNodes) {
          if (n.nodeType === Node.TEXT_NODE) renameText(n);
          else if (n.nodeType === Node.ELEMENT_NODE) renameIn(n);
        }
    }
    capturePopups(mutations);
    if (isRelevant(mutations)) schedule();
  }).observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: RENAME_ATTRS,
  });
  schedule();
  log("démarrage, remplacements initiaux :", renameCount);
})();
