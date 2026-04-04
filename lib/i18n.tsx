import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getSetting, setSetting } from './db';

export type Language = 'en' | 'de';

const SUPPORTED: Language[] = ['en', 'de'];

function detectDeviceLanguage(): Language {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const lang = locale.split('-')[0].toLowerCase() as Language;
    return SUPPORTED.includes(lang) ? lang : 'en';
  } catch {
    return 'en';
  }
}

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

const translations: Record<Language, Record<string, string>> = {
  en: {
    // Tabs
    'tabs.contacts': 'Contacts',
    'tabs.inbox': 'Inbox',
    'tabs.requests': 'Requests',
    'tabs.settings': 'Settings',

    // Notes screen
    'notes.empty.title': 'No LoveNotes yet',
    'notes.empty.hint':
      "When someone sends you a positive note, you'll get it as a notification.",
    'notes.empty.pull': '↓ Pull to refresh',
    'notes.counter.singular': '1 LoveNote received',
    'notes.counter.plural': '{n} LoveNotes received',
    'notes.sender.anonymous': 'Someone',
    'notes.next': 'Next Note',
    'notes.pullHint': '↓ Pull to refresh',

    // Contact detail
    'contact.title': 'Contact',
    'contact.emptyText': 'Write your first note to {name}!',
    'contact.anonymousLabel': 'Send anonymously',
    'contact.placeholder': 'Why do you appreciate this person?',
    'contact.noKey': '{name} needs to open the app before you can write.',
    'contact.delete.title': 'Delete entry',
    'contact.delete.message': 'Do you really want to delete this entry?',
    'contact.delete.cancel': 'Cancel',
    'contact.delete.confirm': 'Delete',
    'contact.notSynced': 'Not sent',
    'contact.withName': 'With your name',
    'contact.anonymous': 'Anonymous',
    'contact.notReady.title': 'Recipient not ready',
    'contact.notReady.message':
      '{name} needs to open the app first so messages can be encrypted. Please try again afterwards.',
    'contact.tooLong.title': 'Too long',
    'contact.tooLong.message': 'The message may be at most 1000 characters long.',
    'contact.sendFailed.title': 'Send failed',
    'contact.sendFailed.fallback': 'The message will be retried on next sync.',
    'contact.error.title': 'Error',
    'contact.error.message': 'Message could not be sent.',
    'contact.chips.label': 'Writing starters:',
    'contact.chip.0': 'You always make me smile when...',
    'contact.chip.1': 'I love how you...',
    'contact.chip.2': 'Thank you for...',
    'contact.chip.3': 'You mean so much to me because...',

    // Contacts screen
    'contacts.empty.title': 'No connections yet',
    'contacts.empty.text':
      'Invite friends to use the app, or accept connection requests.',

    // Requests screen
    'requests.findUser': 'Find User',
    'requests.searchHint':
      'Enter the email address of another LoveNotes user to send a connection request.',
    'requests.emailPlaceholder': 'Email address',
    'requests.sendRequest': 'Send request',
    'requests.incoming': 'Incoming Requests',
    'requests.outgoing': 'Sent Requests',
    'requests.pending': 'Pending...',
    'requests.unknown': 'Unknown',
    'requests.empty':
      'No requests yet. Search above for a user to start a connection.',
    'requests.error.accept': 'Connection request could not be accepted.',
    'requests.error.reject': 'Request could not be rejected.',
    'requests.error.send': 'Request could not be sent: ',
    'requests.error.search': 'Error searching. Please try again.',
    'requests.notFound': 'No user found with this email.',
    'requests.selfSearch': "That's you 😄",
    'requests.alreadyConnected': 'You are already connected with {name}.',
    'requests.alreadyPending': 'Request to {name} is already pending.',
    'requests.sent': 'Sent! ✉️',
    'requests.sentMessage': 'Connection request to {name} was sent.',
    'requests.reject.title': 'Reject request',
    'requests.reject.message': 'Do you really want to reject this request?',
    'requests.reject.cancel': 'Cancel',
    'requests.reject.confirm': 'Reject',
    'requests.error.unknown': 'Unknown error. Please try again.',

    // Settings screen
    'settings.profile': 'Profile',
    'settings.unknown': 'Unknown',
    'settings.notifications': 'Notifications',
    'settings.interval': 'Interval: {n} {unit}',
    'settings.interval.hour': 'hour',
    'settings.interval.hours': 'hours',
    'settings.intervalDesc':
      'How often do you want to receive a random LoveNote as a notification?',
    'settings.language': 'Language',
    'settings.languageDesc': 'Choose the app language.',
    'settings.lang.en': 'English',
    'settings.lang.de': 'Deutsch',
    'settings.developer': 'Developer',
    'settings.debugMode': 'Debug Mode',
    'settings.debugModeDesc':
      'All actions will be logged in detail in the console and in Supabase (app_logs).',
    'settings.debugActive': 'Debug logging active',
    'settings.debugEnabled.title': 'Debug mode activated',
    'settings.debugEnabled.message':
      'All actions are now logged in detail – in the console and in Supabase (app_logs).',
    'settings.info': 'Info',
    'settings.infoText':
      'LoveNotes encrypts all messages end-to-end. Only you and the sender can read the content.',
    'settings.signOut': 'Sign out',
    'settings.signOut.title': 'Sign out',
    'settings.signOut.message': 'Do you really want to sign out?',
    'settings.signOut.cancel': 'Cancel',
    'settings.signOut.confirm': 'Sign out',
    'settings.version': 'LoveNotes v1.0.0',

    // Auth screen
    'auth.subtitle': 'Share appreciation with the people who matter to you',
    'auth.login': 'Sign in',
    'auth.register': 'Sign up',
    'auth.displayName': 'Display name',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.switchToRegister': "No account yet? Register now",
    'auth.switchToLogin': 'Already have an account? Sign in',
    'auth.error.required': 'Please enter email and password.',
    'auth.error.nameRequired': 'Please enter a display name.',
    'auth.error.passwordShort': 'The password must be at least 6 characters long.',
    'auth.error.loginFailed': 'Sign in failed',
    'auth.error.registerFailed': 'Registration failed',
    'auth.registerSuccess.title': 'Registration successful',
    'auth.registerSuccess.message':
      'Please confirm your email address to sign in.',
  },

  de: {
    // Tabs
    'tabs.contacts': 'Kontakte',
    'tabs.inbox': 'Postfach',
    'tabs.requests': 'Anfragen',
    'tabs.settings': 'Einstellungen',

    // Notes screen
    'notes.empty.title': 'Noch keine LoveNotes',
    'notes.empty.hint':
      'Wenn jemand dir eine positive Nachricht schickt, bekommst du sie als Benachrichtigung.',
    'notes.empty.pull': '↓ Zieh zum Aktualisieren',
    'notes.counter.singular': '1 LoveNote erhalten',
    'notes.counter.plural': '{n} LoveNotes erhalten',
    'notes.sender.anonymous': 'Jemand',
    'notes.next': 'Nächste Note',
    'notes.pullHint': '↓ Zieh zum Aktualisieren',

    // Contact detail
    'contact.title': 'Kontakt',
    'contact.emptyText': 'Schreibe deine erste Nachricht an {name}!',
    'contact.anonymousLabel': 'Anonym senden',
    'contact.placeholder': 'Warum schätzt du diesen Menschen?',
    'contact.noKey': '{name} muss die App öffnen, bevor du schreiben kannst.',
    'contact.delete.title': 'Eintrag löschen',
    'contact.delete.message': 'Möchtest du diesen Eintrag wirklich löschen?',
    'contact.delete.cancel': 'Abbrechen',
    'contact.delete.confirm': 'Löschen',
    'contact.notSynced': 'Nicht gesendet',
    'contact.withName': 'Mit deinem Namen',
    'contact.anonymous': 'Anonym',
    'contact.notReady.title': 'Empfänger nicht bereit',
    'contact.notReady.message':
      '{name} muss die App zuerst öffnen, damit Nachrichten verschlüsselt werden können. Bitte versuche es danach erneut.',
    'contact.tooLong.title': 'Zu lang',
    'contact.tooLong.message': 'Die Nachricht darf maximal 1000 Zeichen lang sein.',
    'contact.sendFailed.title': 'Senden fehlgeschlagen',
    'contact.sendFailed.fallback':
      'Die Nachricht wird beim nächsten Sync erneut versucht.',
    'contact.error.title': 'Fehler',
    'contact.error.message': 'Nachricht konnte nicht gesendet werden.',
    'contact.chips.label': 'Schreibstarter:',
    'contact.chip.0': 'Du bringst mich immer zum Lächeln, wenn...',
    'contact.chip.1': 'Ich liebe, wie du...',
    'contact.chip.2': 'Danke für...',
    'contact.chip.3': 'Du bedeutest mir so viel, weil...',

    // Contacts screen
    'contacts.empty.title': 'Noch keine Verbindungen',
    'contacts.empty.text':
      'Lade Freunde ein, die App zu nutzen, oder nimm Verbindungsanfragen an.',

    // Requests screen
    'requests.findUser': 'Nutzer suchen',
    'requests.searchHint':
      'Gib die E-Mail-Adresse eines anderen LoveNotes-Nutzers ein, um eine Verbindungsanfrage zu senden.',
    'requests.emailPlaceholder': 'E-Mail-Adresse',
    'requests.sendRequest': 'Anfrage senden',
    'requests.incoming': 'Eingehende Anfragen',
    'requests.outgoing': 'Gesendete Anfragen',
    'requests.pending': 'Ausstehend...',
    'requests.unknown': 'Unbekannt',
    'requests.empty':
      'Noch keine Anfragen. Suche oben nach einem Nutzer, um eine Verbindung zu starten.',
    'requests.error.accept': 'Verbindungsanfrage konnte nicht angenommen werden.',
    'requests.error.reject': 'Anfrage konnte nicht abgelehnt werden.',
    'requests.error.send': 'Anfrage konnte nicht gesendet werden: ',
    'requests.error.search': 'Fehler bei der Suche. Bitte versuche es erneut.',
    'requests.notFound': 'Kein Nutzer mit dieser E-Mail gefunden.',
    'requests.selfSearch': 'Das bist du selbst 😄',
    'requests.alreadyConnected': 'Du bist bereits mit {name} verbunden.',
    'requests.alreadyPending': 'Anfrage an {name} ist bereits ausstehend.',
    'requests.sent': 'Gesendet! ✉️',
    'requests.sentMessage': 'Verbindungsanfrage an {name} wurde gesendet.',
    'requests.reject.title': 'Anfrage ablehnen',
    'requests.reject.message': 'Möchtest du diese Anfrage wirklich ablehnen?',
    'requests.reject.cancel': 'Abbrechen',
    'requests.reject.confirm': 'Ablehnen',
    'requests.error.unknown': 'Unbekannter Fehler. Bitte versuche es erneut.',

    // Settings screen
    'settings.profile': 'Profil',
    'settings.unknown': 'Unbekannt',
    'settings.notifications': 'Benachrichtigungen',
    'settings.interval': 'Intervall: {n} {unit}',
    'settings.interval.hour': 'Stunde',
    'settings.interval.hours': 'Stunden',
    'settings.intervalDesc':
      'Wie oft möchtest du eine zufällige LoveNote als Benachrichtigung erhalten?',
    'settings.language': 'Sprache',
    'settings.languageDesc': 'Wähle die App-Sprache.',
    'settings.lang.en': 'English',
    'settings.lang.de': 'Deutsch',
    'settings.developer': 'Entwickler',
    'settings.debugMode': 'Debug-Modus',
    'settings.debugModeDesc':
      'Alle Aktionen werden ausführlich in der Konsole und in Supabase (app_logs) geloggt.',
    'settings.debugActive': 'Debug-Logging aktiv',
    'settings.debugEnabled.title': 'Debug-Modus aktiviert',
    'settings.debugEnabled.message':
      'Alle Aktionen werden jetzt ausführlich geloggt – in der Konsole und in Supabase (app_logs).',
    'settings.info': 'Info',
    'settings.infoText':
      'LoveNotes verschlüsselt alle Nachrichten Ende-zu-Ende. Nur du und der Absender können den Inhalt lesen.',
    'settings.signOut': 'Abmelden',
    'settings.signOut.title': 'Abmelden',
    'settings.signOut.message': 'Möchtest du dich wirklich abmelden?',
    'settings.signOut.cancel': 'Abbrechen',
    'settings.signOut.confirm': 'Abmelden',
    'settings.version': 'LoveNotes v1.0.0',

    // Auth screen
    'auth.subtitle': 'Teile Wertschätzung mit den Menschen, die dir wichtig sind',
    'auth.login': 'Anmelden',
    'auth.register': 'Registrieren',
    'auth.displayName': 'Anzeigename',
    'auth.email': 'E-Mail',
    'auth.password': 'Passwort',
    'auth.switchToRegister': 'Noch kein Konto? Jetzt registrieren',
    'auth.switchToLogin': 'Bereits ein Konto? Anmelden',
    'auth.error.required': 'Bitte E-Mail und Passwort eingeben.',
    'auth.error.nameRequired': 'Bitte einen Anzeigenamen eingeben.',
    'auth.error.passwordShort': 'Das Passwort muss mindestens 6 Zeichen lang sein.',
    'auth.error.loginFailed': 'Anmeldung fehlgeschlagen',
    'auth.error.registerFailed': 'Registrierung fehlgeschlagen',
    'auth.registerSuccess.title': 'Registrierung erfolgreich',
    'auth.registerSuccess.message':
      'Bitte bestätige deine E-Mail-Adresse, um dich anzumelden.',
  },
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type I18nContextValue = {
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  setLanguage: async () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    async function init() {
      const stored = await getSetting('language');
      if (stored && SUPPORTED.includes(stored as Language)) {
        setLanguageState(stored as Language);
      } else {
        // First launch: detect device language
        const detected = detectDeviceLanguage();
        setLanguageState(detected);
        await setSetting('language', detected);
      }
    }
    init();
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    await setSetting('language', lang);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const dict = translations[language];
      let str = dict[key] ?? translations['en'][key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          str = str.replace(`{${k}}`, String(v));
        }
      }
      return str;
    },
    [language]
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
