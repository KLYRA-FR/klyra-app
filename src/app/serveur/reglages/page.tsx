import type { Metadata } from "next";
import { Suspense } from "react";
import { ReglagesServeurScreen } from "@/components/serveur/ReglagesServeurScreen";

export const metadata: Metadata = { title: "Réglages du serveur — KLYRA" };

export default function ReglagesServeurPage() {
  return (
    <Suspense>
      <ReglagesServeurScreen />
    </Suspense>
  );
}
