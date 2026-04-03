import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Text, View } from '../components/Themed';
import { useAuth } from '../lib/auth-context';

export default function AuthScreen() {
  const { signInWithEmail, signUpWithEmail } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Fehler', 'Bitte E-Mail und Passwort eingeben.');
      return;
    }

    if (!isLogin && !displayName.trim()) {
      Alert.alert('Fehler', 'Bitte einen Anzeigenamen eingeben.');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Fehler', 'Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }

    setIsLoading(true);
    try {
      if (isLogin) {
        const { error } = await signInWithEmail(email.trim(), password);
        if (error) {
          Alert.alert('Anmeldung fehlgeschlagen', error.message);
        }
      } else {
        const { error } = await signUpWithEmail(email.trim(), password, displayName.trim());
        if (error) {
          Alert.alert('Registrierung fehlgeschlagen', error.message);
        } else {
          Alert.alert(
            'Registrierung erfolgreich',
            'Bitte bestätige deine E-Mail-Adresse, um dich anzumelden.'
          );
          setIsLogin(true);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.logo}>LoveNotes</Text>
          <Text style={styles.subtitle}>
            Teile Wertschätzung mit den Menschen, die dir wichtig sind
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formTitle}>
            {isLogin ? 'Anmelden' : 'Registrieren'}
          </Text>

          {!isLogin && (
            <TextInput
              style={styles.input}
              placeholder="Anzeigename"
              placeholderTextColor="#999"
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              autoCorrect={false}
            />
          )}

          <TextInput
            style={styles.input}
            placeholder="E-Mail"
            placeholderTextColor="#999"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={styles.input}
            placeholder="Passwort"
            placeholderTextColor="#999"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {isLogin ? 'Anmelden' : 'Registrieren'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => setIsLogin(!isLogin)}
          >
            <Text style={styles.switchText}>
              {isLogin
                ? 'Noch kein Konto? Jetzt registrieren'
                : 'Bereits ein Konto? Anmelden'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 42,
    fontWeight: '700',
    color: '#e74c8b',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 12,
    opacity: 0.7,
    paddingHorizontal: 20,
  },
  form: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  formTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
    backgroundColor: '#f9f9f9',
    color: '#333',
  },
  button: {
    backgroundColor: '#e74c8b',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  switchButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  switchText: {
    color: '#e74c8b',
    fontSize: 15,
  },
});
