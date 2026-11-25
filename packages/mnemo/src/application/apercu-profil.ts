// Aperçu, en lecture seule, de tout ce qu'une session d'un profil reçoit, avec l'origine de chaque élément.
import { consigneATraiter, DOSSIERS_FIXES } from '@mnemo/commun';
import { separerFrontmatter } from '../domaine/fiche.ts';
import { skillPourProjet } from '../domaine/profil.ts';
import type { EvenementHook } from '../domaine/session.ts';
import { INSTRUCTIONS_SESSION } from './consignes-par-defaut.ts';
import { texteDuBilan } from './episode.ts';
import { consigneCodex } from './moteurs/codex/session.ts';
import { enabledPluginsDe } from './moteurs/claude-code/plugin.ts';
import type { Dependances } from './ports.ts';
import { chargerProfil, dossierSkillsDuProfil } from './profil.ts';

/** D'où vient un bloc : le profil, Mnemo, la mémoire, un plugin Claude Code, Claude Code hors Mnemo, ou un texte système. */
export type OrigineApercu = 'profil' | 'mnemo' | 'memoire' | 'plugin' | 'hors_mnemo' | 'systeme';

/** Un élément d'une liste de l'aperçu ; `actif` : la session le reçoit. */
export type ElementApercu = { nom: string; detail: string; actif: boolean };

/** Un bloc de l'aperçu : un texte reçu tel quel, ou une liste d'éléments ; `reglable` : il se règle dans le profil. */
export type BlocApercu = { origine: OrigineApercu; titre: string; reglable: boolean; texte?: string; elements?: ElementApercu[] };

/** Ce que fait chaque événement de hook de Mnemo dans une session. */
export const DESCRIPTIONS_HOOKS: Record<EvenementHook, string> = {
	debut: 'Au démarrage : note la session ; rien n\'est injecté avant le premier message.',
	message: 'À chaque message : injecte les consignes, la fiche de position au premier message et les fiches demandées, et propose des pistes à lire (cartes).',
	outil: 'Avant chaque outil : refuse une action contraire à une consigne vérifiée.',
	apres_outil: 'Après un outil : note les fiches lues ou écrites ; rien n\'est injecté.',
	arret: 'À la fin d\'un tour ou sur une demande de permission : tient l\'état de la session (attend, à relire).',
	fin: 'À la fermeture : termine la session et écrit un épisode minimal s\'il n\'y a pas eu de bilan.',
};

/** Skills d'un dossier de la mémoire : nom (dossier), description et texte du `SKILL.md`. */
async function skillsAvecTexte(dep: Dependances, dossier: string): Promise<{ nom: string; description: string; texte: string }[]> {
	const resultat: { nom: string; description: string; texte: string }[] = [];
	for (const sous of (await dep.coffre.lister(dossier)).dossiers) {
		const texte = await dep.coffre.lire(`${sous}/SKILL.md`);
		if (texte === null) continue;
		let description = '';
		try {
			const valeur = separerFrontmatter(`${sous}/SKILL.md`, texte).entete.description;
			if (typeof valeur === 'string') description = valeur;
		} catch {
			// frontmatter illisible : la skill reste listée par son nom
		}
		resultat.push({ nom: sous.slice(sous.lastIndexOf('/') + 1), description, texte });
	}
	return resultat;
}

/**
 * Ce que reçoit une session du profil `nom`, dans l'ordre : consigne du profil, instructions du serveur MCP, hooks, skills de
 * la mémoire, plugins Claude Code, ce qui vient du moteur hors Mnemo, consignes système. Avec `projet`, les skills de
 * `_mnemo/skills/` sont filtrées par leur champ `projets` comme au lancement ; sans projet, ce filtre n'est pas appliqué.
 * Codex : les skills actives sont listées dans la consigne (lues par l'outil `lire`), qui est montrée telle que la session la
 * reçoit ; ni plugins ni skills personnelles de Claude Code.
 */
export async function apercuProfil(dep: Dependances, nom: string, projet?: string): Promise<{ blocs: BlocApercu[]; avertissements: string[] }> {
	const profil = await chargerProfil(dep, nom);
	const codex = profil.moteur === 'codex';
	const { plugins: installes, avertissements: lus } = codex ? { plugins: [], avertissements: [] } : await dep.pluginsClaude.installes();
	const avertissements = [...lus];

	const duProfil = await skillsAvecTexte(dep, dossierSkillsDuProfil(profil.nom));
	const nomsDuProfil = new Set(duProfil.map((s) => s.nom));
	const retenue = (n: string) => profil.skillsMemoire === 'tous' || profil.skillsMemoire.includes(n);
	const skills: ElementApercu[] = duProfil.map((s) => ({ nom: s.nom, detail: `${s.description} (skill du profil)`.trim(), actif: true }));
	// pour la consigne de Codex : les skills actives, avec le dossier de leur `SKILL.md`
	const actives = duProfil.map((s) => ({ nom: s.nom, dossier: `${dossierSkillsDuProfil(profil.nom)}/${s.nom}`, texte: s.texte }));
	for (const s of await skillsAvecTexte(dep, DOSSIERS_FIXES.skills)) {
		const pourLeProjet = projet === undefined || skillPourProjet(s.texte, projet);
		const raison = nomsDuProfil.has(s.nom) ? 'remplacée par la skill du profil de même nom' : !retenue(s.nom) ? 'non retenue par le profil' : !pourLeProjet ? 'réservée à d\'autres projets' : '';
		skills.push({ nom: s.nom, detail: [s.description, raison].filter((t) => t !== '').join(' — '), actif: raison === '' });
		if (raison === '') actives.push({ nom: s.nom, dossier: `${DOSSIERS_FIXES.skills}/${s.nom}`, texte: s.texte });
	}

	const allumes = enabledPluginsDe(profil, installes);
	const plugins: ElementApercu[] = installes.map((p) => ({
		nom: p.id,
		detail: [`version ${p.version}`, p.skills.length > 0 ? `skills : ${p.skills.map((s) => s.nom).join(', ')}` : '', p.hooks ? 'a des hooks' : ''].filter((t) => t !== '').join(' ; '),
		actif: allumes[p.id] === true,
	}));
	for (const id of profil.plugins.filter((id) => !installes.some((p) => p.id === id))) {
		plugins.push({ nom: id, detail: 'listé dans le profil mais non installé', actif: false });
		avertissements.push(`Le plugin « ${id} » est listé dans le profil « ${profil.nom} » mais n'est pas installé dans Claude Code.`);
	}

	const horsMnemo: ElementApercu[] = codex
		? [
				{ nom: 'AGENTS.md', detail: 'instructions de l\'utilisateur et du projet, lues par Codex', actif: true },
				{ nom: '.agents/skills', detail: 'skills du dépôt et de l\'utilisateur (~/.agents/skills/), lues par Codex', actif: true },
			]
		: [
				...(await dep.pluginsClaude.skillsPersonnelles()).map((s) => ({ nom: s, detail: 'skill personnelle de Claude Code (~/.claude/skills/)', actif: true })),
				{ nom: 'CLAUDE.md', detail: 'instructions de l\'utilisateur et du projet, lues par Claude Code', actif: true },
			];

	const titreConsigne = profil.consignePersonnalisee ? 'Consigne du profil (personnalisée)' : 'Consigne du profil (par défaut)';
	const blocs: BlocApercu[] = [
		codex
			? { origine: 'profil', titre: `${titreConsigne}, avec la liste des skills`, reglable: true, texte: consigneCodex(profil, actives) }
			: { origine: 'profil', titre: titreConsigne, reglable: true, texte: `${profil.consigne.trim()}\n` },
		{ origine: 'mnemo', titre: 'Instructions du serveur MCP Mnemo', reglable: false, texte: INSTRUCTIONS_SESSION },
		{ origine: 'mnemo', titre: 'Hooks de Mnemo', reglable: true, elements: profil.hooks.map((h) => ({ nom: h, detail: DESCRIPTIONS_HOOKS[h], actif: true })) },
		{ origine: 'memoire', titre: codex ? 'Skills de la mémoire (listées dans la consigne, lues par l\'outil lire)' : 'Skills de la mémoire', reglable: true, elements: skills },
		...(codex ? [] : [{ origine: 'plugin', titre: 'Plugins Claude Code', reglable: true, elements: plugins } satisfies BlocApercu]),
		{ origine: 'hors_mnemo', titre: 'Hors Mnemo', reglable: false, elements: horsMnemo },
		{ origine: 'systeme', titre: 'Consigne du bilan', reglable: false, texte: texteDuBilan({ objectif: null }) },
		{ origine: 'systeme', titre: 'Consigne d\'import envoyée à l\'archiviste', reglable: false, texte: consigneATraiter(2) },
	];
	return { blocs, avertissements };
}
