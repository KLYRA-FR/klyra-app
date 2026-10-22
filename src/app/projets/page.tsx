import type { Metadata } from "next";
import { Suspense } from "react";
import { ProjetsScreen } from "@/components/project/ProjetsScreen";

export const metadata: Metadata = { title: "Projets — KLYRA" };

/** `/projets`, `/projets?nouveau=1`, `/projets?modifier=<id>`. */
export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjetsScreen />
    </Suspense>
  );
}
