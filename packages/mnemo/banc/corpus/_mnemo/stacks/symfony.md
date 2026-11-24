---
id: 01JBANC0000000000000000029
type: sujet
portee: stack:symfony
updated: 2026-11-10
---
# Symfony

Le cadre de tous les projets PHP.

## Informations
- Sur les nouveaux projets, le composant Scheduler remplace cron | declare | src: utilisateur entretien | appris 2026-11-10 | confiance 100 % ^f-0001
- PHP 8.3 au minimum sur tous les projets | declare | src: utilisateur entretien | appris 2026-11-10 | confiance 100 % ^f-0002
- Rector est lancé à chaque montée de version majeure | declare | src: utilisateur entretien | appris 2026-11-10 | confiance 100 % ^f-0003

## Conventions de code
Les contrôleurs restent minces : la logique vit dans des services, injectés par le constructeur.

Les tests de bout en bout tournent avec Panther, dans un conteneur Chrome sans interface, la nuit sur la branche principale.
