// Coefficients de la note de confiance, un modèle par niveau (spec classement vivant § 4.2). Données écrites par
// `mnemo banc contexte --apprendre --module` : aucun texte de fiche ni de message. Valeur par défaut : les coefficients appris
// d'une mémoire sont dans son `.mnemo/coefficients-note.json`. Un modèle non accepté ne note rien (ordre seul).

import type { CoefficientsNote } from './modele-de-note.ts';

export const COEFFICIENTS_NOTE: CoefficientsNote = {
	"complets": {
		"accepte": false,
		"biais": 0,
		"poids": {},
		"methodeCosinus": "mediane",
		"requete": "seule",
		"lambda": null,
		"converge": true,
		"apprisLe": null,
		"gguf": {
			"sens": null,
			"reranker": null
		},
		"paires": 0,
		"messages": 0,
		"sessions": 0,
		"mesures": null,
		"refus": [
			"pas encore appris"
		]
	},
	"sens": {
		"accepte": false,
		"biais": 0,
		"poids": {},
		"methodeCosinus": "mediane",
		"requete": "seule",
		"lambda": null,
		"converge": true,
		"apprisLe": null,
		"gguf": {
			"sens": null,
			"reranker": null
		},
		"paires": 0,
		"messages": 0,
		"sessions": 0,
		"mesures": null,
		"refus": [
			"pas encore appris"
		]
	}
};
