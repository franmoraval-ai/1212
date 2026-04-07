import type {Metadata, Viewport} from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { SupabaseProvider } from "@/supabase";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";
import { OfflineSync } from "@/components/offline/offline-sync";

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'HO SEGURIDAD | Mando y Control',
  description: 'Sistema Operativo de Seguridad Táctica - Nivel 4',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'HO Seguridad',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: '#22c55e',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <head />
      <body className={`${inter.className} font-body antialiased bg-background text-foreground`}>
        <SupabaseProvider>
          <RegisterServiceWorker />
          <OfflineSync />
          {children}
          <Toaster />
        </SupabaseProvider>
      </body>
    </html>
  );
}
