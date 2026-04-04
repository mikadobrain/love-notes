import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Switch,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n';
import {
  getOutgoingNotesForRecipient,
  insertOutgoingNote,
  deleteOutgoingNote,
  markOutgoingNoteSynced,
  getConnectionByUserId,
  OutgoingNote,
  CachedConnection,
} from '@/lib/db';
import { sendNote } from '@/lib/sync';
import { Logger } from '@/lib/logger';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { v4 as uuidv4 } from 'uuid';

const CHIP_KEYS = ['contact.chip.0', 'contact.chip.1', 'contact.chip.2', 'contact.chip.3'];

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [connection, setConnection] = useState<CachedConnection | null>(null);
  const [notes, setNotes] = useState<OutgoingNote[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!id) return;
    Logger.debug('contact', 'loadData', { contactId: id });
    try {
      const conn = await getConnectionByUserId(id);
      setConnection(conn);
      Logger.debug('contact', 'loadData: connection loaded', {
        displayName: conn?.display_name,
        hasPublicKey: !!conn?.public_key,
        keyPrefix: conn?.public_key?.substring(0, 10),
      });

      const outgoing = await getOutgoingNotesForRecipient(id);
      setNotes(outgoing);
      Logger.debug('contact', 'loadData: notes loaded', { count: outgoing.length });
    } catch (err) {
      Logger.error('contact', 'loadData: failed', {
        error: err instanceof Error ? err.message : String(err),
        contactId: id,
      });
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    Logger.debug('contact', 'ContactDetailScreen mounted', { contactId: id });
    loadData();
  }, [loadData]);

  async function handleSend() {
    if (!newMessage.trim() || !connection || !profile) return;

    Logger.debug('contact', 'handleSend: initiated', {
      recipientId: id,
      recipientName: connection.display_name,
      isAnonymous,
      messageLength: newMessage.trim().length,
      hasPublicKey: !!connection.public_key,
    });

    if (!connection.public_key) {
      Logger.warn('contact', 'handleSend: recipient has no public key', {
        recipientId: id,
        recipientName: connection.display_name,
      });
      Alert.alert(
        t('contact.notReady.title'),
        t('contact.notReady.message', { name: connection.display_name })
      );
      return;
    }

    const message = newMessage.trim();
    if (message.length > 1000) {
      Logger.warn('contact', 'handleSend: message too long', { length: message.length });
      Alert.alert(t('contact.tooLong.title'), t('contact.tooLong.message'));
      return;
    }

    setIsSending(true);
    try {
      const noteId = uuidv4();
      const senderName = isAnonymous ? null : profile.display_name;

      Logger.debug('contact', 'handleSend: storing locally', { noteId, isAnonymous, senderName });
      await insertOutgoingNote({
        id: noteId,
        recipient_id: id!,
        recipient_name: connection.display_name,
        message,
        is_anonymous: isAnonymous,
        created_at: new Date().toISOString(),
      });
      Logger.debug('contact', 'handleSend: stored locally, sending to server...');

      const result = await sendNote(
        id!,
        connection.public_key,
        message,
        senderName
      );

      if (result.success) {
        await markOutgoingNoteSynced(noteId);
        Logger.info('contact', 'handleSend: success', {
          noteId,
          recipientId: id,
          recipientName: connection.display_name,
        });
        setNewMessage('');
        await loadData();
      } else {
        Logger.warn('contact', 'handleSend: server send failed (will retry on next sync)', {
          noteId,
          error: result.error,
          recipientId: id,
        });
        Alert.alert(
          t('contact.sendFailed.title'),
          result.error ?? t('contact.sendFailed.fallback')
        );
        await loadData();
      }
    } catch (err) {
      Logger.error('contact', 'handleSend: unexpected error', {
        error: err instanceof Error ? err.message : String(err),
        recipientId: id,
      });
      Alert.alert(t('contact.error.title'), t('contact.error.message'));
    } finally {
      setIsSending(false);
    }
  }

  async function handleDelete(noteId: string) {
    Logger.debug('contact', 'handleDelete: confirm dialog shown', { noteId });
    Alert.alert(t('contact.delete.title'), t('contact.delete.message'), [
      { text: t('contact.delete.cancel'), style: 'cancel' },
      {
        text: t('contact.delete.confirm'),
        style: 'destructive',
        onPress: async () => {
          Logger.info('contact', 'handleDelete: confirmed', { noteId });
          await deleteOutgoingNote(noteId);
          await loadData();
        },
      },
    ]);
  }

  function handleChipPress(chipKey: string) {
    const chipText = t(chipKey);
    setNewMessage(chipText);
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c8b" />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: connection?.display_name ?? t('contact.title'),
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={100}
      >
        {/* List of sent notes */}
        <FlatList
          data={notes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <FontAwesome name="pencil" size={48} color="#ccc" />
              <Text style={styles.emptyText}>
                {t('contact.emptyText', { name: connection?.display_name ?? '' })}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.noteCard}>
              <View style={styles.noteContent}>
                <Text style={styles.noteMessage}>{item.message}</Text>
                <View style={styles.noteMeta}>
                  <Text style={styles.noteMetaText}>
                    {item.is_anonymous ? t('contact.anonymous') : t('contact.withName')}
                  </Text>
                  {!item.synced && (
                    <Text style={styles.unsyncedBadge}>{t('contact.notSynced')}</Text>
                  )}
                </View>
              </View>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDelete(item.id)}
              >
                <FontAwesome name="trash-o" size={18} color="#f44336" />
              </TouchableOpacity>
            </View>
          )}
        />

        {/* Compose area – paddingBottom keeps it above gesture nav bar */}
        <View style={[styles.composeArea, { paddingBottom: insets.bottom + 12 }]}>
          {!connection?.public_key && (
            <View style={styles.noKeyBanner}>
              <FontAwesome name="lock" size={14} color="#e67e22" />
              <Text style={styles.noKeyText}>
                {t('contact.noKey', { name: connection?.display_name ?? '' })}
              </Text>
            </View>
          )}

          {/* Prompt chips */}
          <View style={styles.chipsContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsScroll}
            >
              {CHIP_KEYS.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.chip,
                    newMessage === t(key) && styles.chipActive,
                  ]}
                  onPress={() => handleChipPress(key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, newMessage === t(key) && styles.chipTextActive]}>
                    {t(key)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={styles.anonymousToggle}>
            <Text style={styles.anonymousLabel}>{t('contact.anonymousLabel')}</Text>
            <Switch
              value={isAnonymous}
              onValueChange={(v) => {
                Logger.debug('contact', 'anonymity toggled', { isAnonymous: v });
                setIsAnonymous(v);
              }}
              trackColor={{ false: '#ddd', true: '#e74c8b' }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={t('contact.placeholder')}
              placeholderTextColor="#999"
              value={newMessage}
              onChangeText={setNewMessage}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity
              style={[styles.sendButton, (!newMessage.trim() || isSending) && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!newMessage.trim() || isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <FontAwesome name="paper-plane" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
    paddingBottom: 8,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.5,
    marginTop: 16,
    paddingHorizontal: 20,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f0f8ff',
    marginBottom: 8,
  },
  noteContent: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  noteMessage: {
    fontSize: 16,
    lineHeight: 22,
    color: '#333',
  },
  noteMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
    backgroundColor: 'transparent',
  },
  noteMetaText: {
    fontSize: 12,
    color: '#999',
  },
  unsyncedBadge: {
    fontSize: 11,
    color: '#ff9800',
    fontWeight: '600',
  },
  deleteButton: {
    padding: 8,
    marginLeft: 8,
  },
  composeArea: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  chipsContainer: {
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  chipsScroll: {
    gap: 8,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#fafafa',
  },
  chipActive: {
    borderColor: '#e74c8b',
    backgroundColor: '#fff0f5',
  },
  chipText: {
    fontSize: 13,
    color: '#888',
  },
  chipTextActive: {
    color: '#e74c8b',
    fontWeight: '600',
  },
  anonymousToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
    backgroundColor: 'transparent',
  },
  anonymousLabel: {
    fontSize: 14,
    color: '#666',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
    backgroundColor: '#f9f9f9',
    color: '#333',
  },
  sendButton: {
    backgroundColor: '#e74c8b',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  noKeyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff8f0',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f0c080',
  },
  noKeyText: {
    flex: 1,
    fontSize: 13,
    color: '#e67e22',
  },
});
