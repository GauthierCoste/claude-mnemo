---
id: 01JBANC0000000000000000039
type: source
updated: 2026-09-30
type_source: spec_validee
date: 2026-09-30
auteur: Bastien Mercier
---
# Cahier des charges — suivi des tournées

## Contenu

```markdown
# Cahier des charges — suivi des tournées

## Contexte

Transports Mercier livre des palettes dans le Grand Ouest. Les tournées sont aujourd'hui suivies par téléphone.

## Application chauffeur

- Liste des arrêts de la tournée du jour, dans l'ordre de passage.
- Scan du code-barres de chaque palette au chargement et à la livraison.
- Preuve de livraison : photo de la palette déposée et signature du destinataire sur l'écran.

## Back-office

- Carte des camions en temps réel.
- Alerte au responsable d'exploitation quand un arrêt prend plus de 20 minutes de retard.

## Exigences

L'application doit fonctionner hors connexion pendant 4 heures et envoyer ses données au retour du réseau.
Les données de position sont conservées 13 mois, puis supprimées.
```
