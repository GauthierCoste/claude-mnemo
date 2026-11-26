/**
 * Installation et désinstallation silencieuses de l'app Windows dans la CI, avec leurs contrôles :
 *
 * - `installer` : `Mnemo-Setup-<version>-x64.exe /S /currentuser` (par utilisateur, sans droits d'administrateur), puis
 *   les fichiers attendus (exécutable, Node et Mnemo emportés, interface, ConPTY de node-pty, désinstalleur) et le raccourci
 *   du menu Démarrer ;
 * - `desinstaller` : l'app fermée, le service du dossier d'essai arrêté (`mnemo arreter` : le Node de l'app tient sinon
 *   ses fichiers), `Uninstall Mnemo.exe /S`, puis le dossier de l'app et le raccourci partis (le désinstalleur de NSIS se
 *   relance depuis un dossier temporaire : sa fin n'est pas celle du retrait, attendu ici, raccourci compris).
 *
 * Usage : node packages/app/outils/ci/installation.ts installer|desinstaller
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cheminsEssai } from './chemins.ts';
import { echouer, etape, executer, lancer, pause } from './commun.ts';

const DEPOT = join(import.meta.dirname, '..', '..', '..', '..');
const ATTENTE_RETRAIT_MS = 120_000;

await executer(async () => {
	const [action] = process.argv.slice(2);
	if (process.platform !== 'win32') echouer('Windows seulement.');
	const version = String((JSON.parse(readFileSync(join(DEPOT, 'packages', 'app', 'package.json'), 'utf8')) as { version: unknown }).version);
	const c = cheminsEssai(DEPOT, version, process.env);

	if (action === 'installer') {
		if (!existsSync(c.installeur)) echouer(`installeur absent : ${c.installeur}`);
		etape(`${c.installeur} /S /currentuser`);
		const s = await lancer(c.installeur, ['/S', '/currentuser'], { delaiMs: 300_000 });
		if (s.code !== 0) echouer(`l’installeur est sorti avec le code ${s.code}.`);
		const ressources = join(c.installe, 'resources');
		const attendus = [
			c.exe,
			c.node,
			c.main,
			join(ressources, 'ui', 'dist'),
			join(ressources, 'mnemo', 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'conpty.node'),
			c.desinstalleur,
			c.raccourci,
		];
		const absents = attendus.filter((f) => !existsSync(f));
		for (const f of attendus) etape(`${absents.includes(f) ? 'ABSENT' : 'présent'} : ${f}`);
		if (absents.length > 0) {
			if (existsSync(c.installe)) etape(`contenu de ${c.installe} : ${readdirSync(c.installe).join(', ')}`);
			echouer(`${absents.length} fichier(s) absent(s) après l’installation.`);
		}
		const node = await lancer(c.node, ['--version'], { delaiMs: 30_000 });
		if (node.code !== 0) echouer(`le Node installé ne se lance pas (code ${node.code}) : ${node.stderr}`);
		etape(`Node installé : ${node.stdout.trim()}`);
		return;
	}

	if (action === 'desinstaller') {
		// l'app ouverte par les captures, s'il en reste (code 128 : aucune) : d'abord, sinon elle relancerait le service
		await lancer('taskkill', ['/IM', basename(c.exe), '/F', '/T'], { delaiMs: 30_000 });
		if (existsSync(join(c.essai, '.mnemo', 'service.json'))) {
			etape('arrêt du service du dossier d’essai');
			const arret = await lancer(c.node, [c.main, 'arreter', c.essai], { delaiMs: 90_000 });
			etape(`mnemo arreter : code ${arret.code} ${arret.stdout.trim()} ${arret.stderr.trim()}`);
		}
		if (!existsSync(c.desinstalleur)) echouer(`désinstalleur absent : ${c.desinstalleur}`);
		etape(`${c.desinstalleur} /S`);
		const s = await lancer(c.desinstalleur, ['/S'], { delaiMs: 300_000 });
		if (s.code !== 0) echouer(`le désinstalleur est sorti avec le code ${s.code}.`);
		// le désinstalleur relancé retire le dossier de l'app (RMDir /r) puis seulement les raccourcis (uninstaller.nsh
		// d'electron-builder) : attendre les deux
		const limite = Date.now() + ATTENTE_RETRAIT_MS;
		while ((existsSync(c.installe) || existsSync(c.raccourci)) && Date.now() < limite) await pause(1000);
		if (existsSync(c.installe)) echouer(`dossier encore là ${ATTENTE_RETRAIT_MS / 1000} s après la désinstallation : ${c.installe} (${readdirSync(c.installe).join(', ')})`);
		if (existsSync(c.raccourci)) echouer(`raccourci du menu Démarrer encore là : ${c.raccourci}`);
		etape(`désinstallée : ${c.installe} et le raccourci retirés`);
		return;
	}

	echouer('Usage : node installation.ts installer|desinstaller');
});
