import type { Metadata } from "next";
import { ArtefactsScreen } from "@/components/artefacts/ArtefactsScreen";

export const metadata: Metadata = { title: "Artefacts — KLYRA" };

export default function ArtefactsPage() {
  return <ArtefactsScreen />;
}
