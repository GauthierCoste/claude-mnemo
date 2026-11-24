---
poids_declare: 1
poids_observe: 0.85
poids_infere: 0.7
seuil_rappel: 0.4
repetitions_pour_monter: 2
fiabilites:
  utilisateur: 1
  contrat: 1
  spec_validee: 0.9
  compte_rendu: 0.8
  email: 0.7
  note: 0.6
  session: 0.6
  deduction: 0.5
  inconnue: 0.3
categories_a_enjeu: [montant, echeance, perimetre]
---
# Schéma de la mémoire

Les règles de Mnemo sont dans l'en-tête ci-dessus ; modifiez-les ici, elles s'appliquent aussitôt.

## Réglages

- `poids_declare` : poids d'une information déclarée par une personne.
- `poids_observe` : poids d'une information observée directement.
- `poids_infere` : poids d'une information déduite.
- `seuil_rappel` : pertinence minimale (entre 0 et 1) d'un résultat de recherche pour qu'il soit rappelé ; la confiance d'une information ne pèse que sur son rang, elle ne la cache jamais.
- `repetitions_pour_monter` : nombre de répétitions d'une consigne avant de proposer le niveau supérieur.
- `fiabilites` : fiabilité de chaque type de source (utilisateur, contrat, spec_validee, compte_rendu, email, note, session, deduction), plus `inconnue` pour une source dont le type n'est pas reconnu.
- Confiance d'une information à plusieurs sources : `1 − Π(1 − cᵢ)`, où `cᵢ` est la confiance que chaque source donnerait seule (fiabilité de son type × poids de la nature), une même référence ne comptant qu'une fois ; plafonnée à 0,9 sauf si l'une des sources est `utilisateur` ou `contrat` ou dépasse seule 0,9, et jamais sous la meilleure source seule.
- `categories_a_enjeu` : catégories d'informations à fort enjeu, toujours soumises à confirmation.
