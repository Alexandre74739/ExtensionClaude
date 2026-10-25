// Affiche les « groupes » de Claude comme des dossiers : renommage, couleurs, sous-dossiers et recherche.
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
  const PARENTS_KEY = "cfg_parents";
  // Retrait d'un niveau : laisse la ligne de rattachement (sous l'icône du parent, vers 22 px)
  // à l'écart du fond de survol des chats du sous-dossier
  const INDENT_PX = 26;
  const CHAT_LINK = 'a[href*="/chat/"]';
  const FOLDER_SVG =
    '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path fill="currentColor" d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.4a2 2 0 0 1 1.4.6L12 6.3h7.5A2.5 2.5 0 0 1 22 8.8v8.7a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5z"/></svg>';
  const CHAT_SVG =
    '<svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><path d="M3 3.5h10a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H7l-3 2.5V11H3a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  const SEARCH_SVG =
    '<svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

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

  function svgIcon(cls, svg, color = null) {
    const span = h("span", {
      class: cls,
      style: color ? `color:${color}` : null,
    });
    span.innerHTML = svg;
    return span;
  }
  const folderIcon = (cls, color) => svgIcon(cls, FOLDER_SVG, color);

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

  const chatIdFrom = (href) =>
    (href || "").match(/\/chat\/([0-9a-f-]{36})/i)?.[1] || null;

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

  // Texte sans accents ni majuscules, avec la position de chaque caractère dans l'original
  function normalizedWithMap(text) {
    let out = "";
    const map = [];
    for (let i = 0; i < text.length; i++) {
      const n = text[i]
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
      for (const c of n) {
        out += c;
        map.push(i);
      }
    }
    map.push(text.length);
    return { out, map };
  }
  const norm = (text) => normalizedWithMap(text).out;

  // ---------- renommage « groupe » → « dossier » ----------

  // Zones d'interface de Claude : le contenu des conversations n'est jamais modifié
  const RENAME_SCOPE =
    'aside, nav, [role="menu"], [role="dialog"], [role="alertdialog"], [role="tooltip"], [role="status"], [role="alert"], [data-cds-overlay]';
  // Titres de chats, zones de saisie et éléments de l'extension : jamais renommés
  const TEXT_SKIP =
    'a[href*="/chat/"], [contenteditable], textarea, script, style, .cf-overlay, #cf-search';
  const ATTR_SKIP =
    'a[href*="/chat/"], [contenteditable], .cf-overlay, #cf-search';
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

  // ---------- couleurs et sous-dossiers (enregistrés par l'extension) ----------

  // Clé d'un dossier = identifiant Claude si on le trouve, sinon « name:<nom> »
  let colors = {}; // clé → couleur
  let parents = {}; // clé du sous-dossier → clé du dossier parent
  let pendingCreation = null; // { name, color, parent, at } : dossier en cours de création

  ext.storage.sync.get([COLORS_KEY, PARENTS_KEY]).then((r) => {
    colors = r[COLORS_KEY] || {};
    parents = r[PARENTS_KEY] || {};
    schedule();
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes[COLORS_KEY]) colors = changes[COLORS_KEY].newValue || {};
    if (changes[PARENTS_KEY]) parents = changes[PARENTS_KEY].newValue || {};
    if (changes[COLORS_KEY] || changes[PARENTS_KEY]) schedule();
  });

  function saveColors(next) {
    colors = next;
    ext.storage.sync.set({ [COLORS_KEY]: colors });
    schedule();
  }
  const setColor = (key, color) => saveColors({ ...colors, [key]: color });

  function saveParents(next) {
    parents = next;
    ext.storage.sync.set({ [PARENTS_KEY]: parents });
    schedule();
  }

  // Vrai si le dossier `key` est `ancestor` ou l'un de ses sous-dossiers
  function isInside(key, ancestor) {
    for (let k = key, i = 0; k && i < 50; k = parents[k], i++)
      if (k === ancestor) return true;
    return false;
  }

  function setParent(key, parent) {
    if (parent && isInside(parent, key)) return false;
    const next = { ...parents };
    if (parent) next[key] = parent;
    else delete next[key];
    saveParents(next);
    log(
      "dossier parent :",
      key.split(":")[0],
      "→",
      parent ? parent.split(":")[0] : "racine",
    );
    return true;
  }

  // Une clé basée sur le nom suit le dossier quand il est renommé
  function renameKey(oldKey, newKey) {
    if (oldKey === newKey) return;
    const nextColors = { ...colors };
    if (oldKey in nextColors) {
      nextColors[newKey] = nextColors[oldKey];
      delete nextColors[oldKey];
    }
    const nextParents = {};
    for (const [child, parent] of Object.entries(parents))
      nextParents[child === oldKey ? newKey : child] =
        parent === oldKey ? newKey : parent;
    saveColors(nextColors);
    saveParents(nextParents);
  }

  // Les premières versions identifiaient les dossiers par leur nom (« name:Test ») :
  // on passe à l'identifiant Claude, qui survit à un renommage
  function migrateNameKeys(groups) {
    const toId = new Map(
      groups
        .filter((g) => g.key.startsWith("group:"))
        .map((g) => [`name:${g.name}`, g.key]),
    );
    const parentValues = new Set(Object.values(parents));
    const hasOld = [...toId.keys()].some(
      (k) => k in colors || k in parents || parentValues.has(k),
    );
    if (!hasOld) return;
    const nextColors = { ...colors };
    for (const [oldKey, newKey] of toId)
      if (oldKey in nextColors) {
        nextColors[newKey] ??= nextColors[oldKey];
        delete nextColors[oldKey];
      }
    const nextParents = {};
    for (const [child, parent] of Object.entries(parents))
      nextParents[toId.get(child) || child] = toId.get(parent) || parent;
    saveColors(nextColors);
    saveParents(nextParents);
    log("réglages migrés vers les identifiants Claude :", toId.size);
  }

  // Dossiers parents affichés, du plus proche au plus lointain
  function ancestorsOf(key) {
    const keys = new Set(currentGroups.map((g) => g.key));
    const out = [];
    for (
      let k = parents[key], i = 0;
      k && keys.has(k) && i < 50;
      k = parents[k], i++
    )
      out.push(k);
    return out;
  }

  function pathOf(key) {
    const names = new Map(currentGroups.map((g) => [g.key, g.name]));
    return [...ancestorsOf(key).reverse(), key]
      .map((k) => names.get(k))
      .join(" › ");
  }

  // Ordre d'affichage en arbre : chaque dossier suivi de ses sous-dossiers
  function treeOrder(groups) {
    const byKey = new Map(groups.map((g) => [g.key, g]));
    const parentOf = (g) => {
      const p = parents[g.key];
      return p && p !== g.key && byKey.has(p) ? p : null;
    };
    const children = new Map();
    for (const g of groups) {
      const p = parentOf(g);
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(g);
    }
    const out = [];
    const walk = (p, depth) => {
      for (const g of children.get(p) || []) {
        out.push({ g, depth });
        walk(g.key, depth + 1);
      }
    };
    walk(null, 0);
    // Boucle venue d'un autre appareil : les dossiers concernés restent à la racine
    for (const g of groups)
      if (!out.some((o) => o.g === g)) out.push({ g, depth: 0 });
    return out;
  }

  // ---------- détection des dossiers et sections de la barre latérale ----------

  const BUILTIN_SECTIONS =
    /^(récents|recents|recent|sans dossier|sans groupe|ungrouped|no folder|épinglés|pinned|favoris|starred|projets|projects|artéfacts|artifacts|chats|design|personnalisation|plus|créer|nouveau chat|tâches planifiées)$/i;
  // Sections de Claude qui contiennent des chats (à filtrer et ordonner avec les dossiers)
  const CHAT_SECTIONS =
    /^(récents|recents|recent|sans dossier|sans groupe|ungrouped|no folder|épinglés|pinned|favoris|starred)$/i;
  let currentGroups = [];
  let lastLayout = null;

  function findGroups() {
    const aside = document.querySelector("aside");
    if (!aside) return [];
    const groups = [];
    // Structure actuelle de Claude : une section par dossier, avec son identifiant
    // (data-group-list="cg-…" ; vide pour « Sans dossier »)
    for (const section of aside.querySelectorAll("[data-group-list]")) {
      const id = section.getAttribute("data-group-list");
      const row = section.querySelector("button[data-group-toggle]");
      const label = row && labelNode(row);
      const name =
        section.dataset.groupLabel || (label && cleanText(label.nodeValue));
      if (id && label && name)
        groups.push({ row, label, name, key: `group:${id}` });
    }
    if (groups.length) return groups;

    // Repli si Claude change de structure
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
          el.closest('[data-row-key^="chat:"], a[href], #cf-search') ||
          el.matches("[aria-haspopup]")
        )
          continue;
        add(el, null);
      }
    return groups;
  }

  function builtinHeaders(aside) {
    const out = [];
    for (const el of aside.querySelectorAll(
      "[aria-expanded], [data-row-key]",
    )) {
      if (
        el.matches("[aria-haspopup]") ||
        el.closest('[data-row-key^="chat:"], a[href], #cf-search')
      )
        continue;
      const label = labelNode(el);
      if (label && CHAT_SECTIONS.test(cleanText(label.nodeValue))) out.push(el);
    }
    return out;
  }

  function commonAncestor(els) {
    let a = els[0].parentElement;
    while (a && !els.every((e) => a.contains(e))) a = a.parentElement;
    return a;
  }

  // Découpe la liste de la barre latérale en sections : un en-tête puis ses chats
  function computeLayout() {
    const aside = document.querySelector("aside");
    if (!aside) return null;
    let headers = [
      ...currentGroups.map((g) => ({ el: g.row, group: g, label: g.name })),
      ...builtinHeaders(aside).map((el) => ({
        el,
        group: null,
        label: cleanText(labelNode(el).nodeValue),
      })),
    ];
    // Un en-tête contenu dans un autre est le même (bouton dans sa ligne)
    headers = headers.filter(
      (hd) => !headers.some((o) => o.el !== hd.el && o.el.contains(hd.el)),
    );
    if (!headers.length) return null;

    let list;
    if (headers.length > 1) list = commonAncestor(headers.map((hd) => hd.el));
    else {
      let block = headers[0].el;
      while (
        block.parentElement &&
        block.parentElement !== aside &&
        !block.parentElement.querySelector(`${CHAT_LINK}:not(#cf-search *)`)
      )
        block = block.parentElement;
      list = block.parentElement;
    }
    if (!list) return null;

    const sections = [];
    const preamble = [];
    partition(list, headers, sections, preamble, { current: null });
    return { aside, list, sections, preamble };
  }

  // Un bloc qui contient plusieurs en-têtes (ex. le conteneur de tous les dossiers,
  // séparé de « Sans dossier ») est découpé à son tour, jusqu'à un en-tête par section
  function partition(container, headers, sections, preamble, state) {
    for (const child of container.children) {
      if (child.id === "cf-search") continue;
      const inside = headers.filter(
        (hd) => child === hd.el || child.contains(hd.el),
      );
      if (inside.length > 1)
        partition(child, inside, sections, preamble, state);
      else if (inside.length === 1) {
        const header = inside[0];
        state.current = {
          header,
          group: header.group,
          label: header.label,
          units: [child],
        };
        sections.push(state.current);
      } else if (state.current) state.current.units.push(child);
      else preamble.push(child);
    }
  }

  const sectionKey = (s) => (s.group ? s.group.key : `section:${s.label}`);

  function toggleOf(section) {
    const el = section.header.el;
    return el.matches("[aria-expanded]")
      ? el
      : el.querySelector("[aria-expanded]:not([aria-haspopup])");
  }
  const isCollapsed = (section) =>
    toggleOf(section)?.getAttribute("aria-expanded") === "false";

  // Ligne d'un chat : remonte tant que le parent ne contient que ce chat, sans sortir de la section
  function rowOf(link, unit) {
    const keyed = link.closest("[data-row-key]");
    if (keyed && unit.contains(keyed)) return keyed;
    let row = link;
    while (
      row !== unit &&
      row.parentElement &&
      row.parentElement.querySelectorAll(CHAT_LINK).length === 1
    )
      row = row.parentElement;
    return row;
  }

  function chatsOf(section) {
    const out = [];
    for (const unit of section.units) {
      const links = unit.matches(CHAT_LINK)
        ? [unit]
        : unit.querySelectorAll(CHAT_LINK);
      for (const link of links) {
        const id = chatIdFrom(link.getAttribute("href"));
        if (id)
          out.push({
            id,
            link,
            title: link.textContent.trim(),
            row: rowOf(link, unit),
          });
      }
    }
    return out;
  }

  // ---------- icône de couleur devant chaque dossier ----------

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

  // Le titre d'un dossier prend le style du texte des chats (taille, graisse, couleur)
  const TITLE_STYLES = [
    "font-family",
    "font-size",
    "font-weight",
    "letter-spacing",
    "color",
  ];

  function chatTextStyle() {
    const links = [...document.querySelectorAll(`aside ${CHAT_LINK}`)];
    // Un chat non sélectionné : le chat ouvert est affiché plus foncé
    const link = links.find((a) => !a.closest("[data-selected]")) || links[0];
    if (!link) return null;
    const cs = getComputedStyle(link);
    return TITLE_STYLES.map((prop) => [prop, cs.getPropertyValue(prop)]);
  }

  function matchTitleStyle(g, style) {
    const el = g.label.parentElement;
    if (!style || !el) return;
    // « important » : les classes de Claude peuvent elles-mêmes être prioritaires
    for (const [prop, value] of style)
      if (el.style.getPropertyValue(prop) !== value)
        el.style.setProperty(prop, value, "important");
  }

  // Un dossier qui apparaît avec le nom saisi à la création reçoit la couleur et le parent choisis
  function applyPendingCreation(g) {
    if (!pendingCreation || Date.now() - pendingCreation.at > 120000) return;
    if (g.name !== pendingCreation.name || colors[g.key]) return;
    setColor(g.key, pendingCreation.color);
    if (pendingCreation.parent) setParent(g.key, pendingCreation.parent);
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

  // ---------- sous-dossiers : ordre et retrait des sections ----------

  // Décale chaque sous-dossier (en-tête et chats) sous son parent, et le masque quand
  // le parent est replié. Réordonne par CSS (order) sans déplacer les éléments de Claude,
  // ce qui casserait React.
  const isContents = (el) => getComputedStyle(el).display === "contents";

  // Boîtes réellement affichées : un élément « display: contents » (courant avec React)
  // n'a pas de boîte, une marge ou un ordre posés dessus seraient sans effet
  const boxesOf = (el) =>
    isContents(el) ? [...el.children].flatMap(boxesOf) : [el];

  function layoutParent(el) {
    let p = el.parentElement;
    while (p && isContents(p)) p = p.parentElement;
    return p;
  }

  function applyNesting(layout) {
    const groupSections = layout.sections.filter((s) => s.group);
    const tree = treeOrder(groupSections.map((s) => s.group));
    const touched = new Set();
    if (tree.some((t) => t.depth > 0)) {
      const sectionByKey = new Map(groupSections.map((s) => [s.group.key, s]));
      const placed = []; // boîtes des dossiers, dans l'ordre de l'arbre
      const nested = []; // boîtes des sous-dossiers visibles, pour leurs lignes de rattachement
      for (const { g, depth } of tree) {
        const hidden = ancestorsOf(g.key).some((k) => {
          const parent = sectionByKey.get(k);
          return parent && isCollapsed(parent);
        });
        for (const u of sectionByKey.get(g.key).units) {
          touched.add(u);
          u.toggleAttribute("data-cf-collapsed-parent", hidden);
          for (const box of boxesOf(u)) {
            placed.push(box);
            touched.add(box);
            box.dataset.cfDepth = String(depth);
            // Retrait intérieur (et non marge) : les lignes se dessinent dans la boîte
            if (depth) {
              box.style.setProperty(
                "padding-inline-start",
                `${depth * INDENT_PX}px`,
                "important",
              );
              if (!hidden) nested.push({ box, key: g.key });
            } else clearGuides(box);
          }
        }
      }
      for (const { box, key } of nested) drawGuides(box, key, sectionByKey);
      // L'ordre n'est possible que si tous les dossiers sont dans le même conteneur affiché
      const container = placed.length ? layoutParent(placed[0]) : null;
      if (container && placed.every((b) => layoutParent(b) === container)) {
        orderContainer(container, placed);
        touched.add(container);
      }
    }
    // Nettoie ce qui ne fait plus partie d'un arbre (sous-dossier remis à la racine…)
    for (const el of layout.aside.querySelectorAll(
      "[data-cf-depth], [data-cf-ordered], [data-cf-collapsed-parent]",
    ))
      if (!touched.has(el)) clearNesting(el);
  }

  // Une ligne verticale sous l'icône de chaque dossier ancêtre, comme les guides d'un
  // explorateur de fichiers ; dessinée en fond pour rester sous le survol des chats
  const GUIDE_PROPS = [
    "background-image",
    "background-position",
    "background-size",
    "background-repeat",
  ];

  function drawGuides(box, key, sectionByKey) {
    const boxLeft = box.getBoundingClientRect().left;
    const xs = [];
    for (const k of ancestorsOf(key)) {
      const icon = sectionByKey
        .get(k)
        ?.group.row.querySelector(".cf-group-icon");
      const r = icon?.getBoundingClientRect();
      if (r?.width) xs.push(Math.round(r.left + r.width / 2 - boxLeft));
    }
    if (!xs.length) return clearGuides(box, false);
    const line =
      "linear-gradient(var(--cf-guide-color), var(--cf-guide-color))";
    box.style.setProperty(
      "background-image",
      xs.map(() => line).join(", "),
      "important",
    );
    box.style.setProperty(
      "background-position",
      xs.map((x) => `${x}px 3px`).join(", "),
      "important",
    );
    box.style.setProperty(
      "background-size",
      "1px calc(100% - 6px)",
      "important",
    );
    box.style.setProperty("background-repeat", "no-repeat", "important");
  }

  function clearGuides(box, withIndent = true) {
    for (const prop of GUIDE_PROPS) box.style.removeProperty(prop);
    if (withIndent) box.style.removeProperty("padding-inline-start");
  }

  // Les dossiers prennent l'ordre de l'arbre, à l'endroit du premier d'entre eux
  function orderContainer(container, placed) {
    if (
      !container.dataset.cfFlex &&
      !/flex|grid/.test(getComputedStyle(container).display)
    ) {
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.dataset.cfFlex = "1";
    }
    container.dataset.cfOrdered = "1";
    const inTree = new Set(placed);
    const sequence = [];
    let inserted = false;
    for (const item of [...container.children].flatMap(boxesOf)) {
      if (!inTree.has(item)) sequence.push(item);
      else if (!inserted) {
        sequence.push(...placed);
        inserted = true;
      }
    }
    sequence.forEach((el, i) =>
      el.style.setProperty("order", String(i + 1), "important"),
    );
  }

  function clearNesting(el) {
    if (el.dataset.cfOrdered) {
      for (const item of [...el.children].flatMap(boxesOf))
        item.style.removeProperty("order");
      if (el.dataset.cfFlex) {
        el.style.removeProperty("display");
        el.style.removeProperty("flex-direction");
        delete el.dataset.cfFlex;
      }
      delete el.dataset.cfOrdered;
    }
    if (el.dataset.cfDepth !== undefined) {
      clearGuides(el);
      delete el.dataset.cfDepth;
    }
    el.removeAttribute("data-cf-collapsed-parent");
  }

  // Sous-menu « Déplacer vers le dossier » : liste des dossiers en arbre
  function enhanceFolderSubmenu(menu) {
    if (findLabel(menu, /^(archiver|archive|renommer|rename)$/i)) return;
    const byName = new Map(currentGroups.map((g) => [g.name, g]));
    const groupItems = [];
    for (const el of menu.querySelectorAll('[role^="menuitem"]')) {
      const text = labelNode(el);
      const g = text && byName.get(cleanText(text.nodeValue));
      if (g) groupItems.push({ el, g });
    }
    if (!groupItems.length) return;
    const tree = treeOrder(groupItems.map((i) => i.g));
    if (!tree.some((t) => t.depth > 0)) return;
    const parent = groupItems[0].el.parentElement;
    if (groupItems.some((i) => i.el.parentElement !== parent)) return;
    if (!/flex|grid/.test(getComputedStyle(parent).display)) {
      parent.style.display = "flex";
      parent.style.flexDirection = "column";
    }
    const children = [...parent.children];
    const slots = children
      .map((c, i) => (groupItems.some((gi) => gi.el === c) ? i : -1))
      .filter((i) => i >= 0);
    const itemByKey = new Map(groupItems.map((i) => [i.g.key, i.el]));
    children.forEach((c, i) => (c.style.order = String(i)));
    tree.forEach(({ g, depth }, n) => {
      const el = itemByKey.get(g.key);
      el.style.order = String(slots[n]);
      el.dataset.cfPad ??= getComputedStyle(el).paddingInlineStart;
      el.style.paddingInlineStart = `calc(${el.dataset.cfPad} + ${depth * 16}px)`;
    });
  }

  // ---------- barre de recherche ----------

  const searchInput = h("input", {
    class: "cf-search-input",
    name: "cf-search",
    type: "text",
    placeholder: "Rechercher un dossier ou un chat…",
    spellcheck: "false",
    autocomplete: "off",
    "aria-label": "Rechercher un dossier ou un chat",
  });
  const ghostTyped = h("span", { class: "cf-ghost-typed" });
  const ghostRest = h("span", { class: "cf-ghost-rest" });
  const hintEl = h("div", { class: "cf-search-hint" });
  const statusEl = h("div", { class: "cf-search-status" });
  const search = h(
    "div",
    { id: "cf-search" },
    h(
      "div",
      { class: "cf-search-box" },
      svgIcon("cf-search-icon", SEARCH_SVG),
      h(
        "div",
        { class: "cf-search-field" },
        h(
          "div",
          { class: "cf-search-ghost", "aria-hidden": "true" },
          ghostTyped,
          ghostRest,
        ),
        searchInput,
      ),
      h(
        "button",
        {
          type: "button",
          class: "cf-search-clear",
          title: "Effacer (Échap)",
          "aria-label": "Effacer la recherche",
          onclick: () => {
            clearSearch();
            searchInput.focus();
          },
        },
        "×",
      ),
    ),
    hintEl,
    statusEl,
  );
  // Les gestionnaires de la barre latérale (glisser, focus) ne doivent pas réagir
  for (const type of ["pointerdown", "mousedown", "click"])
    search.addEventListener(type, (e) => e.stopPropagation());

  let suggestions = [];
  let selIndex = 0;
  const searchExpanded = new Set(); // sections ouvertes par la recherche, à refermer ensuite
  const itemId = (it) => (it.type === "folder" ? `f:${it.key}` : `c:${it.id}`);

  // Placée juste avant la première section (au-dessus des dossiers)
  function ensureSearch(layout) {
    const first = layout.sections[0]?.units[0];
    if (!first) return;
    const placed =
      search.parentElement === first.parentElement &&
      search.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (placed) return;
    const focused = document.activeElement === searchInput;
    const { selectionStart, selectionEnd } = searchInput;
    first.before(search);
    if (focused) {
      searchInput.focus();
      searchInput.setSelectionRange(selectionStart, selectionEnd);
    }
  }

  function collectItems(layout) {
    const items = currentGroups.map((g) => ({
      type: "folder",
      key: g.key,
      label: g.name,
      path: pathOf(g.key),
      color: colors[g.key] || NO_COLOR,
    }));
    const seen = new Set();
    for (const s of layout.sections)
      for (const c of chatsOf(s)) {
        if (seen.has(c.id) || !c.title) continue;
        seen.add(c.id);
        items.push({
          type: "chat",
          id: c.id,
          label: c.title,
          folderKey: s.group?.key || null,
          path: s.group ? pathOf(s.group.key) : "",
        });
      }
    return items;
  }

  // Début du nom, puis début d'un mot, puis n'importe où ; dossiers avant chats
  function rankItems(items, q) {
    const scored = [];
    for (const it of items) {
      const n = norm(it.label);
      const i = n.indexOf(q);
      if (i < 0) continue;
      const score = i === 0 ? 0 : /[\s\-_'’«(]/.test(n[i - 1]) ? 1 : 2;
      scored.push({ it, score });
    }
    scored.sort(
      (a, b) =>
        a.score - b.score ||
        (a.it.type === b.it.type ? 0 : a.it.type === "folder" ? -1 : 1) ||
        a.it.label.length - b.it.label.length,
    );
    return scored.slice(0, 20).map((s) => s.it);
  }

  function addRanges(root, q, ranges) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      if (n.parentElement.closest('[data-cds="Icon"], .cf-group-icon'))
        continue;
      const { out, map } = normalizedWithMap(n.nodeValue);
      for (let i = out.indexOf(q); i >= 0; i = out.indexOf(q, i + q.length)) {
        const range = new Range();
        range.setStart(n, map[i]);
        range.setEnd(n, map[i + q.length]);
        ranges.push(range);
      }
    }
  }

  function clearSearchMarks() {
    for (const el of document.querySelectorAll("[data-cf-search-hidden]"))
      el.removeAttribute("data-cf-search-hidden");
    globalThis.CSS?.highlights?.delete("cf-search");
  }

  function applySearch(layout) {
    clearSearchMarks();
    const q = norm(searchInput.value.trim());
    search.classList.toggle("cf-has-query", !!q);
    if (!q) {
      suggestions = [];
      renderSuggestion();
      statusEl.replaceChildren();
      return;
    }

    // Ouvre les dossiers repliés pour chercher aussi dans leurs chats
    for (const s of layout.sections) {
      const key = sectionKey(s);
      if (isCollapsed(s) && !searchExpanded.has(key)) {
        searchExpanded.add(key);
        toggleOf(s)?.click();
      }
    }

    const sectionByKey = new Map(
      layout.sections.filter((s) => s.group).map((s) => [s.group.key, s]),
    );
    const visible = new Set();
    const ranges = [];
    const foundChats = new Set();
    let foundFolders = 0;
    for (const s of layout.sections) {
      const folderMatch = !!s.group && norm(s.group.name).includes(q);
      if (folderMatch) {
        foundFolders++;
        addRanges(s.group.label.parentElement, q, ranges);
      }
      let shown = 0;
      for (const c of chatsOf(s)) {
        const hit = norm(c.title).includes(q);
        if (hit) {
          foundChats.add(c.id);
          addRanges(c.link, q, ranges);
        }
        if (hit || folderMatch) shown++;
        else c.row.setAttribute("data-cf-search-hidden", "");
      }
      if (folderMatch || shown) visible.add(s);
    }
    // Les dossiers parents d'un résultat restent affichés, pour voir le chemin
    for (const s of [...visible])
      if (s.group)
        for (const k of ancestorsOf(s.group.key)) {
          const parent = sectionByKey.get(k);
          if (parent) visible.add(parent);
        }
    for (const s of layout.sections)
      if (!visible.has(s))
        for (const u of s.units) u.setAttribute("data-cf-search-hidden", "");

    if (
      ranges.length &&
      globalThis.CSS?.highlights &&
      typeof Highlight === "function"
    )
      CSS.highlights.set("cf-search", new Highlight(...ranges));

    const previous = suggestions[selIndex];
    suggestions = rankItems(collectItems(layout), q);
    const kept = previous
      ? suggestions.findIndex((s) => itemId(s) === itemId(previous))
      : -1;
    selIndex = kept >= 0 ? kept : 0;
    renderSuggestion();

    const total = foundFolders + foundChats.size;
    if (total)
      statusEl.replaceChildren(`${total} résultat${total > 1 ? "s" : ""}`);
    else
      statusEl.replaceChildren(
        "Aucun résultat dans les chats chargés. ",
        h("button", {
          type: "button",
          class: "cf-search-link",
          text: "Ouvrir la recherche de Claude",
          onclick: () => {
            clearSearch();
            const chats = document.querySelector('aside a[href="/recents"]');
            if (chats) chats.click();
            else location.assign("/recents");
          },
        }),
      );
  }

  function renderSuggestion() {
    const it = suggestions[selIndex];
    const value = searchInput.value;
    ghostTyped.textContent = value;
    ghostRest.textContent = "";
    if (!it) {
      hintEl.replaceChildren();
      return;
    }
    // Suite grisée dans le champ quand la suggestion commence par le texte tapé
    const { out, map } = normalizedWithMap(it.label);
    const typed = norm(value);
    const caretAtEnd = searchInput.selectionStart === value.length;
    if (
      typed &&
      out.startsWith(typed) &&
      typed.length < out.length &&
      caretAtEnd
    )
      ghostRest.textContent = it.label.slice(map[typed.length]);

    const where =
      it.type === "folder"
        ? it.path
        : it.path
          ? `${it.label} — ${it.path}`
          : it.label;
    hintEl.replaceChildren(
      it.type === "folder"
        ? folderIcon("cf-hint-icon", it.color)
        : svgIcon("cf-hint-icon", CHAT_SVG),
      h("span", { class: "cf-hint-label", text: where }),
      suggestions.length > 1 &&
        h("span", {
          class: "cf-hint-count",
          text: `${selIndex + 1}/${suggestions.length}`,
        }),
      h("kbd", { text: "Tab+A" }),
      h("kbd", { text: "Entrée" }),
    );
  }

  function runSearch() {
    lastLayout = computeLayout();
    if (lastLayout) applySearch(lastLayout);
  }

  function acceptSuggestion() {
    const it = suggestions[selIndex];
    if (!it) return;
    searchInput.value = it.label;
    searchInput.setSelectionRange(it.label.length, it.label.length);
    runSearch();
  }

  function clearSearch({ keepOpen = new Set() } = {}) {
    searchInput.value = "";
    suggestions = [];
    selIndex = 0;
    clearSearchMarks();
    search.classList.remove("cf-has-query");
    renderSuggestion();
    statusEl.replaceChildren();
    // Referme ce que la recherche avait ouvert
    const layout = computeLayout();
    if (layout)
      for (const s of layout.sections) {
        const key = sectionKey(s);
        if (searchExpanded.has(key) && !keepOpen.has(key) && !isCollapsed(s))
          toggleOf(s)?.click();
      }
    searchExpanded.clear();
  }

  // Entrée : un chat s'ouvre ; un dossier est affiché et ouvert, sans ouvrir de chat
  function goTo(it) {
    const folderKey = it.type === "folder" ? it.key : it.folderKey;
    const keepOpen = new Set(
      folderKey ? [folderKey, ...ancestorsOf(folderKey)] : [],
    );
    clearSearch({ keepOpen });
    searchInput.blur();
    if (it.type === "chat") {
      const link = [...document.querySelectorAll(CHAT_LINK)].find(
        (a) => chatIdFrom(a.getAttribute("href")) === it.id,
      );
      if (link) link.click();
      else location.assign(`/chat/${it.id}`);
      return;
    }
    revealFolder(it.key);
  }

  function revealFolder(key, tries = 0) {
    currentGroups = findGroups();
    const layout = computeLayout();
    const section = layout?.sections.find((s) => s.group?.key === key);
    if (!section) {
      if (tries < 10) setTimeout(() => revealFolder(key, tries + 1), 100);
      return;
    }
    for (const k of [...ancestorsOf(key).reverse(), key]) {
      const s = layout.sections.find((x) => x.group?.key === k);
      if (s && isCollapsed(s)) toggleOf(s)?.click();
    }
    const header = section.units[0];
    header.scrollIntoView({ block: "nearest", behavior: "smooth" });
    header.removeAttribute("data-cf-flash");
    void header.offsetWidth; // relance l'animation
    header.setAttribute("data-cf-flash", "");
    setTimeout(() => header.removeAttribute("data-cf-flash"), 1600);
  }

  // Tab seul garde son rôle (navigation) : son effet est retardé jusqu'au relâchement.
  // Tab maintenu + A (la lettre tapée, pour fonctionner aussi en AZERTY) complète.
  let tabChord = null; // { shift, used }

  function focusNeighbour(from, backwards) {
    const focusable = [
      ...document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]',
      ),
    ].filter(
      (el) =>
        el.tabIndex >= 0 &&
        el.getClientRects().length &&
        !el.closest('[inert], [aria-hidden="true"]'),
    );
    const i = focusable.indexOf(from);
    const next =
      focusable[
        (i + (backwards ? -1 : 1) + focusable.length) % focusable.length
      ];
    next?.focus();
  }

  // Écoute au niveau de la fenêtre : Claude ne doit pas recevoir ces touches (raccourcis globaux)
  addEventListener(
    "keydown",
    (e) => {
      if (e.target !== searchInput) return;
      e.stopPropagation();
      if (e.key === "Tab") {
        e.preventDefault();
        if (!e.repeat && !tabChord)
          tabChord = { shift: e.shiftKey, used: false };
        return;
      }
      if (tabChord && e.key.toLowerCase() === "a") {
        e.preventDefault();
        tabChord.used = true;
        acceptSuggestion();
        return;
      }
      if (
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        suggestions.length
      ) {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        selIndex = (selIndex + step + suggestions.length) % suggestions.length;
        renderSuggestion();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const it = suggestions[selIndex];
        if (it) goTo(it);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (searchInput.value) clearSearch();
        else searchInput.blur();
      }
    },
    true,
  );
  addEventListener(
    "keyup",
    (e) => {
      if (e.target !== searchInput) return;
      e.stopPropagation();
      if (e.key !== "Tab" || !tabChord) return;
      const { shift, used } = tabChord;
      tabChord = null;
      if (!used) focusNeighbour(searchInput, shift);
    },
    true,
  );
  addEventListener(
    "keypress",
    (e) => {
      if (e.target === searchInput) e.stopPropagation();
    },
    true,
  );
  searchInput.addEventListener("blur", () => (tabChord = null));
  searchInput.addEventListener("input", () => {
    selIndex = 0;
    runSearch();
  });
  // Déplacer le curseur change l'affichage de la suite grisée
  searchInput.addEventListener("keyup", renderSuggestion);
  searchInput.addEventListener("click", renderSuggestion);

  // ---------- sélecteurs de couleur et de dossier parent ----------

  function colorField(initial, onChange = null) {
    let color = normalizeHex(initial) || DEFAULT_COLOR;
    const preview = folderIcon("cf-preview", color);
    const hex = h("input", {
      class: "cf-hex",
      name: "cf-color-hex",
      type: "text",
      maxlength: "7",
      spellcheck: "false",
      "aria-label": "Code couleur",
    });
    const picker = h("input", {
      class: "cf-picker",
      name: "cf-color-picker",
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

  // Liste des dossiers possibles comme parent (sans le dossier lui-même ni ses sous-dossiers)
  const parentChoices = (excludeKey) =>
    treeOrder(currentGroups).filter(
      ({ g }) => !excludeKey || !isInside(g.key, excludeKey),
    );

  function parentField(excludeKey, initial) {
    const select = h(
      "select",
      {
        class: "cf-parent-select",
        name: "cf-parent",
        "aria-label": "Dossier parent",
      },
      h("option", { value: "", text: "Aucun (à la racine)" }),
      parentChoices(excludeKey).map(({ g, depth }) =>
        h("option", { value: g.key, text: `${"   ".repeat(depth)}${g.name}` }),
      ),
    );
    select.value = initial || "";
    select.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== "Escape") e.stopPropagation();
    });
    const field = h(
      "label",
      { class: "cf-parent-field" },
      h("span", { text: "Dans le dossier" }),
      select,
    );
    return { field, get: () => select.value || null };
  }

  function overlay(...content) {
    dialogEl?.remove();
    dialogEl = h(
      "div",
      {
        class: `cf-overlay ${themeClass()}`,
        onmousedown: (e) => e.target === dialogEl && closeDialog(),
      },
      ...content,
    );
    document.body.append(dialogEl);
    return dialogEl;
  }
  function closeDialog() {
    dialogEl?.remove();
    dialogEl = null;
  }

  function colorDialog(key, name) {
    const { field, get } = colorField(colors[key] || DEFAULT_COLOR);
    overlay(
      h(
        "form",
        {
          class: "cf-dialog cf-dialog-small",
          onsubmit: (e) => {
            e.preventDefault();
            setColor(key, get());
            closeDialog();
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
            onclick: closeDialog,
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
    dialogEl.querySelector(".cf-primary").focus();
  }

  function parentDialog(key, name) {
    const current = parents[key] || null;
    const choose = (parent) => {
      if (setParent(key, parent)) closeDialog();
    };
    const option = (label, value, depth, color) =>
      h(
        "button",
        {
          type: "button",
          class: "cf-option" + (value === current ? " cf-selected" : ""),
          style: `padding-left:${10 + depth * 16}px`,
          onclick: () => choose(value),
        },
        color && folderIcon("cf-option-icon", color),
        h("span", { class: "cf-option-label", text: label }),
      );
    overlay(
      h(
        "div",
        { class: "cf-dialog cf-dialog-small" },
        h("div", {
          class: "cf-dialog-title",
          text: `Placer « ${name} » dans…`,
        }),
        h(
          "div",
          { class: "cf-options" },
          option("Aucun (à la racine)", null, 0, null),
          parentChoices(key).map(({ g, depth }) =>
            option(g.name, g.key, depth, colors[g.key] || NO_COLOR),
          ),
        ),
        h(
          "div",
          { class: "cf-actions" },
          h("button", {
            type: "button",
            class: "cf-btn",
            onclick: closeDialog,
            text: "Annuler",
          }),
        ),
      ),
    );
  }

  // ---------- menu ⋯ d'un dossier : couleur et dossier parent ----------

  const POPUP_SEL = '[role="menu"], [role="dialog"], [role="alertdialog"]';
  let menuGroup = null; // dossier dont le menu vient d'être ouvert
  let hoveredGroup = null;

  function groupAt(target) {
    if (target.closest('[data-row-key^="chat:"], a[href*="/chat/"]'))
      return null;
    const direct = currentGroups.find((g) => g.row.contains(target));
    if (direct) return direct;
    // Bouton ⋯ à côté du titre : il est dans le même bloc que l'en-tête du dossier
    const section = lastLayout?.sections.find(
      (s) => s.group && s.units[0].contains(target),
    );
    return section?.group || null;
  }

  addEventListener(
    "pointerover",
    (e) => {
      if (!(e.target instanceof Element) || !e.target.closest("aside")) return;
      // On garde le dernier dossier survolé tant qu'on ne passe pas sur un chat
      const group = groupAt(e.target);
      if (
        group ||
        e.target.closest('[data-row-key^="chat:"], a[href*="/chat/"]')
      )
        hoveredGroup = group;
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

  // Copie d'une entrée existante pour reprendre exactement le style de Claude
  function cloneMenuItem(template, label, color, onActivate) {
    const item = template.cloneNode(true);
    for (const el of [item, ...item.querySelectorAll("*")])
      for (const attr of [...el.attributes])
        if (
          /^(id|data-testid|data-highlighted|data-state|aria-(?!hidden))/.test(
            attr.name,
          )
        )
          el.removeAttribute(attr.name);
    item.classList.add("cf-native-item");
    item.classList.remove("text-danger"); // copie de « Supprimer »
    item.tabIndex = -1;
    item
      .querySelectorAll("kbd, [data-cds='Shortcut'], [data-cds-mirror]")
      .forEach((k) => k.remove());
    const glyph = item.querySelector('[data-cds="Icon"]');
    if (glyph) glyph.replaceChildren(folderIcon("cf-menu-icon", color));
    const text = labelNode(item);
    if (text) text.nodeValue = label;

    item.addEventListener("pointerenter", () => {
      const menu = item.closest('[role="menu"]');
      for (const i of menu?.querySelectorAll("[data-highlighted]") || [])
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
      setTimeout(onActivate, 60);
    };
    item.addEventListener("click", activate);
    item.addEventListener("pointerup", (e) => e.button === 0 && activate(e));
    return item;
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
    const template = rename || remove;
    const colorItem = cloneMenuItem(
      template,
      "Couleur du dossier…",
      colors[group.key] || NO_COLOR,
      () => colorDialog(group.key, group.name),
    );
    const parentKey = parents[group.key];
    const parentItem = cloneMenuItem(
      template,
      "Placer dans le dossier…",
      (parentKey && colors[parentKey]) || NO_COLOR,
      () => parentDialog(group.key, group.name),
    );
    if (rename) rename.after(colorItem, parentItem);
    else remove.before(colorItem, parentItem);
    log("entrées « Couleur » et « Placer dans » ajoutées");
  }

  // ---------- fenêtres de création / renommage d'un dossier ----------

  const dialogStates = new WeakMap(); // fenêtre de Claude → { input, get, getParent, renameOf }

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
    const { field: parentEl, get: getParent } = parentField(
      renameOf?.key,
      renameOf ? parents[renameOf.key] : null,
    );
    field.classList.add("cf-in-claude");
    parentEl.classList.add("cf-in-claude");
    let block = input;
    while (
      block.parentElement &&
      block.parentElement !== popup &&
      block.parentElement.children.length === 1
    )
      block = block.parentElement;
    block.after(field, parentEl);
    dialogStates.set(popup, { input, get, getParent, renameOf });
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
    const parent = state.getParent();
    if (state.renameOf) {
      const oldKey = state.renameOf.key;
      const newKey = oldKey.startsWith("name:") ? `name:${name}` : oldKey;
      renameKey(oldKey, newKey);
      setColor(newKey, color);
      setParent(newKey, parent);
    } else pendingCreation = { name, color, parent, at: Date.now() };
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
      el.id === "cf-search" ||
      el.tagName.toLowerCase() === "svg"
    )
      return lines;
    for (const c of el.children) skeleton(c, depth + 1, lines);
    return lines;
  }

  // Ce qui décide si l'ordre CSS des sous-dossiers peut fonctionner
  function layoutDetails({ list, sections }) {
    const describe = (el) => {
      const cs = getComputedStyle(el);
      return `<${el.tagName.toLowerCase()} class="${String(el.className).split(/\s+/).slice(0, 3).join(" ")}"> display=${cs.display} position=${cs.position}`;
    };
    return [
      `Liste : ${describe(list)}`,
      ...sections.map((s) => {
        const u = s.units[0];
        const kind = s.group
          ? `dossier parent=${parents[s.group.key] ? "oui" : "non"} profondeur=${u.dataset.cfDepth ?? "-"}`
          : `« ${s.label} »`;
        return `  ${kind} unités=${s.units.length} unité=${describe(u)} conteneur=${describe(u.parentElement)} order=${u.style.order || "-"} marge=${u.style.marginInlineStart || "-"}`;
      }),
    ];
  }

  // Style affiché du titre d'un dossier comparé à celui d'un chat
  function titleDetails() {
    const g = currentGroups[0];
    const link = document.querySelector(`aside ${CHAT_LINK}`);
    if (!g || !link) return [];
    const describe = (el) => {
      const cs = getComputedStyle(el);
      return `<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 80)}"> taille=${cs.fontSize} graisse=${cs.fontWeight} couleur=${cs.color}`;
    };
    return [
      `Titre de dossier : ${describe(g.label.parentElement)} style=${g.label.parentElement.getAttribute("style") || "-"}`,
      `Titre de chat : ${describe(link)}`,
    ];
  }

  function diagnosticText() {
    const aside = document.querySelector("aside");
    const layout = computeLayout();
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
          `  ${g.row.tagName.toLowerCase()} clé=${g.key.split(":")[0]} nom=${g.name.length} car. couleur=${colors[g.key] || "aucune"} parent=${parents[g.key] ? "oui" : "non"}`,
      ),
      `Couleurs enregistrées : ${Object.keys(colors).length}, sous-dossiers : ${Object.keys(parents).length}`,
      `Liste des sections : ${layout ? `<${layout.list.tagName.toLowerCase()}> ${layout.sections.length} sections, ${layout.preamble.length} éléments avant` : "introuvable"}`,
      ...(layout?.sections.map(
        (s) =>
          `  ${s.group ? "dossier" : `« ${s.label} »`} unités=${s.units.length} chats=${chatsOf(s).length} replié=${isCollapsed(s)}`,
      ) || []),
      `Recherche affichée : ${search.isConnected}`,
      ...(layout ? layoutDetails(layout) : []),
      ...titleDetails(),
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
    const text = h("textarea", {
      class: "cf-input cf-diag",
      name: "cf-diagnostic",
      readonly: true,
      spellcheck: "false",
    });
    text.value = diagnosticText();
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
    overlay(
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
            onclick: closeDialog,
            text: "Fermer",
          }),
          copy,
        ),
      ),
    );
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && dialogEl) closeDialog();
    },
    true,
  );

  // Ouvert depuis le bouton de l'extension dans la barre du navigateur
  ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "cf-diagnostic-text")
      sendResponse({
        text: step("diagnosticText", diagnosticText) || debugLog.join("\n"),
      });
    else if (message?.type === "cf-diagnostic") {
      openDiagnostic();
      sendResponse({ ok: true });
    }
  });

  // ---------- démarrage ----------

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(refresh);
  }

  // Chaque étape est isolée : une erreur est notée dans le journal sans bloquer les suivantes
  const loggedErrors = new Set();
  function step(name, fn) {
    try {
      return fn();
    } catch (err) {
      const line = `erreur dans ${name} : ${err.message} @ ${(err.stack || "").split("\n")[1]?.trim()}`;
      if (!loggedErrors.has(line)) {
        loggedErrors.add(line);
        log(line);
      }
    }
  }

  function refresh() {
    scheduled = false;
    currentGroups = step("findGroups", findGroups) || [];
    step("migrateNameKeys", () => migrateNameKeys(currentGroups));
    const titleStyle = step("chatTextStyle", chatTextStyle);
    for (const g of currentGroups) {
      step("applyPendingCreation", () => applyPendingCreation(g));
      step("ensureIcon", () => ensureIcon(g));
      step("matchTitleStyle", () => matchTitleStyle(g, titleStyle));
    }
    lastLayout = step("computeLayout", computeLayout) || null;
    if (lastLayout) {
      step("ensureSearch", () => ensureSearch(lastLayout));
      step("applyNesting", () => applyNesting(lastLayout));
      if (searchInput.value.trim())
        step("applySearch", () => applySearch(lastLayout));
    }
    for (const popup of document.querySelectorAll(POPUP_SEL)) {
      if (popup.closest(".cf-overlay")) continue;
      if (popup.matches('[role="menu"]')) {
        step("enhanceGroupMenu", () => enhanceGroupMenu(popup));
        step("enhanceFolderSubmenu", () => enhanceFolderSubmenu(popup));
      }
      step("enhanceFolderDialog", () => enhanceFolderDialog(popup));
    }
  }

  // Seuls la barre latérale et les menus / fenêtres comptent (pas une réponse en cours d'écriture)
  function isRelevant(mutations) {
    return mutations.some((m) => {
      const el =
        m.target.nodeType === Node.ELEMENT_NODE
          ? m.target
          : m.target.parentElement;
      if (!el || el.closest("#cf-search")) return false;
      return (
        el === document.body ||
        el.parentElement === document.body ||
        !!el.closest(`aside, ${POPUP_SEL}`)
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
      else if (m.type === "attributes") {
        if (RENAME_ATTRS.includes(m.attributeName)) renameAttrs(m.target);
      } else
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
    // aria-expanded : Claude replie un dossier en changeant seulement cet attribut,
    // ses sous-dossiers doivent alors être masqués
    attributeFilter: [...RENAME_ATTRS, "aria-expanded"],
  });
  schedule();
  log("démarrage, remplacements initiaux :", renameCount);
})();
