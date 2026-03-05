/**
 * Configuración de Firebase.
 * En local: crear .env.local con las variables de tu proyecto (Firebase Console → Configuración).
 * Si no, puede aparecer auth/api-key-not-valid.
 */
export const firebaseConfig = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "poised-bot-488618-s3",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:29181931173:web:13de68464c1637aad6274c",
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "poised-bot-488618-s3.firebaseapp.com",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "29181931173",
}

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""
