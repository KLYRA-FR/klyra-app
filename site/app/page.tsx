import type { Metadata } from "next";
import { Homepage } from "../components/homepage/Homepage";

const description = "Une app sur ton ordinateur. L’assistant répartit le travail entre les agents et te rend le résultat vérifié, avec ton compte Claude, ChatGPT ou Grok.";

export const metadata: Metadata = {
  title: { absolute: "KLYRA — Confie le travail à ton équipe d’agents IA." },
  description,
  openGraph: {
    title: "KLYRA — Confie le travail à ton équipe d’agents IA.",
    description,
    type: "website",
    locale: "fr_FR",
  },
};

export default function Accueil() {
  return <Homepage />;
}
