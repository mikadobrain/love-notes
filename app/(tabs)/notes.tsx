import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { getAllIncomingNotes, IncomingNote } from '@/lib/db';
import { fetchAndProcessMessages, syncConnections } from '@/lib/sync';
import { scheduleRandomNoteNotification } from '@/lib/notifications';
import { Logger } from '@/lib/logger';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function NotesScreen() {
  const { user, profile } = useAuth();
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState<IncomingNote[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fade animation for note transitions
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const loadNotes = useCallback(async () => {
    Logger.debug('notes', 'loadNotes: loading from local DB...');
    try {
      const allNotes = await getAllIncomingNotes();
      setNotes(allNotes);
      // Pick a random starting note each time
      if (allNotes.length > 0) {
        setCurrentIndex(Math.floor(Math.random() * allNotes.length));
      }
      Logger.debug('notes', 'loadNotes: done', { count: allNotes.length });
    } catch (err) {
      Logger.error('notes', 'loadNotes: failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    Logger.debug('notes', 'handleRefresh: triggered');
    setIsRefreshing(true);
    try {
      // Must sync connections first so we have the sender's public key
      // in the local cache before attempting decryption
      if (user) {
        Logger.debug('notes', 'handleRefresh: syncing connections for decryption keys...');
        await syncConnections(user.id, profile?.display_name);
      }

      Logger.debug('notes', 'handleRefresh: fetching messages from queue...');
      const processed = await fetchAndProcessMessages();
      Logger.info('notes', 'handleRefresh: done', { newMessages: processed });

      await loadNotes();

      // Schedule a notification for the newly arrived notes
      if (processed > 0) {
        await scheduleRandomNoteNotification();
        Logger.info('notes', `handleRefresh: ${processed} new note(s), notification scheduled`);
      }
    } catch (err) {
      Logger.error('notes', 'handleRefresh: failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [user, profile, loadNotes]);

  useEffect(() => {
    Logger.debug('notes', 'NotesScreen mounted');
    loadNotes();
  }, []);

  function showNextNote() {
    if (notes.length <= 1) return;
    // Fade out, pick new random index (not the same), fade in
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setCurrentIndex((prev) => {
        let next = Math.floor(Math.random() * notes.length);
        // Avoid showing the same note twice in a row
        if (notes.length > 1 && next === prev) next = (next + 1) % notes.length;
        return next;
      });
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    });
    Logger.debug('notes', 'showNextNote tapped');
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c8b" />
      </View>
    );
  }

  const currentNote: IncomingNote | undefined = notes[currentIndex];
  const dateLocale = language === 'de' ? 'de-DE' : 'en-US';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={handleRefresh}
          tintColor="#e74c8b"
          colors={['#e74c8b']}
        />
      }
    >
      {notes.length === 0 ? (
        /* ── Empty state ─────────────────────────────────── */
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>💌</Text>
          <Text style={styles.emptyTitle}>{t('notes.empty.title')}</Text>
          <Text style={styles.emptyHint}>{t('notes.empty.hint')}</Text>
          <Text style={styles.emptyPull}>{t('notes.empty.pull')}</Text>
        </View>
      ) : (
        /* ── Note card ───────────────────────────────────── */
        <>
          {/* Subtle counter – just a number, no content preview */}
          <View style={styles.counterRow}>
            <FontAwesome name="heart" size={14} color="#e74c8b" />
            <Text style={styles.counterText}>
              {notes.length === 1
                ? t('notes.counter.singular')
                : t('notes.counter.plural', { n: notes.length })}
            </Text>
          </View>

          <Animated.View style={[styles.noteCard, { opacity: fadeAnim }]}>
            {/* Quote marks */}
            <Text style={styles.quoteOpen}>"</Text>

            <Text style={styles.noteMessage}>{currentNote?.message}</Text>

            <Text style={styles.quoteClose}>"</Text>

            {/* Sender */}
            <View style={styles.senderRow}>
              <View style={styles.senderDivider} />
              <FontAwesome
                name={currentNote?.sender_name ? 'user' : 'user-secret'}
                size={13}
                color="#e74c8b"
                style={{ marginHorizontal: 8 }}
              />
              <Text style={styles.senderName}>
                {currentNote?.sender_name ?? t('notes.sender.anonymous')}
              </Text>
              <View style={styles.senderDivider} />
            </View>

            {/* Date */}
            <Text style={styles.noteDate}>
              {currentNote
                ? new Date(currentNote.received_at).toLocaleDateString(dateLocale, {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
                : ''}
            </Text>
          </Animated.View>

          {/* Next note button */}
          {notes.length > 1 && (
            <TouchableOpacity style={styles.nextButton} onPress={showNextNote} activeOpacity={0.7}>
              <FontAwesome name="random" size={16} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.nextButtonText}>{t('notes.next')}</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.pullHint}>{t('notes.pullHint')}</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* Empty state */
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  emptyEmoji: {
    fontSize: 64,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyPull: {
    marginTop: 24,
    fontSize: 13,
    color: '#ccc',
  },

  /* Counter */
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
    backgroundColor: 'transparent',
  },
  counterText: {
    fontSize: 13,
    color: '#e74c8b',
    fontWeight: '600',
  },

  /* Note card */
  noteCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 32,
    shadowColor: '#e74c8b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
    alignItems: 'center',
  },
  quoteOpen: {
    fontSize: 72,
    color: '#f8c0d8',
    lineHeight: 60,
    alignSelf: 'flex-start',
    marginBottom: -12,
    fontFamily: 'Georgia',
  },
  noteMessage: {
    fontSize: 20,
    lineHeight: 30,
    color: '#333',
    textAlign: 'center',
    fontStyle: 'italic',
    paddingHorizontal: 8,
  },
  quoteClose: {
    fontSize: 72,
    color: '#f8c0d8',
    lineHeight: 60,
    alignSelf: 'flex-end',
    marginTop: -12,
    fontFamily: 'Georgia',
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    width: '100%',
    backgroundColor: 'transparent',
  },
  senderDivider: {
    flex: 1,
    height: 1,
    backgroundColor: '#f0c0d8',
  },
  senderName: {
    fontSize: 14,
    color: '#e74c8b',
    fontWeight: '600',
  },
  noteDate: {
    fontSize: 12,
    color: '#bbb',
    marginTop: 10,
  },

  /* Next button */
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e74c8b',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 24,
    shadowColor: '#e74c8b',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  nextButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },

  pullHint: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 12,
    color: '#ccc',
  },
});
