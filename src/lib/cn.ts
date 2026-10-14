import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Fusion de classes qui connaît les tokens de l'app. Sans ça, tailwind-merge
 * prend nos tailles de texte (`text-ui`, `text-body-s`…) pour des couleurs et
 * efface la couleur posée avant (texte noir sur un bouton sombre).
 * ALWAYS ce `cn`, jamais celui de klyra-ui.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: ["ui", "ui-s", "ui-xs", "ui-2xs", "ui-3xs", "body-l", "body", "body-s", "caption", "micro", "h1", "h2", "h3", "h4"],
        },
      ],
      shadow: [{ shadow: ["ombre-xs", "ombre-sm", "ombre-ambiante", "ombre-navbar", "ombre-md", "ombre-lg", "ombre-levee", "ombre-survol", "ombre-reflet"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
