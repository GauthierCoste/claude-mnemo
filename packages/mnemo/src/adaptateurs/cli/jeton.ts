import { jetonDuDossier, renouvelerJeton } from '../../infra/jeton-local.ts';
import { lireReglagesDuDossier } from '../../infra/reglages-fichier.ts';
import { preparerDossierLocal } from '../../infra/systeme.ts';
import { adresseAvecJeton, adresseDuService, portDemande } from './adresse.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';
import { serviceVivant } from './service.ts';

const USAGE = `Usage : mnemo jeton [--renouveler]
  affiche l'adresse de première ouverture (avec le jeton) ; --renouveler remplace le jeton du dossier`;

/**
 * `mnemo jeton` : l'adresse de première ouverture dans un navigateur (avec le jeton du service vivant, sinon celui de
 * `.mnemo/jeton`). `--renouveler` : un jeton neuf dans `.mnemo/jeton` ; le service vivant garde l'ancien jusqu'à son
 * redémarrage (au plus simple : rien n'est relu en cours de route), après quoi l'ancien jeton est refusé partout (les
 * navigateurs qui le gardaient affichent l'écran du jeton).
 */
export async function commandeJeton(args: string[]): Promise<void> {
	const inconnues = args.filter((a) => a !== '--renouveler');
	if (inconnues.length > 0) throw new ErreurCli(`Option inconnue : « ${inconnues[0]} ».\n${USAGE}`, 2);
	const racine = trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	preparerDossierLocal(racine);
	const vivant = await serviceVivant(racine);
	// MNEMO_PORT=0 sans service : le port ne sera connu qu'au démarrage
	const port = vivant?.port ?? (portDemande(process.env, lireReglagesDuDossier(racine).reglages.service.port) || '<port>');
	const adresse = (jeton: string) => adresseAvecJeton(port, jeton);

	if (args.includes('--renouveler')) {
		const jeton = renouvelerJeton(racine);
		console.log('Nouveau jeton créé (.mnemo/jeton).');
		console.log(
			vivant === null
				? 'Il vaudra au prochain démarrage du service ; l’ancien jeton sera alors refusé partout.'
				: `Le service en cours (pid ${vivant.pid}) refuse encore ce nouveau jeton et accepte l’ancien : redémarrez Mnemo ` +
						'(« mnemo arreter » puis « mnemo ouvrir », ou Ctrl-C puis « mnemo ») avant d’ouvrir l’adresse ci-dessous.',
		);
		console.log(`Puis, une fois dans chaque navigateur : ${adresse(jeton)}`);
		return;
	}
	const jeton = vivant?.jeton ?? jetonDuDossier(racine, (m) => console.error(`mnemo : ${m}`));
	console.log(`Première ouverture dans un navigateur : ${adresse(jeton)}`);
	console.log(`Ensuite : ${adresseDuService(port)}`);
}
