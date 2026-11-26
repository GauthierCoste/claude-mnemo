/**
 * Lance l'app installée en mode essai (`MNEMO_APP_ESSAI=1` : elle démarre, lit ses images, le dit sur la sortie standard et
 * quitte ; son dossier de données est un dossier temporaire) et vérifie qu'elle a dit « mnemo-app : prête ».
 *
 * Usage : node packages/app/outils/ci/essai-app.ts <Mnemo.exe>
 */
import { echouer, etape, executer, lancer } from './commun.ts';

/** Le message de `src/electron/application.ts` (`MESSAGE_ESSAI`), recopié : cet outil ne charge pas le code d'Electron. */
const PRETE = 'mnemo-app : prête';

await executer(async () => {
	const [exe] = process.argv.slice(2);
	if (exe === undefined) echouer('Usage : node essai-app.ts <Mnemo.exe>');
	etape(`lancement de ${exe} en mode essai`);
	const s = await lancer(exe, [], { env: { ...process.env, MNEMO_APP_ESSAI: '1' }, delaiMs: 90_000 });
	const sorties = `${s.stdout}${s.stderr}`.trim();
	if (!s.stdout.includes(PRETE)) echouer(`l’app n’a pas dit « ${PRETE} » (code ${s.code}${s.signal === null ? '' : `, ${s.signal}`}) :\n${sorties}`);
	if (s.code !== 0) echouer(`l’app a dit « ${PRETE} » mais est sortie avec le code ${s.code} :\n${sorties}`);
	etape(`app prête, sortie avec le code 0`);
});
