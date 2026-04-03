import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { getSetting, setSetting } from '@/lib/db';
import { scheduleRandomNoteNotification } from '@/lib/notifications';
import { Logger } from '@/lib/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function SettingsScreen() {
  const { user, profile, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const [intervalHours, setIntervalHours] = useState(8);
  const [debugMode, setDebugMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    Logger.debug('settings', 'loadSettings: loading...');
    const interval = await getSetting('notification_interval_hours');
    if (interval) setIntervalHours(parseInt(interval, 10));

    const debug = await getSetting('debug_mode');
    const debugEnabled = debug === '1';
    setDebugMode(debugEnabled);
    // Apply immediately so the current session already uses the stored preference
    Logger.setDebugMode(debugEnabled);
    Logger.debug('settings', 'loadSettings: done', { intervalHours: interval, debugMode: debugEnabled });
  }

  async function handleIntervalChange(value: number) {
    const rounded = Math.round(value);
    Logger.debug('settings', 'handleIntervalChange', { rounded });
    setIntervalHours(rounded);
    setIsSaving(true);
    await setSetting('notification_interval_hours', rounded.toString());
    await scheduleRandomNoteNotification();
    setIsSaving(false);
    Logger.info('settings', 'notification interval updated', { intervalHours: rounded });
  }

  async function handleDebugModeToggle(value: boolean) {
    Logger.info('settings', `debug mode toggle → ${value}`);
    setDebugMode(value);
    await setSetting('debug_mode', value ? '1' : '0');
    Logger.setDebugMode(value);
    // Confirm in a log entry that is always sent (info is printed at debug-mode level)
    Logger.info('settings', `Debug mode is now ${value ? 'ON' : 'OFF'}`, {
      userId: user?.id,
      displayName: profile?.display_name,
    });
    if (value) {
      Alert.alert(
        'Debug-Modus aktiviert',
        'Alle Aktionen werden jetzt ausführlich geloggt – in der Konsole und in Supabase (app_logs).'
      );
    }
  }

  async function handleSignOut() {
    Logger.info('settings', 'sign out button tapped');
    Alert.alert('Abmelden', 'Möchtest du dich wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Abmelden',
        style: 'destructive',
        onPress: signOut,
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      {/* Profile Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profil</Text>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(profile?.display_name ?? '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{profile?.display_name ?? 'Unbekannt'}</Text>
            <Text style={styles.profileEmail}>{user?.email ?? ''}</Text>
          </View>
        </View>
      </View>

      {/* Notification Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Benachrichtigungen</Text>
        <View style={styles.settingCard}>
          <Text style={styles.settingLabel}>
            Intervall: {intervalHours} {intervalHours === 1 ? 'Stunde' : 'Stunden'}
          </Text>
          <Text style={styles.settingDescription}>
            Wie oft möchtest du eine zufällige LoveNote als Benachrichtigung erhalten?
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={1}
            maximumValue={24}
            step={1}
            value={intervalHours}
            onSlidingComplete={handleIntervalChange}
            minimumTrackTintColor="#e74c8b"
            maximumTrackTintColor="#ddd"
            thumbTintColor="#e74c8b"
          />
          <View style={styles.sliderLabels}>
            <Text style={styles.sliderLabel}>1h</Text>
            <Text style={styles.sliderLabel}>12h</Text>
            <Text style={styles.sliderLabel}>24h</Text>
          </View>
        </View>
      </View>

      {/* Debug Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Entwickler</Text>
        <View style={styles.settingCard}>
          <View style={styles.debugRow}>
            <View style={styles.debugTextGroup}>
              <Text style={styles.settingLabel}>Debug-Modus</Text>
              <Text style={styles.settingDescription}>
                Alle Aktionen werden ausführlich in der Konsole und in Supabase (app_logs) geloggt.
              </Text>
            </View>
            <Switch
              value={debugMode}
              onValueChange={handleDebugModeToggle}
              trackColor={{ false: '#ddd', true: '#e74c8b' }}
              thumbColor="#fff"
            />
          </View>
          {debugMode && (
            <View style={styles.debugActiveBadge}>
              <FontAwesome name="bug" size={12} color="#e74c8b" />
              <Text style={styles.debugActiveText}>Debug-Logging aktiv</Text>
            </View>
          )}
        </View>
      </View>

      {/* Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Info</Text>
        <View style={styles.settingCard}>
          <Text style={styles.infoText}>
            LoveNotes verschlüsselt alle Nachrichten Ende-zu-Ende.
            Nur du und der Absender können den Inhalt lesen.
          </Text>
        </View>
      </View>

      {/* Sign Out */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <FontAwesome name="sign-out" size={18} color="#f44336" />
        <Text style={styles.signOutText}>Abmelden</Text>
      </TouchableOpacity>

      <Text style={styles.version}>LoveNotes v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f9f9f9',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#e74c8b',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '600',
  },
  profileInfo: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
  },
  profileEmail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  settingCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f9f9f9',
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  sliderLabel: {
    fontSize: 12,
    color: '#999',
  },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    gap: 12,
  },
  debugTextGroup: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  debugActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#fff0f5',
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#f0c0d8',
  },
  debugActiveText: {
    fontSize: 12,
    color: '#e74c8b',
    fontWeight: '600',
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#666',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#fff0f0',
    marginBottom: 16,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f44336',
    marginLeft: 8,
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    color: '#ccc',
  },
});
