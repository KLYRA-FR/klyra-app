import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import icone from "../../public/brand/logo-icone.svg";
import { googleSansFlex } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "KLYRA — ton équipe d’agents, sur ton poste", template: "%s · KLYRA" },
  description:
    "L’app de bureau KLYRA réunit tes conversations avec les agents, tes projets, tes tickets et tes routines, sur ton poste ou sur ton VPS.",
  icons: { icon: icone },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f9f9f9",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={googleSansFlex.variable}>
      <body>{children}</body>
    </html>
  );
}
