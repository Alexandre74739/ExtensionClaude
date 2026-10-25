// Chargé avant les scripts de Claude (run_at: document_start) : ces écouteurs passent donc
// avant les siens. Pendant le glisser d'un dossier, content.js peut ainsi empêcher Claude de
// démarrer son propre glisser (qui réordonne et déplace les dossiers).
// content.js renseigne cfGate.handle(event) : renvoyer true bloque l'événement pour Claude.
globalThis.cfGate = { handle: null };

for (const type of [
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "mousedown",
  "mousemove",
  "click",
  "dragstart",
])
  addEventListener(
    type,
    (e) => {
      if (globalThis.cfGate.handle?.(e)) e.stopImmediatePropagation();
    },
    true,
  );
