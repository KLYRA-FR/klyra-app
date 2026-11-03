import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Les logos officiels des fournisseurs (public/logos/ia, tirés de @lobehub/icons-static-svg 1.102.0, MIT) :
 * les moteurs (`claude`, `codex`) et les IA à consulter (cf. electron/ia.ts). Ni « autre » ni une IA
 * inconnue n'en ont : on écrit leur initiale.
 */
const LOGOS: Record<string, string> = {
  claude: "claude",
  codex: "openai",
  openai: "openai",
  gemini: "gemini",
  mistral: "mistral",
  deepseek: "deepseek",
  xai: "grok",
  openrouter: "openrouter",
};

/** Le carré du fournisseur `id` : son logo, sinon `initiale`. Décoratif : son nom est écrit à côté. */
export function LogoFournisseur({ id, initiale, taille = 32, className }: { id: string; initiale: string; taille?: number; className?: string }) {
  const logo = LOGOS[id];
  return (
    <span
      aria-hidden="true"
      style={{ width: taille, height: taille }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-sm font-semibold text-texte-principal",
        logo ? "border border-bordure-subtile bg-fond-surface" : "bg-fond-surface-grise",
        taille < 24 ? "rounded-2xs text-ui-3xs" : "text-ui-s",
        className,
      )}
    >
      {logo ? <Image src={`/logos/ia/${logo}.svg`} alt="" width={Math.round(taille * 0.6)} height={Math.round(taille * 0.6)} /> : initiale}
    </span>
  );
}
