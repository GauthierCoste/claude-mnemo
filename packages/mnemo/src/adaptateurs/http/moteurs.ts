import { NOMS_MOTEURS } from '@mnemo/commun';
/**
 * Route des moteurs (`ROUTES.moteurs`) : chaque agent de code du service, sa commande, sa version et ses modèles (Réglages ›
 * Agents) ; avec `poste=1`, ce que vérifie `mnemo verifier-poste` (déclaration MCP, hooks du poste et leur approbation), la
 * commande cherchée de nouveau (adoptée par le service si elle a changé) et la version relue (« Relire »), chaque point non
 * satisfaisant avec la commande qui y remédie (Réglages › Branchements). Une seule vérification du poste en vol à la fois.
 * `ROUTES.moteurLier` : lie un moteur à Mnemo (serveur MCP, hooks du poste : `lierMoteur`), puis relit le poste.
 */
import { ROUTES } from '@mnemo/contrat';
import type { EtapeLiaisonVue, LiaisonMoteurVue, MoteurVue, PointMoteurVue, ReponseLiaisonMoteur, ReponseMoteurs } from '@mnemo/contrat';
import type { CommandeMoteur, Executer, Moteur, MoteurDuService, Pilotage } from '../../application/ports.ts';
import { liaisonEchouee, lierMoteur, moteurLie } from '../../application/moteurs/lier.ts';
import type { EtapeLiaison } from '../../application/moteurs/lier.ts';
import { remedesDuMoteur } from '../../application/moteurs/remedes.ts';
import { estIdMoteur } from '../../domaine/moteurs/moteur.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { ErreurHttp } from './routes.ts';
import type { Route } from './routes.ts';

/** Délai de chaque commande du moteur pour le poste (`claude mcp get`, `codex mcp add`…), lecture et liaison, comme `verifier-poste`. */
const DELAI_POSTE_MS = 10_000;

/**
 * Ce que la route lit : les moteurs du service (le `Pilotage['moteurs']` qui lance les sessions, dont la route remplace une
 * entrée quand elle adopte une commande), l'exécuteur, le Node durable et le `main.ts` attendus, la plateforme,
 * l'environnement.
 */
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
function commandesDe(moteur: Moteur): { declarer: string; remplacer: string; introuvable: string; desactivation: string } {
	const { recherche, desactivation } = moteur.installation;
	const sessions = moteur.sansCommande === 'manuel' ? 'les sessions se lancent par une ligne à coller' : 'ses sessions sont refusées';
	return { ...remedesDuMoteur(moteur), introuvable: `${recherche} : ${sessions}`, desactivation };
}

/** Version lue (en cache, sauf `relire`) ; null : le moteur ne la donne pas, ou elle est illisible. */
async function versionDe(moteur: Moteur, commande: CommandeMoteur | null, p: PosteDesMoteurs, relire: boolean): Promise<string | null> {
	if (commande === null || moteur.version === undefined) return null;
	return moteur.version(commande, p.env, p.executer, { relire }).catch(() => null);
}

const chemin = (c: CommandeMoteur): string => c.avant[0] ?? c.commande;
const memeCommande = (a: CommandeMoteur | null, b: CommandeMoteur | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Le service adopte la commande trouvée maintenant (`trouvee`, cherchée de nouveau pour le poste) quand elle n'est pas null
 * et diffère de la sienne (moteur installé ou déplacé depuis) : l'entrée de `p.moteurs`, le `Pilotage['moteurs']` qui lance
 * les sessions, est remplacée ; les sessions déjà lancées gardent leur processus, les suivantes prennent la nouvelle
 * commande. Une commande disparue (null) n'est pas adoptée : le service garde la sienne.
 */
function adopter(duService: MoteurDuService, trouvee: CommandeMoteur | null, p: PosteDesMoteurs): MoteurDuService {
	if (trouvee === null || memeCommande(duService.commande, trouvee)) return duService;
	const adopte: MoteurDuService = { moteur: duService.moteur, commande: trouvee };
	p.moteurs[duService.moteur.id] = adopte;
	return adopte;
}

/**
 * Point « commande » : celle du service (déjà adoptée si elle a changé), comparée à celle trouvée maintenant (`trouvee`) ;
 * seule une commande disparue depuis les sépare (le service lance encore l'ancienne).
 */
function pointCommande(moteur: Moteur, commande: CommandeMoteur | null, trouvee: CommandeMoteur | null): PointMoteurVue {
	const c = { cle: 'commande', libelle: 'Commande' } as const;
	const introuvable = commandesDe(moteur).introuvable;
	if (commande === null) return { ...c, ok: false, etat: 'introuvable', detail: introuvable };
	if (trouvee === null) return { ...c, ok: false, etat: 'introuvable maintenant', detail: `Le service lance encore ${chemin(commande)} ; ${introuvable}.` };
	return { ...c, ok: true, etat: 'trouvée', detail: chemin(commande) };
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
	else if (lu === 'absent') points.push({ ...mcp, ok: false, etat: 'non déclaré', detail: `Les sessions de ${NOMS_MOTEURS[moteur.id]} lancées hors de Mnemo ne lisent pas la mémoire.`, remede: terminal(commandes.declarer) });
	else if (lu === 'perime') points.push({ ...mcp, ok: false, etat: 'périmé', detail: 'Déclaré pour un autre Node ou une autre installation de Mnemo.', remede: terminal(commandes.remplacer) });
	else if (lu === 'desactive') points.push({ ...mcp, ok: false, etat: 'désactivé', detail: `Désactivé dans ${NOMS_MOTEURS[moteur.id]} (${commandes.desactivation}) : Mnemo ne le réactive pas ; le réactiver dans sa configuration.` });
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

/**
 * Vue d'un moteur ; `poste` : la commande cherchée de nouveau (adoptée par le service si elle a changé, avant tout le reste :
 * version relue et points vérifiés pour la nouvelle), avec ses points vérifiés.
 */
async function vueMoteur(entree: MoteurDuService, p: PosteDesMoteurs, poste: boolean): Promise<MoteurVue> {
	const trouvee = poste ? entree.moteur.trouver(p.env, p.plateforme) : null;
	const duService = poste ? adopter(entree, trouvee, p) : entree;
	const { moteur, commande } = duService;
	const [version, modeles] = await Promise.all([
		versionDe(moteur, commande, p, poste),
		moteur.modeles({ executer: p.executer, commande, env: p.env }).catch((): readonly string[] => []),
	]);
	const tropAncien = moteur.refusDeVersion?.(version) ?? null;
	const indisponible = commande === null ? `${NOMS_MOTEURS[moteur.id]} introuvable sur ce poste (${commandesDe(moteur).introuvable}).` : tropAncien === null ? null : `${tropAncien}.`;
	const vue: MoteurVue = { id: moteur.id, nom: NOMS_MOTEURS[moteur.id], indisponible, manuel: commande === null && moteur.sansCommande === 'manuel', version, modeles: [...modeles] };
	if (!poste) return vue;
	const points: PointMoteurVue[] = [pointCommande(moteur, commande, trouvee)];
	if (commande !== null && moteur.version !== undefined) {
		points.push(
			version === null
				? { cle: 'version', libelle: 'Version', ok: null, etat: 'illisible', detail: `${moteur.commandeParDefaut} --version ne répond pas : rien n'est empêché.` }
				: tropAncien === null
					? { cle: 'version', libelle: 'Version', ok: true, etat: version }
					: { cle: 'version', libelle: 'Version', ok: false, etat: version, detail: `${tropAncien} : mettre ${NOMS_MOTEURS[moteur.id]} à jour.` },
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
	// une seule liaison à la fois par moteur : la seconde est refusée (409) tant que la première n'est pas finie
	const liaisonsEnCours = new Set<IdMoteur>();
	/**
	 * Lie le moteur `id` avec sa commande cherchée de nouveau (adoptée par le service si elle a changé, comme à la lecture du
	 * poste) ; 404 moteur inconnu du service, 409 `MNEMO_SANS_MCP=1`, liaison déjà en cours ou commande introuvable.
	 */
	const lier = async (id: string): Promise<LiaisonMoteurVue> => {
		const entree = estIdMoteur(id) ? p.moteurs[id] : undefined;
		if (entree === undefined) throw new ErreurHttp(404, `Moteur inconnu : « ${id.slice(0, 80)} ».`);
		const { moteur } = entree;
		const nom = NOMS_MOTEURS[moteur.id];
		if (p.env.MNEMO_SANS_MCP === '1') throw new ErreurHttp(409, `MNEMO_SANS_MCP=1 dans l'environnement du service : ${nom} n'est pas lié (ni serveur MCP, ni hooks).`);
		if (liaisonsEnCours.has(moteur.id)) throw new ErreurHttp(409, `Liaison de ${nom} à Mnemo déjà en cours.`);
		liaisonsEnCours.add(moteur.id);
		try {
			const trouvee = moteur.trouver(p.env, p.plateforme);
			if (trouvee === null) throw new ErreurHttp(409, `${nom} introuvable sur ce poste (${commandesDe(moteur).introuvable}) : rien n'est lié.`);
			adopter(entree, trouvee, p);
			const r = await lierMoteur(moteur, { executer: p.executer, main: p.main, node: p.node, commande: trouvee, plateforme: p.plateforme, env: p.env, delaiMs: DELAI_POSTE_MS });
			const etape = (e: EtapeLiaison): EtapeLiaisonVue => ({ resultat: e.resultat, message: e.message });
			return { id: moteur.id, lie: moteurLie(r), ok: !liaisonEchouee(r), mcp: etape(r.mcp), ...(r.hooks === undefined ? {} : { hooks: etape(r.hooks) }) };
		} finally {
			liaisonsEnCours.delete(moteur.id);
		}
	};
	return [
		{
			methode: 'POST',
			chemin: ROUTES.moteurLier,
			action: async (r) => {
				const liaison = await lier(r.id);
				// une vérification du poste lancée avant la liaison ne la voit pas : attendue, puis le poste relu
				await posteEnVol?.catch(() => []);
				const moteurs = await lirePoste();
				return { statut: 200, corps: { moteurs, liaison } satisfies ReponseLiaisonMoteur };
			},
		},
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
