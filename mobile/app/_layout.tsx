import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { I18nProvider } from '@/i18n'
import { color } from '@/ui/theme'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: color.elevated },
            headerTitleStyle: { fontSize: 17, fontWeight: '600', color: color.text },
            headerTintColor: color.blue,
            contentStyle: { backgroundColor: color.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="suivi" options={{ title: 'VisaFlow' }} />
          <Stack.Screen name="dossier/[id]" options={{ title: '' }} />
          <Stack.Screen name="cargaison/[id]" options={{ title: '' }} />
          <Stack.Screen name="reglages" options={{ presentation: 'modal', title: '' }} />
        </Stack>
      </I18nProvider>
    </SafeAreaProvider>
  )
}
