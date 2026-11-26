// Coefficients de la note de confiance, un modèle par niveau (spec classement vivant § 4.2). Données écrites par
// `mnemo banc contexte --apprendre --module` : aucun texte de fiche ni de message. Valeur par défaut : les coefficients appris
// d'une mémoire sont dans son `.mnemo/coefficients-note.json`. Un modèle non accepté ordonne sans % ni injection (ordre seul) ;
// un modèle de départ (`--depart`, `origine` `depart`) aussi, jusqu'à ce que la mémoire apprenne le sien.

import type { CoefficientsNote } from './modele-de-note.ts';

export const COEFFICIENTS_NOTE: CoefficientsNote = {
	"complets": {
		"origine": "depart",
		"accepte": false,
		"biais": -1.54371,
		"poids": {
			"logit": 0.280232,
			"cosinusRelatif": 5.31323,
			"bm25Relatif": 0.0316648,
			"signalSession": 1.5,
			"apriori": 0
		},
		"methodeCosinus": "mediane",
		"requete": "seule",
		"lambda": 0.003,
		"converge": true,
		"apprisLe": "2026-11-26T20:53:08.842Z",
		"gguf": {
			"sens": null,
			"reranker": null
		},
		"echelle": null,
		"paires": 2093,
		"messages": 133,
		"sessions": 28,
		"mesures": {
			"seuil": 0.9,
			"injections": 1,
			"nonJugees": 1,
			"horsPileFausses": 0,
			"precision": null,
			"precisionPessimiste": 0,
			"wilsonBassePessimiste": 0,
			"bootstrapP025": 0,
			"sessions": 1,
			"injectionsParMessage": 0.0075188,
			"silences": 5,
			"partSilencesAvecInjection": 0,
			"pente": 1.01644,
			"ordonnee": 0.043047,
			"ece": 0.405913,
			"rappel": 0,
			"utilesAtteintes": 0.1625,
			"rappel10": 0.625,
			"pirePrecision": 0
		},
		"refus": [
			"note de départ, à entraîner"
		]
	},
	"sens": {
		"origine": "depart",
		"accepte": false,
		"biais": -4.33211,
		"poids": {
			"cosinusRelatif": 10.4429,
			"bm25Relatif": 0.668,
			"signalSession": 1.5,
			"apriori": 0
		},
		"methodeCosinus": "mediane",
		"requete": "seule",
		"lambda": 0.003,
		"converge": true,
		"apprisLe": "2026-11-26T20:53:08.842Z",
		"gguf": {
			"sens": null,
			"reranker": null
		},
		"echelle": null,
		"paires": 2333,
		"messages": 133,
		"sessions": 28,
		"mesures": {
			"seuil": 0.9,
			"injections": 0,
			"nonJugees": 0,
			"horsPileFausses": 0,
			"precision": null,
			"precisionPessimiste": null,
			"wilsonBassePessimiste": 0,
			"bootstrapP025": null,
			"sessions": 0,
			"injectionsParMessage": 0,
			"silences": 5,
			"partSilencesAvecInjection": 0,
			"pente": 0.91082,
			"ordonnee": -0.299033,
			"ece": 0.46836,
			"rappel": 0,
			"utilesAtteintes": 0.0875,
			"rappel10": 0.5875,
			"pirePrecision": 0
		},
		"refus": [
			"note de départ, à entraîner"
		]
	}
};
