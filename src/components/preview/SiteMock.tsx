import { Badge, Button, Stack, cn } from "klyra-ui";

/**
 * Maquette fil de fer du site en cours (phase front).
 * Sera remplacée par le vrai site lancé en local dans une webview.
 */
export function SiteMock({ device, modifiedLabel }: { device: "desktop" | "mobile"; modifiedLabel: string | null }) {
  const mobile = device === "mobile";
  return (
    <div inert className="flex h-full flex-col gap-6 overflow-hidden bg-white px-6 py-5">
      {/* Navigation du site */}
      <div className="flex items-center gap-4">
        <span className="text-ui-s font-semibold">bizwhoo</span>
        {!mobile && (
          <Stack direction="row" gap={16} className="ml-auto text-ui-2xs text-fg-3">
            <span>Offre</span>
            <span>Clients</span>
            <span>Blog</span>
          </Stack>
        )}
        <span className={cn("h-6 w-14 rounded-pill bg-ink", mobile && "ml-auto")} />
      </div>

      {/* Hero modifiée */}
      <div className="relative rounded-md border-[1.5px] border-dashed border-ink p-3 pt-5">
        {modifiedLabel && (
          <Badge variant="ink" size="sm" className="klyra-mono absolute -top-2.5 left-2 rounded-xs">
            {modifiedLabel}
          </Badge>
        )}
        <div className={cn("flex gap-4", mobile && "flex-col")}>
          <Stack gap={14} className="flex-1 justify-center">
            <p className="m-0 text-h4 leading-[1.15] tracking-[-0.0325em]">
              <span className="font-semibold">Le titre de la hero</span>
              <br />
              <span className="font-normal">sur deux lignes.</span>
            </p>
            <Stack gap={6}>
              <span className="h-2 w-[85%] rounded-xs bg-blue-mist" />
              <span className="h-2 w-[70%] rounded-xs bg-blue-mist" />
              <span className="h-2 w-[78%] rounded-xs bg-blue-mist" />
            </Stack>
            <Stack direction="row" gap={8} wrap>
              <Button variant="dark" size="sm">Prendre rendez-vous</Button>
              <Button variant="ghost" size="sm">Voir les projets</Button>
            </Stack>
          </Stack>
          <div
            className={cn(
              "klyra-mono flex items-center justify-center rounded-md bg-surface-3 text-ui-3xs text-fg-3",
              mobile ? "h-40" : "w-[38%] min-h-[220px]",
            )}
          >
            vidéo
          </div>
        </div>
      </div>

      {/* Logos clients */}
      <div className="flex justify-between gap-3 border-t border-border-1 pt-5">
        {Array.from({ length: mobile ? 3 : 5 }, (_, i) => (
          <span key={i} className="h-3.5 flex-1 rounded-xs bg-surface-3" />
        ))}
      </div>

      {/* Cartes */}
      <div className={cn("grid gap-3", mobile ? "grid-cols-1" : "grid-cols-3")}>
        {Array.from({ length: 3 }, (_, i) => (
          <Stack key={i} gap={8}>
            <span className="h-32 rounded-md bg-surface-2" />
            <span className="h-2 w-2/3 rounded-xs bg-blue-mist" />
            <span className="h-2 w-1/2 rounded-xs bg-surface-3" />
          </Stack>
        ))}
      </div>
    </div>
  );
}
