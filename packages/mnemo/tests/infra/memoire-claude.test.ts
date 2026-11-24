import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dossiersAAmorcer, NIVEAUX_AMORCE } from '../../src/application/dossiers.ts';
import { dossiersRacine } from '../../src/infra/dossiers.ts';
import { memoireClaude, projetDepuisDossier, projetsClaude } from '../../src/infra/memoire-claude.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

async function fauxClaude() {
	const racine = await dossierTemporaire();
	const home = join(racine, 'alice');
	const claude = join(home, '.claude');
	const memoireDe = async (encode: string, fichiers: Record<string, string>) => {
		const dossier = join(claude, 'projects', encode, 'memory');
		await mkdir(dossier, { recursive: true });
		for (const [nom, texte] of Object.entries(fichiers)) await writeFile(join(dossier, nom), texte);
		return dossier;
	};
	return { racine, home, claude, memoireDe };
}

const encoder = (chemin: string) => chemin.replace(/[^a-zA-Z0-9]/gu, '-');

describe('memoireClaude', () => {
	it('lit les notes de chaque projet (MEMORY.md compris), lit CLAUDE.md ; un autre fichier est ignoré avec sa raison', async () => {
		const { home, claude, memoireDe } = await fauxClaude();
		const h = encoder(home);
		await memoireDe(`${h}-Jardin-app`, { 'MEMORY.md': 'index', 'retour.md': 'un retour', 'autre.txt': 'non' });
		await memoireDe(`${h}-Sites-Mnemo`, { 'Contexte.md': 'ctx' });
		await memoireDe(h, { 'racine.md': 'à la racine' });
		await writeFile(join(claude, 'CLAUDE.md'), 'global');
		const { notes, ignores } = await memoireClaude(claude, home).lire();
		const cles = notes.map((n) => `${n.origine}|${n.projet}|${n.nom}|${n.texte}`).sort();
		expect(cles).toEqual([
			'claude_md|global|CLAUDE|global',
			'memoire|home|racine|à la racine',
			'memoire|jardin-app|MEMORY|index',
			'memoire|jardin-app|retour|un retour',
			'memoire|sites-mnemo|Contexte|ctx',
		]);
		expect(ignores).toEqual([{ chemin: join(claude, 'projects', `${h}-Jardin-app`, 'memory', 'autre.txt'), raison: 'pas un fichier .md' }]);
		expect(notes.find((n) => n.nom === 'retour')?.cle).toBe(`${h}-Jardin-app`);
		expect(notes.find((n) => n.nom === 'CLAUDE')?.cle).toBeUndefined();
	});

	it('sous-dossiers de memory/ lus, extension .md sans tenir compte de la casse', async () => {
		const { home, claude, memoireDe } = await fauxClaude();
		const dossier = await memoireDe(`${encoder(home)}-p`, { 'Note.MD': 'majuscules' });
		await mkdir(join(dossier, 'clients', 'grands'), { recursive: true });
		await writeFile(join(dossier, 'clients', 'acme.md'), 'acme');
		await writeFile(join(dossier, 'clients', 'grands', 'beta.md'), 'beta');
		const { notes, ignores } = await memoireClaude(claude, home).lire();
		expect(notes.map((n) => `${n.nom}|${n.texte}`).sort()).toEqual(['Note|majuscules', 'clients/acme|acme', 'clients/grands/beta|beta']);
		expect(ignores).toEqual([]);
	});

	it('préfixe du dossier personnel absent : nom encodé entier, en minuscules', async () => {
		const { home, claude, memoireDe } = await fauxClaude();
		await memoireDe('-Volumes-Autre-Projet', { 'a.md': 'x' });
		const { notes } = await memoireClaude(claude, home).lire();
		expect(notes.map((n) => n.projet)).toEqual(['volumes-autre-projet']);
	});

	it('chemins longs : noms de dossier tronqués mais distincts (suffixe d\'empreinte)', async () => {
		const long = 'a'.repeat(130);
		const x = projetDepuisDossier(`-${long}-x`, '/rien');
		const y = projetDepuisDossier(`-${long}-y`, '/rien');
		expect(x).not.toBe(y);
		expect(x.length).toBeLessThanOrEqual(120);
		expect(projetDepuisDossier('-Users-a-Projets-X', '/Users/a')).toBe('projets-x');
	});

	it('ignore les liens symboliques et les fichiers de plus de 1 Mo, et les compte', async () => {
		const { racine, home, claude, memoireDe } = await fauxClaude();
		const dossier = await memoireDe(`${encoder(home)}-p`, { 'ok.md': 'ok', 'gros.md': 'x'.repeat(1024 * 1024 + 1) });
		await writeFile(join(racine, 'secret.md'), 'secret');
		await symlink(join(racine, 'secret.md'), join(dossier, 'lien.md'));
		await mkdir(join(racine, 'ailleurs', 'memory'), { recursive: true });
		await writeFile(join(racine, 'ailleurs', 'memory', 'z.md'), 'z');
		await symlink(join(racine, 'ailleurs'), join(claude, 'projects', 'projet-lien'));
		await symlink(join(racine, 'secret.md'), join(claude, 'CLAUDE.md'));
		const m = memoireClaude(claude, home);
		const { notes, ignores } = await m.lire();
		expect(notes.map((n) => n.nom)).toEqual(['ok']);
		// gros fichier, lien de fichier, projet lié et CLAUDE.md lié
		expect(ignores).toHaveLength(4);
		expect(ignores.map((i) => i.raison).sort()).toEqual(['lien symbolique', 'lien symbolique', 'lien symbolique', 'plus de 1 Mo']);
		expect(ignores.some((i) => i.chemin.endsWith('gros.md'))).toBe(true);
		// chaque lecture a sa propre liste : deux lectures simultanées ne se mélangent pas
		const [a, b] = await Promise.all([m.lire(), m.lire()]);
		expect(a.ignores).toHaveLength(4);
		expect(b.ignores).toHaveLength(4);
	});

	it('dossier Claude absent : aucune note', async () => {
		const { racine, home } = await fauxClaude();
		expect((await memoireClaude(join(racine, 'rien'), home).lire()).notes).toEqual([]);
	});
});

describe('projetsClaude', () => {
	it('dossiers du service avec leur clé Claude Code ; CLAUDE.md (toute casse) et .md sous .claude/ des projets ; le reste ignoré avec sa raison', async () => {
		const racine = await dossierTemporaire();
		const home = join(racine, 'home');
		const espace = join(home, 'Travail');
		const p = join(espace, 'Projets', 'Mnemo');
		await mkdir(join(p, '.claude', 'rules'), { recursive: true });
		await mkdir(join(p, '.claude', '.cache'), { recursive: true });
		await mkdir(join(p, '.claude', 'worktrees', 'w'), { recursive: true });
		await writeFile(join(p, 'CLAUDE.md'), 'racine');
		await writeFile(join(p, '.claude', 'claude.md'), 'caché');
		await writeFile(join(p, '.claude', 'rules', 'style.md'), 'style');
		await writeFile(join(p, '.claude', 'settings.local.json'), '{}');
		await writeFile(join(p, '.claude', '.cache', 'x.md'), 'x');
		await writeFile(join(p, '.claude', 'worktrees', 'w', '.git'), 'gitdir: ailleurs');
		await writeFile(join(p, '.claude', 'worktrees', 'w', 'README.md'), 'autre dépôt');
		await writeFile(join(p, 'README.md'), 'pas une instruction');
		const q = join(espace, 'Projets', 'Base');
		await mkdir(join(q, '.claude'), { recursive: true });
		await writeFile(join(q, '.claude', 'claude.md'), 'base');
		await writeFile(join(racine, 'dehors.md'), 'dehors');
		await symlink(join(racine, 'dehors.md'), join(q, 'Claude.md'));
		const liste = await projetsClaude(espace, async () => [
			{ chemin: 'Projets' },
			{ chemin: 'Projets/Base' },
			{ chemin: 'Projets/Mnemo' },
		], { home, dossierClaude: join(home, '.claude') }).lister();
		expect(liste.dossiers).toContainEqual({ dossier: 'Projets/Mnemo', cle: encoder(p), nom: 'travail-projets-mnemo' });
		expect(liste.dossiers).toHaveLength(3);
		expect(liste.instructions.map((i) => `${i.dossier}|${i.nom}|${i.chemin}`).sort()).toEqual([
			'Projets/Base|.claude/claude.md|Projets/Base/.claude/claude.md',
			'Projets/Mnemo|.claude/claude.md|Projets/Mnemo/.claude/claude.md',
			'Projets/Mnemo|.claude/rules/style.md|Projets/Mnemo/.claude/rules/style.md',
			'Projets/Mnemo|CLAUDE.md|Projets/Mnemo/CLAUDE.md',
		]);
		const raisons = Object.fromEntries(liste.ignores.map((i) => [i.chemin, i.raison]));
		expect(raisons['Projets/Mnemo/.claude/settings.local.json']).toBe('pas un fichier .md');
		expect(raisons['Projets/Mnemo/.claude/.cache']).toBe('dossier caché');
		expect(raisons['Projets/Mnemo/.claude/worktrees/w']).toBe('autre dépôt git');
		expect(raisons['Projets/Base/Claude.md']).toBe('lien symbolique');
		expect(Object.keys(raisons).some((c) => c.endsWith('README.md'))).toBe(false);
	});

	it('CLAUDE.local.md et les CLAUDE.md des sous-dossiers sont des instructions ; ce qui n\'est pas parcouru est compté', async () => {
		const racine = await dossierTemporaire();
		const p = join(racine, 'P');
		await mkdir(join(p, 'packages', 'api'), { recursive: true });
		await mkdir(join(p, '.vscode'), { recursive: true });
		await mkdir(join(p, '.git'), { recursive: true });
		await mkdir(join(p, 'a', 'b', 'c', 'd', 'e', 'f', 'g'), { recursive: true });
		await writeFile(join(p, 'CLAUDE.local.md'), 'perso');
		await writeFile(join(p, 'packages', 'api', 'CLAUDE.md'), 'api');
		await writeFile(join(p, 'packages', 'api', 'README.md'), 'pas une instruction');
		await writeFile(join(p, '.vscode', 'CLAUDE.md'), 'caché');
		await writeFile(join(p, '.git', 'CLAUDE.md'), 'dépôt');
		await writeFile(join(p, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'CLAUDE.md'), 'profond');
		const dossiers = ['P', 'P/a', 'P/a/b', 'P/packages', 'P/packages/api'].map((chemin) => ({ chemin }));
		const liste = await projetsClaude(racine, async () => dossiers, { home: racine, dossierClaude: join(racine, 'config') }).lister();
		expect(liste.instructions.map((i) => i.chemin).sort()).toEqual(['P/CLAUDE.local.md', 'P/packages/api/CLAUDE.md']);
		expect(liste.ignores).toEqual([
			{ chemin: 'P', raison: '1 dossier caché non parcouru (.vscode)' },
			{ chemin: 'P/a/b', raison: `1 dossier au-delà de ${NIVEAUX_AMORCE} niveaux de la racine non parcouru (c)` },
		]);
	});

	it(`les CLAUDE.md des sous-dossiers sont cherchés dans les ${NIVEAUX_AMORCE} premiers niveaux de la racine ; .claude/ d'un dossier du dernier niveau reste lu`, async () => {
		const racine = await dossierTemporaire();
		const p = join(racine, 'Clients', 'Acme', 'Site');
		await mkdir(join(p, 'web', 'src'), { recursive: true });
		await mkdir(join(p, '.claude', 'rules'), { recursive: true });
		await writeFile(join(p, 'CLAUDE.md'), 'site');
		await writeFile(join(p, 'web', 'CLAUDE.md'), 'trop bas');
		await writeFile(join(p, '.claude', 'rules', 'style.md'), 'style');
		const dossiers = ['Clients', 'Clients/Acme', 'Clients/Acme/Site'].map((chemin) => ({ chemin }));
		const liste = await projetsClaude(racine, async () => dossiers, { home: racine, dossierClaude: join(racine, 'config') }).lister();
		expect(liste.instructions.map((i) => i.nom).sort()).toEqual(['.claude/rules/style.md', 'CLAUDE.md']);
		expect(liste.ignores).toEqual([{ chemin: 'Clients/Acme/Site', raison: `1 dossier au-delà de ${NIVEAUX_AMORCE} niveaux de la racine non parcouru (web)` }]);
	});

	it('un dossier listé est traité pareil, caché ou non : ses CLAUDE.md et son .claude/ sont des instructions, une seule règle', async () => {
		const racine = await dossierTemporaire();
		const notes = join(racine, 'Documents', '.notes');
		await mkdir(join(notes, '.claude', 'rules'), { recursive: true });
		await writeFile(join(notes, 'CLAUDE.md'), 'notes');
		await writeFile(join(notes, '.claude', 'CLAUDE.md'), 'règles');
		await writeFile(join(notes, '.claude', 'rules', 'a.md'), 'a');
		const dossiers = ['Documents', 'Documents/.notes'].map((chemin) => ({ chemin }));
		const liste = await projetsClaude(racine, async () => dossiers, { home: racine, dossierClaude: join(racine, 'config') }).lister();
		expect(liste.instructions.map((i) => i.chemin).sort()).toEqual(['Documents/.notes/.claude/CLAUDE.md', 'Documents/.notes/.claude/rules/a.md', 'Documents/.notes/CLAUDE.md']);
		expect(liste.ignores).toEqual([]);
	});

	it('le dépôt .git n\'est jamais lu : rien de lui dans la liste des dossiers, les instructions ni les écarts', async () => {
		const racine = await dossierTemporaire();
		const projet = join(racine, 'X');
		await mkdir(join(projet, '.git', 'objects', 'ab'), { recursive: true });
		await mkdir(join(projet, '.git', 'refs', 'heads'), { recursive: true });
		await writeFile(join(projet, '.git', 'CLAUDE.md'), 'dans git');
		await writeFile(join(projet, 'CLAUDE.md'), 'projet');
		const liste = await projetsClaude(racine, () => dossiersAAmorcer(dossiersRacine(racine)), { home: racine, dossierClaude: join(racine, 'config') }).lister();
		const tout = JSON.stringify(liste);
		expect(tout).not.toMatch(/\.git/u);
		expect(liste.instructions.map((i) => i.chemin)).toEqual(['X/CLAUDE.md']);
	});

	it('un dossier qui est la configuration de Claude Code n\'est jamais parcouru', async () => {
		const racine = await dossierTemporaire();
		await mkdir(join(racine, 'config'), { recursive: true });
		await writeFile(join(racine, 'config', 'CLAUDE.md'), 'global');
		const liste = await projetsClaude(racine, async () => [{ chemin: 'config' }], { home: racine, dossierClaude: join(racine, 'Config') }).lister();
		expect(liste.instructions).toEqual([]);
		expect(liste.ignores.map((i) => i.chemin)).toEqual(['config']);
	});

	it('une configuration de Claude Code placée dans un projet n\'est jamais lue comme ses instructions', async () => {
		const racine = await dossierTemporaire();
		const p = join(racine, 'P');
		await mkdir(join(p, '.claude', 'projects', '-k', 'memory'), { recursive: true });
		await mkdir(join(p, 'outils', 'conf'), { recursive: true });
		await writeFile(join(p, 'CLAUDE.md'), 'racine du projet');
		await writeFile(join(p, '.claude', 'projects', '-k', 'memory', 'n.md'), 'note');
		// configuration dans .claude/ du projet : tout le sous-arbre écarté
		// le dossier et son .claude/ sont tous deux listés (comme par l'arbre) : une seule ligne pour la configuration
		const dedans = await projetsClaude(racine, async () => [{ chemin: 'P' }, { chemin: 'P/.claude' }, { chemin: 'P/.claude/projects' }], { home: racine, dossierClaude: join(p, '.claude') }).lister();
		expect(dedans.instructions.map((i) => i.nom)).toEqual(['CLAUDE.md']);
		expect(dedans.ignores).toEqual([{ chemin: 'P/.claude', raison: expect.stringMatching(/configuration de Claude Code/u) }]);
		// configuration plus bas sous .claude/ : ce sous-dossier seulement
		const plusBas = await projetsClaude(racine, async () => [{ chemin: 'P' }], { home: racine, dossierClaude: join(p, '.claude', 'projects') }).lister();
		expect(plusBas.instructions.map((i) => i.nom)).toEqual(['CLAUDE.md']);
		expect(plusBas.ignores).toContainEqual({ chemin: 'P/.claude/projects', raison: expect.stringMatching(/configuration de Claude Code/u) });
	});
});
