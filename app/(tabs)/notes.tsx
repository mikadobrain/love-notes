import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { getAllIncomingNotes, IncomingNote } from '@/lib/db';
import { fetchAndProcessMessages } from '@/lib/sync';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function NotesScreen() {
  const [notes, setNotes] = useState<IncomingNote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadNotes = useCallback(async () => {
    try {
      const allNotes = await getAllIncomingNotes();
      setNotes(allNotes);
    } catch (err) {
      console.error('Error loading notes:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetchAndProcessMessages();
      await loadNotes();
    } finally {
      setIsRefreshing(false);
    }
  }, [loadNotes]);

  useEffect(() => {
    loadNotes();
  }, []);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c8b" />
      </View>
    );
  }

  if (notes.length === 0) {
    return (
      <View style={styles.centered}>
        <FontAwesome name="heart-o" size={64} color="#ccc" />
        <Text style={styles.emptyTitle}>Noch keine LoveNotes</Text>
        <Text style={styles.emptyText}>
          Wenn jemand dir eine nette Nachricht schickt, erscheint sie hier.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={notes}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.noteCard}>
            <View style={styles.noteHeader}>
              <FontAwesome
                name={item.sender_name ? 'user' : 'user-secret'}
                size={16}
                color="#e74c8b"
              />
              <Text style={styles.senderName}>
                {item.sender_name ?? 'Jemand'}
              </Text>
            </View>
            <Text style={styles.noteMessage}>{item.message}</Text>
            <Text style={styles.noteDate}>
              {new Date(item.received_at).toLocaleDateString('de-DE', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Text>
          </View>
        )}
      />
    </View>
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
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    textAlign: 'center',
    opacity: 0.6,
  },
  listContent: {
    padding: 16,
  },
  noteCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    backgroundColor: '#fff0f5',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    backgroundColor: 'transparent',
  },
  senderName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e74c8b',
    marginLeft: 8,
  },
  noteMessage: {
    fontSize: 17,
    lineHeight: 24,
    color: '#333',
  },
  noteDate: {
    fontSize: 12,
    color: '#999',
    marginTop: 12,
  },
});
