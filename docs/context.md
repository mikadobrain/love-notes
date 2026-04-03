# LoveNotes – Projektkontext

## Was ist LoveNotes?

Eine Cross-Platform-App (iOS + Android) mit der Nutzer ihren Kontakten
Wertschätzung, Bewunderung und positive Botschaften hinterlassen können.
Die empfangenden Nutzer sehen diese Nachrichten als Push-Benachrichtigungen
in konfigurierbaren Intervallen – als eine Art positiver Überraschung im Alltag.

## Kernkonzepte

- **Verbindungssystem**: Beide Nutzer müssen sich gegenseitig bestätigen (wie Freundschaftsanfragen), bevor Nachrichten fließen können
- **Ende-zu-Ende-Verschlüsselung**: Nachrichten werden lokal verschlüsselt; der Server sieht nur verschlüsselte Blobs (NaCl `crypto_box`)
- **Dezentrale Datenhaltung**: Alle Klartextdaten liegen lokal in SQLite; Supabase dient nur als verschlüsselter Relay
- **Anonymität**: Absender können Nachrichten anonym senden (kein Absendername)

---

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Framework | React Native + Expo (~SDK 54) |
| Routing | Expo Router v6 (file-based) |
| Sprache | TypeScript |
| Backend | Supabase (PostgreSQL, Auth, Edge Functions, Realtime) |
| Lokale DB | expo-sqlite (SQLite) |
| Kryptografie | tweetnacl (`crypto_box` = Curve25519 + XSalsa20 + Poly1305) |
| Schlüsselspeicher | expo-secure-store |
| Notifications | expo-notifications (lokal; Push in Dev-Build) |
| Kontaktsuche | expo-crypto (SHA-256 für E-Mail-Hashing) |

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
│   │   ├── notes.tsx           # Empfangene Notizen
│   │   ├── requests.tsx        # Verbindungsanfragen senden/annehmen
│   │   └── settings.tsx        # Intervall, Profil, Logout
│   ├── contact/[id].tsx        # Notizen für einen Kontakt schreiben
│   ├── auth.tsx                # Login / Registrierung
│   └── _layout.tsx             # Root-Layout + Auth-Guard
├── components/
│   ├── Themed.tsx              # Theme-aware Text & View
│   ├── useColorScheme.ts       # Hook für Light/Dark-Mode
│   └── useClientOnlyValue.ts   # Web-Hydration-Helper
├── constants/
│   └── Colors.ts               # Brand-Farben (#e74c8b pink)
├── lib/
│   ├── supabase.ts             # Supabase-Client + Typedefinitionen
│   ├── crypto.ts               # NaCl Key-Pair-Generierung & En-/Entschlüsselung
│   ├── db.ts                   # Lokale SQLite-Operationen
│   ├── auth-context.tsx        # React Context: Session, Login, Signup
│   ├── sync.ts                 # Sync-Logik: Nachrichten senden & empfangen
│   └── notifications.ts        # Push-Tokens, lokale Notifications
├── supabase/
│   ├── functions/
│   │   ├── send-note/          # Edge Function: Note weiterleiten + Rate-Limit
│   │   ├── check-contacts/     # Edge Function: Kontakt-Lookup via Hash
│   │   └── manage-connection/  # Edge Function: Verbindungen verwalten
│   └── migrations/             # DB-Migrationen (werden remote applied)
├── docs/
│   └── context.md              # Diese Datei – Projektkontext für KI-Assistenten
├── .env.example                # Vorlage für Umgebungsvariablen (keine echten Keys!)
├── CLAUDE.md                   # Sicherheitsregeln & Arbeitsanweisungen für KI
└── app.json                    # Expo-Konfiguration
```

---

## Datenbankmodell (Supabase)

### `profiles`
| Spalte | Typ | Beschreibung |
|---|---|---|
| `id` | UUID (PK) | = auth.users.id |
| `display_name` | TEXT | Anzeigename |
| `email_hash` | TEXT | SHA-256 der E-Mail (für Suche) |
| `phone_hash` | TEXT | SHA-256 der Telefonnummer |
| `public_key` | TEXT | NaCl Public Key für E2E |
| `fcm_token` | TEXT | Push-Token |

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
| `delivered` | BOOLEAN | Nach Empfang auf `true` gesetzt |

### `audit_log`
Nur über service_role zugänglich. Protokolliert alle Aktionen ohne Klartextdaten.

---

## Lokale Datenbank (SQLite)

- `outgoing_notes`: Nachrichten, die ich geschrieben habe
- `incoming_notes`: Nachrichten, die ich empfangen habe
- `connections_cache`: Akzeptierte Verbindungen (gespiegelt von Supabase)
- `settings`: Key-Value-Store (z. B. `notification_interval_hours`)

---

## Auth-Flow

1. Registrierung: E-Mail + Passwort → Supabase Auth User erstellen
2. NaCl Key-Pair generieren → Private Key in SecureStore speichern
3. Profil anlegen: `display_name`, `public_key`, `email_hash` (SHA-256)
4. Login: `signInWithPassword` → Session in SecureStore persistiert

---

## Bekannte Einschränkungen / TODOs

- **Push-Notifications**: `expo-notifications` Push-Support wurde in Expo Go (SDK 53+) entfernt → für Produktion Development Build erstellen
- **Kontaktabgleich**: `expo-contacts` + Hash-Lookup noch nicht implementiert (Phase 2); aktuell manuell per E-Mail-Suche
- **Edge Functions**: Noch nicht deployed (Deno-Runtime erforderlich)
- **E2E-Test**: Zweites Testgerät / Account nötig zum Verifizieren des Flows
- **Offline-Verhalten**: Noch kein Retry-Mechanismus für fehlgeschlagene Syncs

---

## Entwicklungshistorie

- **Phase 1** (abgeschlossen): Projektsetup, Supabase, Auth, Datenbankschema, RLS
- **Phase 2** (teilweise): Verbindungssystem (UI vorhanden, Kontaktabgleich fehlt noch)
- **Phase 3** (abgeschlossen): Lokale SQLite-DB, alle Screens implementiert
- **Phase 4** (abgeschlossen): E2E-Verschlüsselung, Sync-Logik
- **Phase 5** (in Arbeit): Notifications (lokal funktionsfähig, Push braucht Dev Build)
- **Phase 6** (offen): Onboarding, Error-Handling, Offline-Verhalten
