# QA & Bug Checklist — magnotes-frontend

Last updated: 2026-07-22.

Checklists à valider avant chaque push notable. Couvrent la **logique métier**
(tests automatisés + comportement attendu) et **l'interface** (validation manuelle
dans le navigateur).

---

## 1. Commandes de vérification (à lancer systématiquement)

```bash
npm run typecheck    # tsc --noEmit — obligatoire, vite build ne type-check PAS
npm run lint         # ESLint zero warnings
npm test             # 199+ tests Jest (logique, hooks et composants UI)
npm run build        # vérifier que le build passe sans erreur
```

---

## 2. Logique métier — couverture automatisée

Ces modules sont couverts par Jest. En cas de modification, relancer `npm test`.

| Module                                 | Tests                         | Ce qui est vérifié                                                |
| -------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `hooks/dropIntent.ts`                  | `dropIntent.test.ts`          | Décision stack / dock / free selon la position du drop            |
| `hooks/viewportMath.ts`                | `viewportMath.test.ts`        | Transforms écran ↔ board, zoom centré curseur, framing            |
| `hooks/viewportCulling.ts`             | `viewportCulling.test.ts`     | AABB visible + culling des cartes hors-écran                      |
| `hooks/viewportStorage.ts`             | `viewportStorage.test.ts`     | Persistance viewport par board (localStorage)                     |
| `hooks/stackOrdering.ts`               | `stackOrdering.test.ts`       | Renumérotation contiguë de `stackOrder`                           |
| `hooks/historyCommands.ts`             | `historyCommands.test.ts`     | Commandes reversibles (move, dock, delete…)                       |
| `hooks/useAutosave.ts`                 | `useAutosave.test.ts`         | Fusion du debounce, isolation par carte, flush navigation/unmount |
| `hooks/useConnections.ts`              | `useConnections.test.ts`      | Rollback renommage et suppression de liens                        |
| `hooks/useStacks.ts`                   | `useStacks.test.ts`           | Rollback repli et suppression de piles                            |
| `hooks/usePostIts.ts`                  | `usePostIts.rollback.test.ts` | Rollback déplacement inter-tableaux et suppression                |
| `hooks/useHistory.ts`                  | `useHistory.test.ts`          | Transactions, compensation, concurrence et changement de tableau  |
| `hooks/useNotifications.ts`            | `useNotifications.test.ts`    | Déduplication, expiration et fermeture manuelle                   |
| `components/ui/NotificationCenter.tsx` | `NotificationCenter.test.tsx` | Hors ligne, alertes accessibles et fermeture                      |
| `utils/mentions.ts`                    | `mentions.test.ts`            | Parsing `[[mention]]`, résolution insensible casse, backlinks     |
| `utils/mentionGraph.ts`                | (via mentions.test)           | Index de rétroliens par carte                                     |
| `utils/connectionGeometry.ts`          | `connectionGeometry.test.ts`  | Géométrie SVG des flèches                                         |
| `utils/boardMarkdown.ts`               | `boardMarkdown.test.ts`       | Sérialisation board → Markdown                                    |
| `utils/markdownImport.ts`              | `markdownImport.test.ts`      | Import Markdown → cartes                                          |
| `utils/trelloImport.ts`                | `trelloImport.test.ts`        | Import JSON Trello → cartes                                       |
| `utils/markdownRender.tsx`             | `markdownRender.test.tsx`     | Rendu Markdown sans dépendance, XSS-safe                          |
| `utils/commandSearch.ts`               | `commandSearch.test.ts`       | Matcher flou accent-insensible pour la palette                    |
| `utils/boardTemplate.ts`               | `boardTemplate.test.ts`       | Génération déterministe des cartes de template                    |
| `utils/checklist.ts`                   | `checklist.test.ts`           | Parse / toggle / sérialise les checklists                         |
| `utils/cardMeta.ts`                    | `cardMeta.test.ts`            | Regroupement statut/date pour Kanban/Agenda                       |
| `utils/timeline.ts`                    | `timeline.test.ts`            | Regroupement Timeline (En retard, par date, Sans échéance)        |
| `services/demoBoard.ts`                | `demoBoard.test.ts`           | Store localStorage : CRUD cartes/piles/onglets, cascades          |
| `services/demoImport.ts`               | `demoImport.test.ts`          | Réimport sandbox → compte réel (remap ids)                        |
| `services/demoMode.ts`                 | `demoMode.test.ts`            | Détection mode démo, état URL                                     |
| `i18n/i18n.ts`                         | `i18n.test.ts`                | Parité FR/EN, fallbacks, détection langue                         |

---

## 3. Fonctionnalités à valider manuellement (navigateur)

### 3.1 Authentification

- [ ] Inscription → email de vérification reçu (prod) ou code loggé (dev)
- [ ] Vérification du code → session active
- [ ] Connexion avec mauvais mot de passe → message d'erreur
- [ ] Déconnexion → redirection login
- [ ] Mot de passe oublié → email reçu → reset → nouvelle connexion
- [ ] Session expirée → refresh token silencieux (axios interceptor) sans déconnexion visible
- [ ] Première connexion → tableau "Bienvenue" créé automatiquement

### 3.2 Canvas & cartes

- [ ] Double-clic sur le canvas → nouvelle carte à la position du curseur
- [ ] Édition inline + autosave (titre + contenu)
- [ ] Resize depuis les 4 coins
- [ ] Déplacement drag → grille de snap optionnelle
- [ ] Anneau de sélection au clic sur une carte
- [ ] Multi-sélection Shift+clic / Ctrl+clic
- [ ] Ctrl+A → sélectionner toutes les cartes visibles
- [ ] Suppr / Ctrl+D sur sélection → supprimer / dupliquer
- [ ] Échap → désélectionner
- [ ] Barre d'action flottante sur sélection (supprimer, dupliquer)
- [ ] Undo Ctrl+Z / Redo Ctrl+Shift+Z (déplacements, dock, stack, suppression)
- [ ] Déplacement d'une carte vers un autre onglet
- [ ] Revert optimiste si l'API rejette un déplacement

### 3.3 Stacks

- [ ] Drop centré → création de pile
- [ ] Drop de bord → docking
- [ ] Pile repliée : survol → aperçu grille des cartes
- [ ] Promouvoir une carte (clic dans l'aperçu) → remonte en haut, stackOrder reordonné
- [ ] Undo d'un stack / unstack
- [ ] Expand une pile → cartes libres

### 3.4 Canvas (navigation)

- [ ] Molette → zoom centré curseur
- [ ] Drag canvas vide → pan
- [ ] Minimap visible + localisateur viewport
- [ ] Viewport restauré à l'ouverture du tableau (localStorage)
- [ ] Auto-frame du contenu au premier chargement d'un tableau peuplé
- [ ] Coordonnées négatives accessibles (canvas bidirectionnel)
- [ ] Culling : les cartes hors-écran sont retirées du DOM (vérifier avec les DevTools)

### 3.5 Vues (Kanban / Agenda / Timeline)

- [ ] Basculer entre Canvas / Kanban / Agenda / Timeline depuis la topbar
- [ ] **Kanban** : colonnes par statut (À faire / En cours / Fait), drag entre colonnes → met à jour le statut
- [ ] **Agenda** : cartes groupées par date d'échéance
- [ ] **Timeline** : lane "En retard", colonnes chronologiques, lane "Sans échéance"
- [ ] Clic sur une carte dans une vue → switch vers Canvas + frame sur la carte
- [ ] Mobile <620px : Kanban une colonne par écran avec scroll-snap

### 3.6 Styles & apparence des cartes

- [ ] Couleur de fond (6 presets + picker)
- [ ] Couleur de texte
- [ ] Taille de texte + police
- [ ] Finition (flat, matte, metallic, glass, paper)
- [ ] Presets de style (Note jaune, Sombre néon, Papier)
- [ ] Popover de style : se ferme sur Échap ou clic extérieur (useDismiss)

### 3.7 Métadonnées de carte

- [ ] Statut (À faire / En cours / Fait)
- [ ] Priorité (Basse / Normale / Haute / Urgente)
- [ ] Date d'échéance (overdue en rouge)
- [ ] Tags (ajouter, supprimer, recherche par tag)
- [ ] Checklist in-card (ajouter, cocher, supprimer sous-tâches, barre de progression)
- [ ] Badge footer (statut, priorité, échéance, checklist, tags)
- [ ] Image inline : coller une URL http(s) ou drag-drop fichier png/jpg/gif/webp (~1 MB max)
- [ ] Dupliquer préserve tous les champs task

### 3.8 Modal de détail (expand)

- [ ] Bouton expand → `CardDetailModal` porté dans `document.body` (hors transform)
- [ ] Éditeur + aperçu Markdown live
- [ ] Fermeture sur Échap ou bouton × → retour inline sans perte de données

### 3.9 Markdown

- [ ] Rendu dans la vue lecture (gras, italique, code inline, liens, headings, listes)
- [ ] Clic sur la carte → bascule en édition textarea (raw)
- [ ] `[[mentions]]` restent en texte brut dans le textarea (chips affichés séparément)
- [ ] XSS : pas d'HTML arbitraire rendu

### 3.10 Mentions & connexions

- [ ] `[[Titre de carte]]` → chip cliquable si la carte existe (résolu)
- [ ] Chip muted si non résolu
- [ ] Section "Cité par" (backlinks) sur les cartes mentionnées
- [ ] Clic sur chip / backlink → frame la carte cible sur le canvas
- [ ] Bouton "connecter" sur une carte → mode lien → clic cible → flèche créée
- [ ] Sélectionner une flèche → renommer / supprimer
- [ ] Échap annule le mode lien
- [ ] Flèche trimée aux bordures des cartes (pas à leurs centres)
- [ ] Supprimer une carte → ses flèches disparaissent (cascade)
- [ ] Undo suppression carte → flèches recréées via `restoreLinks`

### 3.11 Palette de commandes (Ctrl+K)

- [ ] Ouverture / fermeture Ctrl/Cmd+K
- [ ] Navigation clavier dans la liste
- [ ] Recherche floue accent-insensible (« palette » trouve « Palëtte »)
- [ ] Quick capture : query non vide → « Créer note « … » »
- [ ] Commandes action (nouvelle carte, frame, undo/redo, thème, export)
- [ ] Commandes vue (Canvas, Kanban, Agenda, Timeline)
- [ ] Jump-to-card (cartes du board actif)
- [ ] Recherche globale (min 2 chars, debounce 220 ms) → « Autres tableaux »
- [ ] Sélectionner un résultat global → switch board + frame carte
- [ ] Insertion de template → cartes créées + frame de la zone

### 3.12 Onglets (boards)

- [ ] Créer un nouvel onglet
- [ ] Renommer via la topbar (inline, Enter/Échap)
- [ ] Renommer depuis le menu d'onglet
- [ ] Changer la couleur de l'onglet (30 couleurs)
- [ ] Emoji picker (30+ emojis) pour l'icône d'onglet
- [ ] Couleur de fond du canvas par onglet (picker, hex validé)
- [ ] Ambiances (Épuré, Frigo, Magnétique, Liège, Ardoise) — panel Apparence
- [ ] Supprimer un onglet → confirmation → données supprimées
- [ ] Déplacer un onglet (réordonner)

### 3.13 Filtres & recherche

- [ ] Recherche texte → filtre en temps réel (titre + contenu + tags)
- [ ] Filtre couleur → n'affiche que les couleurs actuellement utilisées sur le board
- [ ] Filtre actif → les vues Kanban/Agenda/Timeline respectent aussi le filtre
- [ ] Réinitialiser le filtre → toutes les cartes visibles

### 3.14 Partage

- [ ] Activer le partage via ShareDialog ou palette → `shareToken` généré
- [ ] Lien public `/app/b/<token>` → vue lecture seule (canvas scrollable)
- [ ] Vue publique : cartes, images, flèches, badges visibles
- [ ] CTA d'inscription présent sur la vue publique
- [ ] Révoquer le partage → lien public renvoie 404

### 3.15 Import / Export

- [ ] Export Markdown (menu logo ou palette) → fichier `.md` téléchargé
- [ ] Import Markdown → cartes créées correctement (titre, contenu, checklist, tags, statut)
- [ ] Import JSON Trello → colonnes → Kanban (listes → statut, cartes → cartes)
- [ ] Auto-détection du format à l'import (JSON vs Markdown)

### 3.16 Mode démo

- [ ] `/app/?demo=1` → accès sans compte
- [ ] Tableau "Bienvenue" auto-créé dans le sandbox
- [ ] Bannière pousse le board (pas de superposition sur la barre d'outils)
- [ ] Toutes les fonctionnalités canvas disponibles en mode démo
- [ ] Inscription depuis le mode démo → sandbox importé dans le compte

### 3.17 Compte (RGPD)

- [ ] Export des données (JSON téléchargé)
- [ ] Suppression de compte (confirmation mot de passe → toutes les données effacées)

### 3.18 i18n FR/EN

- [ ] Bascule FR/EN → toutes les surfaces naviguées se mettent à jour
- [ ] Anglais par défaut hors navigateur français
- [ ] Persistance du choix de langue (localStorage)
- [ ] Vue publique respecte la langue sélectionnée

### 3.19 Responsive mobile (<620px)

- [ ] Onglets de vue en icône seule (texte masqué)
- [ ] Apparence + ⌘K masqués (fonctionnels mais non affichés sur très petits écrans)
- [ ] `board-topbar-tools` scrollable horizontalement
- [ ] Kanban une colonne par écran avec scroll-snap

---

## 4. Bugs connus / dette technique

| #   | Description                                                                                                                   | Fichier(s)                                        | Priorité                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------- |
| 1   | `formatDueDate` / `cardMeta` utilisent la locale système sur le canvas (pas le contexte i18n) — Timeline/Agenda déjà corrects | `utils/cardMeta.ts`, `utils/timeline.ts`          | Faible                                 |
| 2   | Aucun test de composant/interaction (seulement modules purs)                                                                  | —                                                 | Faible                                 |
| 3   | Aucun test E2E Playwright                                                                                                     | —                                                 | Moyen (avant collaboration temps réel) |
| 4   | Undo/redo limité : `create` et `move-to-tab` sont des barrières d'historique                                                  | `hooks/useHistory.ts`, `hooks/historyCommands.ts` | Faible                                 |
| 5   | Images inline base64 en Mongo (~1 MB cap) — pas scalable, migration GridFS à prévoir côté serveur                             | `utils/imageFile.ts`, `services/boardApi.ts`      | Faible                                 |
| 6   | Pas de PWA (manifest, service worker, offline)                                                                                | —                                                 | Moyen                                  |
| 7   | Pas de tactile mobile fiable (pinch-zoom, drag tactile)                                                                       | `hooks/useBoardViewport.ts`                       | Moyen                                  |

---

## 5. Prochaines priorités (Horizon 1 → 2)

Ordre recommandé :

1. **Analytics** (Umami/Plausible self-hosted) — pilotage à l'aveugle sans ça
2. **QA navigateur** complète (cette liste) — avant tout lancement public
3. **Mobile tactile + PWA** — pinch-zoom, drag tactile, manifest
4. **Tests composants** (Testing Library) sur les parcours clés : création carte, palette, partage
5. **Tests E2E** (Playwright) : signup, drag, palette, share — obligatoire avant collaboration
6. **Notifications échéances** — digest email journalier/hebdo (besoin d'un scheduler côté API)
7. **Import Notion** (après Markdown + Trello)
8. **Galerie templates** — pages publiques SEO
9. **Collaboration Track C phase 2** — invitations + présence temps réel (WebSocket)
