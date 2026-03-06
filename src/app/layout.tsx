import type {Metadata} from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { SupabaseProvider } from "@/supabase";
import { RegisterServiceWorker } from "@/components/pwa/register-service-worker";
import { OfflineSync } from "@/components/offline/offline-sync";

const inter = Inter({ subsets: ['latin'] });

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'HO SEGURIDAD | Mando y Control',
  description: 'Sistema Operativo de Seguridad Táctica - Nivel 4',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <head>
        <link href="https://api.mapbox.com/mapbox-gl-js/v3.1.2/mapbox-gl.css" rel="stylesheet" />
      </head>
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
