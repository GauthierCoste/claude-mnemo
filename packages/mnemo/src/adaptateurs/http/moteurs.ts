/**
 * Route des moteurs (`ROUTES.moteurs`) : chaque agent de code du service, sa commande trouvée au démarrage, sa version et ses
 * modèles (Réglages › Profils) ; avec `poste=1`, ce que vérifie `mnemo verifier-poste` (déclaration MCP, hooks du poste et
 * leur approbation), la commande cherchée de nouveau et la version relue (« Relire »), chaque point non satisfaisant avec
 * la commande qui y remédie (Réglages › Système). Lecture seule ; une seule vérification du poste en vol à la fois.
 */
import { ROUTES } from '@mnemo/contrat';
import type { MoteurVue, PointMoteurVue, ReponseMoteurs } from '@mnemo/contrat';
import type { CommandeMoteur, Executer, Moteur, MoteurDuService, Pilotage } from '../../application/ports.ts';
import { remedesDuMoteur } from '../../application/moteurs/remedes.ts';
import type { Route } from './routes.ts';

/** Délai de chaque commande du moteur lue pour le poste (`claude mcp get`, `codex mcp get`), comme `verifier-poste`. */
const DELAI_POSTE_MS = 10_000;

/** Ce que la route lit : les moteurs du service, l'exécuteur, le Node durable et le `main.ts` attendus, la plateforme, l'environnement. */
export type PosteDesMoteurs = {
	moteurs: Pilotage['moteurs'];
	executer: Executer;
	node: string;
	main: string;
	plateforme: string;
	env: Record<string, string | undefined>;
};

type Remede = NonNullable<PointMoteurVue['remede']>;
const terminal = (texte: string): Remede => ({ texte, dans: 'terminal' });

/** Commandes qui déclarent (ou refont) le serveur MCP et les hooks de Mnemo chez chaque moteur, et ce que dit son absence. */
function commandesDe(moteur: Moteur): { declarer: string; remplacer: string; retirer: string; introuvable: string; desactivation: string } {
	const { recherche, desactivation } = moteur.installation;
	const sessions = moteur.sansCommande === 'manuel' ? 'les sessions se lancent par une ligne à coller' : 'ses sessions sont refusées';
	return { ...remedesDuMoteur(moteur), introuvable: `${recherche} : ${sessions}`, desactivation };
}

/** Version lue (en cache, sauf `relire`) ; null : le moteur ne la donne pas, ou elle est illisible. */
async function versionDe(moteur: Moteur, commande: CommandeMoteur | null, p: PosteDesMoteurs, relire: boolean): Promise<string | null> {
	if (commande === null || moteur.version === undefined) return null;
	return moteur.version(commande, p.env, p.executer, { relire }).catch(() => null);
}

/** Le service garde la commande trouvée à son démarrage : en prendre une autre demande de le redémarrer. */
const REDEMARRER: Remede = { texte: 'mnemo arreter', dans: 'terminal', puis: 'mnemo ouvrir' };
const chemin = (c: CommandeMoteur): string => c.avant[0] ?? c.commande;
const memeCommande = (a: CommandeMoteur | null, b: CommandeMoteur | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Point « commande » : celle du service (trouvée à son démarrage), comparée à celle trouvée maintenant (`trouvee`, cherchée
 * de nouveau pour le poste : moteur installé, déplacé ou retiré depuis).
 */
function pointCommande(moteur: Moteur, commande: CommandeMoteur | null, trouvee: CommandeMoteur | null): PointMoteurVue {
	const c = { cle: 'commande', libelle: 'Commande' } as const;
	const introuvable = commandesDe(moteur).introuvable;
	if (memeCommande(commande, trouvee)) return commande === null ? { ...c, ok: false, etat: 'introuvable', detail: introuvable } : { ...c, ok: true, etat: 'trouvée', detail: chemin(commande) };
	if (commande === null) {
		return { ...c, ok: false, etat: 'trouvée depuis le démarrage', detail: `${chemin(trouvee!)} : le service, démarré sans ${moteur.nom}, ne la prend qu'en redémarrant.`, remede: REDEMARRER };
	}
	if (trouvee === null) return { ...c, ok: false, etat: 'introuvable maintenant', detail: `Le service lance encore ${chemin(commande)}, trouvée à son démarrage ; ${introuvable}.` };
	return { ...c, ok: false, etat: 'changée', detail: `Le service lance ${chemin(commande)}, trouvée à son démarrage ; trouvée maintenant : ${chemin(trouvee)}. Il ne la prend qu'en redémarrant.`, remede: REDEMARRER };
}

/** Points de la déclaration MCP, des hooks du poste et de leur approbation. */
async function pointsDuPoste(duService: MoteurDuService, p: PosteDesMoteurs): Promise<PointMoteurVue[]> {
	const { moteur, commande } = duService;
	const commandes = commandesDe(moteur);
	const points: PointMoteurVue[] = [];
	const lu = await moteur.declarationMcp.lire({ executer: p.executer, main: p.main, commande, plateforme: p.plateforme, env: p.env, delaiMs: DELAI_POSTE_MS }).catch((e: unknown) => ({ echec: e instanceof Error ? e.message : String(e) }));
	const mcp = { cle: 'mcp', libelle: 'Serveur MCP mnemo' } as const;
	if (typeof lu !== 'string') points.push({ ...mcp, ok: false, etat: 'illisible', detail: lu.echec });
	else if (lu === 'deja') points.push({ ...mcp, ok: true, etat: 'déclaré' });
	else if (lu === 'absent') points.push({ ...mcp, ok: false, etat: 'non déclaré', detail: `Les sessions de ${moteur.nom} lancées hors de Mnemo ne lisent pas la mémoire.`, remede: terminal(commandes.declarer) });
	else if (lu === 'perime') points.push({ ...mcp, ok: false, etat: 'périmé', detail: 'Déclaré pour un autre Node ou une autre installation de Mnemo.', remede: terminal(commandes.remplacer) });
	else if (lu === 'desactive') points.push({ ...mcp, ok: false, etat: 'désactivé', detail: `Désactivé dans ${moteur.nom} (${commandes.desactivation}) : Mnemo ne le réactive pas ; réactive-le dans sa configuration.` });
	else points.push({ ...mcp, ok: false, etat: 'autre serveur', detail: 'Une déclaration « mnemo » existe mais ne lance pas Mnemo : laissée telle quelle.' });

	if (moteur.hooksDuPoste === undefined) return points;
	const hooks = await moteur.hooksDuPoste.lire({ node: p.node, main: p.main, env: p.env }).catch((e: unknown) => ({ echec: e instanceof Error ? e.message : String(e) }));
	const h = { cle: 'hooks', libelle: 'Hooks de Mnemo' } as const;
	if ('echec' in hooks) {
		points.push({ ...h, ok: false, etat: 'illisibles', detail: hooks.echec });
		return points;
	}
	if (hooks.etat === 'absent') points.push({ ...h, ok: false, etat: 'non installés', detail: 'Sans eux, Mnemo ne suit pas les sessions lancées.', remede: terminal(commandes.declarer) });
	else if (hooks.etat === 'perime') points.push({ ...h, ok: false, etat: 'périmés', detail: 'Installés pour un autre Node ou une autre installation de Mnemo.', remede: terminal(commandes.remplacer) });
	else points.push({ ...h, ok: true, etat: 'installés' });
	const approbation = hooks.approbation;
	if (approbation !== undefined) {
		const a = { cle: 'approbation', libelle: 'Approbation des hooks', detail: approbation.motif } as const;
		const remede: Remede | undefined = moteur.installation.approbation === null ? undefined : { texte: moteur.installation.approbation.commande, dans: 'moteur' };
		if (approbation.etat === 'approuves') points.push({ ...a, ok: true, etat: 'approuvés' });
		else if (approbation.etat === 'a_approuver') points.push({ ...a, ok: false, etat: 'à approuver', ...(remede === undefined ? {} : { remede }) });
		else points.push({ ...a, ok: null, etat: 'inconnue', ...(remede === undefined ? {} : { remede }) });
	}
	return points;
}

/** Vue d'un moteur ; `poste` : avec ses points vérifiés, la commande cherchée de nouveau et la version relue. */
async function vueMoteur(duService: MoteurDuService, p: PosteDesMoteurs, poste: boolean): Promise<MoteurVue> {
	const { moteur, commande } = duService;
	const [version, modeles] = await Promise.all([
		versionDe(moteur, commande, p, poste),
		moteur.modeles({ executer: p.executer, commande, env: p.env }).catch((): readonly string[] => []),
	]);
	const tropAncien = moteur.refusDeVersion?.(version) ?? null;
	const indisponible = commande === null ? `${moteur.nom} introuvable sur ce poste (${commandesDe(moteur).introuvable}).` : tropAncien === null ? null : `${tropAncien}.`;
	const vue: MoteurVue = { id: moteur.id, nom: moteur.nom, indisponible, manuel: commande === null && moteur.sansCommande === 'manuel', version, modeles: [...modeles] };
	if (!poste) return vue;
	const points: PointMoteurVue[] = [pointCommande(moteur, commande, moteur.trouver(p.env, p.plateforme))];
	if (commande !== null && moteur.version !== undefined) {
		points.push(
			version === null
				? { cle: 'version', libelle: 'Version', ok: null, etat: 'illisible', detail: `${moteur.commandeParDefaut} --version ne répond pas : rien n'est empêché.` }
				: tropAncien === null
					? { cle: 'version', libelle: 'Version', ok: true, etat: version }
					: { cle: 'version', libelle: 'Version', ok: false, etat: version, detail: `${tropAncien} : mets ${moteur.nom} à jour.` },
		);
	}
	if (commande !== null) points.push(...(await pointsDuPoste(duService, p)));
	return { ...vue, poste: points };
}

export function routesMoteurs(p: PosteDesMoteurs): Route[] {
	const lire = (poste: boolean): Promise<MoteurVue[]> => Promise.all(Object.values(p.moteurs).flatMap((m) => (m === undefined ? [] : [vueMoteur(m, p, poste)])));
	// une seule vérification du poste à la fois (plusieurs commandes par moteur) : les appels pendant celle en cours la partagent
	let posteEnVol: Promise<MoteurVue[]> | null = null;
	const lirePoste = (): Promise<MoteurVue[]> =>
		(posteEnVol ??= lire(true).finally(() => {
			posteEnVol = null;
		}));
	return [
		{
			methode: 'GET',
			chemin: ROUTES.moteurs,
			action: async (r) => {
				const moteurs = r.params.get('poste') === '1' ? await lirePoste() : await lire(false);
				return { statut: 200, corps: { moteurs } satisfies ReponseMoteurs };
			},
		},
	];
}
