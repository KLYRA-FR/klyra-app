import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/ComingSoon";

export const metadata: Metadata = { title: "Fichiers — KLYRA" };

export default function FilesPage() {
  return <ComingSoon title="Fichiers" description="Le navigateur de fichiers façon Finder arrive bientôt." />;
}
