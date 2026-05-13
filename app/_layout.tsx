import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { configureNotifications, registerForPushNotifications, savePushToken } from '@/lib/notifications';
import { I18nProvider } from '@/lib/i18n';
import { Logger } from '@/lib/logger';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// Configure notification defaults
configureNotifications();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <RootLayoutNav />
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { session, user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Check notification permission on every app start
  useEffect(() => {
    if (!session || !user) return;

    (async () => {
      const token = await registerForPushNotifications();
      if (token) {
        await savePushToken(user.id, token);
      } else {
        Logger.warn('notifications', 'Permission not granted, prompting user');
        Alert.alert(
          'Benachrichtigungen deaktiviert',
          'LoveNotes braucht Benachrichtigungen, um dir neue Nachrichten zu zeigen. Bitte aktiviere sie in den Einstellungen.',
          [
            { text: 'Später', style: 'cancel' },
            {
              text: 'Einstellungen öffnen',
              onPress: () => {
                if (Platform.OS === 'ios') {
                  Linking.openURL('app-settings:');
                } else {
                  Linking.openSettings();
                }
              },
            },
          ]
        );
      }
    })();
  }, [session, user]);

  // Redirect based on auth state
  useEffect(() => {
    if (isLoading) return;

    const inAuthScreen = segments[0] === 'auth';

    if (!session && !inAuthScreen) {
      // Not signed in → redirect to auth
      router.replace('/auth');
    } else if (session && inAuthScreen) {
      // Signed in → redirect to main app
      router.replace('/');
    }
  }, [session, isLoading, segments]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="contact/[id]"
          options={{
            title: 'Kontakt',
            presentation: 'card',
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
