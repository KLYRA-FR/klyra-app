import type { Metadata } from "next";
import { ReglagesScreen } from "@/components/reglages/ReglagesScreen";

export const metadata: Metadata = { title: "Réglages — KLYRA" };

export default function SettingsPage() {
  return <ReglagesScreen />;
}
