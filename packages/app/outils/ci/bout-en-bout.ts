/**
 * Essai de bout en bout avec le Node et le Mnemo d'une app installée, sur un dossier jetable : `mnemo init --json` sans
 * rien hors du dossier (ni déclaration MCP, ni modèles, ni commande, ni lanceur), service démarré par `mnemo ouvrir`
 * (détaché, sans navigateur), `GET /api/sante` (terminaux node-pty disponibles exigés), une fiche écrite par
 * `POST /api/proposer` (un commit git de plus dans `_mnemo`), un terminal node-pty (ConPTY sous Windows) ouvert par le Node
 * installé, puis `mnemo arreter` et le service parti. Le service reste démarré si l'essai échoue avant l'arrêt : le
 * journal `.mnemo/service.log` est alors recopié.
 *
 * Usage : node packages/app/outils/ci/bout-en-bout.ts --node <node.exe> --main <…/mnemo/src/adaptateurs/cli/main.ts> --dossier <dossier>
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { echouer, etape, executer, lancer, pause, requete } from './commun.ts';

type ServiceJson = { pid: number; port: number; jeton: string };

const { values } = parseArgs({ options: { node: { type: 'string' }, main: { type: 'string' }, dossier: { type: 'string' } } });

function exige(nom: string, valeur: string | undefined): string {
	if (valeur === undefined || valeur === '') echouer(`--${nom} manque. Usage : node bout-en-bout.ts --node <node> --main <main.ts> --dossier <dossier>`);
	return valeur;
}

/** Environnement des commandes de Mnemo : jamais de navigateur, jamais de déclaration MCP. */
const ENV = { ...process.env, MNEMO_SANS_NAVIGATEUR: '1', MNEMO_SANS_MCP: '1' };

function vivant(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

function journalDuService(dossier: string): string {
	try {
		return readFileSync(join(dossier, '.mnemo', 'service.log'), 'utf8').trimEnd().split('\n').slice(-30).join('\n');
	} catch {
		return '(pas de journal)';
	}
}

/** Script lancé par le Node installé : un terminal node-pty (celui emporté par l'app) qui écrit un marqueur, puis sort. */
const SCRIPT_PTY = `
const { createRequire } = require('node:module');
const pty = createRequire(process.argv[1])('node-pty');
const windows = process.platform === 'win32';
const [commande, args] = windows ? [process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'echo mnemo-pty-ok']] : ['/bin/sh', ['-c', 'echo mnemo-pty-ok']];
const p = pty.spawn(commande, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
let lu = '';
p.onData((d) => (lu += d));
const delai = setTimeout(() => { console.error('terminal sans fin en 20 s : ' + JSON.stringify(lu)); process.exit(2); }, 20000);
p.onExit(({ exitCode }) => {
	clearTimeout(delai);
	// ConPTY peut rendre la sortie juste après la fin du processus
	setTimeout(() => {
		if (!lu.includes('mnemo-pty-ok')) { console.error('marqueur absent de la sortie du terminal : ' + JSON.stringify(lu)); process.exit(3); }
		console.log('terminal ' + (windows ? 'ConPTY' : 'pty') + ' : marqueur lu, code ' + exitCode);
		// sous Windows, node-pty garde après la fin du processus de quoi faire vivre la boucle d'événements (tubes de ConPTY) :
		// sortie explicite, comme le service, qui sort par process.exit
		process.exit(0);
	}, 500);
});
`;

await executer(async () => {
	const node = exige('node', values.node);
	const main = exige('main', values.main);
	const dossier = exige('dossier', values.dossier);
	for (const f of [node, main]) if (!existsSync(f)) echouer(`introuvable : ${f}`);
	mkdirSync(dossier, { recursive: true });
	const mnemo = (args: string[], delaiMs = 120_000) => lancer(node, [main, ...args], { env: ENV, cwd: dossier, delaiMs });

	etape(`mnemo init ${dossier} --json`);
	const init = await mnemo(['init', dossier, '--json', '--sans-mcp', '--sans-modeles', '--sans-commande', '--sans-lanceur']);
	const lignes = init.stdout.split('\n').filter((l) => l.trim() !== '');
	for (const l of lignes) console.log(`  ${l}`);
	const fin = lignes.map((l) => JSON.parse(l) as { fin?: boolean; ok?: boolean }).find((l) => l.fin === true);
	if (init.code !== 0 || fin?.ok !== true) echouer(`mnemo init a échoué (code ${init.code}) :\n${init.stderr}`);
	if (!existsSync(join(dossier, '_mnemo', 'SCHEMA.md'))) echouer('_mnemo/SCHEMA.md absent après mnemo init.');

	const git = async (args: string[]): Promise<string> => {
		const s = await lancer('git', ['-C', join(dossier, '_mnemo'), ...args], { delaiMs: 30_000 });
		if (s.code !== 0) echouer(`git ${args.join(' ')} : ${s.stderr.trim()}`);
		return s.stdout.trim();
	};
	const commitsAvant = Number(await git(['rev-list', '--count', 'HEAD']));
	etape(`mémoire créée, ${commitsAvant} commit(s) : ${await git(['log', '-1', '--format=%s'])}`);

	etape('mnemo ouvrir (service détaché)');
	const ouvrir = await mnemo(['ouvrir', dossier]);
	console.log(`  ${ouvrir.stdout.trim()}`);
	if (ouvrir.code !== 0) echouer(`mnemo ouvrir a échoué (code ${ouvrir.code}) :\n${ouvrir.stderr}\n${journalDuService(dossier)}`);
	const service = JSON.parse(readFileSync(join(dossier, '.mnemo', 'service.json'), 'utf8')) as ServiceJson;
	try {
		etape(`GET /api/sante (port ${service.port})`);
		const sante = await requete(service.port, service.jeton, 'GET', '/api/sante');
		console.log(`  ${JSON.stringify(sante.corps)}`);
		const vue = sante.corps as { ok?: boolean; terminaux?: { ok: boolean; motif?: string } } | null;
		if (sante.statut !== 200 || vue?.ok !== true) echouer(`santé : statut ${sante.statut}`);
		if (vue.terminaux?.ok !== true) echouer(`terminaux indisponibles dans le service : ${vue.terminaux?.motif ?? '(motif absent)'}`);

		etape('POST /api/proposer (une fiche, donc un commit)');
		const ecrit = await requete(service.port, service.jeton, 'POST', '/api/proposer', { genre: 'fiche', chemin: 'sujets/essai-ci.md', type: 'sujet', titre: 'Essai de la CI' });
		console.log(`  ${JSON.stringify(ecrit.corps)}`);
		if (ecrit.statut !== 200 || (ecrit.corps as { statut?: string } | null)?.statut !== 'ecrit') echouer(`écriture refusée (statut ${ecrit.statut}).`);
		const commitsApres = Number(await git(['rev-list', '--count', 'HEAD']));
		const message = await git(['log', '-1', '--format=%s']);
		if (commitsApres !== commitsAvant + 1 || !message.startsWith('mnemo: ')) echouer(`commit attendu : ${commitsAvant} → ${commitsApres} commit(s), dernier « ${message} ».`);
		etape(`commit fait : ${message}`);
	} catch (e) {
		console.error(journalDuService(dossier));
		throw e;
	}

	etape('terminal node-pty ouvert par le Node installé');
	const pty = await lancer(node, ['-e', SCRIPT_PTY, main], { cwd: dossier, delaiMs: 60_000 });
	if (pty.code !== 0) echouer(`terminal node-pty (code ${pty.code}) :\n${pty.stdout}${pty.stderr}`);
	console.log(`  ${pty.stdout.trim()}`);

	etape('mnemo arreter');
	const arret = await mnemo(['arreter', dossier], 90_000);
	console.log(`  ${arret.stdout.trim()}`);
	if (arret.code !== 0) echouer(`mnemo arreter a échoué (code ${arret.code}) :\n${arret.stderr}`);
	const limite = Date.now() + 30_000;
	while (vivant(service.pid) && Date.now() < limite) await pause(200);
	if (vivant(service.pid)) echouer(`le service (pid ${service.pid}) vit encore après mnemo arreter.`);
	if (existsSync(join(dossier, '.mnemo', 'service.json'))) echouer('.mnemo/service.json est resté après l’arrêt.');
	etape('service arrêté ; essai de bout en bout réussi');
});
