import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Crypto from 'expo-crypto';
import { Text, View } from '@/components/Themed';
import { useAuth } from '@/lib/auth-context';
import { supabase, Connection } from '@/lib/supabase';
import { Logger } from '@/lib/logger';
import FontAwesome from '@expo/vector-icons/FontAwesome';

type ConnectionRequest = Connection & {
  requester_profile?: { display_name: string };
  target_profile?: { display_name: string };
};

type FoundProfile = {
  id: string;
  display_name: string;
};

export default function RequestsScreen() {
  const { user } = useAuth();
  const [incoming, setIncoming] = useState<ConnectionRequest[]>([]);
  const [outgoing, setOutgoing] = useState<ConnectionRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [searchEmail, setSearchEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [foundProfile, setFoundProfile] = useState<FoundProfile | null>(null);
  const [searchError, setSearchError] = useState('');
  const [isSendingRequest, setIsSendingRequest] = useState(false);

  const loadRequests = useCallback(async () => {
    if (!user) return;
    Logger.debug('requests', 'loadRequests: fetching from Supabase...', { userId: user.id });
    try {
      const { data: incomingData, error: inErr } = await supabase
        .from('connections')
        .select('*, requester_profile:profiles!connections_requester_id_fkey(display_name)')
        .eq('target_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (inErr) {
        Logger.error('requests', 'loadRequests: incoming fetch error', { error: inErr.message });
      }

      const { data: outgoingData, error: outErr } = await supabase
        .from('connections')
        .select('*, target_profile:profiles!connections_target_id_fkey(display_name)')
        .eq('requester_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (outErr) {
        Logger.error('requests', 'loadRequests: outgoing fetch error', { error: outErr.message });
      }

      setIncoming((incomingData as ConnectionRequest[]) ?? []);
      setOutgoing((outgoingData as ConnectionRequest[]) ?? []);
      Logger.debug('requests', 'loadRequests: done', {
        incoming: incomingData?.length ?? 0,
        outgoing: outgoingData?.length ?? 0,
      });
    } catch (err) {
      Logger.error('requests', 'loadRequests: unexpected error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const handleRefresh = useCallback(async () => {
    Logger.debug('requests', 'handleRefresh: triggered');
    setIsRefreshing(true);
    await loadRequests();
    setIsRefreshing(false);
  }, [loadRequests]);

  useEffect(() => {
    Logger.debug('requests', 'RequestsScreen mounted');
    loadRequests();
  }, [loadRequests]);

  async function handleAccept(connectionId: string) {
    Logger.info('requests', 'handleAccept', { connectionId });
    const { error } = await supabase
      .from('connections')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', connectionId);

    if (error) {
      Logger.error('requests', 'handleAccept: failed', { error: error.message, connectionId });
      Alert.alert('Fehler', 'Verbindungsanfrage konnte nicht angenommen werden.');
    } else {
      Logger.info('requests', 'handleAccept: accepted', { connectionId });
      await loadRequests();
    }
  }

  async function handleReject(connectionId: string) {
    Logger.info('requests', 'handleReject: confirm dialog shown', { connectionId });
    Alert.alert('Anfrage ablehnen', 'Möchtest du diese Anfrage wirklich ablehnen?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Ablehnen',
        style: 'destructive',
        onPress: async () => {
          Logger.info('requests', 'handleReject: confirmed', { connectionId });
          const { error } = await supabase
            .from('connections')
            .update({ status: 'rejected', updated_at: new Date().toISOString() })
            .eq('id', connectionId);

          if (error) {
            Logger.error('requests', 'handleReject: failed', { error: error.message, connectionId });
            Alert.alert('Fehler', 'Anfrage konnte nicht abgelehnt werden.');
          } else {
            Logger.info('requests', 'handleReject: rejected', { connectionId });
            await loadRequests();
          }
        },
      },
    ]);
  }

  async function handleSearch() {
    const email = searchEmail.trim().toLowerCase();
    if (!email) return;

    Logger.info('requests', 'handleSearch: searching by email hash', { email });
    setIsSearching(true);
    setFoundProfile(null);
    setSearchError('');

    try {
      const emailHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        email
      );
      Logger.debug('requests', 'handleSearch: email hashed, querying profiles...');

      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name')
        .eq('email_hash', emailHash)
        .single();

      if (error || !data) {
        Logger.warn('requests', 'handleSearch: no profile found', { error: error?.message });
        setSearchError('Kein Nutzer mit dieser E-Mail gefunden.');
        return;
      }

      Logger.debug('requests', 'handleSearch: profile found', {
        id: data.id,
        displayName: data.display_name,
      });

      if (data.id === user?.id) {
        Logger.debug('requests', 'handleSearch: user searched for themselves');
        setSearchError('Das bist du selbst 😄');
        return;
      }

      // Check if a connection already exists
      const { data: existing, error: existErr } = await supabase
        .from('connections')
        .select('id, status')
        .or(
          `and(requester_id.eq.${user?.id},target_id.eq.${data.id}),and(requester_id.eq.${data.id},target_id.eq.${user?.id})`
        )
        .maybeSingle();

      if (existErr) {
        Logger.warn('requests', 'handleSearch: existing connection check error', { error: existErr.message });
      }

      Logger.debug('requests', 'handleSearch: existing connection check', {
        exists: !!existing,
        status: existing?.status,
      });

      if (existing) {
        if (existing.status === 'accepted') {
          setSearchError(`Du bist bereits mit ${data.display_name} verbunden.`);
        } else if (existing.status === 'pending') {
          setSearchError(`Anfrage an ${data.display_name} ist bereits ausstehend.`);
        } else {
          setFoundProfile(data);
        }
        return;
      }

      setFoundProfile(data);
      Logger.info('requests', 'handleSearch: profile ready to connect', { displayName: data.display_name });
    } catch (e) {
      Logger.error('requests', 'handleSearch: unexpected error', {
        error: e instanceof Error ? e.message : String(e),
      });
      setSearchError('Fehler bei der Suche. Bitte versuche es erneut.');
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSendRequest() {
    if (!foundProfile || !user) return;

    Logger.info('requests', 'handleSendRequest: sending connection request', {
      targetId: foundProfile.id,
      targetName: foundProfile.display_name,
    });
    setIsSendingRequest(true);
    try {
      const { error } = await supabase.from('connections').insert({
        requester_id: user.id,
        target_id: foundProfile.id,
        status: 'pending',
      });

      if (error) {
        Logger.error('requests', 'handleSendRequest: failed', {
          error: error.message,
          code: error.code,
          targetId: foundProfile.id,
        });
        Alert.alert('Fehler', 'Anfrage konnte nicht gesendet werden: ' + error.message);
      } else {
        Logger.info('requests', 'handleSendRequest: success', {
          targetId: foundProfile.id,
          targetName: foundProfile.display_name,
        });
        Alert.alert('Gesendet! ✉️', `Verbindungsanfrage an ${foundProfile.display_name} wurde gesendet.`);
        setFoundProfile(null);
        setSearchEmail('');
        await loadRequests();
      }
    } catch (e) {
      Logger.error('requests', 'handleSendRequest: unexpected error', {
        error: e instanceof Error ? e.message : String(e),
      });
      Alert.alert('Fehler', 'Unbekannter Fehler. Bitte versuche es erneut.');
    } finally {
      setIsSendingRequest(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#e74c8b" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Find User ─────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nutzer suchen</Text>
          <View style={styles.searchCard}>
            <Text style={styles.searchHint}>
              Gib die E-Mail-Adresse eines anderen LoveNotes-Nutzers ein, um eine Verbindungsanfrage zu senden.
            </Text>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="E-Mail-Adresse"
                placeholderTextColor="#aaa"
                value={searchEmail}
                onChangeText={(t) => {
                  setSearchEmail(t);
                  setFoundProfile(null);
                  setSearchError('');
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="search"
                onSubmitEditing={handleSearch}
              />
              <TouchableOpacity
                style={styles.searchButton}
                onPress={handleSearch}
                disabled={isSearching || !searchEmail.trim()}
              >
                {isSearching ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <FontAwesome name="search" size={18} color="#fff" />
                )}
              </TouchableOpacity>
            </View>

            {searchError ? (
              <Text style={styles.searchError}>{searchError}</Text>
            ) : null}

            {foundProfile ? (
              <View style={styles.foundProfile}>
                <View style={styles.foundAvatar}>
                  <Text style={styles.avatarText}>
                    {foundProfile.display_name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.foundName}>{foundProfile.display_name}</Text>
                <TouchableOpacity
                  style={styles.sendRequestButton}
                  onPress={handleSendRequest}
                  disabled={isSendingRequest}
                >
                  {isSendingRequest ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <FontAwesome name="user-plus" size={14} color="#fff" />
                      <Text style={styles.sendRequestText}>Anfrage senden</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Incoming requests ─────────────────────── */}
        {incoming.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Eingehende Anfragen</Text>
            {incoming.map((item) => (
              <View key={item.id} style={styles.requestItem}>
                <View style={styles.requestInfo}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {(item.requester_profile?.display_name ?? '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.requestName}>
                    {item.requester_profile?.display_name ?? 'Unbekannt'}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => handleAccept(item.id)}
                  >
                    <FontAwesome name="check" size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.rejectButton}
                    onPress={() => handleReject(item.id)}
                  >
                    <FontAwesome name="times" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Outgoing requests ─────────────────────── */}
        {outgoing.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Gesendete Anfragen</Text>
            {outgoing.map((item) => (
              <View key={item.id} style={styles.requestItem}>
                <View style={styles.requestInfo}>
                  <View style={styles.avatarOutgoing}>
                    <Text style={styles.avatarText}>
                      {(item.target_profile?.display_name ?? '?').charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: 'transparent' }}>
                    <Text style={styles.requestName}>
                      {item.target_profile?.display_name ?? 'Unbekannt'}
                    </Text>
                    <Text style={styles.pendingLabel}>Ausstehend...</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {incoming.length === 0 && outgoing.length === 0 && (
          <View style={styles.emptyHint}>
            <FontAwesome name="user-plus" size={40} color="#ddd" />
            <Text style={styles.emptyText}>
              Noch keine Anfragen. Suche oben nach einem Nutzer, um eine Verbindung zu starten.
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  section: { marginBottom: 24 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },

  searchCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
  },
  searchHint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'transparent',
  },
  searchInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: '#fff',
    color: '#000',
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#e74c8b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchError: {
    marginTop: 10,
    fontSize: 14,
    color: '#e74c8b',
  },
  foundProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
    gap: 10,
  },
  foundAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e74c8b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  foundName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  sendRequestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#e74c8b',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  sendRequestText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },

  requestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: '#f9f9f9',
  },
  requestInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    backgroundColor: 'transparent',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e74c8b',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarOutgoing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#999',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  requestName: { fontSize: 16, fontWeight: '500' },
  pendingLabel: { fontSize: 13, color: '#999', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, backgroundColor: 'transparent' },
  acceptButton: {
    backgroundColor: '#4CAF50',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectButton: {
    backgroundColor: '#f44336',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },

  emptyHint: {
    alignItems: 'center',
    padding: 16,
    gap: 12,
    backgroundColor: 'transparent',
  },
  emptyText: {
    fontSize: 14,
    color: '#aaa',
    textAlign: 'center',
  },
});
