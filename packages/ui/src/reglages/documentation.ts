/**
 * Contenu de l'onglet Documentation de la vue Réglages : une seule page, en sections (sommaire du panneau), registre neutre et
 * technique. Chaque affirmation est vérifiée dans le code du service (`packages/mnemo`) ; les chiffres sont les valeurs par
 * défaut (`domaine/reglages.ts`, `domaine/regles.ts`). Dans un texte, `**gras**` et `` `code` `` sont rendus comme tels. Le
 * tableau des capacités prend noms, symboles et caractère toujours actif dans `profils/hooks.ts` ; ce fichier n'en donne que
 * l'effet, par hook.
 */
import type { EvenementHookVue } from '@mnemo/contrat';

export type BlocDoc =
	| { genre: 'definitions'; termes: readonly (readonly [string, string])[] }
	| { genre: 'etapes'; etapes: readonly string[] }
	| { genre: 'tableau'; legende: string; colonnes: readonly string[]; lignes: readonly (readonly string[])[] }
	| { genre: 'capacites'; effets: Readonly<Record<EvenementHookVue, string>> }
	| { genre: 'intertitre'; texte: string }
	| { genre: 'note'; texte: string };

export type SectionDoc = { id: string; titre: string; blocs: readonly BlocDoc[] };

export const SECTIONS_DOC: readonly SectionDoc[] = [
	{
		id: 'doc-principe',
		titre: 'Principe',
		blocs: [
			{
				genre: 'definitions',
				termes: [
					['Mémoire', 'fiches Markdown dans `_mnemo/`, versionnées par git.'],
					['Écriture', 'sous verrou, un commit par écriture : `mnemo: <action> <chemin>`.'],
					['Moteurs', 'Claude Code, Codex, Mistral Vibe ; serveur MCP et hooks (Réglages › Branchements).'],
					['Outils MCP', '`chercher`, `lire`, `lister`, `voisins`, `chronologie`, `contexte`, `proposer`, `entretenir`, `deplacer`, `extraire_source`, `diagnostiquer`.'],
					['Local', 'embeddings et reranker sur le poste ; seul ce qui est injecté ou lu part chez le fournisseur.'],
				],
			},
		],
	},
	{
		id: 'doc-session',
		titre: 'Session',
		blocs: [
			{
				genre: 'capacites',
				effets: {
					debut: 'branche et commit de départ ; rien d’injecté',
					message: 'consignes permanentes, fiche de position, injections automatiques, pistes',
					outil: 'refuse une action contraire à une consigne `verifiee`',
					apres_outil: 'fiches lues ou écrites notées, plus proposées',
					arret: 'session « attend une réponse »',
					fin: 'sans bilan : épisode minimal sans IA (objectif, dates, branche, fichiers)',
				},
			},
			{ genre: 'note', texte: 'Sans Souffle : rien d’injecté ; les outils MCP restent disponibles.' },
			{
				genre: 'note',
				texte: 'Projet : dossier avec un marqueur (`.git`, `package.json`…, Réglages › Mémoire › Rappel), ◆ dans l’arbre des dossiers.',
			},
		],
	},
	{
		id: 'doc-agents',
		titre: 'Agents',
		blocs: [
			{
				genre: 'definitions',
				termes: [
					['Fiche', '`_mnemo/profils/<nom>/<nom>.md`.'],
					['Classe', 'moteur et modèle ; moteur non lié verrouillé.'],
					['Mission', 'consigne ajoutée aux instructions système.'],
					[
						'Skills',
						'`_mnemo/skills/<nom>/SKILL.md` et `_mnemo/profils/<nom>/skills/` (prioritaire) ; chargées selon `description` ; icône : `metadata.icone`.',
					],
					['Skill fournie', 'de l’archiviste : modifiable, rétablissable ; ni renommée ni supprimée.'],
					['Plugins', 'Claude Code : cochés activés, autres désactivés.'],
					['Capacités', 'Agents › Capacités.'],
					['Départ', '`_mnemo/` ou dossier choisi au lancement.'],
				],
			},
		],
	},
	{
		id: 'doc-rappel',
		titre: 'Rappel',
		blocs: [
			{
				genre: 'etapes',
				etapes: [
					'Candidates : projet, fiches nommées, voisines des injections à la main.',
					'Note : sens et signaux, puis modèle appris ; % si modèle accepté.',
					'Décision : injectée entière, piste (titre, chemin, première phrase), ou rien.',
				],
			},
			{
				genre: 'tableau',
				legende: 'Réglages › Mémoire › Rappel',
				colonnes: ['Réglage', 'Effet', 'Défaut'],
				lignes: [
					['Seuil d’injection', 'note minimale d’injection automatique', '90 %'],
					['Fiches injectées', 'injections automatiques par message', '2'],
					['Seuil des pistes', 'note minimale d’une piste', '10 %'],
					['Pistes proposées', 'pistes par message', '3'],
					['Fiches nommées', 'cartes de fiches citées par message', '5'],
					['Poids d’une injection à la main', 'bonus des voisines', '0,25'],
					['Demi-vie', 'messages pour diviser ce bonus par deux', '3'],
				],
			},
			{ genre: 'note', texte: 'Sans modèle accepté : aucune injection automatique. Sans note apprise : pistes au premier message et après une injection à la main.' },
		],
	},
	{
		id: 'doc-recherche',
		titre: 'Recherche',
		blocs: [
			{
				genre: 'tableau',
				legende: 'Réglages › Mémoire › Recherche (`chercher`, interface)',
				colonnes: ['Réglage', 'Effet', 'Défaut'],
				lignes: [
					['Projet en cours', 'bonus, voisinage du projet', '0,1'],
					['Confiance', 'malus maximal, faible confiance', '0,05'],
					['Fiches de la mémoire', 'bonus, hors documents', '0,05'],
					['Fraîcheur', 'bonus, divisé par deux après un an', '0,05'],
					['Seuil de rappel', 'pertinence minimale', '0,4'],
					['Similarité min.', 'sens minimal (carte Rappel)', '0,45'],
					['Résultats / recherche', 'résultats par défaut', '10'],
					['Chronologie', 'faits de `chronologie`', '30'],
					['Graphe', 'fiches dont les liens sont suivis', '5'],
					['Reranker', 'candidats reclassés', '40'],
				],
			},
		],
	},
	{
		id: 'doc-confiance',
		titre: 'Confiance',
		blocs: [
			{ genre: 'note', texte: 'Confiance = fiabilité de la source × poids de la nature ; `email` observé : 0,7 × 0,85 ≈ 0,6.' },
			{
				genre: 'tableau',
				legende: 'Fiabilité par source (Réglages › Mémoire › Confiance)',
				colonnes: ['Type de source', 'Fiabilité'],
				lignes: [
					['`utilisateur`, `contrat`', '1'],
					['`spec_validee`', '0,9'],
					['`compte_rendu`', '0,8'],
					['`email`', '0,7'],
					['`note`, `session`', '0,6'],
					['`deduction`', '0,5'],
					['`inconnue`', '0,3'],
				],
			},
			{
				genre: 'definitions',
				termes: [
					['Nature', '`declare` 1 · `observe` 0,85 · `infere` 0,7.'],
					['Sources multiples', '1 − Π(1 − cᵢ), plafond 0,9 (1 avec `utilisateur`, `contrat`).'],
					[
						'À confirmer',
						'`infere`, contradiction d’une source plus fiable, `montant`, `echeance`, `perimetre`, type éteint dans « L’archiviste écrit seul… ». Validation : Mémoire › Archiviste › À arbitrer.',
					],
				],
			},
			{ genre: 'intertitre', texte: 'Consignes' },
			{
				genre: 'tableau',
				legende: 'Niveaux d’une consigne',
				colonnes: ['Niveau', 'Injection', 'Montée proposée'],
				lignes: [
					['`rappelee`', 'premier message, puis si mentionnée', '`toujours` après 2 redites'],
					['`toujours`', 'chaque message', '`verifiee` si `regle`'],
					['`verifiee`', 'chaque message ; Bouclier applique `chemins_interdits`, `commandes_interdites`', '—'],
				],
			},
			{ genre: 'note', texte: 'Montée : sur confirmation (À arbitrer).' },
		],
	},
	{
		id: 'doc-archiviste',
		titre: 'Archiviste',
		blocs: [
			{
				genre: 'definitions',
				termes: [
					['Profil', '`archiviste`, Claude Code, dans `_mnemo/` (racine en `--add-dir`).'],
					['Rôle', 'sources (`extraire_source`), ménage (`diagnostiquer`, `entretenir`, `deplacer`).'],
					['Skills', '`_mnemo/profils/archiviste/skills/` : `emails`, `specs`, `comptes-rendus`, `menage`.'],
					['Sans confirmation', 'types allumés (Réglages › Mémoire › Confiance).'],
					['À arbitrer', 'faits à confirmer, montées, lots (`proposer_lot`).'],
				],
			},
		],
	},
];
