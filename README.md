# Claude Folders

Extension de navigateur pour [claude.ai](https://claude.ai) qui affiche les **groupes** de Claude comme des **dossiers**.

- « Groupe » devient « Dossier » partout dans l'interface : barre latérale, menus, fenêtres (« Déplacer vers le dossier », « Sans dossier », « Nouveau dossier »…)
- Icône de dossier en couleur devant chaque dossier : clic sur l'icône, ou **⋯ du dossier → Couleur du dossier…**
- Choix de la couleur (palette ou code `#hex`) directement dans la fenêtre de création et de renommage d'un dossier
- Le contenu des conversations n'est jamais modifié, ni les titres de chats
- Les dossiers restent des groupes Claude : ils sont enregistrés dans ton compte Claude et visibles partout (mobile, autres navigateurs). Les **couleurs** sont enregistrées par l'extension et synchronisées via le compte du navigateur : elles n'apparaissent qu'avec l'extension.

À venir : sous-dossiers.

Compatible Chrome, Edge, Brave et Firefox (121+). Manifest V3, aucune dépendance, pas d'étape de build.

## Installation

### Chrome / Edge / Brave

1. Ouvrir `chrome://extensions` (ou `edge://extensions`)
2. Activer le **Mode développeur**
3. **Charger l'extension non empaquetée** → choisir ce dossier

### Firefox

- **Pour tester** : `about:debugging#/runtime/this-firefox` → **Charger un module complémentaire temporaire** → choisir `manifest.json`. Le module disparaît au redémarrage de Firefox.
- **Pour une installation permanente** : Firefox n'accepte que les extensions signées. Zipper le contenu du dossier, l'envoyer sur [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) en choisissant **« Sur votre propre site »** (non listée, signature automatique), puis installer le `.xpi` signé.
- Si rien ne change sur claude.ai : `about:addons` → Claude Folders → **Permissions** → autoriser `claude.ai`.

## Diagnostic

Si l'affichage ne correspond pas à l'interface actuelle de Claude : bouton de l'extension dans la barre du navigateur → **Ouvrir le diagnostic** → **Copier**. Le texte décrit la structure de la barre latérale et des menus, avec les titres de chats masqués.

## Limites

- L'extension modifie l'affichage de claude.ai. Si Anthropic change son interface, il faudra peut-être adapter [src/content.js](src/content.js).
- Un dossier dont tu as toi-même mis « groupe » dans le nom l'affichera « dossier ».

## Structure

```
manifest.json      déclaration de l'extension (Chrome + Firefox)
popup.html/.js     fenêtre du bouton de l'extension (diagnostic)
src/content.js     renommage injecté dans claude.ai + diagnostic
src/content.css    styles de la fenêtre de diagnostic
```
