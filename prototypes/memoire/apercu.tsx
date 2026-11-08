import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoireVue } from "@/components/memoire/MemoireVue";
import { cleMemoire, decoderMemoire, type CaptureMemoire } from "@/lib/memoire";
import "@/styles/memoire.css";
import "./apercu.css";

function Apercu() {
  const [vue, setVue] = useState<"memoire" | "chat">("memoire");
  const [capture, setCapture] = useState<CaptureMemoire | null>(null);
  const [exemple, setExemple] = useState(() => { try { return decoderMemoire(localStorage.getItem(cleMemoire("apercu-klyra-memoire"))).length === 0; } catch { return false; } });
  const contenu = "Je veux un prototype simple dans KLYRA, sans Obsidian. Une page avec un réseau de notes reliées, dans klyra-app.";
  return <div className="apercu-coque">
    <nav className="apercu-rail" aria-label="Aperçu KLYRA"><span className="apercu-logo" title="KLYRA">K<span>•</span></span><button onClick={() => setVue("chat")} className={vue === "chat" ? "actif" : ""} aria-label="Échange de démonstration">◇<small>Chat</small></button><button onClick={() => setVue("memoire")} className={vue === "memoire" ? "actif" : ""} aria-label="Page Mémoire">✳<small>Mémoire</small></button><span className="apercu-rail-bas">KLYRA<br/>Prototype</span></nav>
    <div className="apercu-fenetre"><div className="apercu-barre"><span>KLYRA <span>/</span> {vue === "memoire" ? "Mémoire" : "Chat"}</span><span>Aperçu interactif de la page · données locales de test</span></div>
      {vue === "memoire" ? <MemoireVue key={capture?.source.messageId ?? "memoire"} lieu="apercu-klyra-memoire" projets={[{ id: "klyra", name: "KLYRA-app" }]} capture={capture} exempleInitial={exemple && !capture} ouvrirSource={() => setVue("chat")} captureTerminee={() => { setCapture(null); setExemple(false); }} /> : <section className="apercu-chat"><span>Échange de démonstration · parcours de capture</span><h1>Une mémoire dans klyra-app</h1><article data-message="demonstration"><h2>Demande de prototype</h2><p>{contenu}</p><button className="memoire-bouton memoire-principal" onClick={() => { setExemple(false); setCapture({ contenu, projetId: "klyra", source: { chatId: "demonstration", messageId: "demonstration", titre: "Une mémoire dans klyra-app · démonstration", extrait: contenu } }); setVue("memoire"); }}>Garder en mémoire</button></article><p>Dans klyra-app, cette action est ajoutée au menu des messages. Rien n’est envoyé à un agent.</p><button className="memoire-bouton" onClick={() => setVue("memoire")}>Revenir à la mémoire</button></section>}
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Apercu/>);
