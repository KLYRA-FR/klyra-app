"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { AgentRond } from "@/components/roles/AgentRond";
import { useAgents } from "@/lib/agents";
import { usePriseEnMain } from "@/lib/prise-en-main";
import { useWorkspace } from "@/lib/workspace";
import { useLieuActif } from "@/lib/lieux";
import { ParcoursPriseEnMain } from "./ParcoursPriseEnMain";

export function PortePriseEnMain({ children }: { children: ReactNode }) {
  const { etat, charge, erreur, relire, changer } = usePriseEnMain();
  const { status, mes } = useAgents();
  const { state } = useWorkspace();
  const pathname = usePathname();
  const lieu = useLieuActif();
  const router = useRouter();
  const [echec, setEchec] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  // Ce guide prépare le PC. Un serveur déjà rejoint possède son équipe et ses fournisseurs.
  if (lieu || pathname === "/serveurs" || pathname.startsWith("/serveur/")) return children;
  if (!charge || status === "chargement" || !state.charge) return <main className="prise-chargement" aria-busy="true"><Image unoptimized src="/brand/logo-signe.svg" alt="KLYRA" width={48} height={48} /><p role="status">On retrouve ton espace…</p></main>;
  if (erreur) return <main className="prise-chargement"><h1>Retrouvons ta prise en main.</h1><p role="alert">{erreur}</p><BoutonPrincipal onClick={() => void relire()}>Réessayer</BoutonPrincipal></main>;
  // Les liens d'invitation conservent leur propre parcours. Aucune IA locale n'y est imposée.
  if (!etat || etat.etape === "termine" || etat.mode === "exploration") return children;
  if (etat.etape !== "conversation" || !etat.conversation) return <ParcoursPriseEnMain etat={etat} />;
  const debut = etat.conversation.debut;
  const messages = state.messages.filter((m) => m.chatId === etat.conversation!.id && m.createdAt >= debut && m.author.kind === "role" && m.author.roleId === "principal");
  const reponse = messages.find((m) => m.statut === "fait" && m.parts.some((p) => p.type === "text" && p.text.trim()));
  const travaille = !!state.travail[etat.conversation.id];
  const reprendre = async (fin: boolean) => {
    if (occupe) return;
    setOccupe(true); setEchec(null);
    try {
      await changer(fin ? { etape: "termine", brouillon: "" } : { etape: "ia", conversation: null });
      if (!fin) router.push("/");
    } catch (e) { setEchec(e instanceof Error ? e.message : "Ton choix n’a pas pu être gardé. Réessaie."); }
    finally { setOccupe(false); }
  };
  return <div className="prise-avec-guide"><section className="prise-guide" aria-label="Fin de la prise en main"><AgentRond roleId="principal" taille={40} /><div><span className="prise-guide-etape">5 / 5 · LA CONVERSATION</span><strong>{reponse ? "Ta première réponse est là. À toi la suite." : travaille ? `${mes?.assistant.nom || "Ton assistant"} prépare ta première réponse…` : "Ta conversation est ouverte."}</strong><p>{reponse ? "Continue l’échange. Les projets rassemblent ton travail, les agents couvrent tes besoins récurrents et les artefacts gardent tes livrables." : travaille ? "La vraie conversation reste juste en dessous. Tu peux suivre ce que fait ton assistant." : "Si la réponse n’aboutit pas, vérifie la connexion à ton IA. Ta demande est conservée."}</p>{echec && <p className="prise-erreur" role="alert">{echec}</p>}</div>{reponse ? <Bouton variant="sombre" taille="md" disabled={occupe} onClick={() => void reprendre(true)}>Continuer l’échange</Bouton> : !travaille && <Bouton variant="blanc" taille="md" disabled={occupe} onClick={() => void reprendre(false)}>Revoir mon IA</Bouton>}</section><div className="prise-espace">{children}</div></div>;
}

/** Un départ en exploration ne déclare jamais l'IA prête : le point de reprise reste visible. */
export function ReprendrePriseEnMain() {
  const { etat, changer } = usePriseEnMain();
  const lieu = useLieuActif();
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  if (lieu || !etat || etat.etape === "termine" || etat.mode !== "exploration") return null;
  const reprendre = async () => {
    setOccupe(true); setErreur(null);
    try { await changer({ mode: "guide" }); }
    catch { setErreur("La prise en main n’a pas pu être reprise. Réessaie."); }
    finally { setOccupe(false); }
  };
  return <section className="prise-reprise" aria-label="Reprendre la prise en main"><div><strong>Préparons ta première demande.</strong><p>Tu explores l’app. Ta prise en main t’attend, avec tes choix déjà gardés.</p>{erreur && <p role="alert">{erreur}</p>}</div><Bouton variant="blanc" taille="md" disabled={occupe} onClick={() => void reprendre()}>Reprendre la prise en main</Bouton></section>;
}
