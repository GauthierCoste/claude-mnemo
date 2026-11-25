// Coefficients de la note de confiance, un modèle par niveau (spec classement vivant § 4.2). Données écrites par
// `mnemo banc contexte --apprendre` : aucun texte de fiche ni de message. Un modèle non accepté ne note rien (ordre seul).

import type { CoefficientsNote } from './modele-de-note.ts';

export const COEFFICIENTS_NOTE: CoefficientsNote = {
	"complets": {
		"accepte": false,
		"biais": 0,
		"poids": {},
		"methodeCosinus": "mediane",
		"requete": "seule",
		"lambda": null,
		"abstention": null,
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
		"abstention": null,
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
