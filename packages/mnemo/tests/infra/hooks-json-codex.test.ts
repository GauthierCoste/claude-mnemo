import { mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hooksAttendus } from '../../src/domaine/moteurs/codex/hooks-installes.ts';
import { cheminHooksJson, HOOKS_DU_POSTE_CODEX as H } from '../../src/infra/moteurs/codex/hooks-json.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

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
		expect(((await stat(join(maison, 'hooks.json'))).mode & 0o777).toString(8)).toBe('644');
		expect((await readdir(maison)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});

	it('approbation lue dans config.toml, sous la clé que Codex donne au hook', async () => {
		const { maison, appel } = await poste();
		await H.installer(appel);
		const fichier = join(maison, 'hooks.json');
		const cles = ['session_start', 'user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'stop', 'permission_request', 'session_end'];
		await writeFile(join(maison, 'config.toml'), `model = "x"\n\n[hooks.state]\n${cles.map((c) => `\n[hooks.state."${fichier}:${c}:0:0"]\ntrusted_hash = "sha256:0"\n`).join('')}`);
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
		expect(((await stat(join(maison, 'hooks.json'))).mode & 0o777).toString(8)).toBe('600');
		expect(await H.retirer(appel)).toBe('retire');
		expect(JSON.parse(await readFile(join(maison, 'hooks.json'), 'utf8'))).toEqual(avant);
		expect(await H.retirer(appel)).toBe('absent');
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
});
