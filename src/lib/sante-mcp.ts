"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBridge, type EntreeSanteMcp, type EtatMcp, type SanteMcpLieu } from "@/lib/bridge";

/**
 * Ce que l'écran montre de la veille des serveurs MCP des agents (cf. electron/mcp-veille.ts) : les connexions en
 * défaut, de ce PC et des VPS reliés, avec depuis quand. Règles pures, puis le hook qui suit le process principal.
 */

export interface DefautMcp extends EntreeSanteMcp {
  lieu: string | null;
}

export const enDefaut = (etat: EtatMcp) => etat === "authentification" || etat === "echec";

/** Les MCP en défaut, le plus ancien d'abord (il attend depuis le plus longtemps). */
export function defautsMcp(lieux: readonly SanteMcpLieu[]): DefautMcp[] {
  return lieux
    .flatMap((l) => (l.sante?.entrees ?? []).filter((e) => enDefaut(e.etat)).map((e) => ({ ...e, lieu: l.lieu })))
    .sort((a, b) => a.depuis - b.depuis || a.agent.localeCompare(b.agent) || a.mcp.localeCompare(b.mcp));
}

export function libelleEtat(etat: EtatMcp): string {
  if (etat === "authentification") return "Connexion expirée";
  if (etat === "echec") return "Ne répond plus";
  if (etat === "connecte") return "Connecté";
  if (etat === "attente") return "En attente d’accord";
  return "État inconnu";
}

const heure = (d: Date) => `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;

/** « depuis 14 h 05 », « depuis hier, 18 h 30 », « depuis le 6 nov., 9 h 00 ». */
export function depuisLe(t: number, maintenant: number): string {
  const d = new Date(t);
  const auj = new Date(maintenant);
  const memeJour = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (memeJour(d, auj)) return `depuis ${heure(d)}`;
  const hier = new Date(maintenant);
  hier.setDate(hier.getDate() - 1);
  if (memeJour(d, hier)) return `depuis hier, ${heure(d)}`;
  return `depuis le ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(d)}, ${heure(d)}`;
}

/** Ce qui n'a pas pu être vérifié : un serveur injoignable, un agent sans Claude Code. */
export function verificationsRatees(lieux: readonly SanteMcpLieu[]): { lieu: string | null; message: string }[] {
  return lieux.flatMap((l) => (l.erreur ? [{ lieu: l.lieu, message: l.erreur }] : (l.sante?.erreurs ?? []).map((e) => ({ lieu: l.lieu, message: `${e.agent} : ${e.message}` }))));
}

/** Une lecture reçue du process principal, gardée seulement si elle a la bonne forme. */
export function lectureValide(brut: unknown): SanteMcpLieu[] | null {
  if (!Array.isArray(brut)) return null;
  return brut.every((l) => l && typeof l === "object" && (l.lieu === null || typeof l.lieu === "string")) ? (brut as SanteMcpLieu[]) : null;
}

/** La veille, suivie : la dernière lecture, `verifier` pour tout relire. */
export function useSanteMcp() {
  const [lieux, setLieux] = useState<SanteMcpLieu[]>([]);
  const [verification, setVerification] = useState(false);
  const pont = getBridge()?.santeMcp;

  useEffect(() => {
    if (!pont) return;
    let vivant = true;
    void pont.sante().then((r) => vivant && r.ok && setLieux(r.data));
    const arreter = pont.surSante((brut) => {
      const l = lectureValide(brut);
      if (l) setLieux(l);
    });
    return () => {
      vivant = false;
      arreter();
    };
  }, [pont]);

  const verifier = useCallback(async () => {
    if (!pont) return;
    setVerification(true);
    try {
      const r = await pont.sante(true);
      if (r.ok) setLieux(r.data);
    } finally {
      setVerification(false);
    }
  }, [pont]);

  const defauts = useMemo(() => defautsMcp(lieux), [lieux]);
  return { lieux, defauts, verification, verifier, disponible: !!pont };
}
