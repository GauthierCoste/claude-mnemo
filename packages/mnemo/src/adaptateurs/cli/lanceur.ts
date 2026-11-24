import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TypeIcns } from '../../infra/icns.ts';
import { ecrireLanceur, retirerLanceur } from '../../infra/lanceur-macos.ts';
import { navigateurInstalle, posteCourant } from '../../infra/navigateurs.ts';
import { lireReglagesDuDossier } from '../../infra/reglages-fichier.ts';
import { versionMnemo } from '../../infra/version.ts';
import { dossierInterface } from '../http/statique.ts';
import { AUCUNE_MEMOIRE, ErreurCli } from './erreurs.ts';
import { trouverRacine } from './racine.ts';

const USAGE = `Usage : mnemo lanceur [--retirer]
  crée ~/Applications/Mnemo.app, qui ouvre Mnemo pour ce dossier (et démarre son service) ; --retirer le supprime`;

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/** Icônes du lanceur : les PNG de l'interface construite (`icones/`), s'ils sont là. */
function icones(): { type: TypeIcns; png: Buffer }[] {
	const dossier = join(dossierInterface(), 'icones');
	const lues: { type: TypeIcns; png: Buffer }[] = [];
	for (const [type, taille] of [['ic08', 256], ['ic09', 512], ['ic10', 1024]] as const) {
		try {
			lues.push({ type, png: readFileSync(join(dossier, `icone-${taille}.png`)) });
		} catch {
			// absente : le lanceur aura l'icône par défaut
		}
	}
	return lues;
}

/**
 * `mnemo lanceur` : crée `~/Applications/Mnemo.app` pour le dossier Mnemo courant (macOS seulement) ; au clic, il démarre
 * le service s'il ne tourne pas (détaché, journal `.mnemo/service.log`) et ouvre `http://127.0.0.1:<port>/` en fenêtre
 * d'application. `--retirer` le supprime. Jamais lancé ni inscrit au démarrage de la session. `racineDonnee` : le dossier Mnemo
 * (`mnemo init`), au lieu de celui du dossier courant ; `ecrire` : la sortie standard par défaut.
 */
export async function commandeLanceur(args: string[], racineDonnee?: string, ecrire: (ligne: string) => void = (ligne) => console.log(ligne)): Promise<void> {
	const inconnues = args.filter((a) => a !== '--retirer');
	if (inconnues.length > 0) throw new ErreurCli(`Option inconnue : « ${inconnues[0]} ».\n${USAGE}`, 2);
	if (process.platform !== 'darwin') throw new ErreurCli('Le lanceur est une application macOS : ailleurs, installez Mnemo depuis le navigateur (« Installer Mnemo »).');
	const applications = join(homedir(), 'Applications');

	if (args.includes('--retirer')) {
		const r = retirerLanceur(applications);
		if ('refus' in r) throw new ErreurCli(r.refus);
		ecrire('absent' in r ? `Aucun lanceur à retirer (${r.absent}).` : `Lanceur retiré : ${r.retire}.`);
		return;
	}

	const racine = racineDonnee ?? trouverRacine(process.cwd());
	if (racine === null) throw new ErreurCli(AUCUNE_MEMOIRE);
	const lues = icones();
	const r = ecrireLanceur(applications, {
		racine,
		node: process.execPath,
		main: MAIN,
		path: process.env.PATH ?? '/usr/bin:/bin',
		...(process.env.MNEMO_PORT ? { port: process.env.MNEMO_PORT } : {}),
		version: versionMnemo(),
		icones: lues,
	});
	if ('refus' in r) throw new ErreurCli(r.refus);
	ecrire(`${r.remplace ? 'Lanceur remplacé' : 'Lanceur créé'} : ${r.app} (dossier ${racine}).`);
	ecrire(`Il appelle ${process.execPath} et ${MAIN} : si Node ou le code de Mnemo change de place, relancez « mnemo lanceur ».`);
	if (lues.length === 0) ecrire('Sans icône : construisez l’interface (pnpm construire), puis relancez « mnemo lanceur ».');
	const navigateur = navigateurInstalle(lireReglagesDuDossier(racine).reglages.service.navigateur, posteCourant());
	ecrire(`Première fois : ouvrez une fois dans ${navigateur?.nom ?? 'votre navigateur par défaut'} l’adresse donnée par « mnemo jeton », pour que la fenêtre soit reconnue.`);
	ecrire('Le retirer : mnemo lanceur --retirer.');
}
