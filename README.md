# ✈ AIR RACE — course aérienne multijoueur

8 pilotes, 3 circuits (Néon City, Archipel Pacifique, Baie des Anges), 5 avions (3 à hélice, 2 à réacteurs),
bots, salons privés par code, classements, XP et peintures à débloquer, cockpit 3D cliquable,
manette / joystick, version téléphone tactile.

## Lancer en local
    node server/server.js        # Node 18+ ; aucune installation npm nécessaire
    # puis http://localhost:3000   (PORT et DATA_DIR configurables)

Le client charge Three.js (r160) depuis le CDN jsDelivr : une connexion internet est requise côté joueur.

## Commandes
Clavier : flèches/WASD (tangage, roulis), Q/E lacet, Maj/Ctrl gaz, Z/X plein gaz/ralenti, Espace boost, C vue, T stabilisation, L feux, H HUD, Échap menu.
Cockpit : glisser le manche et le levier des gaz, cliquer interrupteurs et BOOST, clic droit + glisser = regarder autour.
Manette / joystick : Réglages > Manette (détection automatique de l'axe/bouton, inversion, zone morte).
Téléphone : menu principal > « Téléphone » (manche et gaz tactiles, vues extérieures).

## Hébergement gratuit
Voir la section dans la réponse / ci-dessous : Render (web service gratuit, WebSocket OK) avec `render.yaml` fourni.
- Poussez le dossier sur GitHub, créez un « Web Service » Render pointé sur le dépôt (start : `node server/server.js`).
- Le service gratuit s'endort après ~15 min sans trafic et son disque est éphémère : classements et profils
  sont remis à zéro au redéploiement/redémarrage. Pour les conserver, utilisez un hébergeur avec disque persistant
  (VM gratuite type Oracle Cloud « Always Free », ou VPS) et pointez `DATA_DIR` dessus.
