import { NOMS_MOTEURS } from '@mnemo/commun';
import type { AppelDeclaration, HooksDuPoste, MoteurDuPoste, ResultatDeclaration } from '../ports.ts';
import { messageDeclarationMoteur, messageHooksMoteur } from './messages-liaison.ts';

/**
 * Ce que reçoit la liaison : la déclaration MCP (exécuteur, `main.ts`, commande du moteur, plateforme, environnement, délai
 * de chaque commande du moteur) et le Node durable que lancent les hooks du poste.
 */
export type AppelLiaison = AppelDeclaration & { node: string };

/**
 * Ce qu'une étape de la liaison a fait : `declare` (serveur MCP absent, déclaré), `remplace` (déclaration ou hooks de Mnemo
 * faits pour un autre Node ou un autre Mnemo, refaits), `installe` (hooks absents, installés), `deja` (rien à faire),
 * `laisse` (une déclaration de l'utilisateur, désactivée, d'une autre portée ou qui ne lance pas ce Mnemo : jamais touchée),
 * `echec` ; `message`, en français, à montrer.
 */
export type EtapeLiaison = { resultat: 'declare' | 'remplace' | 'installe' | 'deja' | 'laisse' | 'echec'; message: string };

/** La liaison d'un moteur : son serveur MCP, et ses hooks du poste s'il en a (Codex, Mistral Vibe). */
type ResultatLiaison = { mcp: EtapeLiaison; hooks?: EtapeLiaison };

const texteErreur = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Le résultat de `declarer` (serveur MCP lu absent, ou « mnemo » qui ne lance pas ce Mnemo : `declarer` n'y écrit rien). */
function apresDeclaration(moteur: MoteurDuPoste, r: ResultatDeclaration): EtapeLiaison {
	const message = messageDeclarationMoteur(moteur, r);
	if (r === 'declare' || r === 'deja') return { resultat: r, message };
	if (r === 'desactive') return { resultat: 'laisse', message };
	if ('perime' in r) {
		// une déclaration de Mnemo apparue entre la lecture et la déclaration : jamais remplacée sans avoir été lue périmée
		if (r.remplacable === true) return { resultat: 'laisse', message: `Déclaration MCP de Mnemo pour un autre Node ou un autre Mnemo, apparue entre-temps chez ${NOMS_MOTEURS[moteur.id]} : laissée ; liaison à relancer.` };
		return { resultat: 'laisse', message };
	}
	return { resultat: 'echec', message };
}

/**
 * Serveur MCP : lu, puis absent → déclaré ; déclaration de Mnemo périmée (autre Node, autre `main.ts`) → refaite ; à jour →
 * rien ; désactivée, d'une autre portée, ou « mnemo » qui ne lance pas Mnemo → laissée (déclaration de l'utilisateur,
 * jamais touchée).
 */
async function lierMcp(moteur: MoteurDuPoste, a: AppelLiaison): Promise<EtapeLiaison> {
	const echec = (e: unknown): EtapeLiaison => ({ resultat: 'echec', message: `Serveur MCP de ${NOMS_MOTEURS[moteur.id]} : ${texteErreur(e)}` });
	try {
		const lu = await moteur.declarationMcp.lire(a);
		if (typeof lu !== 'string') return echec(lu.echec);
		if (lu === 'deja' || lu === 'desactive') return apresDeclaration(moteur, lu);
		// `autre` : `declarer` ne réécrit jamais une déclaration existante, mais en dit la portée (Claude Code) pour le message
		if (lu === 'absent' || lu === 'autre') return apresDeclaration(moteur, await moteur.declarationMcp.declarer(a));
		const r = await moteur.declarationMcp.remplacer(a);
		if (typeof r !== 'string') return echec(r.echec);
		if (r === 'remplace') return { resultat: 'remplace', message: `Serveur MCP refait chez ${NOMS_MOTEURS[moteur.id]} avec ce Node et ce Mnemo.` };
		if (r === 'deja') return apresDeclaration(moteur, 'deja');
		// `autre` : de nouveau par `declarer`, qui n'écrit rien et dit pourquoi ; `absent` (retirée entre-temps) : déclarée à neuf
		return apresDeclaration(moteur, await moteur.declarationMcp.declarer(a));
	} catch (e) {
		return echec(e);
	}
}

/**
 * Hooks de Mnemo pour tout le poste : lus, puis absents → installés ; périmés (autre Node, autre `main.ts`) → refaits ; à
 * jour → rien. Chez un moteur qui les fait approuver (Codex), le message dit où.
 */
async function lierHooks(moteur: MoteurDuPoste, hooks: HooksDuPoste, a: AppelLiaison): Promise<EtapeLiaison> {
	const appel = { node: a.node, main: a.main, env: a.env };
	const fichier = hooks.chemin(a.env);
	const etape = (r: 'installe' | 'mis_a_jour' | 'remplace' | 'deja'): EtapeLiaison => ({ resultat: r === 'mis_a_jour' ? 'remplace' : r, message: messageHooksMoteur(moteur, r, fichier) });
	const echec = (e: unknown): EtapeLiaison => ({ resultat: 'echec', message: `Hooks de Mnemo chez ${NOMS_MOTEURS[moteur.id]} : ${texteErreur(e)}` });
	const installer = async (): Promise<EtapeLiaison> => {
		const r = await hooks.installer(appel);
		return typeof r === 'string' ? etape(r) : echec(r.echec);
	};
	try {
		const lu = await hooks.lire(appel);
		if ('echec' in lu) return echec(lu.echec);
		if (lu.etat === 'a_jour') return etape('deja');
		if (lu.etat === 'absent') return await installer();
		const r = await hooks.remplacer(appel);
		if (typeof r !== 'string') return echec(r.echec);
		if (r === 'deja') return etape('deja');
		if (r === 'mis_a_jour') return etape('remplace');
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
 * d'une autre portée, ou « mnemo » qui ne lance pas Mnemo) n'est jamais touchée : l'étape est `laisse`, et son message le
 * dit. Ne lève pas : chaque échec est dans son étape.
 */
export async function lierMoteur(moteur: MoteurDuPoste, a: AppelLiaison): Promise<ResultatLiaison> {
	const mcp = await lierMcp(moteur, a);
	if (moteur.hooksDuPoste === undefined) return { mcp };
	return { mcp, hooks: await lierHooks(moteur, moteur.hooksDuPoste, a) };
}

/** La liaison a-t-elle échoué en un point ? (`laisse` n'est pas un échec : rien n'était à faire par Mnemo.) */
export const liaisonEchouee = (r: ResultatLiaison): boolean => r.mcp.resultat === 'echec' || r.hooks?.resultat === 'echec';

/** Le moteur est-il lié : serveur MCP et hooks déclarés et installés par Mnemo (ni échec, ni déclaration laissée) ? */
export const moteurLie = (r: ResultatLiaison): boolean => [r.mcp, ...(r.hooks === undefined ? [] : [r.hooks])].every((e) => e.resultat !== 'echec' && e.resultat !== 'laisse');
