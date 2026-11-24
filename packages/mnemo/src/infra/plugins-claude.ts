import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginInstalle, PluginsClaude, SkillInstallee } from '../application/ports.ts';
import { separerFrontmatter } from '../domaine/fiche.ts';
import { dossierClaudeParDefaut } from './memoire-claude.ts';

/** Dossier des skills dans l'arborescence de Claude Code (plugin ou `~/.claude/`) : pas le dossier fixe `skills` de la mémoire Mnemo. */
const DOSSIER_SKILLS_CLAUDE = 'skills';

const texte = (valeur: unknown): string => (typeof valeur === 'string' ? valeur.trim() : '');

const existe = (chemin: string): Promise<boolean> => stat(chemin).then(() => true, () => false);

/** Noms des sous-dossiers de `dossier` (vide s'il manque ou ne se lit pas), triés. */
async function sousDossiers(dossier: string): Promise<string[]> {
	try {
		const entrees = await readdir(dossier, { withFileTypes: true });
		const noms: string[] = [];
		for (const e of entrees) if (e.isDirectory() || (e.isSymbolicLink() && (await stat(join(dossier, e.name)).then((s) => s.isDirectory(), () => false)))) noms.push(e.name);
		return noms.sort();
	} catch {
		return [];
	}
}

/** Une skill d'après son `SKILL.md` : `name` et `description` du frontmatter, à défaut le nom du dossier et rien. */
async function lireSkill(dossierSkill: string, nomDossier: string): Promise<SkillInstallee | null> {
	let brut: string;
	try {
		brut = await readFile(join(dossierSkill, 'SKILL.md'), 'utf8');
	} catch {
		return null;
	}
	try {
		const { entete } = separerFrontmatter(nomDossier, brut);
		return { nom: texte(entete['name']) || nomDossier, description: texte(entete['description']) };
	} catch {
		return { nom: nomDossier, description: '' };
	}
}

async function skillsDe(dossier: string): Promise<SkillInstallee[]> {
	const skills: SkillInstallee[] = [];
	for (const nom of await sousDossiers(dossier)) {
		const skill = await lireSkill(join(dossier, nom), nom);
		if (skill !== null) skills.push(skill);
	}
	return skills;
}

/** Plugins Claude Code installés et skills personnelles, d'après le dossier de configuration de Claude Code. Ne lève jamais. */
export function pluginsClaude(dossierClaude: string = dossierClaudeParDefaut()): PluginsClaude {
	return {
		async installes() {
			const fichier = join(dossierClaude, 'plugins', 'installed_plugins.json');
			let brut: string;
			try {
				brut = await readFile(fichier, 'utf8');
			} catch (erreur) {
				if ((erreur as NodeJS.ErrnoException).code === 'ENOENT') return { plugins: [], avertissements: [] };
				return { plugins: [], avertissements: [`Le fichier des plugins installés (${fichier}) ne se lit pas.`] };
			}
			let declares: Record<string, unknown>;
			try {
				const racine: unknown = JSON.parse(brut.replace(/^﻿/u, ''));
				const plugins = (racine as { plugins?: unknown } | null)?.plugins;
				if (typeof plugins !== 'object' || plugins === null || Array.isArray(plugins)) throw new Error('plugins absent');
				declares = plugins as Record<string, unknown>;
			} catch {
				return { plugins: [], avertissements: [`Le fichier des plugins installés (${fichier}) est illisible.`] };
			}
			const plugins: PluginInstalle[] = [];
			const avertissements: string[] = [];
			for (const [id, entrees] of Object.entries(declares)) {
				const entree = Array.isArray(entrees) ? (entrees[0] as Record<string, unknown> | undefined) : undefined;
				if (entree === undefined || entree === null || typeof entree !== 'object') {
					avertissements.push(`Le plugin « ${id} » n'a aucune installation lisible dans ${fichier}.`);
					continue;
				}
				const plugin: PluginInstalle = { id, nom: id.split('@')[0]!, version: texte(entree['version']), portee: texte(entree['scope']), skills: [], hooks: false };
				const chemin = texte(entree['installPath']);
				if (chemin === '' || !(await existe(chemin))) {
					avertissements.push(`Le dossier du plugin « ${id} » est introuvable${chemin === '' ? '' : ` (${chemin})`} : ses skills et ses hooks ne sont pas lus.`);
				} else {
					plugin.skills = await skillsDe(join(chemin, DOSSIER_SKILLS_CLAUDE));
					plugin.hooks = await existe(join(chemin, 'hooks', 'hooks.json'));
				}
				plugins.push(plugin);
			}
			return { plugins, avertissements };
		},
		async skillsPersonnelles() {
			return sousDossiersAvecSkill(join(dossierClaude, DOSSIER_SKILLS_CLAUDE));
		},
	};
}

async function sousDossiersAvecSkill(dossier: string): Promise<string[]> {
	const noms: string[] = [];
	for (const nom of await sousDossiers(dossier)) if (await existe(join(dossier, nom, 'SKILL.md'))) noms.push(nom);
	return noms;
}
