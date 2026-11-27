import { DOSSIERS_FIXES, PROFIL_ARCHIVISTE } from '@mnemo/commun';

/** Une définition : le terme, puis le texte. */
const def = (terme: string, definition: string): readonly [string, string] => [terme, definition];

/**
 * Réglages › Documentation : la page et le texte de chaque section. Dans un texte, `**gras**` et `` `code` `` sont rendus
 * comme tels. La structure des sections (blocs, ordre) est dans `reglages/documentation.ts`.
 */
export const documentation = {
	page: { titre: 'Documentation', sommaire: 'Sommaire' },
	capacites: {
		legende: 'Capacités et hooks, dans l’ordre de la session (Agents › Capacités)',
		colonnes: ['Capacité', 'Hook', 'Effet', 'Réglable'],
		toujours: 'non, toujours actif',
		reglable: 'oui',
	},
	principe: {
		titre: 'Principe',
		termes: [
			def('Mémoire', 'fiches Markdown dans `_mnemo/`, versionnées par git.'),
			def('Écriture', 'sous verrou, un commit par écriture : `mnemo: <action> <chemin>`.'),
			def('Moteurs', 'Claude Code, Codex, Mistral Vibe ; serveur MCP et hooks (Réglages › Branchements).'),
			def('Outils MCP', '`chercher`, `lire`, `lister`, `voisins`, `chronologie`, `contexte`, `proposer`, `entretenir`, `deplacer`, `extraire_source`, `diagnostiquer`.'),
			def('Local', 'embeddings et reranker sur le poste ; seul ce qui est injecté ou lu part chez le fournisseur.'),
		],
	},
	session: {
		titre: 'Session',
		effets: {
			debut: 'branche et commit de départ ; rien d’injecté',
			message: 'consignes permanentes, fiche de position, injections automatiques, pistes',
			outil: 'refuse une action contraire à une consigne `verifiee`',
			apres_outil: 'fiches lues ou écrites notées, plus proposées',
			arret: 'session « attend une réponse »',
			fin: 'sans bilan : épisode minimal sans IA (objectif, dates, branche, fichiers)',
		},
		sansSouffle: 'Sans Souffle : rien d’injecté ; les outils MCP restent disponibles.',
		projet: 'Projet : dossier avec un marqueur (`.git`, `package.json`…, Réglages › Mémoire › Rappel), ◆ dans l’arbre des dossiers.',
	},
	agents: {
		titre: 'Agents',
		termes: [
			def('Fiche', `\`_mnemo/${DOSSIERS_FIXES.profils}/<nom>/<nom>.md\`.`),
			def('Classe', 'moteur et modèle ; moteur non lié verrouillé.'),
			def('Mission', 'consigne ajoutée aux instructions système.'),
			def(
				'Skills',
				`\`_mnemo/${DOSSIERS_FIXES.skills}/<nom>/SKILL.md\` et \`_mnemo/${DOSSIERS_FIXES.profils}/<nom>/${DOSSIERS_FIXES.skills}/\` (prioritaire) ; chargées selon \`description\` ; icône : \`metadata.icone\`.`,
			),
			def('Skill fournie', 'de l’archiviste : modifiable, rétablissable ; ni renommée ni supprimée.'),
			def('Plugins', 'Claude Code : cochés activés, autres désactivés.'),
			def('Capacités', 'Agents › Capacités.'),
			def('Départ', '`_mnemo/` ou dossier choisi au lancement.'),
		],
	},
	rappel: {
		titre: 'Rappel',
		etapes: [
			'Candidates : projet, fiches nommées, voisines des injections à la main.',
			'Note : sens et signaux, puis modèle appris ; % si modèle accepté.',
			'Décision : injectée entière, piste (titre, chemin, première phrase), ou rien.',
		],
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
			['Réapprentissage automatique', 'note réapprise en fond sur les gestes, au plus une fois par jour', 'oui'],
		],
		note: 'Sans modèle accepté : aucune injection automatique. Sans note apprise : pistes au premier message et après une injection à la main.',
	},
	recherche: {
		titre: 'Recherche',
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
	confiance: {
		titre: 'Confiance',
		formule: 'Confiance = fiabilité de la source × poids de la nature ; `email` observé : 0,7 × 0,85 ≈ 0,6.',
		legendeSources: 'Fiabilité par source (Réglages › Mémoire › Confiance)',
		colonnesSources: ['Type de source', 'Fiabilité'],
		lignesSources: [
			['`utilisateur`, `contrat`', '1'],
			['`spec_validee`', '0,9'],
			['`compte_rendu`', '0,8'],
			['`email`', '0,7'],
			['`note`, `session`', '0,6'],
			['`deduction`', '0,5'],
			['`inconnue`', '0,3'],
		],
		termes: [
			def('Nature', '`declare` 1 · `observe` 0,85 · `infere` 0,7.'),
			def('Sources multiples', '1 − Π(1 − cᵢ), plafond 0,9 (1 avec `utilisateur`, `contrat`).'),
			def(
				'À confirmer',
				'`infere`, contradiction d’une source plus fiable, `montant`, `echeance`, `perimetre`, type éteint dans « L’archiviste écrit seul… ». Validation : Mémoire › Archiviste › À arbitrer.',
			),
		],
		consignes: 'Consignes',
		legendeNiveaux: 'Niveaux d’une consigne',
		colonnesNiveaux: ['Niveau', 'Injection', 'Montée proposée'],
		lignesNiveaux: [
			['`rappelee`', 'premier message, puis si mentionnée', '`toujours` après 2 redites'],
			['`toujours`', 'chaque message', '`verifiee` si `regle`'],
			['`verifiee`', 'chaque message ; Bouclier applique `chemins_interdits`, `commandes_interdites`', '—'],
		],
		montee: 'Montée : sur confirmation (À arbitrer).',
	},
	archiviste: {
		titre: 'Archiviste',
		termes: [
			def('Profil', `\`${PROFIL_ARCHIVISTE}\`, Claude Code, dans \`_mnemo/\` (racine en \`--add-dir\`).`),
			def('Rôle', 'sources (`extraire_source`), ménage (`diagnostiquer`, `entretenir`, `deplacer`).'),
			def('Skills', `\`_mnemo/${DOSSIERS_FIXES.profils}/${PROFIL_ARCHIVISTE}/${DOSSIERS_FIXES.skills}/\` : \`emails\`, \`specs\`, \`comptes-rendus\`, \`menage\`.`),
			def('Sans confirmation', 'types allumés (Réglages › Mémoire › Confiance).'),
			def('À arbitrer', 'faits à confirmer, montées, lots (`proposer_lot`).'),
		],
	},
};
