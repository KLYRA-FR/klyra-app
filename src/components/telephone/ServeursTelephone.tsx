"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { getBridge } from "@/lib/bridge";
import { retenirLieu, signalerCarnet, useLieuActif } from "@/lib/lieux";
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
  retardDe,
  sondeDe,
  type Carnet,
  type Sonde,
} from "@/lib/serveur-vps";
import { Commande } from "@/components/serveur/Commande";
import { etapeTerminal, ligneServeur } from "@/lib/telephone/serveurs";
import { useHorsLigne } from "./BandeauReseau";
import { useEspaceAffiche } from "./EspaceTelephone";
import { usePostes, useSupport } from "./poste";
import { EnteteTelephone } from "./EnteteTelephone";
import { CHAMP_TELEPHONE, MessageErreur } from "./Controles";
import { Feuille, MenuFeuille } from "./Feuille";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { useTirerPourRelire } from "./TirerPourRelire";

const CHAMP = CHAMP_TELEPHONE;

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

/** Le carnet, les sondes et le lien : partagés par la page du bureau et celle du téléphone. */
function useCarnetServeurs() {
  const router = useRouter();
  const compte = useCompte();
  const [carnet, setCarnet] = useState<Carnet>(() => (typeof window === "undefined" ? carnetVide() : lireCarnet(localStorage.getItem(CLE_CARNET))));
  const [saisie, setSaisie] = useState("");
  const [ajout, setAjout] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("ajouter"));
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [sondes, setSondes] = useState<Record<string, Sonde>>({});
  const [retards, setRetards] = useState<Record<string, boolean>>({});
  const [agentsVps, setAgentsVps] = useState<Record<string, string>>({});
  const [verifies, setVerifies] = useState<Record<string, number>>({});
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
        setRetards((etat) => ({ ...etat, [serveur.id]: retardDe(lecture) }));
        setVerifies((etat) => ({ ...etat, [serveur.id]: Date.now() }));
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

  const relancerSondes = () => {
    for (const serveur of carnet.liste) {
      if (serveur.etat !== "joint") continue;
      void interroger(serveur.adresse).then((lecture) => {
        setSondes((etat) => ({ ...etat, [serveur.id]: sondeDe(lecture) }));
        setRetards((etat) => ({ ...etat, [serveur.id]: retardDe(lecture) }));
        setVerifies((etat) => ({ ...etat, [serveur.id]: Date.now() }));
        if (lecture.ok && lecture.agents) setAgentsVps((etat) => ({ ...etat, [serveur.id]: lecture.agents! }));
      });
    }
  };

  return { compte, connecte, carnet, setCarnet, saisie, setSaisie, ajout, setAjout, erreur, setErreur, occupe, sondes, retards, agentsVps, verifies, repris, setRepris, formulaire, tenter, rejoindre, relancerSondes };
}

/** Liste, lien, quitter, retirer, sur la page du bureau. Le QR reste sur la page du VPS. */
export function EcranServeurs() {
  const lieuActif = useLieuActif();
  const { carnet, setCarnet, saisie, setSaisie, setAjout, erreur, setErreur, occupe, sondes, retards, agentsVps, repris, setRepris, formulaire, tenter, rejoindre } = useCarnetServeurs();
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col px-8 pt-8 pb-8">
      <h1 className="text-h3 font-medium text-texte-principal">Serveurs</h1>
      <p className="pb-4 text-ui text-texte-secondaire">
        {carnet.liste.length === 0 ? "Relie l’app à un serveur KLYRA qui tourne sur ton VPS." : "Pour ajouter un VPS, lance la commande sur la machine et colle le lien qu’elle affiche."}
      </p>
      {carnet.liste.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Guide />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {carnet.liste.map((serveur) => {
            return (
              <li key={serveur.id} className="border-b border-bordure-subtile py-3">
                {/* Le serveur affiché se choisit ici, pour ce téléphone seulement : l'ordinateur garde le sien. */}
                <div className="flex min-h-11 w-full flex-col justify-center text-left">
                  <span className="text-body-s text-texte-principal">{serveur.nom}</span>
                  <span className="text-ui-xs text-texte-secondaire">{serveur.adresse}</span>
                  <span className="text-ui-xs text-texte-secondaire">{libelleServeur(serveur.etat, sondes[serveur.id], agentsVps[serveur.id], retards[serveur.id])}</span>
                </div>
                <span className="mt-1 flex gap-4">
                  {serveur.etat === "joint" ? (
                    <button
                      type="button"
                      aria-pressed={lieuActif === serveur.adresse}
                      className="min-h-11 text-ui font-medium text-texte-accent"
                      onClick={() => retenirLieu(lieuActif === serveur.adresse ? null : serveur.adresse)}
                    >
                      {lieuActif === serveur.adresse ? "Affiché ici : revenir sur l’ordinateur" : "Afficher sur ce téléphone"}
                    </button>
                  ) : null}
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
      <div className="shrink-0 pt-3">
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
            {erreur ? <MessageErreur>{erreur}</MessageErreur> : null}
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

/* ─── Le téléphone (lot 8, E8-44 à E8-49) ─────────────────────────── */

/** Une commande à copier (E8-44) : « Copier » compact dans une cible de 44, « Copiée » 2 s après le résultat du presse-papiers. */
function CommandeACopier({ texte }: { texte: string }) {
  const [etat, setEtat] = useState<"repos" | "copiee" | "impossible">("repos");
  const copier = () => {
    const fini = (suite: "copiee" | "impossible") => {
      setEtat(suite);
      setTimeout(() => setEtat("repos"), 2000);
    };
    if (!navigator.clipboard) return fini("impossible");
    void navigator.clipboard.writeText(texte).then(() => fini("copiee"), () => fini("impossible"));
  };
  return (
    <div className="flex items-start gap-2 rounded-md bg-fond-surface-grise py-2 pr-2 pl-3">
      <code className="min-w-0 flex-1 pt-1.5 font-[inherit] text-ui leading-[1.45] [overflow-wrap:anywhere] text-texte-principal">{texte}</code>
      <Bouton
        variant="blanc"
        taille="compact"
        onClick={copier}
        aria-label={etat === "copiee" ? "Commande copiée" : "Copier la commande"}
        iconeGauche={<Icon name={etat === "copiee" ? "check-01" : "copy-left"} size={16} />}
        className="relative after:absolute after:inset-x-0 after:-inset-y-1.5"
      >
        {etat === "copiee" ? "Copiée" : etat === "impossible" ? "Copie impossible" : "Copier"}
      </Bouton>
    </div>
  );
}

function EtapeGuide({ numero, titre, children }: { numero: number; titre: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-fond-teinte-bleue text-ui-xs font-semibold text-texte-accent">
        {numero}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-body-s font-semibold text-texte-principal">{titre}</h3>
        {children}
      </div>
    </li>
  );
}

/** Le lien d'invitation : collé à la main, jamais recopié ailleurs ; une erreur sous le champ, la saisie reste. */
function ChampInvitation({ saisie, setSaisie, erreur, occupe, onRejoindre }: { saisie: string; setSaisie: (t: string) => void; erreur: string | null; occupe: boolean; onRejoindre: (e: FormEvent) => void }) {
  const coller = async () => {
    try {
      setSaisie(await navigator.clipboard.readText());
    } catch {
      /* Le champ reste à remplir à la main. */
    }
  };
  return (
    <form onSubmit={onRejoindre} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <label htmlFor="klyra-lien-invitation" className="text-ui font-medium text-texte-principal">
          Lien d’invitation
        </label>
        <span className="flex gap-2">
          <input
            id="klyra-lien-invitation"
            aria-label="Lien d’invitation"
            aria-invalid={erreur ? true : undefined}
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="klyra://rejoindre…"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            className={`${CHAMP} min-w-0 flex-1 text-ellipsis`}
          />
          <Bouton type="button" variant="blanc" taille="md" className="h-12 px-3.5" onClick={() => void coller()}>
            Coller
          </Bouton>
        </span>
        {erreur ? <MessageErreur>{erreur}</MessageErreur> : <span className="text-ui-xs text-texte-secondaire">Il sert une seule fois, pendant 10 minutes.</span>}
      </div>
      <BoutonPrincipal type="submit" disabled={occupe}>
        {occupe ? "Connexion…" : "Rejoindre"}
      </BoutonPrincipal>
    </form>
  );
}

/** Le guide (E8-44, E8-45) : le vrai terminal selon le poste, « yes » expliqué, puis le lien à coller. */
function GuideTelephone({ champ }: { champ: ReactNode }) {
  const { principal } = usePostes();
  const sur = useSupport();
  return (
    <ol className="flex flex-col gap-5">
      <EtapeGuide numero={1} titre={etapeTerminal(principal?.systeme ?? null, sur)}>
        <p className="text-ui leading-[1.45] text-texte-secondaire">Connecte-toi à ton VPS avec cette commande, en remplaçant ADRESSE_DU_VPS par l’adresse IP donnée par ton hébergeur.</p>
        <CommandeACopier texte={COMMANDE_SSH} />
        <p className="text-ui leading-[1.45] text-texte-secondaire">À la première connexion, une question de sécurité s’affiche : tape « yes » puis Entrée. Le mot de passe ne s’affiche pas pendant la frappe, c’est normal.</p>
      </EtapeGuide>
      <EtapeGuide numero={2} titre="Lance l’installation sur le VPS">
        <p className="text-ui leading-[1.45] text-texte-secondaire">Dans le même terminal. Elle installe KLYRA sur le serveur, puis affiche un lien.</p>
        <CommandeACopier texte={COMMANDE_SERVEUR} />
      </EtapeGuide>
      <EtapeGuide numero={3} titre="Colle ici le lien affiché">
        {champ}
      </EtapeGuide>
    </ol>
  );
}

/** La page Serveurs du téléphone, ouverte aussi sans compte (T-00). */
export function ServeursTelephone() {
  const { connecte, carnet, setCarnet, saisie, setSaisie, ajout, setAjout, erreur, setErreur, occupe, sondes, retards, agentsVps, verifies, repris, setRepris, tenter, rejoindre, relancerSondes } = useCarnetServeurs();
  const sur = useSupport();
  const horsLigne = useHorsLigne();
  const { lieu, choisir } = useEspaceAffiche();
  const tirer = useTirerPourRelire(relancerSondes, { actif: !horsLigne && carnet.liste.length > 0 });
  const [menu, setMenu] = useState<string | null>(null);
  const serveurMenu = carnet.liste.find((s) => s.id === menu) ?? null;
  const ligneDe = (s: (typeof carnet.liste)[number]) => ligneServeur({ etat: s.etat, sonde: sondes[s.id], agents: agentsVps[s.id], retard: retards[s.id], verifieLe: verifies[s.id], sur, horsLigne });
  const noteReseau = horsLigne ? "Possible quand ce téléphone est en ligne." : undefined;
  const champ = (
    <>
      <ChampInvitation
        saisie={saisie}
        setSaisie={(t) => {
          setSaisie(t);
          setRepris(false);
        }}
        erreur={erreur}
        occupe={occupe}
        onRejoindre={rejoindre}
      />
      {repris && saisie ? <p className="text-ui-xs text-texte-secondaire">Lien repris du presse-papiers.</p> : null}
    </>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Serveurs" parent={connecte ? "/plus" : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto" {...tirer.props}>
        {tirer.indicateur}
        <div className="flex flex-col gap-[18px] px-4 pt-2 pb-6">
          {carnet.liste.length === 0 ? (
            <>
              <p className="mx-1 text-ui leading-[1.45] text-texte-secondaire">Relié à ce téléphone, un VPS KLYRA te dit s’il répond, et reçoit tes messages à ses agents même {sur} fermé.</p>
              <GuideTelephone champ={champ} />
            </>
          ) : (
            <>
              <p className="mx-1 text-ui leading-[1.45] text-texte-secondaire">Tes messages passent par {sur}. Quand il est fermé, ceux que tu écris aux agents d’un serveur relié ici lui parviennent directement.</p>
              <SectionListe titre="Reliés à ce téléphone" compte={carnet.liste.length}>
                <GroupeListe>
                  {carnet.liste.map((s) => {
                    const ligne = ligneDe(s);
                    return (
                      <LigneListe
                        key={s.id}
                        debut={<TuileIcone icone="globe-01" />}
                        retrait="tuile"
                        nom={s.nom}
                        etiquette={ligne.etiquette ? <Etiquette ton={ligne.ton}>{ligne.etiquette}</Etiquette> : null}
                        ligne2={lieu === s.adresse ? `Affiché ici · ${ligne.phrase}` : ligne.phrase}
                        onMenu={() => setMenu(s.id)}
                        menuVisible
                      />
                    );
                  })}
                </GroupeListe>
              </SectionListe>
              <Bouton
                variant="blanc"
                taille="md"
                className="w-full"
                iconeGauche={<Icon name="plus-01" size={20} />}
                onClick={() => {
                  setErreur(null);
                  setAjout(true);
                }}
              >
                Ajouter un serveur
              </Bouton>
            </>
          )}
        </div>
      </div>
      {ajout && carnet.liste.length > 0 ? (
        <Feuille titre="Ajouter un serveur" haute onFermer={() => setAjout(false)}>
          <div className="pt-1 pb-4">
            <GuideTelephone champ={champ} />
          </div>
        </Feuille>
      ) : null}
      {serveurMenu ? (
        <MenuFeuille
          titre={serveurMenu.nom}
          objet={{ visuel: <TuileIcone icone="globe-01" />, sous: [ligneDe(serveurMenu).etiquette, ligneDe(serveurMenu).phrase].filter(Boolean).join(" · ") }}
          onFermer={() => setMenu(null)}
          actions={[
            ...(serveurMenu.etat === "joint"
              ? [
                  lieu === serveurMenu.adresse
                    ? { libelle: `Revenir sur ${sur}`, icone: "computer" as const, note: "Ce téléphone montre de nouveau ses chats et ses projets.", onChoisir: () => choisir(null) }
                    : { libelle: "Afficher sur ce téléphone", icone: "globe-01" as const, desactivee: horsLigne, note: noteReseau ?? "Ses chats, ses projets et ses routines. Pour ce téléphone seulement.", onChoisir: () => choisir(serveurMenu.adresse) },
                ]
              : []),
            serveurMenu.etat === "joint"
              ? { libelle: "Vérifier maintenant", icone: "refresh-01", desactivee: horsLigne, note: noteReseau, onChoisir: relancerSondes }
              : { libelle: "Rejoindre", icone: "refresh-01", desactivee: horsLigne, note: noteReseau ?? "Sans nouveau lien, si ce serveur connaît encore ce téléphone.", onChoisir: () => void tenter(serveurMenu.adresse, null) },
            ...(serveurMenu.etat === "joint"
              ? [{ libelle: "Quitter", icone: "minimise-01" as const, note: "Ce téléphone ne l’interroge plus ; tu pourras revenir sans nouveau lien.", onChoisir: () => setCarnet((etat) => quitterServeur(etat, serveurMenu.id)) }]
              : []),
            {
              libelle: "Retirer de ce téléphone…",
              icone: "trash-01",
              danger: true,
              separateurAvant: true,
              confirmation: {
                titre: `Retirer ${serveurMenu.nom} de ce téléphone ?`,
                texte: `Ce téléphone oublie ce serveur et son accès. ${sur.charAt(0).toUpperCase()}${sur.slice(1)} reste relié, et tes conversations avec ses agents restent dans ton compte. Pour le relier de nouveau ici, il faudra relancer la commande sur le VPS.`,
                confirmer: "Retirer",
              },
              onChoisir: () => {
                void retirer(serveurMenu.adresse);
                setCarnet((etat) => retirerServeur(etat, serveurMenu.id));
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}
