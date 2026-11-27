/**
 * Exécution de « Désinstaller Mnemo… » : chaque étape du plan (`domaine/desinstallation.ts`), dans l'ordre, chacune
 * indépendante (une exception devient l'échec de cette étape, les suivantes sont menées quand même). Les actions sont
 * données par l'appelant (Electron pour l'ouverture à l'ouverture de session et la corbeille) ; `actionsFichiers` donne
 * celles qui ne touchent que des fichiers et les commandes de `mnemo`.
 */
import type { Lancement } from '../domaine/configuration.ts';
import type { EtapeDesinstallation, ResultatEtape } from '../domaine/desinstallation.ts';
import { TEXTES_FR, type TextesApp } from '../domaine/langue/textes.ts';
import { declarer, lancerMnemo } from './commande-mnemo.ts';
import { cheminsInstallation, lireEtatInstallation, retirerEntreeAppClaude, retirerFichiers } from './installation-fichiers.ts';

/** Une action : rien (fait), une note (fait, avec une précision), ou une exception (échec). */
export type ActionEtape = () => Promise<string | void>;

export async function executerEtapes(etapes: readonly EtapeDesinstallation[], actions: Readonly<Record<EtapeDesinstallation, ActionEtape>>): Promise<ResultatEtape[]> {
	const resultats: ResultatEtape[] = [];
	for (const etape of etapes) {
		try {
			const note = await actions[etape]();
			resultats.push(note === undefined ? { etape, ok: true } : { etape, ok: true, note });
		} catch (e) {
			resultats.push({ etape, ok: false, raison: e instanceof Error ? e.message : String(e) });
		}
	}
	return resultats;
}

/**
 * Retraits par fichiers et commandes de `mnemo` (lancées avec `lancement`, celui qui tourne : celui du paquet, ou en
 * développement celui de la configuration). `fichiersApp` : la configuration, les préférences et le journal de l'app. `textes` : la langue des notes.
 */
export function actionsFichiers(o: {
	home: string;
	lancement: Lancement;
	path: string;
	fichiersApp: readonly string[];
	base?: NodeJS.ProcessEnv;
	textes?: TextesApp;
}): Pick<Record<EtapeDesinstallation, ActionEtape>, 'commande' | 'claudeCode' | 'appClaude' | 'configuration'> {
	const notes = (o.textes ?? TEXTES_FR).desinstallation.notes;
	return {
		async commande() {
			// relue juste avant : `mnemo commande --retirer` retire toute commande de Mnemo, même celle d'une autre installation
			const etat = lireEtatInstallation(o.home, o.lancement).commande;
			if (etat === 'absent') return notes.dejaAbsente;
			if (etat !== 'nous') return notes.commandeAilleurs;
			const r = await lancerMnemo(o.lancement, ['commande', '--retirer'], o.path, o.base);
			if (!r.ok) throw new Error(r.raison);
		},
		async claudeCode() {
			const r = await declarer(o.lancement, '--retirer', o.path, o.base);
			if (!r.ok) throw new Error(r.raison);
			return r.resultat === 'retire' ? undefined : r.message;
		},
		async appClaude() {
			return retirerEntreeAppClaude(cheminsInstallation(o.home).appClaude, o.lancement) === 'retire' ? undefined : notes.dejaAbsente;
		},
		async configuration() {
			return retirerFichiers(o.fichiersApp).length === 0 ? notes.dejaAbsentes : undefined;
		},
	};
}
