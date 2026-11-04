# KLYRA — app de bureau

L’outil de l’équipe KLYRA : des agents, des conversations, des projets et des automatisations, dans une app de bureau pour Mac et Windows. Les agents tournent sur le poste ou sur un VPS, et l’équipe partage ses comptes et sa bibliothèque par Convex.

## Lancer l’app

```bash
pnpm install
pnpm desktop        # l’app de bureau, avec rechargement à chaud
pnpm dev            # la même interface dans le navigateur : http://localhost:3100
```

Version finale (sans serveur de dev) :

```bash
pnpm start:desktop
```

## Vérifier avant de livrer

```bash
pnpm typecheck && pnpm lint && pnpm build
pnpm test:smoke     # ouvre la version finale sans fenêtre et vérifie qu’elle s’affiche
```

## Contribuer et publier

Une branche par sujet, une pull request, la vérification verte, puis la fusion : voir [docs/CONTRIBUER.md](docs/CONTRIBUER.md). **Chaque fusion sur `main` publie une version pour tous les utilisateurs**, dans [KLYRA-FR/klyra-app-versions](https://github.com/KLYRA-FR/klyra-app-versions/releases/latest) : c’est là qu’on télécharge l’app, et là que les apps installées trouvent leurs mises à jour.

## Où sont les choses

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : la carte du dépôt.
- [AGENTS.md](AGENTS.md) : les consignes pour les agents.
- [docs/DECISIONS.md](docs/DECISIONS.md) : les décisions qui portent encore.
