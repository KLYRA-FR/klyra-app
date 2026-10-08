import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/ComingSoon";

export const metadata: Metadata = { title: "Projets — KLYRA" };

export default function ProjectsPage() {
  return <ComingSoon title="Projets" description="Le tableau des projets arrive bientôt." />;
}
