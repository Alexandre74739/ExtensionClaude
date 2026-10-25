# Claude Folders

Extension de navigateur pour [claude.ai](https://claude.ai) qui affiche les **groupes** de Claude comme des **dossiers**.

- « Groupe » devient « Dossier » partout dans l'interface : barre latérale, menus, fenêtres (« Déplacer vers le dossier », « Sans dossier », « Nouveau dossier »…)
- Icône de dossier en couleur devant chaque dossier : clic sur l'icône, ou **⋯ du dossier → Couleur du dossier…**
- Choix de la couleur (palette ou code `#hex`) directement dans la fenêtre de création et de renommage d'un dossier
- Le contenu des conversations n'est jamais modifié, ni les titres de chats
- Les dossiers restent des groupes Claude : ils sont enregistrés dans ton compte Claude et visibles partout (mobile, autres navigateurs). Les **couleurs** sont enregistrées par l'extension et synchronisées via le compte du navigateur : elles n'apparaissent qu'avec l'extension.

- **Sous-dossiers** : glisser l'en-tête d'un dossier sur un autre dossier (sur « Sans dossier » pour le remettre à la racine), ou ⋯ du dossier → **Placer dans le dossier…**, ou choix « Dans le dossier » à la création. Pendant ce glisser, l'extension prend la main : les dossiers ne bougent pas (le réordonnancement des dossiers par glisser de Claude est donc désactivé). Le sous-dossier s'affiche décalé sous son parent et se masque quand le parent est replié. Claude ne gère pas les sous-groupes : l'imbrication n'est visible qu'avec l'extension.
- **Recherche** au-dessus des dossiers : filtre en direct les dossiers, sous-dossiers et chats (sans tenir compte des accents ni des majuscules).

| Touche | Effet |
| --- | --- |
| `Tab` maintenu + `A` | Complète avec la suggestion affichée en gris |
| `Tab` seul | Navigation habituelle |
| `↑` / `↓` | Suggestion précédente / suivante |
| `Entrée` | Ouvre le chat, ou affiche et ouvre le dossier (sans ouvrir de chat) |
| `Échap` | Efface la recherche |

La recherche couvre aussi les chats que la barre latérale n'a pas chargés : la liste complète est récupérée via l'API interne de claude.ai (avec ta session, à la première utilisation de la recherche, puis gardée 5 minutes) et les résultats apparaissent dans « Chats plus anciens ». Cette API n'est pas documentée : si elle échoue, la recherche reste limitée aux chats chargés.

Compatible Chrome, Edge, Brave et Firefox (140+). Manifest V3, aucune dépendance, pas d'étape de build.

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

Si l'affichage ne correspond pas à l'interface actuelle de Claude : bouton de l'extension dans la barre du navigateur → **Copier le diagnostic** (ou **Afficher le diagnostic** pour le lire avant). Le texte décrit la structure de la barre latérale et des menus, avec les titres de chats masqués.

## Limites

- L'extension modifie l'affichage de claude.ai. Si Anthropic change son interface, il faudra peut-être adapter [src/content.js](src/content.js).
- Un dossier dont tu as toi-même mis « groupe » dans le nom l'affichera « dossier ».
- Les couleurs et sous-dossiers sont liés à l'identifiant Claude de chaque dossier : ils survivent à un renommage. Un sous-dossier s'affiche après les chats de son parent (Claude place chaque dossier dans un bloc séparé).

## Structure

```
manifest.json      déclaration de l'extension (Chrome + Firefox)
popup.html/.js     fenêtre du bouton de l'extension (diagnostic)
src/gate.js        chargé avant Claude : lui cache le glisser d'un dossier (sinon il le réordonne)
src/content.js     renommage, couleurs, sous-dossiers, recherche, diagnostic
src/content.css    styles de la fenêtre de diagnostic
```
