import { Stack } from "klyra-ui";
import { cn } from "@/lib/cn";

/**
 * Maquette fil de fer du site en cours (phase front).
 * Sera remplacée par le vrai site lancé en local dans une webview.
 */
export function SiteMock({ device, modifiedLabel }: { device: "desktop" | "mobile"; modifiedLabel: string | null }) {
  const mobile = device === "mobile";
  return (
    <div inert className="flex h-full flex-col gap-6 overflow-hidden bg-fond-surface px-6 py-5">
      {/* Navigation du site */}
      <div className="flex items-center gap-4">
        <span className="text-ui-s font-semibold">bizwhoo</span>
        {!mobile && (
          <Stack direction="row" gap={16} className="ml-auto text-ui-2xs text-texte-tertiaire">
            <span>Offre</span>
            <span>Clients</span>
            <span>Blog</span>
          </Stack>
        )}
        <span className={cn("h-6 w-14 rounded-xs bg-fond-inverse-fort", mobile && "ml-auto")} />
      </div>

      {/* Hero modifiée : zone touchée cernée en K1, étiquette au-dessus. */}
      <div className="relative rounded-md border-[1.5px] border-dashed border-focus p-3 pt-5">
        {modifiedLabel && (
          <span className="absolute -top-2.5 left-2 inline-flex items-center rounded-xs bg-fond-accent px-2 py-0.5 text-ui-3xs font-medium text-texte-inverse">
            {modifiedLabel}
          </span>
        )}
        <div className={cn("flex gap-4", mobile && "flex-col")}>
          <Stack gap={14} className="flex-1 justify-center">
            <p className="m-0 text-h4 leading-[1.25] tracking-[-0.0325em]">
              <span className="font-semibold">Le titre de la hero</span>
              <br />
              <span className="font-normal">sur deux lignes.</span>
            </p>
            <Stack gap={6}>
              <span className="h-2 w-[85%] rounded-[2px] bg-gris-k2-500" />
              <span className="h-2 w-[70%] rounded-[2px] bg-gris-k2-500" />
              <span className="h-2 w-[78%] rounded-[2px] bg-gris-k2-500" />
            </Stack>
            <Stack direction="row" gap={8} wrap>
              <span className="rounded-xs bg-fond-inverse-fort px-3 py-1.5 text-ui-2xs font-medium text-texte-inverse">
                Prendre rendez-vous
              </span>
              <span className="rounded-xs border border-bordure-forte px-3 py-1.5 text-ui-2xs font-medium">
                Voir les projets
              </span>
            </Stack>
          </Stack>
          <div
            className={cn(
              "flex items-center justify-center rounded-md bg-fond-surface-grise text-ui-3xs text-texte-tertiaire",
              mobile ? "h-40" : "w-[38%] min-h-[220px]",
            )}
          >
            vidéo
          </div>
        </div>
      </div>

      {/* Logos clients */}
      <div className="flex justify-between gap-3 border-t border-bordure-subtile pt-5">
        {Array.from({ length: mobile ? 3 : 5 }, (_, i) => (
          <span key={i} className="h-3.5 flex-1 rounded-[2px] bg-fond-surface-grise" />
        ))}
      </div>

      {/* Cartes */}
      <div className={cn("grid gap-3", mobile ? "grid-cols-1" : "grid-cols-3")}>
        {Array.from({ length: 3 }, (_, i) => (
          <Stack key={i} gap={8}>
            <span className="h-32 rounded-md bg-fond-survol" />
            <span className="h-2 w-2/3 rounded-[2px] bg-gris-k2-500" />
            <span className="h-2 w-1/2 rounded-[2px] bg-fond-surface-grise" />
          </Stack>
        ))}
      </div>
    </div>
  );
}
