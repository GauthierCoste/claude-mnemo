import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dansLePath, dossierDeCommande, ecrireCommande, retirerCommande } from '../../infra/commande-mnemo.ts';
import { ErreurCli } from './erreurs.ts';

const USAGE = `Usage : mnemo commande [--retirer]
  installe la commande « mnemo » dans ~/.local/bin (macOS, Linux) ; --retirer la supprime`;

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/** Ce qui varie selon le poste ; remplaçable (tests : un dossier temporaire, jamais le vrai `~/.local/bin`). */
export type OptionsCommande = { maison?: string; plateforme?: NodeJS.Platform; path?: string; ecrire?: (ligne: string) => void };

/**
 * `mnemo commande` : écrit `~/.local/bin/mnemo`, qui lance ce Mnemo avec ce Node ; `--retirer` le supprime. Sur Windows :
 * refus, avec la commande à lancer (`pnpm link --global`).
 */
export async function commandeCommande(args: string[], o: OptionsCommande = {}): Promise<void> {
	const inconnues = args.filter((a) => a !== '--retirer');
	if (inconnues.length > 0) throw new ErreurCli(`Option inconnue : « ${inconnues[0]} ».\n${USAGE}`, 2);
	const plateforme = o.plateforme ?? process.platform;
	const ecrire = o.ecrire ?? ((ligne: string) => console.log(ligne));
	if (plateforme === 'win32') throw new ErreurCli('Sur Windows, installez la commande depuis packages/mnemo : pnpm link --global.');
	const dossier = dossierDeCommande(o.maison ?? homedir());

	if (args.includes('--retirer')) {
		const r = retirerCommande(dossier);
		if ('refus' in r) throw new ErreurCli(r.refus);
		ecrire('absent' in r ? `Aucune commande à retirer (${r.absent}).` : `Commande retirée : ${r.retire}.`);
		return;
	}

	const r = ecrireCommande(dossier, { node: process.execPath, main: MAIN });
	if ('refus' in r) throw new ErreurCli(r.refus);
	ecrire(`${r.remplace ? 'Commande mise à jour' : 'Commande installée'} : ${r.fichier} (Node ${process.versions.node}).`);
	if (!dansLePath(dossier, o.path ?? process.env.PATH)) {
		ecrire(`${dossier} n'est pas dans votre PATH : ajoutez à ~/.zshrc (ou ~/.bashrc) la ligne`);
		ecrire(`  export PATH="${dossier}:$PATH"`);
		ecrire('puis ouvrez un nouveau terminal.');
	}
	ecrire('La retirer : mnemo commande --retirer.');
}
