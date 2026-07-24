# Postman Collection — ft_transcendence

Collection complète pour tester l'API REST + WebSocket de ft_transcendence.

## 📦 Fichiers

- `transcendence.postman_collection.json` — la collection (19 requêtes REST)
- `transcendence-local.postman_environment.json` — l'environnement local

## 🚀 Import dans Postman

1. Ouvrir Postman
2. **File → Import** (ou Ctrl+O)
3. Sélectionner les **2 fichiers** :
   - `transcendence.postman_collection.json`
   - `transcendence-local.postman_environment.json`
4. Importer → la collection apparaît dans la sidebar avec les dossiers `Auth`, `2FA`, `Users`, `Friends`, `Messages`
5. En haut à droite, sélectionner l'environnement **"ft_transcendence — local"**

## ⚠️ Désactiver la vérif SSL (cert HTTPS auto-signé)

Le backend tourne en HTTPS avec un certificat auto-signé. Postman refuse par défaut.

**Settings → General → SSL Certificate Verification → OFF**

Sinon toutes les requêtes échoueront avec "SELF_SIGNED_CERT_IN_CHAIN" ou similaire.

## 🔄 Flow type pour tester

### Login simple (sans 2FA)
1. Lancer **Auth/Login** → `accessToken` stocké automatiquement
2. Lancer **Users/Get Me** → vérifier la session
3. Toutes les requêtes protégées utilisent `Authorization: Bearer {{accessToken}}`

### Login avec 2FA activée
1. **Auth/Login** → renvoie `requires2FA: true` + tempToken (stocké auto)
2. Remplir le `code` dans **2FA/Verify** (6 chiffres de ton app Authenticator)
3. Lancer **2FA/Verify** → `accessToken` stocké

### Activer la 2FA pour la première fois
1. Être loggé (accessToken OK)
2. **2FA/Setup** → renvoie `{ secret, qrCodeDataUrl }`
3. Scanner le QR avec Google Authenticator / Authy / 1Password
4. Remplir le `code` dans **2FA/Enable** → 2FA activée

### Gérer les amis
1. Récupérer l'`id` d'un autre user (Adminer ou GET `/users/:pseudo`)
2. Edit Environment → mettre cet id dans `friendId`
3. **Friends/Send Friend Request** → `friendshipId` stocké auto
4. **Friends/Accept**, **Friends/Reject**, **Friends/Unfriend** utilisent `friendshipId` direct

### Charger un chat
1. `friendId` doit être renseigné
2. **Messages/Chat History** → 100 derniers messages

## 🔌 WebSocket (à ajouter manuellement)

La collection REST ne couvre pas le WebSocket. Postman supporte WS nativement mais il faut le créer en UI.

### Ajouter le WS Chat dans Postman

1. **New → WebSocket Request** (en haut à gauche, à côté de "New HTTP Request")
2. URL : `{{wsBaseUrl}}/ws/chat?token={{accessToken}}`
3. Sauver dans la collection (clic droit → Save As)

### Tester l'envoi de messages

Une fois connecté, dans le tab **Messages**, envoie un frame texte de la forme :
```json
{"to":"<friend-uuid>","content":"salut !"}
```

Tu devrais recevoir en retour :
- `{"type":"message_sent", "message":{...}}` (ack côté sender)
- Et si tu es connecté avec un autre user, il recevrait `{"type":"message", "message":{...}}`

### Tester la présence

Tu reçois automatiquement à la connexion :
- `{"type":"initial_presence", "onlineFriendIds":[...]}` (liste des amis déjà online)
- `{"type":"presence", "userId":"...", "online":true/false}` pour chaque ami qui change de statut

## 📝 Variables d'environnement

| Var | Description | À renseigner ? |
|---|---|---|
| `baseUrl` | URL backend REST | Auto |
| `wsBaseUrl` | URL backend WS | Auto |
| `email` / `password` | Credentials login | Pour Login |
| `pseudo` | Pour GET `/users/:pseudo` | Pour cette route |
| `accessToken` | JWT 15 min | **Auto** après login/verify/refresh |
| `tempToken` | JWT 2FA temporaire | **Auto** après login 2FA |
| `friendId` | UUID d'un user ami | **Manuel** |
| `friendshipId` | UUID d'une friendship | **Auto** après send-request |

## 🐛 Troubleshooting

| Erreur | Solution |
|---|---|
| `SELF_SIGNED_CERT_IN_CHAIN` | Settings → General → SSL Certificate Verification = OFF |
| `ECONNREFUSED` | Backend pas démarré : `docker compose up -d` |
| `401 Unauthorized` | accessToken expiré (15 min) : relancer Login ou Refresh |
| `403 not friends` | Tu n'es pas ami avec le user cible (vérifier avec Adminer) |
