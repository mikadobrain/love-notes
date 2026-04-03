import { Platform } from 'react-native';
import { getRandomIncomingNote, markNoteShown, getSetting } from './db';
import { supabase } from './supabase';
import { Logger } from './logger';

// Lazy-load expo-notifications so a missing/broken module doesn't crash the app
// (expo-notifications push support was removed from Expo Go in SDK 53)
let Notifications: typeof import('expo-notifications') | null = null;
try {
  Notifications = require('expo-notifications');
  Logger.debug('notifications', 'expo-notifications loaded successfully');
} catch {
  Logger.warn('notifications', 'expo-notifications not available – notification features disabled');
}

/**
 * Configure notification handling defaults.
 * Safe no-op when expo-notifications is not available.
 */
export function configureNotifications(): void {
  Logger.debug('notifications', 'configureNotifications called');
  try {
    Notifications?.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    Logger.debug('notifications', 'configureNotifications: handler set');
  } catch (e) {
    Logger.warn('notifications', 'configureNotifications failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Request notification permissions and return the push token.
 * Returns null when running in Expo Go (push not supported).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  Logger.debug('notifications', 'registerForPushNotifications called');

  if (!Notifications) {
    Logger.warn('notifications', 'registerForPushNotifications: expo-notifications not available');
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    Logger.debug('notifications', 'registerForPushNotifications: existing permission', { status: existingStatus });
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      Logger.debug('notifications', 'registerForPushNotifications: requesting permission...');
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Logger.warn('notifications', 'registerForPushNotifications: permission denied', { status: finalStatus });
      return null;
    }

    Logger.debug('notifications', 'registerForPushNotifications: permission granted, getting push token...');
    const tokenData = await Notifications.getExpoPushTokenAsync();
    Logger.info('notifications', 'registerForPushNotifications: push token obtained', {
      tokenPrefix: tokenData.data.substring(0, 20),
    });
    return tokenData.data;
  } catch (e) {
    Logger.warn('notifications', 'registerForPushNotifications failed (Expo Go?)', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Save the push token to the user's profile on Supabase.
 */
export async function savePushToken(userId: string, token: string): Promise<void> {
  Logger.debug('notifications', 'savePushToken', { userId, tokenPrefix: token.substring(0, 20) });
  const { error } = await supabase
    .from('profiles')
    .update({ fcm_token: token })
    .eq('id', userId);

  if (error) {
    Logger.error('notifications', 'savePushToken: failed', { error: error.message, userId });
  } else {
    Logger.info('notifications', 'savePushToken: success', { userId });
  }
}

/**
 * Schedule a recurring local notification that shows a random LoveNote.
 * Safe no-op when expo-notifications is not available.
 */
export async function scheduleRandomNoteNotification(): Promise<void> {
  Logger.debug('notifications', 'scheduleRandomNoteNotification called');

  if (!Notifications) {
    Logger.warn('notifications', 'scheduleRandomNoteNotification: expo-notifications not available');
    return;
  }

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    Logger.debug('notifications', 'scheduleRandomNoteNotification: cancelled existing notifications');

    const intervalStr = await getSetting('notification_interval_hours');
    const intervalHours = intervalStr ? parseInt(intervalStr, 10) : 8;
    Logger.debug('notifications', 'scheduleRandomNoteNotification: interval loaded', { intervalHours });

    const note = await getRandomIncomingNote();
    if (!note) {
      Logger.info('notifications', 'scheduleRandomNoteNotification: no incoming notes to schedule');
      return;
    }

    const senderText = note.sender_name
      ? `${note.sender_name} sagt:`
      : 'Jemand sagt:';

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'LoveNote 💌',
        subtitle: senderText,
        body: note.message,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: intervalHours * 3600,
        repeats: false,
      },
    });

    await markNoteShown(note.id);
    Logger.info('notifications', 'scheduleRandomNoteNotification: scheduled', {
      intervalHours,
      noteId: note.id,
      sender: note.sender_name ?? 'anon',
    });
  } catch (e) {
    Logger.warn('notifications', 'scheduleRandomNoteNotification failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Send an immediate local notification (e.g., when a new note arrives).
 * Safe no-op when expo-notifications is not available.
 */
export async function showImmediateNotification(
  title: string,
  body: string,
  subtitle?: string
): Promise<void> {
  Logger.debug('notifications', 'showImmediateNotification', { title, body, subtitle });

  if (!Notifications) {
    Logger.warn('notifications', 'showImmediateNotification: expo-notifications not available');
    return;
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        subtitle,
        body,
        sound: true,
      },
      trigger: null,
    });
    Logger.debug('notifications', 'showImmediateNotification: sent');
  } catch (e) {
    Logger.warn('notifications', 'showImmediateNotification failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
