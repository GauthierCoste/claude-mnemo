import { lstat, mkdir, readdir, readFile, readlink, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hooksAttendus } from '../../src/domaine/moteurs/codex/hooks-installes.ts';
import { cheminHooksJson, HOOKS_DU_POSTE_CODEX as H } from '../../src/infra/moteurs/codex/hooks-json.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

/** Droits des fichiers comparés hors de Windows seulement (il n'en a pas : 666 lus pour tout fichier). */
const POSIX = process.platform !== 'win32';

const NODE = '/opt/node/bin/node';
const MAIN = "/maison/a/Mes projets/l'outil/packages/mnemo/src/adaptateurs/cli/main.ts";
const etranger = { type: 'command', command: 'autre-outil --hook', timeout: 5 };

async function poste(): Promise<{ maison: string; appel: { node: string; main: string; env: Record<string, string | undefined> } }> {
	const maison = join(await dossierTemporaire(), 'codex');
	return { maison, appel: { node: NODE, main: MAIN, env: { CODEX_HOME: maison } } };
}

describe('hooks.json de Codex sur le poste', () => {
	it('CODEX_HOME : installé dans son hooks.json (dossier créé), relu à jour, puis « déjà » ; à approuver tant que config.toml ne dit rien', async () => {
		const { maison, appel } = await poste();
		expect(cheminHooksJson(appel.env)).toBe(join(maison, 'hooks.json'));
		expect(await H.lire(appel)).toEqual({ etat: 'absent', chemin: join(maison, 'hooks.json') });
		expect(await H.installer(appel)).toBe('installe');
		const ecrit = JSON.parse(await readFile(join(maison, 'hooks.json'), 'utf8')) as { hooks: Record<string, unknown[]> };
		expect(ecrit.hooks.Stop).toEqual([hooksAttendus(NODE, MAIN).get('Stop')]);
		expect(await H.installer(appel)).toBe('deja');
		expect(await H.lire(appel)).toMatchObject({ etat: 'a_jour', approbation: { etat: 'a_approuver' } });
		if (POSIX) expect(((await stat(join(maison, 'hooks.json'))).mode & 0o777).toString(8)).toBe('644');
		expect((await readdir(maison)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});

	it('approbation lue dans config.toml, sous la clé que Codex donne au hook', async () => {
		const { maison, appel } = await poste();
		await H.installer(appel);
		const fichier = join(maison, 'hooks.json');
		const cles = ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop', 'permission_request', 'session_end'];
		// clé en chaîne TOML de base (JSON.stringify) : les « \ » d'un chemin Windows échappés, comme Codex les écrit
		await writeFile(join(maison, 'config.toml'), `model = "x"\n\n[hooks.state]\n${cles.map((c) => `\n[hooks.state.${JSON.stringify(`${fichier}:${c}:0:0`)}]\ntrusted_hash = "sha256:0"\n`).join('')}`);
		expect(await H.lire(appel)).toMatchObject({ etat: 'a_jour', approbation: { etat: 'approuves' } });
	});

	it('entrées d’autres outils gardées ; autre Node : périmé, remis à jour par remplacer ; retirer n’enlève que Mnemo', async () => {
		const { maison, appel } = await poste();
		await mkdir(maison, { recursive: true });
		const avant = { hooks: { Stop: [{ hooks: [etranger] }] } };
		await writeFile(join(maison, 'hooks.json'), JSON.stringify(avant), { mode: 0o600 });
		expect(await H.remplacer(appel)).toBe('absent');
		expect(await H.installer({ ...appel, node: '/ancien/node' })).toBe('installe');
		expect(await H.lire(appel)).toEqual({ etat: 'perime', chemin: join(maison, 'hooks.json') });
		expect(await H.remplacer(appel)).toBe('mis_a_jour');
		expect(await H.remplacer(appel)).toBe('deja');
		// les droits du fichier remplacé sont gardés
		if (POSIX) expect(((await stat(join(maison, 'hooks.json'))).mode & 0o777).toString(8)).toBe('600');
		expect(await H.retirer(appel)).toBe('retire');
		expect(JSON.parse(await readFile(join(maison, 'hooks.json'), 'utf8'))).toEqual(avant);
		expect(await H.retirer(appel)).toBe('absent');
	});

	it('installer face aux hooks d’une autre installation de Mnemo : échec périmé, rien d’écrit ; ceux de cette installation sont complétés', async () => {
		const { maison, appel } = await poste();
		const fichier = join(maison, 'hooks.json');
		expect(await H.installer({ ...appel, main: '/autre/packages/mnemo/src/adaptateurs/cli/main.ts' })).toBe('installe');
		const avant = await readFile(fichier, 'utf8');
		expect(await H.installer(appel)).toEqual({ echec: expect.stringContaining('mnemo declarer --moteur codex --lier'), perime: true });
		expect(await readFile(fichier, 'utf8')).toBe(avant);
		// cette installation, un événement retiré à la main : complété
		await writeFile(fichier, JSON.stringify({ hooks: { Stop: [hooksAttendus(NODE, MAIN).get('Stop')] } }));
		expect(await H.installer(appel)).toBe('mis_a_jour');
		expect(await H.lire(appel)).toMatchObject({ etat: 'a_jour' });
	});

	it('retirer : les commandes de cette installation, même dans un groupe modifié ; jamais celles d’une autre (« autre »)', async () => {
		const { maison, appel } = await poste();
		await mkdir(maison, { recursive: true });
		const fichier = join(maison, 'hooks.json');
		const a = hooksAttendus(NODE, MAIN);
		const autre = hooksAttendus('/autre/node', MAIN);
		await writeFile(fichier, JSON.stringify({ hooks: { Stop: [{ matcher: 'x', hooks: [etranger, ...a.get('Stop')!.hooks] }, autre.get('Stop')], SessionEnd: [{ ...a.get('SessionEnd'), timeout: 9 }] } }));
		expect(await H.retirer(appel)).toBe('retire');
		expect(JSON.parse(await readFile(fichier, 'utf8'))).toEqual({ hooks: { Stop: [{ matcher: 'x', hooks: [etranger] }, autre.get('Stop')] } });
		expect(await H.retirer(appel)).toBe('autre');
	});

	it('JSON illisible : échec motivé, le fichier n’est pas réécrit', async () => {
		const { maison, appel } = await poste();
		await mkdir(maison, { recursive: true });
		await writeFile(join(maison, 'hooks.json'), '{ "hooks": ');
		for (const r of [await H.installer(appel), await H.retirer(appel), await H.remplacer(appel), await H.lire(appel)]) expect(r).toEqual({ echec: expect.stringMatching(/JSON illisible.*Mnemo ne le réécrit pas/u) });
		expect(await readFile(join(maison, 'hooks.json'), 'utf8')).toBe('{ "hooks": ');
	});

	it('hooks.json en lien symbolique : la cible est écrite, le lien reste', async () => {
		const { maison, appel } = await poste();
		await mkdir(maison, { recursive: true });
		const cible = join(maison, 'reglages-partages.json');
		await writeFile(cible, '{}');
		await symlink(cible, join(maison, 'hooks.json'));
		expect(await H.installer(appel)).toBe('installe');
		expect(JSON.parse(await readFile(cible, 'utf8'))).toHaveProperty('hooks.SessionEnd');
		expect((await readdir(maison)).sort()).toEqual(['hooks.json', 'reglages-partages.json']);
	});

	it('lien symbolique cassé : échec motivé, le lien n’est jamais remplacé', async () => {
		const { maison, appel } = await poste();
		await mkdir(maison, { recursive: true });
		const cible = join(maison, 'disparu.json');
		await symlink(cible, join(maison, 'hooks.json'));
		for (const r of [await H.installer(appel), await H.retirer(appel), await H.remplacer(appel), await H.lire(appel)]) expect(r).toEqual({ echec: expect.stringContaining('lien symbolique dont la cible est introuvable') });
		expect((await lstat(join(maison, 'hooks.json'))).isSymbolicLink()).toBe(true);
		expect(await readlink(join(maison, 'hooks.json'))).toBe(cible);
		expect(await readdir(maison)).toEqual(['hooks.json']);
	});
});
