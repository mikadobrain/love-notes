# LoveNotes – Projektkontext

## Was ist LoveNotes?

Eine Cross-Platform-App (iOS + Android) mit der Nutzer ihren Kontakten
Wertschätzung, Bewunderung und positive Botschaften hinterlassen können.
Die empfangenden Nutzer sehen diese Nachrichten als Push-Benachrichtigungen
in konfigurierbaren Intervallen – als eine Art positiver Überraschung im Alltag.

**Wichtiges UX-Prinzip**: Empfänger sehen Nachrichten NICHT als Liste, sondern
immer nur eine Note auf einmal, die sich periodisch ändert. Keine Listenansicht,
keine Gesamtübersicht – der Effekt soll Überraschung und positive Impulse im Alltag sein.

## Kernkonzepte

- **Verbindungssystem**: Beide Nutzer müssen sich gegenseitig bestätigen (wie Freundschaftsanfragen)
- **Ende-zu-Ende-Verschlüsselung**: Nachrichten lokal verschlüsselt; Server sieht nur verschlüsselte Blobs (NaCl `crypto_box`)
- **Dezentrale Datenhaltung**: Alle Klartextdaten liegen lokal in SQLite; Supabase ist verschlüsselter Relay
- **Anonymität**: Absender können Nachrichten anonym senden
- **Key-Rotation-Resilienz**: `sender_public_key` wird mit jeder Queue-Message gespeichert → Entschlüsselung klappt auch nach Sender-Reinstall

---

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Framework | React Native + Expo (SDK 54) |
| Routing | Expo Router v6 (file-based) |
| Sprache | TypeScript |
| Backend | Supabase (PostgreSQL, Auth, Edge Functions) |
| Lokale DB | expo-sqlite |
| Kryptografie | tweetnacl (`crypto_box` = Curve25519 + XSalsa20 + Poly1305) |
| Schlüsselspeicher | expo-secure-store |
| Notifications | expo-notifications (lokal; Push nur Dev-Build) |
| Kontaktsuche | expo-crypto (SHA-256 für E-Mail-Hashing) |
| Logging | Supabase `app_logs` Tabelle (zentral, durchsuchbar) |

**Supabase Projekt-ID**: `aengcivlycdttoivfbkm` (EU-Region)

---

## Architektur

```
┌──────────────┐    verschlüsselt    ┌──────────────────┐    verschlüsselt    ┌──────────────┐
│   Nutzer A   │ ──────────────────▶ │    Supabase      │ ◀────────────────── │   Nutzer B   │
│ React Native │                     │ • Auth           │                     │ React Native │
│ + Expo       │                     │ • message_queue  │                     │ + Expo       │
│ SQLite lokal │                     │ • Edge Functions │                     │ SQLite lokal │
│ (Klartext)   │                     │ • connections    │                     │ (Klartext)   │
└──────────────┘                     └──────────────────┘                     └──────────────┘
```

**Sicherheitsprinzip**: Edge Functions sind der einzige Schreibzugang zur `message_queue`.
Clients können direkt keine Nachrichten einschleusen.

---

## Projektstruktur

```
love-notes/
├── app/                        # Expo Router (file-based routing)
│   ├── (tabs)/
│   │   ├── index.tsx           # Kontaktliste (akzeptierte Verbindungen)
│   │   ├── notes.tsx           # Empfangene Notizen (eine Note rotierend, keine Liste)
│   │   ├── requests.tsx        # Verbindungsanfragen senden/annehmen (Suche per E-Mail)
│   │   └── settings.tsx        # Intervall, Profil, Debug-Logging-Toggle, Logout
│   ├── contact/[id].tsx        # Notizen für einen Kontakt schreiben
│   ├── auth.tsx                # Login / Registrierung
│   └── _layout.tsx             # Root-Layout + Auth-Guard + SafeAreaProvider
├── components/
│   ├── Themed.tsx
│   ├── useColorScheme.ts
│   └── useClientOnlyValue.ts
├── constants/
│   └── Colors.ts               # Brand-Farben (#e74c8b pink)
├── lib/
│   ├── supabase.ts             # Supabase-Client + Typedefinitionen
│   ├── crypto.ts               # NaCl Key-Pair, En-/Entschlüsselung
│   ├── db.ts                   # Lokale SQLite-Operationen
│   ├── auth-context.tsx        # React Context: Session, Login, Signup, ensureKeyPair
│   ├── sync.ts                 # Sync-Logik: Senden, Empfangen, Key-Rotation
│   ├── logger.ts               # Zentrales Logging (console + Supabase app_logs)
│   └── notifications.ts        # Push-Tokens, lokale Notifications
├── supabase/
│   ├── functions/
│   │   ├── send-note/          # Edge Function: Note validieren + in Queue legen
│   │   ├── check-contacts/     # Edge Function: Kontakt-Lookup via Hash
│   │   └── manage-connection/  # Edge Function: Verbindungen verwalten
│   └── migrations/
├── docs/
│   └── context.md              # Diese Datei
├── .github/
│   └── workflows/
│       └── claude.yml          # GitHub Claude Code Actions
├── .env                        # Secrets (gitignored)
├── .env.example                # Vorlage ohne echte Keys
├── CLAUDE.md                   # KI-Regeln & Arbeitsanweisungen
└── app.json                    # Expo-Konfiguration
```

---

## Datenbankmodell (Supabase)

### `profiles`
| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | UUID (PK) | = auth.users.id |
| `display_name` | TEXT | Anzeigename |
| `email_hash` | TEXT | SHA-256 der E-Mail (für Suche, UNIQUE) |
| `phone_hash` | TEXT | SHA-256 der Telefonnummer |
| `public_key` | TEXT | Aktueller NaCl Public Key für E2E |
| `fcm_token` | TEXT | Push-Token |

Profil-Erstellung via PostgreSQL-Trigger `handle_new_user` (on `auth.users` INSERT).
App macht anschließend UPDATE mit `display_name`, `email_hash`, `public_key`.

### `connections`
| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | UUID (PK) | |
| `requester_id` | UUID | Wer die Anfrage gesendet hat |
| `target_id` | UUID | Wer die Anfrage erhalten hat |
| `status` | TEXT | `pending` / `accepted` / `rejected` |

### `message_queue`
| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | UUID (PK) | |
| `recipient_id` | UUID | Empfänger |
| `encrypted_payload` | TEXT | Verschlüsselter Blob (NaCl box) |
| `sender_public_key` | TEXT | Public Key des Senders zum Zeitpunkt des Sendens |
| `delivered` | BOOLEAN | Nach Empfang auf `true` gesetzt |

`sender_public_key` löst das Key-Rotation-Problem: auch nach Sender-Reinstall
kann der Empfänger den originalen Sender-Key für Entschlüsselung nutzen.

### `app_logs`
Zentrales Debug-Log. Alle `warn`/`error`-Events werden immer geschrieben;
`debug`/`info` nur wenn `EXPO_PUBLIC_LOG_LEVEL=debug`. Per `module` und `level` filterbar.

### `audit_log`
Nur über service_role zugänglich. Protokolliert Aktionen ohne Klartextdaten.

---

## Lokale Datenbank (SQLite)

| Tabelle | Beschreibung |
|---|---|
| `outgoing_notes` | Nachrichten die ich geschrieben habe (`synced` flag) |
| `incoming_notes` | Empfangene und entschlüsselte Nachrichten |
| `connections_cache` | Akzeptierte Verbindungen (gespiegelt von Supabase, inkl. `public_key`) |
| `settings` | Key-Value-Store (z.B. `notification_interval_hours`, `debug_logging`) |

---

## Auth-Flow

1. **Registrierung**: E-Mail + Passwort → Supabase Auth User
2. DB-Trigger erstellt automatisch Profil-Eintrag
3. App macht UPDATE: `display_name`, `email_hash` (SHA-256), `public_key`
4. NaCl Key-Pair generieren → Private Key in SecureStore
5. **Login**: `signInWithPassword` → `ensureKeyPair()` prüft Key-Sync zwischen SecureStore und DB

### Key-Rotation-Logik
- `ensureKeyPair()` läuft bei jedem Login
- Vergleicht Device-Key (SecureStore) mit DB-Key
- Bei Abweichung: Device-Key gewinnt, wird in DB hochgeladen
- Sender-Seite: `syncConnections` erkennt geänderten Empfänger-Key → markiert alle Outgoing-Notes als `synced=0` → werden neu verschlüsselt und gesendet
- Empfänger-Seite: `sender_public_key` in Queue sorgt dafür dass auch nach Sender-Rotation entschlüsselt werden kann

---

## Logging-System

`lib/logger.ts` – zentral, zwei Modi:

| Modus | Steuerung | Verhalten |
|---|---|---|
| **INFO** (default) | `EXPO_PUBLIC_LOG_LEVEL=info` | `warn`/`error` → Supabase; `debug`/`info` → nur console |
| **DEBUG** | `EXPO_PUBLIC_LOG_LEVEL=debug` oder Settings-Toggle | Alles → Supabase `app_logs` |

In den App-Settings gibt es einen Toggle zum Ein-/Ausschalten von Debug-Logging zur Laufzeit.

---

## Edge Functions (deployed)

| Function | Zweck |
|---|---|
| `send-note` | Validiert Auth, prüft Verbindung, legt Note in `message_queue` |
| `check-contacts` | Sucht Nutzer per `email_hash` |
| `manage-connection` | Verbindungsanfragen senden/annehmen/ablehnen |

Authentifizierung via `adminClient.auth.getUser(jwt)` (expliziter Bearer-Token per `fetch`).

---

## Bekannte Einschränkungen / Offene TODOs

- **Push-Notifications**: `expo-notifications` Push-Support in Expo Go (SDK 53+) entfernt → Dev-Build nötig für echte Push-Notifications
- **Kontaktabgleich**: `expo-contacts` + Hash-Lookup noch nicht implementiert (Phase 2); aktuell manuell per E-Mail-Suche
- **Offline-Verhalten**: Kein Retry-Mechanismus für fehlgeschlagene Syncs
- **End-to-End-Test**: Empfangsflow (fetchAndProcessMessages) noch nicht vollständig getestet
- **Produktions-Build**: Kein EAS Build / App Store Setup bisher

---

## Entwicklungshistorie

- **Phase 1** ✅ Projektsetup, Supabase, Auth, DB-Schema, RLS
- **Phase 2** ✅ Verbindungssystem (UI + E-Mail-Suche über `email_hash`)
- **Phase 3** ✅ Lokale SQLite-DB, alle Screens
- **Phase 4** ✅ E2E-Verschlüsselung, Sync-Logik, Key-Rotation-Resilienz
- **Phase 5** 🔄 Notifications (lokal OK, Push braucht Dev-Build); UX-Redesign (rotierende Einzel-Note statt Liste)
- **Phase 6** ⬜ Onboarding, umfassendes Error-Handling, Offline-Verhalten, Produktion
