import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { googleSansFlex } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "KLYRA",
  description: "L’app de bureau du studio : chat avec les rôles, projets et fichiers.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "KLYRA", statusBarStyle: "default" },
  /* L'écran d'accueil de l'iPhone : plein cadre, il arrondit lui-même (le manifest sert Android). */
  icons: { apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" } },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  /* La barre du système de l'app installée, couleur du fond (`fond-page`). */
  themeColor: "#f9f9f9",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${googleSansFlex.variable} h-full`}>
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
