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
import { Logger } from '@/lib/logger';
import { useI18n } from '@/lib/i18n';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function ContactsScreen() {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [connections, setConnections] = useState<CachedConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadConnections = useCallback(async () => {
    Logger.debug('contacts', 'loadConnections: loading from local cache...');
    try {
      const cached = await getAcceptedConnections();
      setConnections(cached);
      Logger.debug('contacts', 'loadConnections: done', { count: cached.length });
    } catch (err) {
      Logger.error('contacts', 'loadConnections: failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!user) return;
    Logger.debug('contacts', 'handleRefresh: pull-to-refresh triggered');
    setIsRefreshing(true);
    try {
      await syncConnections(user.id, profile?.display_name);
      await loadConnections();
      Logger.info('contacts', 'handleRefresh: done');
    } catch (err) {
      Logger.error('contacts', 'handleRefresh: failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [user, profile, loadConnections]);

  useEffect(() => {
    Logger.debug('contacts', 'ContactsScreen mounted, userId:', { userId: user?.id });
    loadConnections();
    if (user) {
      Logger.debug('contacts', 'starting background syncConnections...');
      syncConnections(user.id, profile?.display_name)
        .then(loadConnections)
        .catch((err) =>
          Logger.error('contacts', 'background syncConnections failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        );
    }
  }, [user, profile]);

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
        <Text style={styles.emptyTitle}>{t('contacts.empty.title')}</Text>
        <Text style={styles.emptyText}>{t('contacts.empty.text')}</Text>
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
            onPress={() => {
              Logger.debug('contacts', 'contact tapped', {
                userId: item.user_id,
                displayName: item.display_name,
              });
              router.push(`/contact/${item.user_id}`);
            }}
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
