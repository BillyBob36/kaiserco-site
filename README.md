# KAISER CO — Site vitrine

Page unique avec avatar 3D parlant, FAQ chatbot **sans aucune API au runtime**.
Tout le pipeline TTS + lipsync est pré-calculé une fois en local, puis le site final ne sert que des fichiers statiques.

## Pré-requis

- **Node.js 18+** (pour les scripts de build et le serveur statique)
- **Navigateur Chrome/Edge récent** pour exécuter `build-visemes.html`
- Une **resource Azure OpenAI** avec un déploiement TTS (`gpt-4o-mini-tts` recommandé)

## Structure

```
SIte KaiserCo/
├── .env                      # Clé Azure (NE PAS committer)
├── .env.example              # Modèle
├── data/
│   └── faq.json              # Liste des questions/réponses → édite-moi
├── public/                   # ← le site statique à déployer
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   ├── lib/
│   │   ├── avatar-player.js  # Module avatar 3D (transparent, lipsync pré-calculé)
│   │   ├── viseme-config.js
│   │   ├── tuning-config.js
│   │   └── wawa-lipsync.es.js (utilisé seulement par build-visemes)
│   └── assets/
│       ├── avatar/men/       # GLTF + textures de l'avatar
│       ├── img/              # Images des services (déjà générées)
│       └── voices/           # ← MP3 + visemes.json (à générer en build)
└── scripts/
    ├── build-voices.js       # Génère les MP3 via Azure TTS
    ├── build-visemes.html    # Pré-calcule les timelines de visemes
    └── server.js             # Serveur statique de dev (port 8080)
```

## Build — flux complet

### 1. Configurer la clé Azure

Le fichier `.env` est déjà rempli. Vérifie qu'il contient :

```
AZURE_OPENAI_ENDPOINT=https://johann-api-resource.cognitiveservices.azure.com
AZURE_OPENAI_KEY=...
AZURE_OPENAI_TTS_MODEL=gpt-4o-mini-tts
AZURE_OPENAI_TTS_VOICE=ash
AZURE_OPENAI_TTS_API_VERSION=2025-03-01-preview
```

> Si le déploiement TTS sur Azure n'a pas le nom `gpt-4o-mini-tts`, mets-le ici.

### 2. (Optionnel) Éditer la FAQ

`data/faq.json` contient 12 entrées. Modifie les textes, ajoute/retire des questions. **L'`id` doit rester en snake_case** (ex: `q05_truc`) — il sert de nom de fichier pour les MP3 et de clé dans le JSON.

### 3. Générer les MP3

```bash
node scripts/build-voices.js
```

Output : `public/assets/voices/q01_qui.mp3`, `q02_dev.mp3`, etc.
Le script est **idempotent** : il skippe les MP3 déjà existants. Force le re-build avec `--force`.
Pour ne traiter qu'un sous-ensemble : `node scripts/build-voices.js --only=q05_conseil,q07_tarifs`.

### 4. Pré-calculer les visemes

```bash
node scripts/server.js
```

Puis ouvrir [http://localhost:8080/scripts/build-visemes.html](http://localhost:8080/scripts/build-visemes.html) dans Chrome :

1. Clique sur **▶ Lancer l'analyse**
2. La page joue chaque MP3 en muet, échantillonne les visemes via `wawa-lipsync` à 60 Hz
3. Quand c'est fini, clique sur **↓ Télécharger visemes.json**
4. Place le fichier téléchargé dans `public/assets/voices/visemes.json`

### 5. Tester le site en local

Le serveur tourne déjà : [http://localhost:8080/](http://localhost:8080/)

L'avatar doit apparaître **sur fond transparent** (la couleur de la section vient du CSS, pas du WebGL). Clique une question → l'avatar parle.

## Déploiement

Le contenu de `public/` est un site **100% statique**, déployable n'importe où.

### Vercel
```bash
npx vercel --prod public/
```

### Netlify
Drag-and-drop le dossier `public/` sur [app.netlify.com/drop](https://app.netlify.com/drop), ou :
```bash
npx netlify deploy --prod --dir=public
```

### Coolify (auto-hébergé)
Type d'app : **Static** · Build command : aucune · Publish directory : `public`

> ⚠️ Ne déploie **jamais** `.env` ni le dossier `scripts/`. Seul `public/` doit être servi.

## Personnalisation

| À changer | Fichier |
|---|---|
| Liste des questions / réponses | `data/faq.json` |
| Voix TTS | `.env` (variable `AZURE_OPENAI_TTS_VOICE`) |
| Ton / instructions de prononciation | `data/faq.json` (champ `instructions`) |
| Couleurs / typo | `public/style.css` (variables `:root`) |
| Position caméra avatar | premier `<camera>` du fichier `public/assets/avatar/men/men.gltf` |
| Tuning lipsync (lerp, blink, breathing) | `public/lib/tuning-config.js` |

## Côté Stripe

Le site répond aux exigences Stripe pour la vérification du compte :
- URL publique accessible sans mot de passe
- Nom commercial visible (KAISER CO)
- SIREN visible dans l'à-propos et le footer
- Activité décrite (services 4 cards)
- Email de contact public
