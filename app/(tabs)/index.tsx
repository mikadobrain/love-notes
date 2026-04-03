import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { getAcceptedConnections, CachedConnection } from '@/lib/db';
import { syncConnections } from '@/lib/sync';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function ContactsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [connections, setConnections] = useState<CachedConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadConnections = useCallback(async () => {
    try {
      const cached = await getAcceptedConnections();
      setConnections(cached);
    } catch (err) {
      console.error('Error loading connections:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!user) return;
    setIsRefreshing(true);
    try {
      await syncConnections(user.id);
      await loadConnections();
    } finally {
      setIsRefreshing(false);
    }
  }, [user, loadConnections]);

  useEffect(() => {
    loadConnections();
    // Also sync from server on mount
    if (user) {
      syncConnections(user.id).then(loadConnections);
    }
  }, [user]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c8b" />
      </View>
    );
  }

  if (connections.length === 0) {
    return (
      <View style={styles.centered}>
        <FontAwesome name="users" size={64} color="#ccc" />
        <Text style={styles.emptyTitle}>Noch keine Verbindungen</Text>
        <Text style={styles.emptyText}>
          Lade Freunde ein, die App zu nutzen, oder nimm Verbindungsanfragen an.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={connections}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.contactItem}
            onPress={() => router.push(`/contact/${item.user_id}`)}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {item.display_name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.contactInfo}>
              <Text style={styles.contactName}>{item.display_name}</Text>
            </View>
            <FontAwesome name="chevron-right" size={16} color="#ccc" />
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'transparent',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#e74c8b',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  contactInfo: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  contactName: {
    fontSize: 17,
    fontWeight: '500',
  },
  separator: {
    height: 1,
    backgroundColor: '#eee',
    marginLeft: 76,
  },
});
