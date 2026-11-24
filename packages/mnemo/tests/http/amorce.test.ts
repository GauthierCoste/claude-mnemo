import { chmod, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { BilanAmorceVue, SessionVue } from '@mnemo/contrat';
import type { Fichiers } from '../../src/application/ports.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { fichiersDossier } from '../../src/infra/fichiers-dossier.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';

const encoder = (chemin: string) => chemin.replace(/[^a-zA-Z0-9]/gu, '-');
const verrouilles: string[] = [];
afterEach(async () => {
	// rendus inscriptibles, pour que le dossier temporaire puisse être supprimé
	while (verrouilles.length > 0) await chmodRecursif(verrouilles.pop()!, 0o755);
});

async function chmodRecursif(dossier: string, mode: number): Promise<void> {
	for (const e of await readdir(dossier, { withFileTypes: true })) if (e.isDirectory()) await chmodRecursif(join(dossier, e.name), mode);
	await chmod(dossier, mode);
}

/** Empreinte du dossier de configuration : chemins, tailles et dates de modification de tout ce qu'il contient. */
async function photo(dossier: string): Promise<string[]> {
	const sortie: string[] = [];
	const parcourir = async (d: string) => {
		for (const e of await readdir(d, { withFileTypes: true })) {
			const c = join(d, e.name);
			const s = await stat(c);
			sortie.push(`${c}|${s.size}|${s.mtimeMs}`);
			if (e.isDirectory()) await parcourir(c);
		}
	};
	await parcourir(dossier);
	return sortie.sort();
}

describe('POST memoire/amorce', () => {
	it('notes et CLAUDE.md de projets importés en un commit, rattachés, envoyés à l’archiviste ; relance : rien ; aucune écriture sous la configuration de Claude', async () => {
		const claude = join(await dossierTemporaire(), 'config-claude');
		const c = await serviceFaux({}, { dossierClaude: claude });
		// les vrais documents du dossier (sur le disque), pour lire les CLAUDE.md du projet
		(c.dep as { documents: Fichiers }).documents = fichiersDossier(c.racine, { claudeGlobal: claude });
		const projet = join(c.racine, 'Projets', 'Mnemo');
		await mkdir(join(projet, '.claude'), { recursive: true });
		await writeFile(join(projet, 'CLAUDE.md'), '# Mnemo\n\nLes tests passent avant chaque commit.\n');
		await writeFile(join(projet, '.claude', 'claude.md'), '# Règles\n\nToujours écrire en français.\n');
		await writeFile(join(projet, '.claude', 'settings.local.json'), '{"permissions":{}}');
		const memoire = join(claude, 'projects', encoder(projet), 'memory');
		await mkdir(memoire, { recursive: true });
		await writeFile(join(memoire, 'MEMORY.md'), '- [tests](tests.md)\n');
		await writeFile(join(memoire, 'tests.md'), 'Lancer pnpm test avant de livrer.\n');
		await mkdir(join(claude, 'projects', '-Volumes-Ailleurs', 'memory'), { recursive: true });
		await writeFile(join(claude, 'projects', '-Volumes-Ailleurs', 'memory', 'autre.md'), 'Autre chose.\n');
		await writeFile(join(claude, 'CLAUDE.md'), 'Répondre en français.\n');
		await chmodRecursif(claude, 0o555);
		verrouilles.push(claude);
		const avant = await photo(claude);

		const { port, jeton } = c.service;
		// aucun archiviste ne tourne : rien n'est tapé, tout attend (« en attente »)
		const r = await appeler(port, 'POST', ROUTES.amorce, { jeton, corps: {} });
		expect(r.statut).toBe(200);
		const bilan = r.corps as BilanAmorceVue;
		expect(bilan).toMatchObject({
			notes: { nouvelles: 4, modifiees: 0, inchangees: 0 },
			instructions: { nouvelles: 2, modifiees: 0, inchangees: 0 },
			rattachees: 2,
			aTraiter: 6,
			archiviste: 'en_attente',
			commit: expect.any(String),
		});
		expect(bilan.fiches).toHaveLength(6);
		expect(bilan.ignores).toContainEqual({ chemin: 'Projets/Mnemo/.claude/settings.local.json', raison: 'pas un fichier .md' });
		expect(c.dep.commits.map((m) => m.message)).toEqual(['mnemo: amorçage (6 fiches)']);

		const fiches = [...c.dep.fichiers.keys()].filter((f) => f.startsWith('sources/claude-code/'));
		const lue = (f: string) => lireFiche(f, c.dep.fichiers.get(f)!);
		const note = fiches.find((f) => f.endsWith('/tests.md'))!;
		expect(lue(note).donnees).toMatchObject({ projet: 'Projets/Mnemo', a_traiter: true });
		// l'index de la mémoire de Claude Code est une note comme les autres : rien n'est écarté
		expect(fiches.some((f) => f.endsWith('/MEMORY.md'))).toBe(true);
		const instruction = fiches.find((f) => lue(f).donnees['chemin'] === 'Projets/Mnemo/.claude/claude.md')!;
		expect(lue(instruction).donnees).toMatchObject({ type_source: 'note', projet: 'Projets/Mnemo', a_traiter: true });
		expect(fiches.some((f) => lue(f).donnees['chemin'] === 'Projets/Mnemo/CLAUDE.md')).toBe(true);
		const passages = (await c.dep.index.sources()).filter((s) => s.fiche === instruction);
		expect(passages[0]?.passages).toBeGreaterThan(0);

		// l'archiviste lancé ensuite reçoit la consigne avec son lancement : rien n'est perdu
		const archiviste = (await appeler(port, 'POST', ROUTES.sessions, { jeton, corps: { profil: 'archiviste', dossier: '' } })).corps as { session: SessionVue };
		expect(archiviste.session.objectif).toMatch(/^Traite les 6 fiches sources marquées « à traiter »/u);
		const terminal = c.terminaux.lances.find((t) => t.options.env.MNEMO_SESSION === archiviste.session.id)!;
		expect(terminal.options.args.join(' ')).toContain('Traite les 6 fiches sources');
		const commitsAvant = c.dep.commits.length;

		// nouveau clic sans changement : rien d'écrit, mais la consigne (une seule ligne) repart à l'archiviste qui tourne
		const encore = await appeler(port, 'POST', ROUTES.amorce, { jeton, corps: {} });
		expect(encore.corps).toMatchObject({ notes: { nouvelles: 0, modifiees: 0, inchangees: 4 }, instructions: { inchangees: 2 }, commit: null, fiches: [], aTraiter: 6, archiviste: 'confie' });
		expect(c.dep.commits).toHaveLength(commitsAvant);
		expect(await jusqua(() => terminal.ecrits.some((e) => e.startsWith('Traite les 6 fiches')), 2000)).toBe(true);
		expect(terminal.ecrits.filter((e) => e.startsWith('Traite '))).toHaveLength(1);

		expect(await photo(claude)).toEqual(avant);
	});

	it('les CLAUDE.md des dossiers des 3 premiers niveaux, avec ou sans marqueur, caché ou non ; pas au-delà', async () => {
		const claude = join(await dossierTemporaire(), 'config-claude');
		const c = await serviceFaux({}, { dossierClaude: claude });
		(c.dep as { documents: Fichiers }).documents = fichiersDossier(c.racine, { claudeGlobal: claude });
		const instructions = ['Clients/Durand/Notes/CLAUDE.md', 'Documents/.notes/CLAUDE.md', 'Projets/Site/.claude/rules/style.md'];
		for (const chemin of [...instructions, 'Archives/a/b/c/CLAUDE.md']) {
			await mkdir(join(c.racine, ...chemin.split('/').slice(0, -1)), { recursive: true });
			await writeFile(join(c.racine, ...chemin.split('/')), `# ${chemin}\n\nConsigne du dossier ${chemin}.\n`);
		}
		const r = await appeler(c.service.port, 'POST', ROUTES.amorce, { jeton: c.service.jeton, corps: {} });
		expect(r.statut).toBe(200);
		expect(r.corps).toMatchObject({ instructions: { nouvelles: 3 } });
		const chemins = [...c.dep.fichiers.keys()].filter((f) => f.startsWith('sources/claude-code/')).map((f) => lireFiche(f, c.dep.fichiers.get(f)!).donnees['chemin']).filter((x) => x !== undefined);
		expect(chemins.sort()).toEqual(instructions);
	});

	it('deux imports simultanés : le second attend le premier, un seul commit', async () => {
		const claude = join(await dossierTemporaire(), 'config-claude');
		await mkdir(join(claude, 'projects', '-x', 'memory'), { recursive: true });
		await writeFile(join(claude, 'projects', '-x', 'memory', 'n.md'), 'Note.\n');
		const c = await serviceFaux({}, { dossierClaude: claude });
		const { port, jeton } = c.service;
		const [a, b] = await Promise.all([appeler(port, 'POST', ROUTES.amorce, { jeton, corps: {} }), appeler(port, 'POST', ROUTES.amorce, { jeton, corps: {} })]);
		expect([a.statut, b.statut]).toEqual([200, 200]);
		const bilans = [a.corps, b.corps] as BilanAmorceVue[];
		expect(bilans.map((x) => x.notes.nouvelles).sort()).toEqual([0, 1]);
		expect(c.dep.commits).toHaveLength(1);
	});

	it('configuration de Claude absente : bilan vide, rien écrit', async () => {
		const claude = join(await dossierTemporaire(), 'absent');
		const c = await serviceFaux({}, { dossierClaude: claude });
		const r = await appeler(c.service.port, 'POST', ROUTES.amorce, { jeton: c.service.jeton, corps: {} });
		expect(r.statut).toBe(200);
		expect(r.corps).toMatchObject({ notes: { nouvelles: 0 }, instructions: { nouvelles: 0 }, aTraiter: 0, archiviste: 'rien', commit: null });
		expect(c.dep.commits).toHaveLength(0);
	});
});
