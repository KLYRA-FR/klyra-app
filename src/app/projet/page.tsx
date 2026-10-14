import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjectScreen } from "@/components/project/ProjectScreen";

export const metadata: Metadata = { title: "Projet — KLYRA" };

/** `/projet?id=…` : l’id passe en paramètre, compatible avec l’export statique. */
export default function ProjectPage() {
  return (
    <Suspense>
      <ProjectScreen />
    </Suspense>
  );
}
