const ext = globalThis.browser ?? globalThis.chrome;
const statusEl = document.getElementById("status");
const output = document.getElementById("output");

async function activeTabId() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}

// Copie directement le diagnostic de l'onglet claude.ai ouvert
document.getElementById("copy").addEventListener("click", async () => {
  let text;
  try {
    ({ text } = await ext.tabs.sendMessage(await activeTabId(), {
      type: "cf-diagnostic-text",
    }));
  } catch {
    statusEl.textContent =
      "Ouvre un onglet claude.ai (rechargé après l'installation), puis réessaie.";
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    statusEl.textContent = "Diagnostic copié : colle-le dans la conversation.";
  } catch {
    // Presse-papiers refusé : le texte est affiché pour une copie manuelle
    output.hidden = false;
    output.value = text;
    output.select();
    statusEl.textContent =
      "Copie automatique impossible : copie le texte ci-dessous (Ctrl+C).";
  }
});

document.getElementById("open").addEventListener("click", async () => {
  try {
    await ext.tabs.sendMessage(await activeTabId(), { type: "cf-diagnostic" });
    window.close();
  } catch {
    statusEl.textContent =
      "Ouvre un onglet claude.ai (rechargé après l'installation), puis réessaie.";
  }
});
