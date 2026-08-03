# Setup Windows — onboarding pour ft_transcendence

Guide complet pour démarrer le projet **depuis zéro** sous Windows.
Compte ~1h30 d'installation au total.

> **Prérequis matériel**
> - Windows 10 (build 19041+) ou Windows 11
> - 16 Go RAM recommandé (8 Go minimum)
> - 30 Go d'espace libre sur C:
> - CPU x64 avec virtualisation activée dans le BIOS

---

## 📋 Vue d'ensemble — ce qu'on va installer

1. **WSL 2** (Linux dans Windows)
2. **Docker Desktop** (pour faire tourner les conteneurs Postgres/Redis/MinIO/backend/frontend)
3. **VS Code** + extension WSL (l'IDE qu'on utilise)
4. **Git** + **clé SSH 42** (pour cloner et push sur vogsphere)
5. **Node 24** via **nvm** (versions de Node propres)
6. **Postman** (pour tester l'API)

Tout sauf Docker Desktop et VS Code s'installe **dans WSL** (côté Linux). C'est important.

---

## Étape 1 — Activer la virtualisation (BIOS)

⚠️ Étape souvent oubliée. Sans ça, Docker/WSL ne marcheront pas.

1. Redémarre ton PC et entre dans le **BIOS** (touche au démarrage : `F2`, `Del`, `F10` selon ton constructeur)
2. Cherche une option du genre **"Intel VT-x"** / **"AMD-V"** / **"SVM Mode"** / **"Virtualization Technology"**
3. **Active-la** si elle est désactivée
4. Sauvegarde et redémarre

**Vérif après reboot** (ouvre PowerShell) :
```powershell
Get-WmiObject Win32_Processor | Select-Object VirtualizationFirmwareEnabled
```
Doit afficher `True`.

---

## Étape 2 — Installer WSL 2 + Ubuntu

Ouvre **PowerShell en administrateur** (clic droit sur l'icône PowerShell → "Exécuter en tant qu'administrateur").

```powershell
wsl --install -d Ubuntu
```

Cette commande :
- Active les features Windows nécessaires
- Installe WSL 2
- Installe Ubuntu (dernière version stable)

**Redémarre ton PC** quand demandé.

Au redémarrage, Ubuntu s'ouvre automatiquement et te demande :
- Un **username Linux** (ex: `pinto`) — pas besoin que ce soit le même qu'au Windows
- Un **password Linux** — choisis-en un, tu en auras besoin pour les `sudo`

⚠️ Quand tu tapes le password, **rien ne s'affiche** (pas même des étoiles). C'est normal sous Linux. Tape et appuie sur Entrée.

---

## Étape 3 — Mettre à jour Ubuntu

Dans le terminal Ubuntu :
```bash
sudo apt update && sudo apt upgrade -y
```

Tape ton password Linux quand demandé. Ça peut prendre 5-10 min selon ta connexion.

---

## Étape 4 — Installer Docker Desktop

Côté **Windows** cette fois (pas dans Ubuntu).

1. Télécharger : https://www.docker.com/products/docker-desktop/
2. Lancer l'installeur, **garder l'option "Use WSL 2 instead of Hyper-V" cochée**
3. Redémarrer après installation
4. Au premier lancement, Docker Desktop te demande de t'inscrire — tu peux **skip** ou créer un compte (gratuit)

### Vérifier l'intégration WSL

Dans Docker Desktop :
- **Settings** → **Resources** → **WSL Integration**
- Coche **"Enable integration with my default WSL distro"**
- Coche aussi ton distro Ubuntu dans la liste
- Apply & Restart

### Tester depuis Ubuntu

Retour dans le terminal Ubuntu :
```bash
docker --version
docker run hello-world
```

Tu dois voir un message "Hello from Docker!" → tout marche ✅

---

## Étape 5 — Installer Git + configurer SSH pour le git 42 (vogsphere)

> ⚠️ Le projet est hébergé sur le **git 42 (vogsphere)**, pas sur GitHub. C'est le dépôt officiel que 42 vérifie pour noter les contributions individuelles.

Dans le terminal Ubuntu :

```bash
sudo apt install -y git
```

### Configurer ton identité git — avec TON identité 42

⚠️ **Chaque membre commit avec sa propre identité 42** : 42 vérifie qui a contribué quoi. Mets ton login 42 et l'email rattaché à ton compte 42.

```bash
git config --global user.name "ton-login-42"
git config --global user.email "ton-email-42"
```

(Tu pourras aussi la définir par-dépôt avec `git config --local ...` une fois le projet cloné.)

### Générer une clé SSH

```bash
ssh-keygen -t ed25519 -C "ton-email-42" -f ~/.ssh/id_ed25519 -N ""
```

(Le `-N ""` met une passphrase vide pour simplifier. Tu peux en mettre une si tu veux.)

### Ajouter la clé publique à ton compte 42

Affiche ta clé publique :
```bash
cat ~/.ssh/id_ed25519.pub
```

Copie tout le contenu (commence par `ssh-ed25519 AAAA...`), puis sur l'intra 42 :
1. Va sur https://profile.intra.42.fr/ → **Settings**
2. Section **SSH keys** → ajoute ta clé publique
3. Sauvegarde

> Tu dois aussi être **inscrit comme membre du groupe de ce projet sur l'intra** pour que vogsphere t'autorise à cloner/push. Si le clone échoue en "access denied", vérifie ton inscription au projet avec l'équipe.

### Tester la connexion SSH

```bash
ssh -T git@vogsphere.42paris.fr
```

Vogsphere ne renvoie pas toujours de message de bienvenue : le vrai test, c'est que le **clone** (Étape 7) passe sans "Permission denied".

---

## Étape 6 — Installer Node 24 via nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
```

**Relance le terminal** (ferme et rouvre), puis :
```bash
nvm install 24
nvm use 24
node --version    # doit afficher v24.x
npm --version
```

---

## Étape 7 — Cloner le projet

```bash
cd ~
git clone git@vogsphere.42paris.fr:vogsphere/intra-uuid-bddfec7e-b4c9-4920-887c-c250b3e9fd0c-7492998-wacista ft_transcendence
cd ft_transcendence
```

⚠️ Tous les membres clonent **la même URL vogsphere** ci-dessus. Si le clone échoue ("access denied" / "Permission denied"), c'est que ta clé SSH n'est pas sur l'intra (Étape 5) ou que tu n'es pas inscrit au groupe du projet sur l'intra 42.

---

## Étape 8 — Configurer le projet en local

### 8.1 — Copier le template d'environnement

```bash
cp .env.example .env
```

Édite `.env` (ouvre-le avec `nano .env` ou via VS Code après l'installation) :

```env
POSTGRES_USER=changeme
POSTGRES_PASSWORD=changeme    # un password de ton choix
POSTGRES_DB=transcendence

REDIS_HOSTNAME=redis
REDIS_PORT=6379
REDIS_PASSWORD=changeme       # un password de ton choix

MINIO_ROOT_USER=changeme      # min. 5 caractères
MINIO_ROOT_PASSWORD=changeme  # min. 8 caractères
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_BUCKET=avatars

JWT_SECRET=...                # génère avec : openssl rand -hex 64 (min. 16 caractères)

GOOGLE_CLIENT_ID=...          # demande à Da/Brahim de partager les credentials
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://localhost:5173/api/auth/oauth/google/callback

# Origine applicative unique (navigateur) + cibles proxy internes lues par le frontend.
FRONTEND_URL=https://localhost:5173
API_PROXY_TARGET=https://backend:3000
MINIO_PROXY_TARGET=http://minio:9000
```

> ⚠️ Le backend **valide ces variables au démarrage** : si l'une manque ou est malformée, il
> s'arrête immédiatement en affichant le **nom** de la variable fautive (jamais sa valeur).
> Copie bien tout le `.env.example`.

Pour générer `JWT_SECRET` :
```bash
openssl rand -hex 64
```
Copie la sortie dans la valeur de `JWT_SECRET`.

⚠️ Pour les credentials Google OAuth, demande-les à l'équipe (ils sont dans la Google Cloud
Console partagée). Voir aussi l'**Étape 8.2** : l'URI de redirection doit y être enregistrée.

### 8.2 — Google Cloud : enregistrer l'URI de redirection

Pour que « Se connecter avec Google » fonctionne, l'URI de redirection utilisée par l'app doit
être **enregistrée à l'identique** dans la Google Cloud Console (OAuth 2.0 Client → *Authorized
redirect URIs*) :

```
https://localhost:5173/api/auth/oauth/google/callback
```

C'est la personne qui possède le projet Google Cloud qui l'ajoute (demande à l'équipe). Tant
que ce n'est pas fait, Google renvoie une erreur `redirect_uri_mismatch`. Le reste de l'app
(register/login classiques) fonctionne sans ça.

> Le certificat HTTPS n'a **rien à générer à la main** : le backend le crée automatiquement au
> démarrage dans le volume `backend_certs` et le partage au frontend. (Ancienne étape supprimée.)

---

## Étape 9 — Lancer le projet

```bash
docker compose up -d --build --wait
```

Premier démarrage : Docker build les images (~2-5 min). `--wait` bloque jusqu'à ce que tous les
services soient **healthy**. Le backend génère le certificat, applique les **migrations
automatiquement**, puis démarre ; le frontend démarre ensuite.

### Vérifier que tout tourne

```bash
docker compose ps
```

Tous les services doivent être **healthy** (aucun `Restarting`) :
- `frontend` (port 5173, HTTPS) — l'origine applicative
- `backend` (port 3000, HTTPS) — accès direct diagnostic/tests
- `postgres`, `redis`, `minio`
- `adminer`, `redis-commander`

> Les migrations Drizzle sont appliquées **automatiquement** au démarrage du backend — plus
> aucune commande manuelle. (Si un jour tu veux les inspecter : `docker compose exec backend
> npx drizzle-kit migrate`.)

### Tester

```bash
curl -k https://localhost:5173/api/ping   # via le proxy
curl -k https://localhost:3000/ping       # backend direct
```

Les deux doivent renvoyer `pong-from-docker`.

### URLs en local (depuis ton navigateur Windows)

| Service | URL |
|---|---|
| **App (unique)** | **https://localhost:5173** |
| Backend direct (diagnostic) | https://localhost:3000 |
| Adminer (Postgres) | http://localhost:8080 |
| Redis Commander | http://localhost:8081 |
| MinIO Console | http://localhost:9001 |

⚠️ Ouvre **`https://localhost:5173`** : le navigateur dira "certificat non sécurisé" (cert
auto-signé) → **Avancé → Continuer**. C'est la **seule** exception à accepter ; l'API et les
médias passent par cette même origine.

### Note Redis / WSL — warning `vm.overcommit_memory`

Au démarrage, Redis peut logger un avertissement `Memory overcommit must be enabled`. Il dépend
d'un réglage **de l'hôte** (le noyau WSL), pas du projet — on ne le modifie **pas** depuis
Compose. Pour le diagnostiquer / corriger côté WSL :

```bash
cat /proc/sys/vm/overcommit_memory      # 0 par défaut → d'où le warning
sudo sysctl vm.overcommit_memory=1      # correction temporaire (jusqu'au prochain reboot WSL)
```

Sans correction, Redis fonctionne quand même en dev ; le warning est bénin ici.

---

## Étape 10 — Installer VS Code + extensions

### VS Code

Télécharge sur Windows : https://code.visualstudio.com/

### Extension WSL (obligatoire pour bosser sur le projet)

Dans VS Code :
1. **Extensions** (`Ctrl+Shift+X`)
2. Cherche **"WSL"** (de Microsoft)
3. Install

Puis dans Ubuntu :
```bash
cd ~/ft_transcendence
code .
```

Cette commande lance VS Code dans le contexte WSL → tu travailles directement sur les fichiers Linux.

### Extensions recommandées pour le projet

Une fois dans VS Code (en mode WSL — barre en bas à gauche doit dire "WSL: Ubuntu"), installe les **mêmes extensions** que le reste de l'équipe pour avoir un setup identique :

| Extension | ID | Utilité |
|---|---|---|
| **Prettier** | `esbenp.prettier-vscode` | Formatage auto sur save (déjà configuré dans `.vscode/settings.json`) |
| **ESLint** | `dbaeumer.vscode-eslint` | Linting TypeScript |
| **Swagger Viewer** | `arjun.swagger-viewer` | Visualiser `backend/openapi.yaml` (Ctrl+Shift+P → "Preview Swagger") |
| **YAML** | `redhat.vscode-yaml` | Coloration + validation YAML (utile pour docker-compose, openapi) |
| **Tailwind CSS IntelliSense** | `bradlc.vscode-tailwindcss` | Autocomplete classes Tailwind pour le frontend |
| **Docker** | `ms-azuretools.vscode-docker` | Vue arborescente des conteneurs / images / volumes |
| **Containers** | `ms-azuretools.vscode-containers` | Successeur de Docker (de Microsoft), complémentaire |
| **PostgreSQL** | `ckolkman.vscode-postgres` | Explorer/requêter Postgres direct depuis VS Code |

### Installation rapide en une commande

Tu peux toutes les installer d'un coup via le terminal Ubuntu :

```bash
code --install-extension esbenp.prettier-vscode \
     --install-extension dbaeumer.vscode-eslint \
     --install-extension arjun.swagger-viewer \
     --install-extension redhat.vscode-yaml \
     --install-extension bradlc.vscode-tailwindcss \
     --install-extension ms-azuretools.vscode-docker \
     --install-extension ms-azuretools.vscode-containers \
     --install-extension ckolkman.vscode-postgres
```

Puis recharge la fenêtre VS Code : `Ctrl+Shift+P` → `Reload Window`.

---

## Étape 11 — Installer Postman pour tester l'API

### Installer Postman sur Windows

Télécharge : https://www.postman.com/downloads/

### Importer la collection du projet

1. Lance Postman
2. **File → Import**
3. Sélectionne les **2 fichiers** :
   - `postman/transcendence.postman_collection.json`
   - `postman/transcendence-local.postman_environment.json`
4. En haut à droite, sélectionne l'environnement **"ft_transcendence — local"**

### ⚠️ Désactiver la vérif SSL

Postman refuse les certificats auto-signés par défaut.
- **Settings → General → SSL Certificate Verification → OFF**

### Tester

Lance la requête **Auth → Login** dans Postman. Si tu reçois un `200 OK` avec un `accessToken`, tout marche ✅

Lis `postman/README.md` pour les workflows détaillés (2FA, friends, messages, etc.).

---

## 🧪 Vérification finale — tout marche ?

Checklist rapide :

- [ ] `wsl --version` affiche WSL 2
- [ ] `docker --version` marche dans Ubuntu
- [ ] clé SSH ajoutée sur l'intra 42 et clone vogsphere OK
- [ ] `node --version` affiche v24.x
- [ ] `docker compose ps` (depuis `~/ft_transcendence`) affiche tous les services **healthy**
- [ ] les tables sont visibles dans Adminer (migrations appliquées automatiquement au boot)
- [ ] `curl -k https://localhost:5173/api/ping` **et** `curl -k https://localhost:3000/ping` répondent `pong-from-docker`
- [ ] VS Code s'ouvre en mode WSL (`code .` depuis Ubuntu)
- [ ] Postman → Login renvoie un 200 avec accessToken

Si toutes les cases sont cochées : t'es opérationnel 🎉

---

## 🐛 Troubleshooting

### "WSL n'est pas reconnu" dans PowerShell
Tu as une vieille version de Windows. Mets à jour Windows ou installe WSL manuellement :
https://learn.microsoft.com/fr-fr/windows/wsl/install-manual

### Docker Desktop ne démarre pas
Vérifie que la virtualisation est activée dans le BIOS (Étape 1). Si oui, désinstalle/réinstalle Docker Desktop, et redémarre Windows.

### "Permission denied" au push (vogsphere)
Ta clé SSH n'est pas chargée, ou pas enregistrée sur l'intra 42. Dans Ubuntu :
```bash
ssh-add ~/.ssh/id_ed25519
```
Si ça persiste : vérifie que la clé publique est bien sur l'intra (Étape 5) et que tu es inscrit au groupe du projet.

### `docker compose up -d` plante au build
Réessaie : c'est souvent un timeout réseau au pull des images. Si ça persiste, regarde le log : `docker compose logs backend`.

### Le backend crash au boot
Vérifie ton `.env` :
```bash
docker compose exec backend printenv | grep -E "^(DATABASE_URL|JWT_SECRET|REDIS|MINIO)"
```
Toutes les vars doivent avoir une valeur.

### Hot reload ne marche pas (modifs pas prises)
WSL2 + Docker ont un souci connu avec inotify. Le projet utilise déjà `CHOKIDAR_USEPOLLING=true` pour contourner. Si ça marche toujours pas, restart le conteneur : `docker compose restart backend`.

### "Cannot find module '@fastify/oauth2'" après un git pull
Quelqu'un a ajouté une dépendance et tu as un volume node_modules périmé :
```bash
docker compose up -d --build -V backend
```

Le `-V` rafraîchit les volumes anonymes.

### Postman erreur "SELF_SIGNED_CERT_IN_CHAIN"
Tu as oublié de désactiver la vérif SSL (Étape 11 — Settings → SSL Verification OFF).

---

## 📚 Pour comprendre l'architecture

Une fois le setup OK, lis dans cet ordre :

1. **README.md** (racine) — vue d'ensemble du projet et stack
2. **postman/README.md** — comment tester l'API
3. **backend/openapi.yaml** — doc complète des routes REST (ouvre avec Swagger Viewer dans VS Code)

---

## 🤝 Workflow git en équipe

> Pas de Pull Request sur vogsphere : la **review se fait en local** puis on merge sur `master`.

Quand tu commences à coder :

```bash
# Toujours partir d'un master à jour
git checkout master
git pull

# Créer une branche feature (convention : feature/<code-ticket>-<sujet>)
git checkout -b feature/f1-scaffolding-front

# Coder, commiter régulièrement (Conventional Commits : feat/fix/docs/...)
git add ...
git commit -m "feat(scope): ..."

# Push ta branche sur vogsphere
git push -u origin feature/f1-scaffolding-front
```

**Review (en local, par un coéquipier — jamais sa propre branche) :**
```bash
git checkout master && git pull
git diff master..feature/f1-scaffolding-front   # relire le diff
git merge feature/f1-scaffolding-front          # si OK
git push origin master
```

⚠️ **Ne push jamais de code non relu directement sur `master`.** Toujours branche → review locale → merge.
⚠️ **Avant de pusher / merger** : `npm run build` et `npm run lint` doivent passer, et la console Chrome doit rester vide sur les écrans touchés (DevTools ouverts — c'est un motif de rejet du projet).

---

Bienvenue dans le projet 🚀

Si tu bloques sur une étape, ping un coéquipier sur Discord/Slack avec :
- L'étape précise où tu es
- Le message d'erreur complet
- Ce que tu as essayé avant
