import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import { googleSansFlex } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "KLYRA",
  description: "L’app de bureau du studio : chat avec les rôles, projets et fichiers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${googleSansFlex.variable} h-full`}>
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
