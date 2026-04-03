import { Platform } from 'react-native';
import { getRandomIncomingNote, markNoteShown, getSetting } from './db';
import { supabase } from './supabase';

// Lazy-load expo-notifications so a missing/broken module doesn't crash the app
// (expo-notifications push support was removed from Expo Go in SDK 53)
let Notifications: typeof import('expo-notifications') | null = null;
try {
  Notifications = require('expo-notifications');
} catch {
  console.warn('expo-notifications not available – notification features disabled');
}

/**
 * Configure notification handling defaults.
 * Safe no-op when expo-notifications is not available.
 */
export function configureNotifications(): void {
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
  } catch (e) {
    console.warn('configureNotifications failed:', e);
  }
}

/**
 * Request notification permissions and return the push token.
 * Returns null when running in Expo Go (push not supported).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Notifications) return null;

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('Push notification permission not granted');
      return null;
    }

    // getExpoPushTokenAsync requires a development build in SDK 53+
    const tokenData = await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch (e) {
    console.warn('registerForPushNotifications failed (Expo Go?):', e);
    return null;
  }
}

/**
 * Save the push token to the user's profile on Supabase.
 */
export async function savePushToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ fcm_token: token })
    .eq('id', userId);

  if (error) {
    console.error('Error saving push token:', error);
  }
}

/**
 * Schedule a recurring local notification that shows a random LoveNote.
 * Safe no-op when expo-notifications is not available.
 */
export async function scheduleRandomNoteNotification(): Promise<void> {
  if (!Notifications) return;

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();

    const intervalStr = await getSetting('notification_interval_hours');
    const intervalHours = intervalStr ? parseInt(intervalStr, 10) : 8;

    const note = await getRandomIncomingNote();
    if (!note) return;

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
  } catch (e) {
    console.warn('scheduleRandomNoteNotification failed:', e);
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
  if (!Notifications) return;

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
  } catch (e) {
    console.warn('showImmediateNotification failed:', e);
  }
}
