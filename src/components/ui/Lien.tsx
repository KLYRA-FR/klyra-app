"use client";

import type { ReactNode } from "react";
import { getBridge } from "@/lib/bridge";

/** Une adresse locale : le serveur de dev d'un projet, sur ce Mac. */
export const LOCAL = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/;

/** « localhost:3002 » → « http://localhost:3002 ». */
export function versUrl(adresse: string): string {
  return /^https?:\/\//.test(adresse) ? adresse : `http://${adresse}`;
}

/** Ce qu'un écran reçoit quand on clique un lien local : il le prend (aperçu) en mettant `pris` à vrai. */
export interface DemandeApercu {
  url: string;
  pris: boolean;
}

/**
 * Ouvre un lien local dans l'app : dans l'aperçu de la conversation s'il y en
 * a un, sinon dans une fenêtre de l'app. Les autres liens vont au navigateur.
 */
export function ouvrirLien(adresse: string) {
  const url = versUrl(adresse);
  if (!LOCAL.test(adresse)) {
    window.open(url, "_blank", "noreferrer");
    return;
  }
  const demande: DemandeApercu = { url, pris: false };
  window.dispatchEvent(new CustomEvent<DemandeApercu>("klyra:apercu", { detail: demande }));
  if (demande.pris) return;
  const bridge = getBridge();
  if (bridge) void bridge.fenetres.ouvrir(url);
  else window.open(url, "_blank", "noreferrer");
}

/** Un lien dans le texte d'un agent : souligné, il s'ouvre au clic (cf. ouvrirLien). */
export function Lien({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={versUrl(href)}
      onClick={(e) => {
        e.preventDefault();
        ouvrirLien(href);
      }}
      title={LOCAL.test(href) ? "Ouvrir dans l’app" : "Ouvrir dans le navigateur"}
      className="text-texte-accent underline decoration-current/40 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-current"
    >
      {children}
    </a>
  );
}
