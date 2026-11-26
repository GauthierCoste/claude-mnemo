/**
 * Exécution de « Désinstaller Mnemo… » : chaque étape du plan (`domaine/desinstallation.ts`), dans l'ordre, chacune
 * indépendante (une exception devient l'échec de cette étape, les suivantes sont menées quand même). Les actions sont
 * données par l'appelant (Electron pour l'ouverture à l'ouverture de session et la corbeille) ; `actionsFichiers` donne
 * celles qui ne touchent que des fichiers et les commandes de `mnemo`.
 */
import type { Lancement } from '../domaine/configuration.ts';
import type { EtapeDesinstallation, ResultatEtape } from '../domaine/desinstallation.ts';
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
 * développement celui de la configuration). `fichiersApp` : la configuration, les préférences et le journal de l'app.
 */
export function actionsFichiers(o: { home: string; lancement: Lancement; path: string; fichiersApp: readonly string[]; base?: NodeJS.ProcessEnv }): Pick<Record<EtapeDesinstallation, ActionEtape>, 'commande' | 'claudeCode' | 'appClaude' | 'configuration'> {
	return {
		async commande() {
			// relue juste avant : `mnemo commande --retirer` retire toute commande de Mnemo, même celle d'une autre installation
			const etat = lireEtatInstallation(o.home, o.lancement).commande;
			if (etat === 'absent') return 'déjà absente';
			if (etat !== 'nous') return 'laissée : elle ne lance plus cette app';
			const r = await lancerMnemo(o.lancement, ['commande', '--retirer'], o.path, o.base);
			if (!r.ok) throw new Error(r.raison);
		},
		async claudeCode() {
			const r = await declarer(o.lancement, '--retirer', o.path, o.base);
			if (!r.ok) throw new Error(r.raison);
			return r.resultat === 'retire' ? undefined : r.message;
		},
		async appClaude() {
			return retirerEntreeAppClaude(cheminsInstallation(o.home).appClaude, o.lancement) === 'retire' ? undefined : 'déjà absente';
		},
		async configuration() {
			return retirerFichiers(o.fichiersApp).length === 0 ? 'déjà absentes' : undefined;
		},
	};
}
