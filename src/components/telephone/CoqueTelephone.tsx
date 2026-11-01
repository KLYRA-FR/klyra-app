"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCompte } from "@/lib/compte";
import { AgentsTelephone, EcranMac, PlusTelephone, ProjetsTelephone, ReglagesTelephone } from "./ListesTelephone";
import { BarreOnglets } from "./BarreOnglets";
import { ChatsTelephone } from "./ChatsTelephone";
import { ConnexionTelephone } from "./ConnexionTelephone";
import { FilTelephone } from "./FilTelephone";
import { PlanningTelephone } from "./PlanningTelephone";
import { ServeursTelephone } from "./ServeursTelephone";

const CLE_INSTALL = "klyra:installer";

function ecran(pathname: string): ReactNode {
  if (pathname === "/chats" || pathname === "/") return <ChatsTelephone />;
  if (pathname === "/chat") return <FilTelephone />;
  if (pathname === "/planning") return <PlanningTelephone />;
  if (pathname === "/equipe") return <AgentsTelephone />;
  if (pathname === "/projets") return <ProjetsTelephone />;
  if (pathname === "/plus") return <PlusTelephone />;
  if (pathname === "/reglages") return <ReglagesTelephone />;
  if (pathname === "/serveurs") return <ServeursTelephone />;
  if (pathname === "/routines") return <EcranMac titre="Automatisations" phrase="Les routines sont sur ton Mac. Elles ne partent que quand KLYRA y est ouverte." />;
  if (pathname === "/artefacts") return <EcranMac titre="Artefacts" phrase="La liste est sur ton Mac." />;
  if (pathname === "/projet" || pathname === "/fichiers") return <EcranMac titre="Projet" phrase="Les fichiers de ce projet sont sur ton Mac. Ils s’affichent quand KLYRA y est ouverte." />;
  return <EcranMac titre="KLYRA" phrase="Cet écran se lit sur ton Mac." />;
}

/** Sous 760 px. L'ouverture est Chats. Le bureau (≥ 1100 px) ne passe pas ici. */
export function CoqueTelephone() {
  const pathname = usePathname();
  const router = useRouter();
  const compte = useCompte();
  const [installe, setInstalle] = useState(() => (typeof window === "undefined" ? true : localStorage.getItem(CLE_INSTALL) === "navigateur"));
  const [horsLigne, setHorsLigne] = useState(false);

  useEffect(() => {
    if (pathname === "/") router.replace("/chats");
  }, [pathname, router]);

  useEffect(() => {
    const lire = () => setHorsLigne(typeof navigator !== "undefined" && !navigator.onLine);
    lire();
    window.addEventListener("online", lire);
    window.addEventListener("offline", lire);
    return () => {
      window.removeEventListener("online", lire);
      window.removeEventListener("offline", lire);
    };
  }, []);

  const fil = pathname === "/chat";
  const serveurs = pathname === "/serveurs";
  const continuer = () => {
    localStorage.setItem(CLE_INSTALL, "navigateur");
    setInstalle(true);
  };

  return (
    <div className="flex h-full flex-col bg-fond-page">
      {horsLigne ? <p className="bg-fond-surface-grise px-4 py-2 text-ui-xs text-texte-secondaire">Hors ligne</p> : null}
      {!installe ? (
        <div className="m-auto flex max-w-sm flex-col gap-4 px-6">
          <h1 className="text-h3 font-medium text-texte-principal">Installer KLYRA sur ce téléphone</h1>
          <p className="text-ui text-texte-secondaire">
            Sur iPhone, le menu Partager de Safari permet d’ajouter KLYRA à l’écran d’accueil. Sur Android, le menu de Chrome le permet aussi. Les libellés exacts de ces menus se vérifient sur l’appareil.
          </p>
          <button type="button" className="min-h-11 text-left text-ui text-texte-principal" onClick={continuer}>
            Continuer dans le navigateur
          </button>
        </div>
      ) : compte.etat === "connecte" || serveurs ? (
        <>
          {ecran(pathname)}
          {fil || compte.etat !== "connecte" ? null : <BarreOnglets />}
        </>
      ) : (
        <ConnexionTelephone />
      )}
    </div>
  );
}
