# Décisions

Une ligne par décision structurante encore valable. Les détails restent dans le document cité. L'historique complet est dans `docs/JOURNAL.md`, qui n'est plus tenu à jour depuis le 04/11/2026.

| Date | Décision | Source |
|---|---|---|
| 2026-11-01 | Un VPS par personne, relié par Tailscale, avec l'abonnement de la personne | `docs/VPS-AGENTS-PLAN.md` |
| 2026-11-01 | KLYRA reste séparé d'OpenBot sur une même machine : utilisateur, ports, dossiers | `docs/VPS-AGENTS-PLAN.md` |
| 2026-11-01 | Flux SSE plutôt que WebSocket entre l'app et le VPS | `docs/VPS-AGENTS-PLAN.md` |
| 2026-11-02 | Un ticket est un fil. Les rappels restent à part, affichés ensemble | `src/lib/tickets.ts` |
| 2026-11-03 | Consommer moins : proposer sans imposer, mesurer avant d'affirmer, ne rien perdre en qualité | `docs/consignes/fournisseurs.md` |
| — | Fusionner sur `main` publie l'app pour tous | `docs/CONTRIBUER.md` |
| — | Le journal super-agent reste sur le poste, rien ne part vers Convex | `docs/SUPERAGENT.md` |
| 2026-11-04 | klyra-app est l'outil de référence de l'équipe. Le circuit multi-agents s'y construit, OpenBot n'est pas étendu | Corentin |
| 2026-11-04 | Le circuit est une fonction de l'app pour tout projet de KLYRA-FR, pas un outil réservé à ce dépôt. Les Apps sont installées sur tous les dépôts de l'organisation, `accesDepots` limite par personne et par dépôt | Corentin, `docs/JETONS-GITHUB.md` |
| 2026-11-04 | Le verrou d'une Issue est la création de sa branche, atomique sur GitHub, sans service à ajouter | `electron/collaboration/reservation.ts` |
| 2026-11-04 | Pour le travail partagé, les Issues et les PR font foi. Une Issue est une unité de travail | `docs/consignes/collaboration.md` |
| 2026-11-04 | Le dépôt reste public pendant le pilote : aucun nom de client dans les Issues, contenu d'auteurs extérieurs ignoré par les agents | Corentin |
| 2026-11-04 | Pendant le pilote, Corentin fusionne les PR d'agents | Corentin |
| 2026-11-04 | Review automatique par un agent dès le risque moyen, distincte de la QA d'Agathe, qui reste sur demande | Corentin |
| 2026-11-04 | Consignes rangées par sujet et non par dossier : `electron/` est trop vaste, et tous les fournisseurs lisent le même index | `AGENTS.md` |
