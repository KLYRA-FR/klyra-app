"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { useCompte } from "@/lib/compte";
import {
  CLE_CARNET,
  CLE_LIEN_ATTENTE,
  MESSAGE_INVITATION,
  MESSAGE_VERSION,
  ajouterServeur,
  carnetVide,
  choisirServeur,
  interroger,
  lireCarnet,
  lireSaisie,
  placePour,
  quitterServeur,
  retirerServeur,
  type Carnet,
  type Lecture,
} from "@/lib/serveur-vps";
import { EnteteTelephone } from "./EnteteTelephone";

const CHAMP = "h-12 w-full rounded-md border border-bordure-champ bg-fond-surface px-3 text-body-s text-texte-principal";

type Sonde = "attente" | "repond" | "silence" | "invitation" | "version";

function sondeDe(lecture: Lecture): Sonde {
  if (lecture.ok) return "repond";
  if (lecture.message === MESSAGE_INVITATION) return "invitation";
  if (lecture.message === MESSAGE_VERSION) return "version";
  return "silence";
}

function libelle(etat: "joint" | "quitte", sonde: Sonde | undefined, enCours: boolean): string {
  if (etat === "quitte") return "Quitté";
  const detail = sonde === "repond" ? "Répond" : sonde === "invitation" ? "Invitation refusée" : sonde === "version" ? "Autre version" : sonde === "silence" ? "Ne répond pas" : "Vérification…";
  return enCours ? `En cours · ${detail}` : detail;
}

/** Liste, lien, quitter, retirer. Le QR reste sur la page du VPS. */
export function EcranServeurs({ cadre }: { cadre: "telephone" | "bureau" }) {
  const router = useRouter();
  const compte = useCompte();
  const [carnet, setCarnet] = useState<Carnet>(() => (typeof window === "undefined" ? carnetVide() : lireCarnet(localStorage.getItem(CLE_CARNET))));
  const [saisie, setSaisie] = useState("");
  const [ajout, setAjout] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [sondes, setSondes] = useState<Record<string, Sonde>>({});

  useEffect(() => {
    localStorage.setItem(CLE_CARNET, JSON.stringify(carnet));
  }, [carnet]);

  useEffect(() => {
    const controle = new AbortController();
    for (const serveur of carnet.liste) {
      if (serveur.etat !== "joint") continue;
      void interroger(serveur.adresse, serveur.invitation, controle.signal).then((lecture) => {
        if (controle.signal.aborted) return;
        setSondes((etat) => ({ ...etat, [serveur.id]: sondeDe(lecture) }));
      });
    }
    return () => controle.abort();
  }, [carnet.liste]);

  const connecte = compte.etat === "connecte";
  const formulaire = carnet.liste.length === 0 || ajout;

  const tenterRef = useRef<(adresse: string, code: string | null) => Promise<void>>(async () => {});
  const tenter = async (adresse: string, code: string | null) => {
    setOccupe(true);
    setErreur(null);
    const lecture = await interroger(adresse, code);
    setOccupe(false);
    if (!lecture.ok) {
      setSondes((etat) => ({ ...etat, [adresse]: sondeDe(lecture) }));
      setErreur(lecture.message);
      return;
    }
    setCarnet((etat) => ajouterServeur(etat, { adresse, invitation: code, nom: lecture.nom, version: lecture.version }));
    setSondes((etat) => ({ ...etat, [adresse]: "repond" }));
    setSaisie("");
    setAjout(false);
  };
  useEffect(() => {
    tenterRef.current = tenter;
  });

  useEffect(() => {
    const appliquer = () => {
      const lien = sessionStorage.getItem(CLE_LIEN_ATTENTE);
      if (!lien) return;
      sessionStorage.removeItem(CLE_LIEN_ATTENTE);
      const lu = lireSaisie(lien, "");
      if (!lu.ok) {
        setSaisie(lien);
        setErreur(lu.message);
        setAjout(true);
        return;
      }
      if (!placePour(lireCarnet(localStorage.getItem(CLE_CARNET)), lu.adresse)) {
        setErreur("Retire un serveur avant d’en ajouter un autre.");
        return;
      }
      void tenterRef.current(lu.adresse, lu.invitation);
    };
    appliquer();
    window.addEventListener("klyra:rejoindre", appliquer);
    return () => window.removeEventListener("klyra:rejoindre", appliquer);
  }, []);

  const rejoindre = (e: FormEvent) => {
    e.preventDefault();
    const lu = lireSaisie(saisie, "");
    if (!lu.ok) {
      setErreur(lu.message);
      return;
    }
    if (!placePour(carnet, lu.adresse)) {
      setErreur("Retire un serveur avant d’en ajouter un autre.");
      return;
    }
    void tenter(lu.adresse, lu.invitation);
  };

  const cadreTel = cadre === "telephone";
  return (
    <div className={cadreTel ? "flex min-h-0 flex-1 flex-col" : "mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col px-8 pt-8 pb-8"}>
      {cadreTel ? (
        <EnteteTelephone
          titre="Serveurs"
          pastille={connecte}
          retour={connecte ? () => router.push("/plus") : undefined}
        />
      ) : (
        <h1 className="text-h3 font-medium text-texte-principal">Serveurs</h1>
      )}
      <p className={cadreTel ? "px-4 pb-2 text-ui text-texte-secondaire" : "pb-4 text-ui text-texte-secondaire"}>Le QR est affiché par le serveur. Ici, on colle le lien d’invitation.</p>
      <ul className={cadreTel ? "min-h-0 flex-1 overflow-y-auto px-4" : "min-h-0 flex-1 overflow-y-auto"}>
        {carnet.liste.map((serveur) => {
          const enCours = serveur.id === carnet.actif;
          return (
            <li key={serveur.id} className="border-b border-bordure-subtile py-3">
              <button
                type="button"
                className="flex min-h-11 w-full flex-col justify-center text-left"
                aria-current={enCours ? "true" : undefined}
                onClick={() => {
                  if (serveur.etat === "joint") setCarnet((etat) => choisirServeur(etat, serveur.id));
                }}
              >
                <span className="text-body-s text-texte-principal">{serveur.nom}</span>
                <span className="text-ui-xs text-texte-secondaire">{serveur.adresse}</span>
                <span className="text-ui-xs text-texte-secondaire">{libelle(serveur.etat, sondes[serveur.id], enCours)}</span>
              </button>
              <span className="mt-1 flex gap-4">
                {serveur.etat === "joint" ? (
                  <button type="button" className="min-h-11 text-ui text-texte-principal" onClick={() => setCarnet((etat) => quitterServeur(etat, serveur.id))}>
                    Quitter
                  </button>
                ) : (
                  <button
                    type="button"
                    className="min-h-11 text-ui text-texte-principal"
                    onClick={() => void tenter(serveur.adresse, serveur.invitation)}
                  >
                    Rejoindre
                  </button>
                )}
                <button type="button" className="min-h-11 text-ui text-texte-principal" onClick={() => setCarnet((etat) => retirerServeur(etat, serveur.id))}>
                  Retirer
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className={cadreTel ? (connecte ? "shrink-0 px-4 pt-3 pb-4" : "shrink-0 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]") : "shrink-0 pt-3"}>
        {formulaire ? (
          <form onSubmit={rejoindre} className="flex flex-col gap-3">
            <label className="flex flex-col gap-2 text-ui text-texte-principal">
              Lien d’invitation
              <input
                aria-label="Lien d’invitation"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="klyra://rejoindre?…"
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                className={CHAMP}
              />
            </label>
            {erreur ? (
              <p role="alert" className="text-ui text-texte-principal">
                {erreur}
              </p>
            ) : null}
            <BoutonPrincipal type="submit" disabled={occupe}>
              {occupe ? "Connexion…" : "Rejoindre"}
            </BoutonPrincipal>
            {carnet.liste.length > 0 ? (
              <button type="button" className="min-h-11 text-left text-ui text-texte-secondaire" onClick={() => setAjout(false)}>
                Fermer
              </button>
            ) : null}
          </form>
        ) : (
          <Bouton variant="sombre" taille="md" onClick={() => { setErreur(null); setAjout(true); }}>
            Ajouter un serveur
          </Bouton>
        )}
      </div>
    </div>
  );
}

/** Sous 760 px. Le bureau utilise le même écran, dans la page /serveurs. */
export function ServeursTelephone() {
  return <EcranServeurs cadre="telephone" />;
}
