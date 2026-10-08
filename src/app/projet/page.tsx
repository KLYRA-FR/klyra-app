import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/ComingSoon";

export const metadata: Metadata = { title: "Fiche projet — KLYRA" };

export default function ProjectPage() {
  return <ComingSoon title="Fiche projet" description="Brief, chats du projet, rôles attribués et liens arrivent bientôt." />;
}
