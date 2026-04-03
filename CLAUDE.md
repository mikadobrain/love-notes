# CLAUDE.md – Regeln & Kontext für KI-Assistenten

## 🚨 SICHERHEITSREGELN – IMMER EINHALTEN

### Niemals Credentials committen!
- **NIEMALS** API Keys, Tokens, Passwörter oder andere Secrets in Git committen
- Das betrifft insbesondere:
  - Supabase URL & Anon Key (`EXPO_PUBLIC_SUPABASE_*`)
  - Supabase Service Role Key
  - Supabase Management API Token
  - Push-Notification-Keys (FCM, APNs)
  - Alle anderen Zugangsdaten
- Secrets gehören **ausschließlich** in `.env` (ist gitignored) oder in den Systemschlüsselbund
- Für neue Entwickler: `.env.example` als Vorlage verwenden und eigene Werte eintragen
- Das Repo ist **öffentlich** – ein einmal gepushter Key muss sofort rotiert werden!

### Vor jedem Commit prüfen:
```bash
git diff --cached | grep -E "(eyJ|sk_|password|secret|token|key)"
```

---

## Projektkontext

Siehe [`docs/context.md`](docs/context.md) für die vollständige Projektbeschreibung,
Architektur, Tech-Stack und Implementierungsstand.

---

## Arbeitsumgebung

- **Lokales Projektverzeichnis**: `~/dev/love-notes`
- **Kein OneDrive** – OneDrive verursacht Expo-File-Watcher-Probleme
- **Expo Go** nutzen zum Testen (QR-Code scannen) – ohne separates Tunnel-Tool
- **Node.js**: via Homebrew installiert
- **Supabase CLI**: `npx supabase` (kein globales Install nötig)

## Nützliche Befehle

```bash
# Entwicklungsserver starten
cd ~/dev/love-notes && npx expo start

# Mit leerem Cache (nach Abhängigkeitsänderungen)
npx expo start --clear

# TypeScript prüfen
npx tsc --noEmit

# Supabase Edge Functions deployen
npx supabase functions deploy send-note --project-ref aengcivlycdttoivfbkm
npx supabase functions deploy check-contacts --project-ref aengcivlycdttoivfbkm
npx supabase functions deploy manage-connection --project-ref aengcivlycdttoivfbkm
```
