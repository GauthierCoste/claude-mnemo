import { NOMS_MOTEURS } from '@mnemo/commun';
import type { AppelDeclaration, HooksDuPoste, MoteurDuPoste, ResultatDeclaration } from '../ports.ts';

/**
 * Ce que reçoit la liaison : la déclaration MCP (exécuteur, `main.ts`, commande du moteur, plateforme, environnement, délai)
 * et le Node durable que lancent les hooks du poste.
 */
export type AppelLiaison = AppelDeclaration & { node: string };

/**
 * Ce qu'une étape de la liaison a fait : `declare` (serveur MCP absent, déclaré), `remplace` (déclaration ou hooks de Mnemo
 * faits pour un autre Node ou un autre Mnemo, refaits), `installe` (hooks absents, installés), `deja` (rien à faire),
 * `laisse` (une déclaration de l'utilisateur, désactivée ou qui ne lance pas Mnemo : jamais touchée), `echec` ; `message`,
 * en français, à montrer.
 */
export type EtapeLiaison = { resultat: 'declare' | 'remplace' | 'installe' | 'deja' | 'laisse' | 'echec'; message: string };

/** La liaison d'un moteur : son serveur MCP, et ses hooks du poste s'il en a (Codex, Mistral Vibe). */
export type ResultatLiaison = { mcp: EtapeLiaison; hooks?: EtapeLiaison };

const texteErreur = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Une déclaration « mnemo » de l'utilisateur qui ne lance pas Mnemo (ou d'une autre portée) : laissée, et comment la retirer. */
function autreDeclaration(moteur: MoteurDuPoste): EtapeLiaison {
	const nom = NOMS_MOTEURS[moteur.id];
	return { resultat: 'laisse', message: `Une déclaration MCP « mnemo » qui ne lance pas ce Mnemo existe chez ${nom} : laissée telle quelle (pour la retirer : ${moteur.installation.retraitManuel}).` };
}

/** Le résultat de `declarer` (serveur MCP lu absent). */
function apresDeclaration(moteur: MoteurDuPoste, r: ResultatDeclaration): EtapeLiaison {
	const nom = NOMS_MOTEURS[moteur.id];
	if (r === 'declare') return { resultat: 'declare', message: `Serveur MCP déclaré pour toutes les sessions ${nom}.` };
	if (r === 'deja') return { resultat: 'deja', message: `Serveur MCP déjà déclaré à ${nom}.` };
	if (r === 'desactive') return desactivee(moteur);
	// déclarée entre la lecture et la déclaration : jamais remplacée sans avoir été lue périmée
	if ('perime' in r) return autreDeclaration(moteur);
	if (r.introuvable) return { resultat: 'echec', message: `${nom} introuvable : déclarez à la main : ${r.manuel}` };
	return { resultat: 'echec', message: `Déclaration à ${nom} impossible (${r.raison}) : déclarez à la main : ${r.manuel}` };
}

function desactivee(moteur: MoteurDuPoste): EtapeLiaison {
	const nom = NOMS_MOTEURS[moteur.id];
	return { resultat: 'laisse', message: `Serveur MCP désactivé dans ${nom} (${moteur.installation.desactivation}) : laissé tel quel ; Mnemo ne le réactive pas.` };
}

/**
 * Serveur MCP : lu, puis absent → déclaré ; déclaration de Mnemo périmée (autre Node, autre `main.ts`) → refaite ; à jour →
 * rien ; désactivée ou « mnemo » qui ne lance pas Mnemo → laissée (déclaration de l'utilisateur, jamais touchée).
 */
async function lierMcp(moteur: MoteurDuPoste, a: AppelLiaison): Promise<EtapeLiaison> {
	const nom = NOMS_MOTEURS[moteur.id];
	const echec = (e: unknown): EtapeLiaison => ({ resultat: 'echec', message: `Serveur MCP de ${nom} : ${texteErreur(e)}` });
	try {
		const lu = await moteur.declarationMcp.lire(a);
		if (typeof lu !== 'string') return echec(lu.echec);
		if (lu === 'deja') return { resultat: 'deja', message: `Serveur MCP déjà déclaré à ${nom}.` };
		if (lu === 'desactive') return desactivee(moteur);
		if (lu === 'autre') return autreDeclaration(moteur);
		if (lu === 'absent') return apresDeclaration(moteur, await moteur.declarationMcp.declarer(a));
		const r = await moteur.declarationMcp.remplacer(a);
		if (typeof r !== 'string') return echec(r.echec);
		if (r === 'remplace') return { resultat: 'remplace', message: `Serveur MCP refait chez ${nom} avec ce Node et ce Mnemo.` };
		if (r === 'deja') return { resultat: 'deja', message: `Serveur MCP déjà déclaré à ${nom}.` };
		if (r === 'autre') return autreDeclaration(moteur);
		// retirée entre la lecture et le remplacement : déclarée à neuf
		return apresDeclaration(moteur, await moteur.declarationMcp.declarer(a));
	} catch (e) {
		return echec(e);
	}
}

/**
 * Hooks de Mnemo pour tout le poste : lus, puis absents → installés ; périmés (autre Node, autre `main.ts`) → refaits ; à
 * jour → rien. Installés ou refaits chez un moteur qui les fait approuver (Codex) : le message dit comment.
 */
async function lierHooks(moteur: MoteurDuPoste, hooks: HooksDuPoste, a: AppelLiaison): Promise<EtapeLiaison> {
	const nom = NOMS_MOTEURS[moteur.id];
	const appel = { node: a.node, main: a.main, env: a.env };
	const fichier = hooks.chemin(a.env);
	const { approbation } = moteur.installation;
	const apres = approbation === null ? '.' : ` ; ${approbation.consigne}`;
	const echec = (e: unknown): EtapeLiaison => ({ resultat: 'echec', message: `Hooks de Mnemo chez ${nom} : ${texteErreur(e)}` });
	const deja: EtapeLiaison = { resultat: 'deja', message: `Hooks de Mnemo déjà installés chez ${nom} (${fichier}).` };
	const installer = async (): Promise<EtapeLiaison> => {
		const r = await hooks.installer(appel);
		if (typeof r !== 'string') return echec(r.echec);
		if (r === 'deja') return deja;
		return r === 'installe'
			? { resultat: 'installe', message: `Hooks de Mnemo installés chez ${nom} (${fichier})${apres}` }
			: { resultat: 'remplace', message: `Hooks de Mnemo mis à jour chez ${nom} (${fichier})${apres}` };
	};
	try {
		const lu = await hooks.lire(appel);
		if ('echec' in lu) return echec(lu.echec);
		if (lu.etat === 'a_jour') return deja;
		if (lu.etat === 'absent') return await installer();
		const r = await hooks.remplacer(appel);
		if (typeof r !== 'string') return echec(r.echec);
		if (r === 'deja') return deja;
		if (r === 'mis_a_jour') return { resultat: 'remplace', message: `Hooks de Mnemo refaits chez ${nom} (${fichier}) avec ce Node et ce Mnemo${apres}` };
		// retirés entre la lecture et le remplacement : installés à neuf
		return await installer();
	} catch (e) {
		return echec(e);
	}
}

/**
 * Lie un moteur à Mnemo, comme `mnemo init --<option>` pour lui quand c'est à faire et `mnemo declarer --moteur <id>
 * --remplacer` quand c'est périmé, et rien d'autre : serveur MCP (portée utilisateur) puis hooks du poste s'il en a, les
 * hooks tentés même si le serveur MCP échoue ou est laissé (comme `init`). Une déclaration de l'utilisateur (désactivée,
 * ou « mnemo » qui ne lance pas Mnemo) n'est jamais touchée : l'étape est `laisse`, et son message le dit. Ne lève pas :
 * chaque échec est dans son étape.
 */
export async function lierMoteur(moteur: MoteurDuPoste, a: AppelLiaison): Promise<ResultatLiaison> {
	const mcp = await lierMcp(moteur, a);
	if (moteur.hooksDuPoste === undefined) return { mcp };
	return { mcp, hooks: await lierHooks(moteur, moteur.hooksDuPoste, a) };
}

/** La liaison a-t-elle échoué en un point ? (`laisse` n'est pas un échec : rien n'était à faire par Mnemo.) */
export const liaisonEchouee = (r: ResultatLiaison): boolean => r.mcp.resultat === 'echec' || r.hooks?.resultat === 'echec';
