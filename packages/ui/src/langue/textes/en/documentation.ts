import { DOSSIERS_FIXES, PROFIL_ARCHIVISTE } from '@mnemo/commun';
import type { Forme } from '../../forme.ts';
import type { documentation as fr } from '../fr/documentation.ts';

const def = (terme: string, definition: string): readonly [string, string] => [terme, definition];

export const documentation: Forme<typeof fr> = {
	page: { titre: 'Documentation', sommaire: 'Contents' },
	capacites: {
		legende: 'Capabilities and hooks, in session order (Agents › Capabilities)',
		colonnes: ['Capability', 'Hook', 'Effect', 'Configurable'],
		toujours: 'no, always on',
		reglable: 'yes',
	},
	principe: {
		titre: 'Principles',
		termes: [
			def('Memory', 'Markdown notes in `_mnemo/`, versioned with git.'),
			def('Writing', 'under a lock, one commit per write: `mnemo: <action> <path>`.'),
			def('Engines', 'Claude Code, Codex, Mistral Vibe; MCP server and hooks (Settings › Connections).'),
			def('MCP tools', '`chercher`, `lire`, `lister`, `voisins`, `chronologie`, `contexte`, `proposer`, `entretenir`, `deplacer`, `extraire_source`, `diagnostiquer`.'),
			def('Local', 'embeddings and reranker on this machine; only what is injected or read is sent to the provider.'),
		],
	},
	session: {
		titre: 'Session',
		effets: {
			debut: 'starting branch and commit; nothing injected',
			message: 'standing instructions, position note, automatic injections, leads',
			outil: 'refuses an action that goes against a `verifiee` instruction',
			apres_outil: 'notes read or written are recorded and no longer suggested',
			arret: 'session "waiting for a reply"',
			fin: 'no summary: minimal episode without AI (goal, dates, branch, files)',
		},
		sansSouffle: 'Without Breath: nothing injected; the MCP tools remain available.',
		projet: 'Project: a folder with a marker (`.git`, `package.json`…, Settings › Memory › Recall), ◆ in the folder tree.',
	},
	agents: {
		titre: 'Agents',
		termes: [
			def('Note', `\`_mnemo/${DOSSIERS_FIXES.profils}/<name>/<name>.md\`.`),
			def('Class', 'engine and model; an engine that is not linked is locked.'),
			def('Mission', 'instruction added to the system instructions.'),
			def(
				'Skills',
				`\`_mnemo/${DOSSIERS_FIXES.skills}/<name>/SKILL.md\` and \`_mnemo/${DOSSIERS_FIXES.profils}/<name>/${DOSSIERS_FIXES.skills}/\` (takes precedence); loaded according to \`description\`; icon: \`metadata.icone\`.`,
			),
			def('Built-in skill', 'from the Archivist: editable, restorable; cannot be renamed or deleted.'),
			def('Plugins', 'Claude Code: checked ones enabled, the others disabled.'),
			def('Capabilities', 'Agents › Capabilities.'),
			def('Start', '`_mnemo/` or the folder chosen at launch.'),
		],
	},
	rappel: {
		titre: 'Recall',
		etapes: [
			'Candidates: project, named notes, neighbors of manual injections.',
			'Score: meaning and signals, then learned model; % if the model is accepted.',
			'Decision: injected in full, lead (title, path, first sentence), or nothing.',
		],
		legende: 'Settings › Memory › Recall',
		colonnes: ['Setting', 'Effect', 'Default'],
		lignes: [
			['Injection threshold', 'minimum score for automatic injection', '90%'],
			['Injected notes', 'automatic injections per message', '2'],
			['Lead threshold', 'minimum score for a lead', '10%'],
			['Suggested leads', 'leads per message', '3'],
			['Named notes', 'cards for notes cited per message', '5'],
			['Manual injection weight', 'bonus for neighbors', '0.25'],
			['Half-life', 'messages to halve this bonus', '3'],
			['Automatic retraining', 'score retrained in the background from your feedback, at most once a day', 'yes'],
		],
		note: 'Without an accepted model: no automatic injection. Without a learned score: leads on the first message and after a manual injection.',
	},
	recherche: {
		titre: 'Search',
		legende: 'Settings › Memory › Search (`chercher`, interface)',
		colonnes: ['Setting', 'Effect', 'Default'],
		lignes: [
			['Current project', 'bonus, project neighborhood', '0.1'],
			['Confidence', 'maximum penalty, low confidence', '0.05'],
			['Memory notes', 'bonus, excluding documents', '0.05'],
			['Freshness', 'bonus, halved after one year', '0.05'],
			['Recall threshold', 'minimum relevance', '0.4'],
			['Min. similarity', 'minimum semantic similarity (Recall card)', '0.45'],
			['Results / search', 'default number of results', '10'],
			['Timeline', 'facts from `chronologie`', '30'],
			['Graph', 'notes whose links are followed', '5'],
			['Reranker', 'candidates reranked', '40'],
		],
	},
	confiance: {
		titre: 'Confidence',
		formule: 'Confidence = source reliability × weight of the nature; observed `email`: 0.7 × 0.85 ≈ 0.6.',
		legendeSources: 'Reliability by source (Settings › Memory › Confidence)',
		colonnesSources: ['Source type', 'Reliability'],
		lignesSources: [
			['`utilisateur`, `contrat`', '1'],
			['`spec_validee`', '0.9'],
			['`compte_rendu`', '0.8'],
			['`email`', '0.7'],
			['`note`, `session`', '0.6'],
			['`deduction`', '0.5'],
			['`inconnue`', '0.3'],
		],
		termes: [
			def('Nature', '`declare` 1 · `observe` 0.85 · `infere` 0.7.'),
			def('Multiple sources', '1 − Π(1 − cᵢ), capped at 0.9 (1 with `utilisateur`, `contrat`).'),
			def(
				'To confirm',
				'`infere`, contradiction by a more reliable source, `montant`, `echeance`, `perimetre`, type turned off in "The Archivist writes on its own…". Validation: Memory › Archivist › To decide.',
			),
		],
		consignes: 'Instructions',
		legendeNiveaux: 'Levels of an instruction',
		colonnesNiveaux: ['Level', 'Injection', 'Suggested promotion'],
		lignesNiveaux: [
			['`rappelee`', 'first message, then when mentioned', '`toujours` after 2 repeats'],
			['`toujours`', 'every message', '`verifiee` if `regle`'],
			['`verifiee`', 'every message; Shield enforces `chemins_interdits`, `commandes_interdites`', '—'],
		],
		montee: 'Promotion: on confirmation (To decide).',
	},
	archiviste: {
		titre: 'Archivist',
		termes: [
			def('Profile', `\`${PROFIL_ARCHIVISTE}\`, Claude Code, in \`_mnemo/\` (root via \`--add-dir\`).`),
			def('Role', 'sources (`extraire_source`), cleanup (`diagnostiquer`, `entretenir`, `deplacer`).'),
			def('Skills', `\`_mnemo/${DOSSIERS_FIXES.profils}/${PROFIL_ARCHIVISTE}/${DOSSIERS_FIXES.skills}/\`: \`emails\`, \`specs\`, \`comptes-rendus\`, \`menage\`.`),
			def('Without confirmation', 'types turned on (Settings › Memory › Confidence).'),
			def('To decide', 'facts to confirm, promotions, batches (`proposer_lot`).'),
		],
	},
};
