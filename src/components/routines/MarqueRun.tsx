import { Icon } from "@/components/icons/Icon";
import { PixelCheck } from "@/components/ui/PixelCheck";
import type { RoutineRun } from "@/types/routines";

/** Marque décorative : le libellé de l'exécution reste écrit à côté. */
export function MarqueRun({ run }: { run?: RoutineRun }) {
  if (!run) return null;
  if (run.missed) return <Icon name="clock-backward" size={14} className="text-icone-secondaire" />;
  switch (run.status) {
    case "running": return <Icon name="loader-01" size={14} className="text-icone-secondaire motion-safe:animate-spin" />;
    case "needs-attention": return <Icon name="bell-01" size={14} className="text-texte-accent" />;
    case "queued": return <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-dashed border-icone-secondaire" />;
    case "succeeded": return <PixelCheck className="h-3.5 w-[19px]" />;
    case "failed": return <span aria-hidden className="size-2 shrink-0 rounded-full bg-texte-erreur" />;
    case "interrupted": return <Icon name="stop-01" size={14} className="text-icone-secondaire" />;
    case "cancelled": return <Icon name="x-01" size={14} className="text-icone-secondaire" />;
  }
}
