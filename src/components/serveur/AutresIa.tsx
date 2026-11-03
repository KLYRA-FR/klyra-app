"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "klyra-ui";
import { Bouton } from "@/components/ui/Bouton";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { getBridge, type AutreIa } from "@/lib/bridge";
import { cn } from "@/lib/cn";

export type CatalogueIa = Record<string, { nom: string; url: string; modele: string }>;

/** Où créer la clé de chaque fournisseur. */
const OU_CREER_LA_CLE: Record<string, string> = {
  openai: "platform.openai.com/api-keys",
  gemini: "aistudio.google.com/apikey",
  mistral: "console.mistral.ai/api-keys",
  deepseek: "platform.deepseek.com/api_keys",
  xai: "console.x.ai",
  openrouter: "openrouter.ai/keys",
};

/** Le résultat du dernier test de chaque IA. */
export type TestIa = { etat: "en-cours" } | { etat: "ok" } | { etat: "erreur"; message: string };

/** Ajouter une IA à consulter, `initial` déjà choisie (Gemini, Grok… ou « autre »). */
export function FormulaireIa({
  fournisseurs,
  initial = "openai",
  lieu = null,
  onAjoutee,
  onAnnuler,
}: {
  fournisseurs: CatalogueIa;
  initial?: string;
  /** Le VPS où l'ajouter (la clé y reste) ; absent : ce poste. */
  lieu?: string | null;
  onAjoutee: (liste: AutreIa[]) => void;
  onAnnuler: () => void;
}) {
  const [fournisseur, setFournisseur] = useState(initial);
  const [nom, setNom] = useState(initial === "autre" ? "" : (fournisseurs[initial]?.nom ?? ""));
  const [modele, setModele] = useState(fournisseurs[initial]?.modele ?? "");
  const [url, setUrl] = useState("");
  const [cle, setCle] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const autre = fournisseur === "autre";

  const choisir = (f: string) => {
    setFournisseur(f);
    setNom(f === "autre" ? "" : (fournisseurs[f]?.nom ?? ""));
    setModele(fournisseurs[f]?.modele ?? "");
  };

  const ajouter = async () => {
    const ia = getBridge()?.ia;
    if (!ia) return;
    setEnvoi(true);
    setErreur(null);
    const r = await ia.ajouter({ nom, fournisseur, url: autre ? url : "", modele, cle }, lieu);
    setEnvoi(false);
    if (!r.ok) return setErreur(r.message);
    setCle("");
    onAjoutee(r.data);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void ajouter();
      }}
      className="flex flex-col gap-4 rounded-md border border-bordure-subtile p-4"
    >
      <div className="grid gap-4 @lg:grid-cols-2">
        <Champ label="IA">
          <ListeDeroulante
            value={fournisseur}
            options={Object.entries(fournisseurs).map(([id, f]) => ({ value: id, label: f.nom }))}
            onChange={choisir}
          />
        </Champ>
        <Champ label="Nom" aide="Celui que tu diras aux agents : « demande à Gemini ».">
          <Input size="sm" value={nom} onChange={(e) => setNom(e.target.value)} className={CHAMP} />
        </Champ>
        {autre && (
          <Champ label="Adresse de l’API" aide="Compatible OpenAI, par exemple https://api.exemple.com/v1.">
            <Input size="sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={CHAMP} />
          </Champ>
        )}
        <Champ label="Modèle" aide="Laisse celui proposé si tu ne sais pas.">
          <Input size="sm" value={modele} onChange={(e) => setModele(e.target.value)} spellCheck={false} className={cn(CHAMP, "klyra-mono")} />
        </Champ>
        <Champ
          label="Clé API"
          aide={`${OU_CREER_LA_CLE[fournisseur] ? `À créer sur ${OU_CREER_LA_CLE[fournisseur]}. ` : ""}${lieu ? "Gardée sur ce serveur, lisible par lui seul." : "Chiffrée dans le trousseau de ce poste."}`}
          className="@lg:col-span-2"
        >
          <Input
            size="sm"
            type="password"
            value={cle}
            onChange={(e) => setCle(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={cn(CHAMP, "klyra-mono")}
          />
        </Champ>
      </div>
      {erreur && (
        <p role="alert" className="m-0 text-ui-s text-texte-erreur">
          {erreur}
        </p>
      )}
      <div className="flex gap-2">
        <Bouton type="submit" variant="sombre" taille="md" disabled={envoi || !nom.trim() || !modele.trim() || !cle.trim() || (autre && !url.trim())}>
          {envoi ? "Ajout…" : "Ajouter"}
        </Bouton>
        <Bouton variant="blanc" taille="md" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

/**
 * Les IA à consulter (ChatGPT, Gemini, Mistral, DeepSeek, Grok…) : on les ajoute avec leur clé API,
 * et les agents peuvent les interroger. Elles s'affichent dans Réglages du serveur › Fournisseurs.
 * `lieu` : celles d'un VPS relié (la clé reste sur le VPS) ; absent : celles de ce poste.
 * La clé ne revient jamais à l'interface.
 */
export function useAutresIa(lieu: string | null = null) {
  const bridge = getBridge()?.ia;
  const [catalogue, setCatalogue] = useState<CatalogueIa | null>(null);
  const [liste, setListe] = useState<AutreIa[]>([]);
  const [tests, setTests] = useState<Record<string, TestIa>>({});

  useEffect(() => {
    if (!bridge) return;
    void bridge.fournisseurs(lieu).then((r) => r.ok && setCatalogue(r.data));
    void bridge.lister(lieu).then((r) => r.ok && setListe(r.data));
  }, [bridge, lieu]);

  const tester = useCallback(
    async (id: string) => {
      if (!bridge) return;
      setTests((t) => ({ ...t, [id]: { etat: "en-cours" } }));
      const r = await bridge.tester(id, lieu);
      setTests((t) => ({ ...t, [id]: r.ok ? { etat: "ok" } : { etat: "erreur", message: r.message } }));
    },
    [bridge, lieu],
  );
  const retirer = useCallback(
    async (id: string) => {
      const r = await bridge?.retirer(id, lieu);
      if (r?.ok) setListe(r.data);
    },
    [bridge, lieu],
  );

  return { disponible: !!bridge, catalogue, liste, setListe, tests, tester, retirer };
}
