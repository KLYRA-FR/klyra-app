"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { getBridge } from "@/lib/bridge";
import { signalerCarnet } from "@/lib/lieux";
import { useCompte } from "@/lib/compte";
import {
  CLE_CARNET,
  CLE_LIEN_ATTENTE,
  COMMANDE_SERVEUR,
  COMMANDE_SSH,
  EVENEMENT_AJOUTER,
  ajouterServeur,
  carnetVide,
  appairer,
  interroger,
  lienCopie,
  lireCarnet,
  lireSaisie,
  placePour,
  quitterServeur,
  retirer,
  retirerServeur,
  libelleServeur,
  sondeDe,
  type Carnet,
  type Sonde,
} from "@/lib/serveur-vps";
import { EnteteTelephone } from "./EnteteTelephone";

const CHAMP = "h-12 w-full rounded-md border border-bordure-champ bg-fond-surface px-3 text-body-s text-texte-principal";


/** Une commande à copier, sur une ligne qui peut se couper. */
function Commande({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false);
  const copier = () => {
    void navigator.clipboard?.writeText(texte).then(() => {
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    });
  };
  return (
    <div className="flex items-start gap-2 rounded-md border border-bordure-subtile bg-fond-page p-3">
      <code className="min-w-0 flex-1 text-ui-xs leading-[1.6] [overflow-wrap:anywhere] text-texte-principal">{texte}</code>
      <Bouton variant="blanc" taille="mini" onClick={copier}>
        {copie ? "Copiée" : "Copier"}
      </Bouton>
    </div>
  );
}

function Etape({ numero, titre, children }: { numero: number; titre: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="klyra-mono w-5 shrink-0 pt-px text-ui font-medium text-texte-accent">{numero}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-body-s text-texte-principal">{titre}</p>
        {children}
      </div>
    </li>
  );
}

/** Écran vide : se connecter au VPS, y coller la commande, puis coller ici le lien qu’elle affiche. */
function Guide() {
  return (
    <ol className="flex flex-col gap-6 py-2">
      <Etape numero={1} titre="Connecte-toi à ton VPS">
        <p className="text-ui text-texte-secondaire">Ouvre un terminal sur ton ordinateur (PowerShell sous Windows, Terminal sur Mac) et tape cette commande, en remplaçant ADRESSE_DU_VPS par l’adresse IP donnée par ton hébergeur.</p>
        <Commande texte={COMMANDE_SSH} />
        <p className="text-ui text-texte-secondaire">Réponds yes à la première question, puis tape le mot de passe du VPS : rien ne s’affiche pendant la frappe, c’est normal.</p>
      </Etape>
      <Etape numero={2} titre="Colle cette commande sur ton VPS">
        <p className="text-ui text-texte-secondaire">Dans ce même terminal, une fois connecté. Elle installe et lance tout. Avec Tailscale sur le VPS et ici, l’adresse ne change jamais.</p>
        <Commande texte={COMMANDE_SERVEUR} />
      </Etape>
      <Etape numero={3} titre="Colle ici le lien qu’elle affiche">
        <p className="text-ui text-texte-secondaire">
          {getBridge() ? "Il commence par klyra://rejoindre et sert une seule fois, 10 minutes. S’il est déjà copié, l’app le reprend toute seule." : "Il commence par klyra://rejoindre et sert une seule fois, 10 minutes."}
        </p>
      </Etape>
    </ol>
  );
}

/** Liste, lien, quitter, retirer. Le QR reste sur la page du VPS. */
export function EcranServeurs({ cadre }: { cadre: "telephone" | "bureau" }) {
  const router = useRouter();
  const compte = useCompte();
  const [carnet, setCarnet] = useState<Carnet>(() => (typeof window === "undefined" ? carnetVide() : lireCarnet(localStorage.getItem(CLE_CARNET))));
  const [saisie, setSaisie] = useState("");
  const [ajout, setAjout] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("ajouter"));
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [sondes, setSondes] = useState<Record<string, Sonde>>({});
  const [agentsVps, setAgentsVps] = useState<Record<string, string>>({});
  const [repris, setRepris] = useState(false);
  const dernierRepris = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(CLE_CARNET, JSON.stringify(carnet));
    signalerCarnet();
  }, [carnet]);

  // Le sélecteur du rail peut retirer un serveur pendant que l'écran est ouvert : on relit le carnet.
  useEffect(() => {
    const relire = () => {
      const brut = localStorage.getItem(CLE_CARNET);
      setCarnet((actuel) => (JSON.stringify(actuel) === brut ? actuel : lireCarnet(brut)));
    };
    window.addEventListener("klyra:carnet", relire);
    return () => window.removeEventListener("klyra:carnet", relire);
  }, []);

  // « Ajouter un serveur » du sélecteur du rail : le formulaire s'ouvre (à l'arrivée par `?ajouter`, ou écran déjà ouvert).
  const ajouter = useSearchParams().get("ajouter");
  useEffect(() => {
    if (ajouter) router.replace("/serveurs");
  }, [ajouter, router]);
  useEffect(() => {
    const ouvrir = () => {
      setErreur(null);
      setAjout(true);
    };
    window.addEventListener(EVENEMENT_AJOUTER, ouvrir);
    return () => window.removeEventListener(EVENEMENT_AJOUTER, ouvrir);
  }, []);

  useEffect(() => {
    const controle = new AbortController();
    for (const serveur of carnet.liste) {
      if (serveur.etat !== "joint") continue;
      void interroger(serveur.adresse, controle.signal).then((lecture) => {
        if (controle.signal.aborted) return;
        setSondes((etat) => ({ ...etat, [serveur.id]: sondeDe(lecture) }));
        if (lecture.ok && lecture.agents) setAgentsVps((etat) => ({ ...etat, [serveur.id]: lecture.agents! }));
      });
    }
    return () => controle.abort();
  }, [carnet.liste]);

  const connecte = compte.etat === "connecte";
  const formulaire = carnet.liste.length === 0 || ajout;

  // Dans Electron seulement (le navigateur demanderait l’autorisation) : un lien copié remplit le champ vide, une seule fois.
  useEffect(() => {
    if (!formulaire || saisie || !getBridge()) return;
    const lire = () => {
      void navigator.clipboard
        ?.readText()
        .then((texte) => {
          const lien = lienCopie(texte);
          if (!lien || lien === dernierRepris.current) return;
          dernierRepris.current = lien;
          setSaisie((actuelle) => actuelle || lien);
          setRepris(true);
        })
        .catch(() => {
          /* Le champ reste à remplir à la main. */
        });
    };
    lire();
    window.addEventListener("focus", lire);
    return () => window.removeEventListener("focus", lire);
  }, [formulaire, saisie]);

  const tenterRef = useRef<(adresse: string, code: string | null) => Promise<void>>(async () => {});
  const tenter = async (adresse: string, code: string | null) => {
    setOccupe(true);
    setErreur(null);
    // Avec un code : premier lien. Sans code : un serveur que cet appareil connaît déjà.
    const lecture = code ? await appairer(adresse, code) : await interroger(adresse);
    setOccupe(false);
    if (!lecture.ok) {
      setSondes((etat) => ({ ...etat, [adresse]: sondeDe(lecture) }));
      setErreur(lecture.message);
      return;
    }
    setCarnet((etat) => ajouterServeur(etat, { adresse, nom: lecture.nom, version: lecture.version }));
    setSondes((etat) => ({ ...etat, [adresse]: "repond" }));
    setSaisie("");
    setRepris(false);
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
      const lu = lireSaisie(lien);
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
      void tenterRef.current(lu.adresse, lu.code);
    };
    appliquer();
    window.addEventListener("klyra:rejoindre", appliquer);
    return () => window.removeEventListener("klyra:rejoindre", appliquer);
  }, []);

  const rejoindre = (e: FormEvent) => {
    e.preventDefault();
    const lu = lireSaisie(saisie);
    if (!lu.ok) {
      setErreur(lu.message);
      return;
    }
    if (!placePour(carnet, lu.adresse)) {
      setErreur("Retire un serveur avant d’en ajouter un autre.");
      return;
    }
    void tenter(lu.adresse, lu.code);
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
      <p className={cadreTel ? "px-4 pb-2 text-ui text-texte-secondaire" : "pb-4 text-ui text-texte-secondaire"}>
        {carnet.liste.length === 0 ? "Relie l’app à un serveur KLYRA qui tourne sur ton VPS." : "Pour ajouter un VPS, lance la commande sur la machine et colle le lien qu’elle affiche."}
      </p>
      {carnet.liste.length === 0 ? (
        <div className={cadreTel ? "min-h-0 flex-1 overflow-y-auto px-4" : "min-h-0 flex-1 overflow-y-auto"}>
          <Guide />
        </div>
      ) : (
        <ul className={cadreTel ? "min-h-0 flex-1 overflow-y-auto px-4" : "min-h-0 flex-1 overflow-y-auto"}>
          {carnet.liste.map((serveur) => {
            return (
              <li key={serveur.id} className="border-b border-bordure-subtile py-3">
                {/* La machine active se choisit dans le sélecteur du rail : ici, l'état et les gestes. */}
                <div className="flex min-h-11 w-full flex-col justify-center text-left">
                  <span className="text-body-s text-texte-principal">{serveur.nom}</span>
                  <span className="text-ui-xs text-texte-secondaire">{serveur.adresse}</span>
                  <span className="text-ui-xs text-texte-secondaire">{libelleServeur(serveur.etat, sondes[serveur.id], agentsVps[serveur.id])}</span>
                </div>
                <span className="mt-1 flex gap-4">
                  {serveur.etat === "joint" ? (
                    <button type="button" className="min-h-11 text-ui text-texte-principal" onClick={() => setCarnet((etat) => quitterServeur(etat, serveur.id))}>
                      Quitter
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="min-h-11 text-ui text-texte-principal"
                      onClick={() => void tenter(serveur.adresse, null)}
                    >
                      Rejoindre
                    </button>
                  )}
                  <button type="button" className="min-h-11 text-ui text-texte-principal" onClick={() => {
                      void retirer(serveur.adresse);
                      setCarnet((etat) => retirerServeur(etat, serveur.id));
                    }}>
                    Retirer
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
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
                onChange={(e) => {
                  setSaisie(e.target.value);
                  setRepris(false);
                }}
                className={CHAMP}
              />
            </label>
            {repris && saisie ? <p className="text-ui-xs text-texte-secondaire">Lien repris du presse-papiers.</p> : null}
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
