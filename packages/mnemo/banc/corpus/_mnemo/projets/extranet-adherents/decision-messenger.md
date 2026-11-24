---
id: 01JBANC0000000000000000019
type: sujet
updated: 2026-09-18
---
# Décision : Messenger pour les exports

Refonte des exports de remboursements, septembre 2026.

## Informations
- Les exports CSV des remboursements passent par Symfony Messenger avec un transport Redis, à la place de la tâche cron de nuit | declare | src: utilisateur entretien | appris 2026-09-18 | confiance 100 % ^f-0001
- La tâche cron dépassait 40 minutes et bloquait les sauvegardes | declare | src: utilisateur entretien | appris 2026-09-18 | confiance 100 % ^f-0002

## Relations
- projet [[projets/extranet-adherents/extranet-adherents]]
