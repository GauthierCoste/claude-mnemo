/**
 * Données fictives du mode démo (`?demo`, en développement seulement) : un dossier de projets, huit sessions sur quatre
 * dossiers (plus l'archiviste et une session terminée), une petite mémoire au format des fiches, le fil du jour et les
 * sorties de terminal. Jamais dans la construction.
 */
import { ACCENT_PAR_DEFAUT, PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { ChampReglageVue, EtatSessionVue, RaisonCarteVue } from '@mnemo/contrat';

/** Dossier des projets dans la mémoire fictive de la démo : la position d'une session de démo est `<ce dossier>/<dossier>`. */
export const DOSSIER_DES_PROJETS_DEMO = 'projets';

export const RACINE_DEMO = '~/Developer';
/** `RACINE_DEMO` en chemin absolu (ce que « Chemin copié » copie). */
export const RACINE_ABSOLUE_DEMO = '/Users/demo/Developer';

export type SessionDemo = {
	id: string;
	profil: string;
	dossier: string;
	objectif: string;
	etat: EtatSessionVue;
	/** Âge de la session, en minutes. */
	ageMin: number;
	/** Dernière activité, en minutes. */
	calmeMin: number;
	branche: string | null;
	/** Fiches servies (chemins, ou `chemin#f-NNNN` pour un fait). */
	servis: string[];
	/** Classées sans être servies, avec leur note fictive (classement en direct du panneau Contexte). */
	classees?: [string, number][];
	/** Pistes ◇ proposées au dernier message (format actuel : la fiche de position ◆ est dans `servis`, le classement reste vide). */
	pistes?: PisteDemo[];
	/** Fiches que la session a lues (panneau Contexte), avec les minutes écoulées entre le début de la session et leur lecture. */
	lues?: [string, number][];
	/** Faux : session suivie sans terminal dans Mnemo (vrai par défaut). */
	terminal?: boolean;
	/** Moteur et modèle de la session (absents : Claude Code, modèle par défaut). */
	moteur?: 'claude-code' | 'codex';
	modele?: string;
	/** Pourquoi elle ne peut être ni mise en pause ni reprise (Codex dont aucun hook n'est arrivé). */
	sansReprise?: string;
	/**
	 * Écran du terminal : [genre, texte] ; u = utilisateur, m = Mnemo, t = outil, r = résultat, a = réponse, q = question,
	 * w = avertissement écrit par le service en tête du terminal (`[Mnemo] …`, tel quel).
	 */
	ecran: ['u' | 'm' | 't' | 'r' | 'a' | 'q' | 'w', string][];
};

/** Une piste ◇ fictive : la fiche, sa raison, et pour `liee` la fiche injectée à la main d'où vient le poids. */
export type PisteDemo = { id: string; raison: RaisonCarteVue; depuis?: string };

export const SESSIONS_DEMO: SessionDemo[] = [
	{
		id: '7f3a2c4e-1b9d-4e57-a0c2-5d18e6f0a7b1',
		profil: PROFIL_TRAVAIL,
		dossier: 'erp-saas',
		objectif: 'Refondre le module stocks pour gérer les lots',
		etat: 'attend',
		ageMin: 77 * 60,
		calmeMin: 6,
		branche: 'feat/stocks-lots',
		servis: ['projets/erp-saas/Module stocks.md'],
		pistes: [
			{ id: 'consignes/Migrations réversibles.md', raison: 'perimetre' },
			{ id: 'projets/erp-saas/Multi-tenant.md', raison: 'perimetre' },
			{ id: 'stacks/PostgreSQL.md', raison: 'nommee' },
			{ id: 'sources/cdc-stocks-v2.md', raison: 'question' },
			{ id: 'episodes/erp-saas/2026-11-21-schema-des-lots.md', raison: 'liee', depuis: 'projets/erp-saas/Module stocks.md' },
		],
		lues: [
			['projets/erp-saas/Module stocks.md', 3],
			['sources/cdc-stocks-v2.md', 9],
			['projets/erp-saas/Export CSV.md', 14],
		],
		ecran: [
			['u', "Je veux que le module stocks gère les lots et les dates de péremption. Regarde l'existant et propose un plan avant de coder."],
			['m', 'Mnemo : fiche injectée (Module stocks), 5 pistes proposées'],
			['t', '● Read(src/Stock/Entity/Mouvement.php)'],
			['r', '214 lignes'],
			['t', '● memoire_chercher(« lot péremption »)'],
			['r', '2 informations : « Chaque lot porte une date de péremption » (cahier des charges, p. 4)'],
			['a', "Le schéma est prêt : stock_lot, stock_lot_mouvement et une vue de compatibilité. D'après tes consignes, la migration aura un down() testé."],
			['t', '● Write(migrations/Version20261121_lots.php)'],
			['r', 'créé, 86 lignes'],
			['q', "Je garde l'ancienne table stock_mouvement en lecture seule, ou je migre tout l'historique ?"],
		],
	},
	{
		id: 'c21e9a07-4f2b-4c8e-9d61-0b7a3e5f2c94',
		profil: PROFIL_TRAVAIL,
		dossier: 'agent-maison',
		objectif: "Cadrer l'architecture du projet",
		etat: 'attend',
		ageMin: 49 * 60,
		calmeMin: 14,
		branche: 'main',
		servis: ['projets/agent-maison/Architecture.md', 'stacks/Symfony.md'],
		ecran: [
			['u', 'Nouveau projet. Propose-moi un découpage en modules avec des responsabilités claires.'],
			['m', 'Mnemo : 2 fiches injectées (Architecture, Symfony)'],
			['a', 'Je propose 4 modules : Accueil des demandes, Planification, Exécution, Journal. Chacun a ses entrées et ses sorties.'],
			['q', "Tu valides le découpage en 4 modules avant que je crée l'arborescence ?"],
		],
	},
	{
		id: 'b7d14e2a-9c3f-4a6b-8e05-7f2d1c9b3a68',
		profil: PROFIL_TRAVAIL,
		dossier: 'erp-saas',
		objectif: 'Écrire les tests du module achats',
		// hooks de Codex pas encore approuvés : Mnemo n'a reçu aucun événement (état du lancement, aucun outil vu), la session
		// ne peut pas être reprise ; l'avertissement est celui que le service écrit en tête du terminal
		etat: 'attend',
		ageMin: 3,
		calmeMin: 3,
		branche: 'test/achats',
		servis: [],
		moteur: 'codex',
		sansReprise:
			"session Codex dont l'identifiant chez Codex est inconnu (aucun hook reçu : hooks de Mnemo absents ou non approuvés dans Codex, ou aucun message envoyé) : elle ne peut pas être reprise",
		ecran: [
			[
				'w',
				'Hooks de Mnemo pour Codex non approuvés : cette session ne transmettra rien à Mnemo (état, contexte servi, consignes vérifiées, épisode). 7 hook(s) de Mnemo sur 7 sans approbation : à approuver dans Codex (/hooks).',
			],
		],
	},
	{
		id: '41d7f0b3-6e8a-4d29-b1c4-3a5e9f7d2b10',
		profil: PROFIL_TRAVAIL,
		dossier: 'erp-saas',
		objectif: "Corriger l'export CSV des factures",
		etat: 'a_relire',
		ageMin: 21 * 60,
		calmeMin: 35,
		branche: 'fix/export-csv',
		servis: ['projets/erp-saas/Export CSV.md', 'consignes/Test avant correction.md', 'consignes/Commits en français.md'],
		ecran: [
			['u', "L'export CSV des factures coupe les libellés qui contiennent un point-virgule."],
			['t', '● Write(tests/Export/CsvEchappementTest.php)'],
			['r', 'test rouge, comme attendu'],
			['t', '● Edit(src/Export/CsvWriter.php)'],
			['r', '3 lignes modifiées'],
			['a', "Corrigé et testé, 2 fichiers modifiés. Rien n'est commité : le diff t'attend."],
		],
	},
	{
		id: '0b5f8d21-3a7c-4e96-a2b8-6c4d0e1f9a35',
		profil: PROFIL_TRAVAIL,
		dossier: 'site-vitrine',
		objectif: 'Refaire la page contact',
		etat: 'en_pause',
		ageMin: 45 * 60,
		calmeMin: 44 * 60,
		branche: 'feat/contact',
		servis: [],
		ecran: [
			['u', 'Refais la page contact avec un formulaire plus simple.'],
			['a', "Le formulaire est intégré. Il reste à brancher l'envoi du mail."],
		],
	},
	{
		id: 'a9c3e5d7-2b4f-4618-9e0a-c7b5d3f1e8a2',
		profil: PROFIL_ARCHIVISTE,
		dossier: '',
		objectif: 'Ranger les documents déposés',
		etat: 'travaille',
		ageMin: 95,
		calmeMin: 1,
		branche: null,
		servis: [],
		ecran: [
			['u', 'Range les documents déposés.'],
			['t', '● extraire_source(clients/logistique-durand/mails-refonte-stocks.mbox)'],
			['r', '42 mails, 3 pièces jointes'],
			['a', "J'ai lu le fil « Refonte stocks ». 4 informations nouvelles, dont 1 à confirmer : la durée de conservation de l'historique."],
			['t', '● memoire_proposer(fait, « Module stocks »)'],
			['r', 'ajouté'],
		],
	},
	// Ajoutées en fin de liste : COMMITS_DEMO désigne les sessions par leur rang.
	{
		id: '9e02b6f4-8d1a-4c37-b5e9-2a6f0c8d4e13',
		profil: PROFIL_TRAVAIL,
		dossier: 'erp-saas',
		objectif: "Mettre à jour la doc de l'API",
		etat: 'en_pause',
		ageMin: 74 * 60,
		calmeMin: 72 * 60,
		branche: 'docs/api',
		servis: [],
		terminal: false,
		ecran: [
			['u', "Mets à jour la documentation de l'API à partir des routes actuelles."],
			['a', '48 routes listées. Il reste à écrire les exemples de requêtes.'],
		],
	},
	{
		id: 'a90b3d5e-7c2f-4b18-9a6d-e4f1c0b2d7a9',
		profil: PROFIL_TRAVAIL,
		dossier: 'api-facturation',
		objectif: 'Faire passer les tests du dépôt SFTP',
		etat: 'travaille',
		moteur: 'codex',
		modele: 'gpt-6.2-sol',
		ageMin: 42,
		calmeMin: 0,
		branche: 'fix/sftp-tests',
		servis: ['projets/api-facturation/Dépôt SFTP.md', 'consignes/Test avant correction.md'],
		classees: [['episodes/api-facturation/2026-11-20-dependances.md', 0.27]],
		ecran: [
			['u', 'Les tests du dépôt SFTP échouent depuis la mise à jour. Trouve pourquoi et corrige.'],
			// marques de Codex (« Ran », « Edited », « Called »), pas celles de Claude Code
			['t', 'Ran php bin/phpunit --filter Sftp'],
			['r', '11 tests, 5 échecs'],
			['a', "La mise à jour a ramené le délai de connexion à 10 s. J'écris d'abord le test qui reproduit, puis je corrige."],
			['t', 'Edited config/packages/sftp.yaml'],
			['r', 'timeout: 30'],
			['t', 'Called mnemo.proposer(« Dépôt SFTP », « Le délai de connexion SFTP est de 30 s »)'],
			['r', 'ajouté'],
			['t', 'Ran php bin/phpunit --filter Sftp'],
			['r', 'en cours… 8 sur 11'],
		],
	},
	{
		id: 'e6c2f1a8-5b3d-4e90-8c7a-1d9b4f6e2c05',
		profil: PROFIL_TRAVAIL,
		dossier: 'api-facturation',
		objectif: 'Mettre à jour les dépendances',
		etat: 'a_relire',
		ageMin: 70 * 60,
		calmeMin: 70,
		branche: 'chore/deps',
		servis: ['projets/api-facturation/api-facturation.md'],
		ecran: [
			['u', 'Mets à jour les dépendances Composer et dis-moi ce qui casse.'],
			['t', '● Bash(composer update)'],
			['r', '12 paquets mis à jour'],
			['a', "Tout passe, sauf un changement cassant dans la bibliothèque SFTP, traité dans l'autre session."],
		],
	},
	{
		id: '5d8a0e2c-4f6b-4a13-97c1-b3e5d7f9a2c4',
		profil: PROFIL_TRAVAIL,
		dossier: 'kit-ui',
		objectif: 'Ranger les composants du kit',
		etat: 'terminee',
		ageMin: 5 * 24 * 60,
		calmeMin: 4 * 24 * 60,
		branche: 'main',
		servis: [],
		ecran: [['u', 'Range les composants du kit par famille.']],
	},
];

/** Dossier de la démonstration ; celui qui a un état git y est un projet. */
export type DossierDemo = { chemin: string; git: { branche: string; fichiers: [string, 'M' | 'A' | 'D'][]; modifies: number } | null };

export const DOSSIERS_DEMO: DossierDemo[] = [
	{
		chemin: 'erp-saas',
		git: {
			branche: 'main',
			fichiers: [
				['src/Stock/Entity/Mouvement.php', 'M'],
				['migrations/Version20261121_lots.php', 'A'],
				['src/Export/CsvWriter.php', 'M'],
				['tests/Achat/CommandeTest.php', 'A'],
				['src/Stock/Ancien/Inventaire.php', 'D'],
			],
			modifies: 16,
		},
	},
	{
		chemin: 'api-facturation',
		git: { branche: 'main', fichiers: [['config/packages/sftp.yaml', 'M'], ['tests/Sftp/DepotTest.php', 'M'], ['composer.lock', 'M']], modifies: 5 },
	},
	{ chemin: 'agent-maison', git: { branche: 'main', fichiers: [['docs/architecture.md', 'A']], modifies: 3 } },
	{ chemin: 'site-vitrine', git: { branche: 'feat/contact', fichiers: [['templates/contact.html.twig', 'M']], modifies: 3 } },
	{ chemin: 'kit-ui', git: { branche: 'main', fichiers: [], modifies: 0 } },
	{ chemin: 'scripts', git: null },
	{ chemin: 'Documents', git: null },
	{ chemin: 'Projets', git: null },
	{ chemin: 'Projets/boutique-bio', git: { branche: 'main', fichiers: [['src/Panier.php', 'M']], modifies: 1 } },
	{ chemin: 'Projets/outil-devis', git: { branche: 'main', fichiers: [], modifies: 0 } },
];

/** Fiches de la mémoire, texte brut complet (frontmatter + corps), au format du coffre. */
export const FICHES_DEMO: Record<string, string> = {
	'clients/logistique-durand/logistique-durand.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3G
type: dossier
updated: 2026-11-20
---
# logistique-durand

Client logistique, 140 salariés, trois entrepôts. Projet principal : l'ERP (module stocks). 3 fiches prises en compte le 2026-11-20.

## Relations
- client de [[projets/erp-saas/erp-saas]]
- interlocuteur [[Marc Lefèvre]]
- interlocutrice [[Inès Roux]]
`,
	'clients/logistique-durand/Contrat de maintenance.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3H
type: sujet
alias: [maintenance Durand]
updated: 2026-11-12
---
# Contrat de maintenance

Conditions du contrat de maintenance de l'ERP chez Logistique Durand.

## Informations
- [perimetre] La maintenance couvre les modules stocks, achats et facturation. | declare | src: [[sources/contrat-maintenance-2026]] p.2 | appris 2026-03-02 | valide [2026-01-01,2026-12-31] | confiance 100 % ^f-0001
- [echeance] Le renouvellement du contrat de maintenance se décide avant le 2026-12-01. | declare | src: [[sources/contrat-maintenance-2026]] p.7 | appris 2026-03-02 | valide [2026-03-02,) | a confirmer ^f-0002
  > « Le présent contrat est renouvelable par accord écrit des parties avant le 1er décembre 2026. »

## Relations
- concerne [[logistique-durand]]
`,
	'projets/erp-saas/erp-saas.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3J
type: dossier
updated: 2026-11-22
---
# erp-saas

ERP multi-tenant en Symfony et PostgreSQL. Deux ans de sessions. 6 fiches prises en compte le 2026-11-22.

## Relations
- sujet [[Module stocks]]
- sujet [[Multi-tenant]]
- sujet [[Export CSV]]
- client [[logistique-durand]]
- stack [[Symfony]]
- stack [[PostgreSQL]]
`,
	'projets/erp-saas/Module stocks.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3K
type: sujet
alias: [stocks, gestion des lots]
updated: 2026-11-21
---
# Module stocks

Synthèse : périmètre, échéances et décisions du module stocks.

## Informations
- [decision] Les lots sont portés par une table stock_lot séparée. | declare | src: [[sources/cr-atelier-12-11]] | appris 2026-11-12 | valide [2026-11-12,) | confiance 90 % ^f-0001
- [delai] Livraison du module stocks au 15/12/2026. | observe | src: [[sources/cdc-stocks-v2]] p.12 | appris 2026-11-20 | valide [2026-11-20,) | confiance 80 % ^f-0002
  > « La livraison du module stocks est fixée au 15 décembre 2026, recette incluse. »
- [decision] La table stock_mouvement passe en lecture seule après la refonte. | infere | src: session 7f3a | appris 2026-11-21 | a confirmer ^f-0003
- [regle] ~~Les inventaires se font le lundi.~~ | observe | src: [[sources/cr-atelier-12-11]] 2026-09-02 | invalidé 2026-10-14 par ^f-0005 ^f-0004
- [regle] L'inventaire tournant est reporté à une phase ultérieure. | observe | src: [[sources/cr-atelier-12-11]] p.2 | appris 2026-11-12 | valide [2026-11-12,) | confiance 60 % ^f-0005

## Relations
- exigences dans [[Cahier des charges stocks]]
- suit [[Migrations réversibles]]
- décidé lors de [[Atelier du 12.11]]
- concerne [[logistique-durand]]
- remplace [[Ancien module inventaire]]
`,
	'projets/erp-saas/Multi-tenant.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3M
type: sujet
updated: 2026-05-05
---
# Multi-tenant

Règles de cloisonnement des données entre clients.

## Informations
- [regle] Toute table métier a un index composé commençant par tenant_id. | declare | src: utilisateur | appris 2026-05-05 | valide [2026-05-05,) | confiance 100 % ^f-0001

## Relations
- concerne [[PostgreSQL]]
`,
	'projets/erp-saas/Export CSV.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3N
type: sujet
updated: 2026-11-21
---
# Export CSV

Export des factures en CSV.

## Informations
- [regle] Les libellés sont échappés quand ils contiennent un point-virgule. | observe | src: session 41d7 | appris 2026-11-21 | valide [2026-11-21,) | confiance 51 % ^f-0001

## Relations
- corrigé en suivant [[Test avant correction]]
`,
	'projets/erp-saas/achats/achats.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3P
type: dossier
updated: 2026-11-22
---
# achats

Module achats de l'ERP : commandes fournisseurs et réceptions. 1 fiche prise en compte le 2026-11-22.

## Relations
- sujet [[Commandes fournisseurs]]
`,
	'projets/erp-saas/achats/Commandes fournisseurs.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3Q
type: sujet
updated: 2026-11-22
---
# Commandes fournisseurs

Cycle de vie d'une commande fournisseur.

## Informations
- [regle] Une commande fournisseur validée ne se modifie plus ; on l'annule et on en crée une autre. | declare | src: utilisateur | appris 2026-10-03 | valide [2026-10-03,) | confiance 100 % ^f-0001
- [montant] Au-delà de 5 000 € HT, une commande demande une seconde validation. | observe | src: [[sources/cdc-stocks-v2]] p.15 | appris 2026-11-20 ^f-0002

## Relations
- reçue dans [[Module stocks]]
`,
	'projets/api-facturation/api-facturation.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3R
type: dossier
updated: 2026-11-22
---
# api-facturation

API de facturation électronique. 1 fiche prise en compte le 2026-11-22.

## Relations
- sujet [[Dépôt SFTP]]
- stack [[Symfony]]
`,
	'projets/api-facturation/Dépôt SFTP.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3S
type: sujet
updated: 2026-11-22
---
# Dépôt SFTP

Dépôt des factures chez la plateforme de dématérialisation.

## Informations
- [config] Le délai de connexion SFTP est de 30 s depuis la mise à jour du 2026-11-20. | observe | src: session a90b | appris 2026-11-22 | valide [2026-11-20,) | confiance 51 % ^f-0001

## Relations
- corrigé en suivant [[Test avant correction]]
`,
	'projets/agent-maison/agent-maison.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3T
type: dossier
updated: 2026-11-21
---
# agent-maison

Projet neuf, ouvert cette semaine. 1 fiche prise en compte le 2026-11-21.

## Relations
- sujet [[Architecture]]
`,
	'projets/agent-maison/Architecture.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3V
type: sujet
updated: 2026-11-21
---
# Architecture

Découpage du projet agent-maison.

## Informations
- [decision] Découpage en 4 modules : Accueil des demandes, Planification, Exécution, Journal. | infere | src: session c21e | appris 2026-11-21 | a confirmer ^f-0001

## Relations
- suit [[Contrôleurs fins]]
- stack [[Symfony]]
`,
	'personnes/Marc Lefèvre.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3W
type: entite
alias: [Marc, M. Lefèvre, ML]
updated: 2026-11-18
---
# Marc Lefèvre

Responsable logistique chez Logistique Durand, interlocuteur sur les stocks.

## Informations
- [role] Marc Lefèvre valide les règles de gestion des stocks côté client. | observe | src: [[sources/mails-refonte-stocks]] 2026-10-02 | appris 2026-11-22 | confiance 70 % ^f-0001

## Relations
- travaille chez [[logistique-durand]]
- projet [[projets/erp-saas/erp-saas]]
`,
	'personnes/Inès Roux.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3X
type: entite
alias: [Inès]
updated: 2026-11-22
---
# Inès Roux

DSI de Logistique Durand, en copie des échanges sur les stocks.

## Relations
- travaille chez [[logistique-durand]]
`,
	'personnes/Claire Martin.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3Y
type: entite
alias: [Claire]
updated: 2026-09-14
---
# Claire Martin

Développeuse indépendante, relit les livraisons de l'api-facturation.

## Relations
- projet [[api-facturation]]
`,
	'consignes/Migrations réversibles.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E3Z
type: consigne
updated: 2026-11-21
portee: stack:symfony
niveau: toujours
repetitions: [2026-06-02, 2026-11-21]
---
# Migrations réversibles

Toute migration a un down() testé, et jamais de DROP COLUMN dans la livraison qui cesse de lire la colonne.
`,
	'consignes/Test avant correction.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E40
type: consigne
updated: 2026-11-22
portee: globale
niveau: rappelee
repetitions: [2026-09-14, 2026-11-22]
proposition: { niveau: toujours, date: 2026-11-22, source: session b7d1 }
---
# Test avant correction

Avant de corriger un bug, écrire le test qui échoue ; le test de reproduction reste dans la suite.
`,
	'consignes/Commits en français.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E41
type: consigne
updated: 2026-01-20
portee: globale
niveau: toujours
---
# Commits en français

Message de commit à l'impératif, en français, 70 caractères au plus.
`,
	'consignes/Pas de mise en production le vendredi.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E42
type: consigne
updated: 2026-11-22
portee: globale
niveau: toujours
proposition: { niveau: verifiee, regle: { type: commandes_interdites, motifs: ["bin/deployer prod*"] }, date: 2026-11-22, source: session 7f3a }
---
# Pas de mise en production le vendredi

Jamais de mise en production le vendredi.
`,
	'consignes/Contrôleurs fins.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E43
type: consigne
updated: 2026-05-30
portee: stack:symfony
niveau: rappelee
---
# Contrôleurs fins

Un contrôleur Symfony valide, délègue, répond : aucune requête Doctrine dans un contrôleur.
`,
	'stacks/Symfony.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E44
type: sujet
updated: 2026-05-30
---
# Symfony

Tout ce qui vaut pour un projet Symfony.

## Relations
- utilisé par [[projets/erp-saas/erp-saas]]
- utilisé par [[api-facturation]]
- utilisé par [[agent-maison]]
- consigne [[Contrôleurs fins]]
`,
	'stacks/PostgreSQL.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E45
type: sujet
updated: 2026-11-21
---
# PostgreSQL

Tout ce qui vaut pour PostgreSQL.

## Informations
- [version] La production tourne sous PostgreSQL 17. | declare | src: utilisateur | appris 2026-04-11 | valide [2026-04-11,) | confiance 100 % ^f-0001

## Relations
- utilisé par [[projets/erp-saas/erp-saas]]
`,
	'sources/cdc-stocks-v2.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E46
type: source
alias: [Cahier des charges stocks, CDC stocks]
updated: 2026-11-18
chemin: erp-saas/docs/cdc-stocks-v2.pdf
format: pdf
type_source: spec_validee
version_de: "[[sources/cdc-stocks-v1]]"
---
# Cahier des charges stocks

Document ingéré. Remplace la v1 du 2026-10-02.

## Informations
- [regle] Chaque lot porte une date de péremption. | observe | src: [[sources/cdc-stocks-v2]] p.4 | appris 2026-11-18 | confiance 90 % ^f-0001
  > « Chaque lot est identifié par un numéro et porte une date de péremption. »
- [regle] Sortie de stock en premier périmé, premier sorti. | observe | src: [[sources/cdc-stocks-v2]] p.5 | appris 2026-11-18 ^f-0002
- [delai] L'historique des mouvements est conservé 5 ans. | observe | src: [[sources/cdc-stocks-v2]] p.9 | appris 2026-11-18 | confiance 90 % ^f-0003

## Relations
- envoyé par [[Marc Lefèvre]]
- concerne [[Module stocks]]
`,
	'sources/cr-atelier-12-11.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E47
type: source
alias: [Atelier du 12.11]
updated: 2026-11-12
chemin: erp-saas/docs/cr-atelier-12-11.docx
format: docx
type_source: compte_rendu
---
# Atelier du 12.11

Compte rendu d'atelier ingéré.

## Informations
- [planning] L'inventaire tournant est reporté à une phase ultérieure. | observe | src: [[sources/cr-atelier-12-11]] p.2 | appris 2026-11-12 | confiance 80 % ^f-0001

## Relations
- participant [[Marc Lefèvre]]
- participante [[Inès Roux]]
`,
	'sources/claude-code/preferences.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E4C
type: source
updated: 2026-11-22
type_source: note
a_traiter: true
---
# Préférences de travail

Note importée de la mémoire de Claude Code, en attente de l'archiviste.

## Contenu
\`\`\`
- Commits en français, sans mention de l'outil.
- Tests avant chaque livraison.
\`\`\`
`,
	'sources/claude-code/erp-saas-claude.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E4F
type: source
updated: 2026-11-21
type_source: note
chemin: Projets/erp-saas/CLAUDE.md
projet: projets/erp-saas
a_traiter: true
---
# CLAUDE.md (Projets/erp-saas)

Instructions du projet, importées de Claude Code, en attente de l'archiviste.
`,
	'episodes/kit-ui/2026-11-17-composants.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E4D
type: episode
updated: 2026-11-18
session: 5d8a0e2c-4f6b-4a13-97c1-b3e5d7f9a2c4
branche: main
---
# Composants rangés par famille

Objectif : ranger les composants du kit. Résultat : 4 familles (formulaires, navigation, retours, mise en page), index mis à jour.
`,
	'episodes/erp-saas/2026-11-21-schema-des-lots.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E48
type: episode
updated: 2026-11-21
session: 7f3a2c4e-1b9d-4e57-a0c2-5d18e6f0a7b1
branche: feat/stocks-lots
---
# Schéma des lots

Objectif : nouveau schéma des lots du module stocks. Résultat : 3 tables créées, migration écrite avec son down().

## Décisions
- Une table stock_lot séparée plutôt qu'une colonne sur stock_mouvement, pour garder l'historique intact.

## Relations
- concerne [[Module stocks]]
- suit [[Migrations réversibles]]
`,
	'episodes/erp-saas/2026-11-19-export-csv.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E49
type: episode
updated: 2026-11-19
session: 41d7f0b3-6e8a-4d29-b1c4-3a5e9f7d2b10
branche: fix/export-csv
---
# Export CSV des factures

Objectif : corriger la coupure des libellés. Résultat : échappement corrigé, test de reproduction ajouté.

## Relations
- concerne [[Export CSV]]
- suit [[Test avant correction]]
`,
	'episodes/api-facturation/2026-11-20-dependances.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1E4A
type: episode
updated: 2026-11-20
branche: chore/deps
---
# Mise à jour des dépendances

Objectif : mettre à jour les dépendances Composer. Résultat : 12 paquets mis à jour, un changement cassant dans la bibliothèque SFTP.

## Relations
- concerne [[Dépôt SFTP]]
- lien vers [[Bibliothèque SFTP]]
`,
	// Fiches plus anciennes : l'axe du temps et la couleur par période du graphe ont plusieurs années à montrer.
	'clients/logistique-durand/Historique du compte.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1F01
type: sujet
alias: [historique Durand]
updated: 2026-02-14
---
# Historique du compte

Les grandes étapes de la relation avec Logistique Durand depuis 2019.

## Informations
- [contrat] Premier contrat signé pour la gestion des entrepôts de Lyon. | declare | src: [[sources/contrat-2019]] p.1 | appris 2024-05-02 | valide [2019-03-01,) | confiance 100 % ^f-0001
- [perimetre] Extension aux entrepôts de Marseille et Lille. | observe | src: [[sources/avenant-2021]] p.3 | appris 2024-05-02 | valide [2021-09-15,) | confiance 90 % ^f-0002
- [decision] Passage à la facturation mensuelle. | observe | src: [[sources/cr-revue-2023]] | appris 2024-05-02 | valide [2023-01-01,) | confiance 80 % ^f-0003

## Relations
- concerne [[logistique-durand]]
- interlocuteur [[Marc Lefèvre]]
`,
	'decisions/Choix de PostgreSQL.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1F02
type: sujet
updated: 2022-04-20
---
# Choix de PostgreSQL

Pourquoi l'ERP est passé de MySQL à PostgreSQL : schémas par client et requêtes JSON.

## Informations
- [decision] L'ERP utilise un schéma PostgreSQL par client. | declare | src: [[sources/adr-007]] | appris 2022-04-20 | valide [2022-04-20,) | confiance 100 % ^f-0001
- [decision] Les exports lisent une réplique en lecture seule. | observe | src: [[sources/adr-007]] | appris 2022-04-20 | valide [2022-06-01,) | confiance 90 % ^f-0002

## Relations
- concerne [[PostgreSQL]]
- projet [[projets/erp-saas/erp-saas]]
- remplace [[Choix de MySQL]]
- éclaire [[Multi-tenant]]
`,
	'decisions/Hébergement en France.md': `---
id: 01JD7Q2M4R8T0V3X5Z7B9C1F03
type: sujet
updated: 2025-01-10
---
# Hébergement en France

Les données des clients restent hébergées en France, chez un hébergeur certifié.

## Informations
- [regle] Les données clients sont hébergées en France. | declare | src: [[sources/politique-hebergement]] | appris 2025-01-10 | valide [2025-01-10,) | confiance 100 % ^f-0001
- [delai] Les sauvegardes sont gardées 35 jours. | observe | src: [[sources/politique-hebergement]] | appris 2025-01-10 | valide [2025-02-01,) | confiance 90 % ^f-0002

## Relations
- concerne [[api-facturation]]
- concerne [[projets/erp-saas/erp-saas]]
- suit [[Pas de mise en production le vendredi]]
`,
};

/** Commits du jour : [heure locale, message, fiches, rang de la session dans SESSIONS_DEMO ou null] ; 5 = l'archiviste. */
export const COMMITS_DEMO: [string, string, string[], number | null][] = [
	['08:47', 'mnemo: source sources/cr-atelier-12-11.md', ['sources/cr-atelier-12-11.md', 'projets/erp-saas/Module stocks.md'], 5],
	['09:12', 'mnemo: information projets/erp-saas/Module stocks.md', ['projets/erp-saas/Module stocks.md'], 0],
	['09:40', 'mnemo: source sources/cdc-stocks-v2.md', ['sources/cdc-stocks-v2.md'], 5],
	['10:27', 'mnemo: propose niveau consignes/Test avant correction.md', ['consignes/Test avant correction.md'], 2],
	['10:41', 'mnemo: information personnes/Marc Lefèvre.md', ['personnes/Marc Lefèvre.md'], 5],
	['11:03', 'mnemo: propose niveau consignes/Pas de mise en production le vendredi.md', ['consignes/Pas de mise en production le vendredi.md'], 0],
	['11:20', 'mnemo: fiche personnes/Inès Roux.md', ['personnes/Inès Roux.md', 'clients/logistique-durand/logistique-durand.md'], 5],
	['11:42', 'mnemo: information projets/api-facturation/Dépôt SFTP.md', ['projets/api-facturation/Dépôt SFTP.md'], 7],
];

/** Fichiers déjà présents dans le dossier de démonstration : un dépôt du même chemin est refusé (409). */
export const FICHIERS_EXISTANTS_DEMO = ['erp-saas/docs/cdc-stocks-v2.pdf', 'erp-saas/docs/cr-atelier-12-11.docx'];

/** Réponses de l'archiviste de démonstration aux suggestions du tiroir (sinon, la réponse fictive commune). */
export const REPONSES_ARCHIVISTE_DEMO: Record<string, string> = {
	'Range les documents déposés': "Rien de nouveau dans les dépôts depuis ce matin : les mails de la refonte des stocks sont rangés dans clients/logistique-durand.",
	"Qu'as-tu appris aujourd'hui ?": "8 changements aujourd'hui : 2 sources lues, 3 informations nouvelles, 2 montées de niveau proposées et une fiche créée (Inès Roux). 3 informations attendent ta confirmation.",
	'Y a-t-il des contradictions à trancher ?': "Une seule : la durée de conservation de l'historique des mouvements (5 ans dans le cahier des charges, 10 ans dans un mail). Elle est dans Mémoire › Archiviste, à arbitrer.",
};

/** Réponse fictive de `claude` à une saisie, dans le terminal de démonstration : indicateur, puis réponse. */
export const REPONSES_TERMINAL_DEMO: [string, string] = [
	'Réflexion',
	"D'accord. Je reprends à partir de là et je te montre le diff avant de commiter.",
];

/** Ce que l'archiviste sert à une session peu après l'ouverture : fiches servies, puis le classement [id, note, servi]. */
export const SERVI_PAR_ARCHIVISTE_DEMO: { ids: [string, string]; autres: [string, number, boolean][] } = {
	ids: ['projets/api-facturation/Dépôt SFTP.md', 'consignes/Test avant correction.md'],
	autres: [['episodes/api-facturation/2026-11-20-dependances.md', 0.31, false]],
};

/**
 * Nouvel envoi à la première session, peu après l'ouverture : le panneau Contexte réordonne ses pistes ◇ en direct (le
 * cahier des charges, nommé dans le message, passe en tête ; une fiche du périmètre n'est plus proposée).
 */
export const PISTES_NOUVEL_ENVOI_DEMO: PisteDemo[] = [
	{ id: 'sources/cdc-stocks-v2.md', raison: 'nommee' },
	{ id: 'episodes/erp-saas/2026-11-21-schema-des-lots.md', raison: 'liee', depuis: 'projets/erp-saas/Module stocks.md' },
	{ id: 'stacks/PostgreSQL.md', raison: 'question' },
	{ id: 'consignes/Migrations réversibles.md', raison: 'perimetre' },
];

/**
 * Réglages fictifs du mode démo (`?demo&vue=reglages`) : la forme de ceux du service (`domaine/reglages.ts`), pour voir la
 * vue sans service ; le service reste la seule source des vrais champs et défauts.
 */
export const REGLAGES_DEMO: ChampReglageVue[] = [
	{ cle: 'projets.marqueurs', groupe: 'projets', libelle: 'Marqueurs de projet', explication: 'Un dossier qui contient l’un de ces fichiers ou dossiers porte ◆ dans l’arbre des dossiers (casse ignorée).', genre: 'liste', defaut: ['.git', 'package.json', 'composer.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'], valeur: ['.git', 'package.json', 'composer.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'], effet: 'immediat' },
	{ cle: 'contexte.similariteRecherche', groupe: 'contexte', libelle: 'Similarité minimale (recherche)', explication: 'Proximité de sens minimale d’un résultat de recherche (outils, interface, CLI), de 0 à 1.', genre: 'decimal', defaut: 0.45, valeur: 0.45, min: 0.1, max: 0.95, effet: 'immediat' },
	{ cle: 'contexte.cartesPerimetre', groupe: 'contexte', libelle: 'Cartes du périmètre au premier message', explication: 'Cartes (titre, chemin, première phrase) proposées au premier message pour les fiches du périmètre de la position.', genre: 'entier', defaut: 10, valeur: 10, min: 0, max: 30, unite: 'cartes', effet: 'immediat' },
	{ cle: 'contexte.cartesNommees', groupe: 'contexte', libelle: 'Cartes des fiches nommées par message', explication: 'Cartes proposées au plus, à chaque message, pour les fiches dont le titre ou un alias est cité dans le message.', genre: 'entier', defaut: 5, valeur: 5, min: 0, max: 15, unite: 'cartes', effet: 'immediat' },
	{ cle: 'contexte.poidsInjection', groupe: 'contexte', libelle: 'Poids d’une fiche injectée à la main sur ses voisines', explication: 'Ajouté à la note des fiches reliées à une fiche que tu injectes à la main, de 0 à 1 (0,25 : 25 points ; le sens du message vaut de 0 à 1).', genre: 'decimal', defaut: 0.25, valeur: 0.25, min: 0, max: 1, effet: 'immediat' },
	{ cle: 'contexte.demiVieInjection', groupe: 'contexte', libelle: 'Demi-vie de ce poids, en messages', explication: 'Messages (hors messages muets) après lesquels le poids d’une fiche injectée à la main sur ses voisines a diminué de moitié.', genre: 'entier', defaut: 3, valeur: 3, min: 1, max: 20, unite: 'messages', effet: 'immediat' },
	{ cle: 'recherche.resultats', groupe: 'recherche', libelle: 'Résultats par recherche', explication: 'Résultats rendus par `chercher` quand la demande n’en fixe pas le nombre (outils, interface).', genre: 'entier', defaut: 10, valeur: 10, min: 1, max: 50, effet: 'immediat' },
	{ cle: 'recherche.chronologie', groupe: 'recherche', libelle: 'Résultats de la chronologie', explication: 'Faits rendus par `chronologie` quand la demande n’en fixe pas le nombre.', genre: 'entier', defaut: 30, valeur: 30, min: 1, max: 200, effet: 'immediat' },
	{ cle: 'recherche.graphe', groupe: 'recherche', libelle: 'Fiches suivies par le graphe', explication: 'Premières fiches de la recherche dont les liens sont suivis (un saut).', genre: 'entier', defaut: 5, valeur: 5, min: 0, max: 20, effet: 'immediat' },
	{ cle: 'recherche.reranker', groupe: 'recherche', libelle: 'Candidats au reranker', explication: 'Premiers candidats reclassés par le reranker (s’il tourne) ; plus, c’est plus juste et plus lent.', genre: 'entier', defaut: 40, valeur: 40, min: 5, max: 100, effet: 'immediat' },
	{ cle: 'recherche.poidsPosition', groupe: 'recherche', libelle: 'Poids du projet courant', explication: 'Ajouté à la note d’un résultat situé dans le voisinage du projet courant, de 0 à 0,5 (0,1 : 10 points ; la pertinence vaut de 0 à 1).', genre: 'decimal', defaut: 0.1, valeur: 0.1, min: 0, max: 0.5, effet: 'immediat' },
	{ cle: 'recherche.poidsConfiance', groupe: 'recherche', libelle: 'Poids de la confiance', explication: 'Retiré à la note d’un résultat peu fiable, au prorata de ce qui manque à sa confiance, de 0 à 0,5 (0,05 : 5 points au plus).', genre: 'decimal', defaut: 0.05, valeur: 0.05, min: 0, max: 0.5, effet: 'immediat' },
	{ cle: 'recherche.poidsMemoire', groupe: 'recherche', libelle: 'Poids de la mémoire', explication: 'Ajouté à la note d’un résultat qui vient de la mémoire (fiches et faits), de 0 à 0,5 (0,05 : 5 points).', genre: 'decimal', defaut: 0.05, valeur: 0.05, min: 0, max: 0.5, effet: 'immediat' },
	{ cle: 'recherche.poidsFraicheur', groupe: 'recherche', libelle: 'Poids de la fraîcheur', explication: 'Ajouté à la note d’un résultat récent, de 0 à 0,5, réduit de moitié après un an (0,05 : 5 points au plus).', genre: 'decimal', defaut: 0.05, valeur: 0.05, min: 0, max: 0.5, effet: 'immediat' },
	{ cle: 'memoire.seuilRappel', groupe: 'memoire', libelle: 'Seuil de rappel', explication: 'Pertinence minimale d’un résultat de recherche pour qu’il soit rappelé aux sessions ; la confiance d’un fait ne pèse que sur son rang.', genre: 'decimal', defaut: 0.4, valeur: 0.4, min: 0, max: 1, effet: 'immediat' },
	{ cle: 'memoire.repetitions', groupe: 'memoire', libelle: 'Répétitions pour monter une consigne', explication: 'Fois où une consigne est redite avant que Mnemo propose de la rendre toujours présente.', genre: 'entier', defaut: 2, valeur: 2, min: 1, max: 20, effet: 'immediat' },
	{ cle: 'memoire.poids_declare', groupe: 'memoire', libelle: 'Poids d’un fait déclaré', explication: 'Multiplie la fiabilité de la source pour donner la confiance du fait.', genre: 'decimal', defaut: 1, valeur: 1, min: 0, max: 1, effet: 'immediat' },
	{ cle: 'memoire.fiabilite_email', groupe: 'memoire', libelle: 'Fiabilité : Email', explication: 'Fiabilité d’une information de source « email ».', genre: 'decimal', defaut: 0.7, valeur: 0.7, min: 0, max: 1, effet: 'immediat' },
	{ cle: 'modeles.inactiviteMinutes', groupe: 'modeles', libelle: 'Arrêt pour inactivité', explication: 'Les modèles locaux s’arrêtent après ce temps sans requête, que le service tourne ou non ; le prochain usage les relance. Partagés par toute la machine, ils gardent le délai du dossier qui les a démarrés.', genre: 'entier', defaut: 15, valeur: 15, min: 1, max: 240, unite: 'minutes', effet: 'modeles' },
	{
		cle: 'archiviste.typesAConfirmer',
		groupe: 'archiviste',
		libelle: 'Types de fiche à confirmer',
		explication: 'Une information proposée dans une fiche de ces types attend ta confirmation avant d’être injectée.',
		genre: 'choix-multiple',
		defaut: [],
		valeur: [],
		choix: [
			{ valeur: 'sujet', libelle: 'Sujet' },
			{ valeur: 'dossier', libelle: 'Dossier' },
			{ valeur: 'entite', libelle: 'Entité' },
			{ valeur: 'consigne', libelle: 'Consigne' },
			{ valeur: 'episode', libelle: 'Épisode' },
			{ valeur: 'source', libelle: 'Source' },
			{ valeur: 'glossaire', libelle: 'Glossaire' },
		],
		effet: 'immediat',
	},
	{ cle: 'interface.accent', groupe: 'interface', libelle: 'Couleur principale de l’interface', explication: 'Couleur des éléments actifs, des liens, des titres et du focus ; le logo ne change pas.', genre: 'couleur', defaut: ACCENT_PAR_DEFAUT, valeur: ACCENT_PAR_DEFAUT, effet: 'immediat' },
	{ cle: 'service.port', groupe: 'service', libelle: 'Port du service', explication: 'Port local de l’interface ; le changer change son adresse (favori, application installée, lanceur).', genre: 'entier', defaut: 4747, valeur: 4747, min: 1024, max: 65535, effet: 'service' },
	{
		cle: 'service.navigateur',
		groupe: 'service',
		libelle: 'Navigateur du lanceur',
		explication: 'Navigateur qui ouvre la fenêtre de Mnemo (« mnemo ouvrir » et le lanceur macOS).',
		genre: 'choix',
		defaut: 'auto',
		valeur: 'auto',
		choix: [
			{ valeur: 'auto', libelle: 'Automatique (Chrome, sinon Edge, sinon par défaut)' },
			{ valeur: 'chrome', libelle: 'Google Chrome' },
			{ valeur: 'edge', libelle: 'Microsoft Edge' },
			{ valeur: 'brave', libelle: 'Brave' },
			{ valeur: 'arc', libelle: 'Arc' },
			{ valeur: 'defaut', libelle: 'Navigateur par défaut' },
		],
		effet: 'immediat',
	},
];
