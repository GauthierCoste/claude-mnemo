---
id: 01JBANC0000000000000000022
type: dossier
portee: projet:suivi-tournees
updated: 2026-11-10
---
# Suivi des tournées

API et application mobile pour suivre les livraisons en temps réel.

## Informations
- API Platform 4 sur PostgreSQL, avec PostGIS pour les positions | declare | src: utilisateur entretien | appris 2026-11-10 | confiance 100 % ^f-0001
- Chaque camion envoie sa position GPS toutes les 30 secondes | declare | src: utilisateur entretien | appris 2026-11-10 | confiance 100 % ^f-0002
- La preuve de livraison est une photo et une signature du destinataire | observe | src: [[sources/cahier-des-charges-tournees]] | appris 2026-09-30 | confiance 100 % ^f-0003
- L'application mobile est réalisée par l'agence Pixelmer, à Saint-Nazaire | declare | src: utilisateur entretien | appris 2026-11-10 | confiance 100 % ^f-0004

## CLAUDE.md du projet
Ce dépôt contient l'API (dossier `api/`) et l'application mobile (dossier `mobile/`, livrée par l'agence).

### Démarrer
- `make up` lance PostgreSQL, PostGIS et l'API dans Docker.
- `make flotte` lance le simulateur de flotte : il rejoue la journée du 3 octobre, quarante camions, positions comprises.

### Règles
- Ne jamais pousser directement sur la branche principale : une demande de fusion, relue par Bastien.
- Les migrations de base se nomment par date et par ticket.

## Relations
- client [[clients/transports-mercier/transports-mercier]]
- contact [[personnes/bastien-mercier]]
- stack [[stacks/api-platform]]
- cahier des charges [[sources/cahier-des-charges-tournees]]
