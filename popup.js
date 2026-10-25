const ext = globalThis.browser ?? globalThis.chrome;

document.getElementById("diagnostic").addEventListener("click", async () => {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  try {
    await ext.tabs.sendMessage(tab.id, { type: "cf-diagnostic" });
    window.close();
  } catch {
    document.getElementById("status").textContent =
      "Ouvre un onglet claude.ai (rechargé après l'installation), puis réessaie.";
  }
});
