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

- `poids_declare` : poids d'un fait déclaré par une personne.
- `poids_observe` : poids d'un fait observé directement.
- `poids_infere` : poids d'un fait déduit.
- `seuil_rappel` : confiance minimale (entre 0 et 1) pour qu'un fait soit rappelé.
- `repetitions_pour_monter` : nombre de répétitions d'une consigne avant de proposer le niveau supérieur.
- `fiabilites` : fiabilité de chaque type de source (utilisateur, contrat, spec_validee, compte_rendu, email, note, session, deduction), plus `inconnue` pour une source dont le type n'est pas reconnu.
- `categories_a_enjeu` : catégories de faits à fort enjeu, toujours soumises à confirmation.
