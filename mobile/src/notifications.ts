import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

/* Les notifications poussees sont la seule vraie raison de faire une
   application plutot qu'une page web : un rappel WhatsApp coute de l'argent a
   chaque envoi, une notification n'en coute aucun. */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
})

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'VisaFlow',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#0066CC',
    })
  }

  const existing = await Notifications.getPermissionsAsync()
  let status = existing.status
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status
  }
  if (status !== 'granted') return null

  const token = await Notifications.getExpoPushTokenAsync()
  // A envoyer au serveur, associe au client : c'est lui qui declenchera
  // « votre piece est validee » ou « votre marchandise est arrivee au port ».
  return token.data
}
