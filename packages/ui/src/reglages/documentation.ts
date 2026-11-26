/**
 * Contenu de l'onglet Documentation de la vue Réglages : six chapitres (Le principe, Une session, Les agents, Le rappel, La
 * confiance, L'archiviste), chacun une suite de blocs que `Documentation.tsx` met en forme. Chaque affirmation est vérifiée
 * dans le code du service (`packages/mnemo`) ; les chiffres sont les valeurs par défaut. Dans un texte, `**gras**` et
 * `` `code` `` sont rendus comme tels. Les pouvoirs (noms, runes) viennent de `profils/hooks.ts` : la frise ne donne que
 * leur explication, par événement.
 */
import type { EvenementHookVue } from '@mnemo/contrat';

export type CaseSchema = { icone?: string; titre: string; texte: string; accent?: true };
export type Sort = { ton: 'injectee' | 'piste' | 'aucun'; nom: string; texte: string };
export type FacteurFormule = { nom: string; detail: string; resultat?: true };

export type BlocDoc =
	| { genre: 'chapo'; texte: string }
	| { genre: 'intertitre'; texte: string }
	| { genre: 'paragraphe'; texte: string }
	| { genre: 'note'; texte: string }
	| { genre: 'points'; points: readonly string[] }
	| { genre: 'schema'; fleche: string; cases: readonly CaseSchema[] }
	| { genre: 'frise'; etapes: Readonly<Record<EvenementHookVue, string>> }
	| { genre: 'glossaire'; termes: readonly (readonly [string, string])[] }
	| { genre: 'sorts'; sorts: readonly Sort[] }
	| { genre: 'formule'; facteurs: readonly FacteurFormule[] };

export type ChapitreDoc = { cle: string; titre: string; sous: string; titreLong: string; blocs: readonly BlocDoc[] };

export const CHAPITRES_DOC: readonly ChapitreDoc[] = [
	{
		cle: 'principe',
		titre: 'Le principe',
		sous: 'une mémoire pour tes sessions',
		titreLong: 'Le principe',
		blocs: [
			{
				genre: 'chapo',
				texte: 'Une session d’agent oublie tout en se fermant. Mnemo lui donne une mémoire : des fiches en Markdown dans ton dossier, versionnées avec git, qu’il injecte dans chaque session au bon moment.',
			},
			{
				genre: 'schema',
				fleche: '⇄',
				cases: [
					{ icone: '📁', titre: 'La mémoire', texte: 'des fiches Markdown dans `_mnemo/` : projets, personnes, décisions, pratiques, consignes' },
					{ icone: '◆', titre: 'Mnemo', texte: 'cherche, classe, injecte, et écrit sous git ce que les sessions apprennent', accent: true },
					{ icone: '⌨', titre: 'Tes sessions', texte: 'Claude Code, Codex ou Mistral Vibe, lancées depuis Mnemo' },
				],
			},
			{ genre: 'intertitre', texte: 'Ce qu’il faut retenir' },
			{
				genre: 'points',
				points: [
					'**Tout est lisible.** Une fiche est un fichier texte que tu peux ouvrir, corriger, supprimer.',
					'**Tout est réversible.** Chaque écriture est un commit git : rien ne se perd.',
					'**La mémoire reste chez toi.** La recherche et la note des fiches tournent sur des modèles locaux ; seul ce que Mnemo injecte part, avec la session, chez le fournisseur de l’agent.',
				],
			},
		],
	},
	{
		cle: 'session',
		titre: 'Une session',
		sous: 'du lancement à la fermeture',
		titreLong: 'Une session, du lancement à la fermeture',
		blocs: [
			{
				genre: 'chapo',
				texte: 'Mnemo intervient à six moments de la vie d’une session. Ce sont les **pouvoirs** d’un agent (des « hooks ») : chacun s’allume ou s’éteint dans l’onglet Agents.',
			},
			{
				genre: 'frise',
				etapes: {
					debut: 'La session démarre : Mnemo note sa branche et son commit de départ. Rien n’est encore injecté.',
					message:
						'À chaque message : Mnemo injecte tes consignes permanentes, la fiche du projet si elle n’y est pas déjà et les fiches très proches de ta demande, et propose des pistes (voir « Le rappel »).',
					outil: 'Avant chaque action de l’agent : si elle viole une consigne vérifiée (un chemin ou une commande interdits), Mnemo la refuse.',
					apres_outil: 'Après chaque action : Mnemo note les fiches que l’agent a lues ou écrites. Elles ne lui sont plus proposées, et une piste lue compte comme utile pour les notes suivantes.',
					arret: 'L’agent s’arrête ou attend ton accord : la session passe « Attend ta réponse » dans Sessions.',
					fin: 'À la fermeture : Mnemo termine la session et, si aucun bilan n’en a laissé, écrit un épisode minimal, sans IA (objectif, dates, branche, fichiers modifiés). Ce que la session a appris, elle l’a écrit en cours de route.',
				},
			},
			{ genre: 'note', texte: 'Un agent sans Souffle travaille sans la mémoire : il peut la consulter avec ses outils, mais rien ne lui est injecté.' },
			{
				genre: 'note',
				texte: 'Un **projet** est un dossier qui contient l’un des marqueurs choisis (`.git`, `package.json`… : Réglages › Mémoire › Confiance) : il porte ◆ dans l’arbre des dossiers où tu choisis où lancer une session.',
			},
		],
	},
	{
		cle: 'agents',
		titre: 'Les agents',
		sous: 'classe, équipement, pouvoirs',
		titreLong: 'Les agents',
		blocs: [
			{ genre: 'chapo', texte: 'Un agent, c’est un profil de session : ce qu’une session reçoit en démarrant. Tu en crées autant que de façons de travailler.' },
			{
				genre: 'glossaire',
				termes: [
					[
						'Classe',
						'L’agent de code qui fait tourner la session : Claude Code (Anthropic), Codex (OpenAI) ou Mistral Vibe (Mistral), et le modèle choisi. Un moteur doit être **lié à Mnemo** (Réglages › Branchements) pour que ses sessions reçoivent la mémoire ; d’ici là, sa classe reste verrouillée.',
					],
					['Mission', 'La consigne de l’agent, ajoutée aux instructions de chaque session : son rôle, sa façon de faire.'],
					[
						'Équipement',
						'**Skills** : des savoir-faire écrits dans la mémoire (`_mnemo/skills/`) ou propres à l’agent ; l’agent en lit une quand sa tâche correspond à sa description. Le crayon ✎ d’une skill ouvre son éditeur. **Plugins** : des extensions de Claude Code (commandes, outils), propres à ce moteur.',
					],
					['Pouvoirs', 'Les moments où Mnemo agit dans la session (voir « Une session ») ; au moins un reste allumé.'],
					[
						'Départ',
						'« Démarre dans la mémoire » : ses sessions s’ouvrent dans le dossier de la mémoire, pour ranger ou relire les fiches ; sinon dans le dossier choisi au lancement. L’archiviste démarre toujours dans la mémoire.',
					],
					['Stats', 'Ce que l’agent emporte : skills, plugins (avec Claude Code) et pouvoirs, chacun rapporté à ce qui peut être équipé.'],
				],
			},
		],
	},
	{
		cle: 'rappel',
		titre: 'Le rappel',
		sous: 'injection, pistes, ordre',
		titreLong: 'Le rappel',
		blocs: [
			{ genre: 'chapo', texte: 'À chaque message, Mnemo cherche les fiches utiles, leur donne une note, puis décide de leur sort.' },
			{
				genre: 'schema',
				fleche: '→',
				cases: [
					{ titre: '1 · Chercher', texte: 'autour du projet en cours, parmi les fiches que le message nomme (titre ou alias), et les voisines des fiches que tu as injectées' },
					{ titre: '2 · Noter', texte: 'des modèles locaux et une note apprise de tes gestes estiment la chance qu’une fiche soit utile ici, de 0 à 100 %' },
					{ titre: '3 · Décider', texte: 'injecter, proposer en piste, ou laisser de côté', accent: true },
				],
			},
			{ genre: 'intertitre', texte: 'Les trois sorts d’une fiche' },
			{
				genre: 'sorts',
				sorts: [
					{ ton: 'injectee', nom: 'Injectée', texte: 'Au-dessus du seuil d’injection : elle entre entière dans la session sans ton geste. Au plus « Fiches injectées » par message.' },
					{
						ton: 'piste',
						nom: 'Piste',
						texte: 'Au-dessus du seuil des pistes : une carte (titre, chemin, première phrase) que l’agent lit s’il en a besoin, ou que tu injectes d’un geste. Les fiches que ton message nomme sont proposées en plus.',
					},
					{ ton: 'aucun', nom: 'Laissée de côté', texte: 'En dessous : rien n’est envoyé.' },
				],
			},
			{
				genre: 'paragraphe',
				texte: 'L’injection automatique attend une note **calibrée** (un modèle de note accepté). Avant, aucune fiche n’entre seule : les premières de l’ordre partent en pistes, au premier message et quand tu injectes une fiche à la main.',
			},
			{ genre: 'intertitre', texte: 'L’ordre des recherches' },
			{
				genre: 'paragraphe',
				texte: 'Quand l’agent ou toi cherchez (outil `chercher`, recherche de l’interface), entre deux résultats aussi pertinents passent devant ceux du **projet en cours**, les plus **sûrs**, ceux de la **mémoire** plutôt que des documents, et les plus **récents**, selon les poids « Ce qui passe devant » de Réglages › Mémoire.',
			},
			{
				genre: 'note',
				texte: 'Quand tu injectes une fiche à la main, ses voisines montent dans la note pendant quelques messages, puis l’effet s’estompe (la demi-vie, dans les réglages fins du Rappel).',
			},
		],
	},
	{
		cle: 'confiance',
		titre: 'La confiance',
		sous: 'sources, faits, consignes',
		titreLong: 'La confiance',
		blocs: [
			{ genre: 'chapo', texte: 'Chaque fait d’une fiche a une confiance. Elle vient de deux choses : d’où il vient, et comment on le sait.' },
			{
				genre: 'formule',
				facteurs: [
					{ nom: 'Fiabilité de la source', detail: 'toi 1 · contrat 1 · e-mail 0,7 · déduction 0,5…' },
					{ nom: 'Façon dont on le sait', detail: 'déclaré 1 · observé 0,85 · inféré 0,7' },
					{ nom: 'Confiance du fait', detail: 'ex. un e-mail observé : 0,7 × 0,85 ≈ 0,6', resultat: true },
				],
			},
			{
				genre: 'paragraphe',
				texte: 'Une seconde source qui confirme le fait le fait monter, jusqu’à 0,9 (jusqu’à 1 si l’une d’elles est toi ou un contrat). Les valeurs se règlent dans Réglages › Mémoire › Confiance.',
			},
			{ genre: 'intertitre', texte: 'Les consignes' },
			{
				genre: 'paragraphe',
				texte: 'Une consigne est une règle que tu donnes à tes sessions. D’abord **rappelée** : injectée au premier message, puis quand un message en parle. Redite le nombre de fois choisi, Mnemo propose de la passer à **toujours** : injectée à chaque message. Si elle porte une règle vérifiable (chemins ou commandes interdits), elle peut devenir **vérifiée** : injectée à chaque message, et le pouvoir Bouclier refuse les actions qui la violent. Chaque montée attend ton accord.',
			},
			{
				genre: 'note',
				texte: 'Montants, échéances et périmètres sont des faits à fort enjeu : Mnemo ne les écrit jamais seul. Comme un fait inféré ou qui contredit une source plus fiable, ils sont écrits « à confirmer » et attendent ton accord dans Mémoire › Archiviste › À arbitrer.',
			},
		],
	},
	{
		cle: 'archiviste',
		titre: 'L’archiviste',
		sous: 'qui range la mémoire',
		titreLong: 'L’archiviste',
		blocs: [
			{
				genre: 'chapo',
				texte: 'L’archiviste est un agent comme les autres, dont la mission est de ranger : il classe ce que tu lui confies (documents, notes importées), fait le ménage (doublons, liens cassés, fiches mal nommées) et relie les fiches entre elles.',
			},
			{
				genre: 'points',
				points: [
					'**Il écrit seul** dans les types de fiche que tu laisses allumés (Réglages › Mémoire › Confiance, « L’archiviste écrit seul… ») ; dans les autres, ses informations sont écrites « à confirmer ».',
					'**Il te demande** pour le reste : les informations à confirmer, les montées de consigne et ses lots (plusieurs suppressions, fusions ou confirmations d’un coup) attendent ton accord dans Mémoire › Archiviste › À arbitrer.',
					'**Il tourne sur Claude Code** et démarre toujours dans la mémoire.',
				],
			},
			{ genre: 'note', texte: 'Chaque écriture de l’archiviste est un commit : tu peux toujours revenir en arrière.' },
		],
	},
];
