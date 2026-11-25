/**
 * Route des moteurs (`ROUTES.moteurs`) : chaque agent de code du service, sa commande trouvée au démarrage, sa version et ses
 * modèles (Réglages › Profils) ; avec `poste=1`, ce que vérifie `mnemo verifier-poste` (déclaration MCP, hooks du poste et
 * leur approbation), chaque point non satisfaisant avec la commande qui y remédie (Réglages › Système). Lecture seule.
 */
import { ROUTES } from '@mnemo/contrat';
import type { MoteurVue, PointMoteurVue, ReponseMoteurs } from '@mnemo/contrat';
import type { CommandeMoteur, Executer, Moteur, MoteurDuService, Pilotage } from '../../application/ports.ts';
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

/** Commandes qui déclarent (ou refont) le serveur MCP et les hooks de Mnemo chez chaque moteur. */
const COMMANDES: Record<MoteurVue['id'], { declarer: string; remplacer: string; introuvable: string }> = {
	'claude-code': {
		declarer: 'mnemo init --mcp',
		remplacer: 'mnemo declarer --remplacer',
		introuvable: 'commande claude absente du PATH, ou MNEMO_CLAUDE invalide : les sessions se lancent par une ligne à coller',
	},
	codex: {
		declarer: 'mnemo init --codex',
		remplacer: 'mnemo declarer --moteur codex --remplacer',
		introuvable: 'commande codex absente du PATH et de ChatGPT.app, ou MNEMO_CODEX invalide : ses sessions sont refusées',
	},
};

/** Version lue (en cache) ; null : le moteur ne la donne pas, ou elle est illisible. */
async function versionDe(moteur: Moteur, commande: CommandeMoteur | null, p: PosteDesMoteurs): Promise<string | null> {
	if (commande === null || moteur.version === undefined) return null;
	return moteur.version(commande, p.env).catch(() => null);
}

/** Points de la déclaration MCP, des hooks du poste et de leur approbation. */
async function pointsDuPoste(duService: MoteurDuService, p: PosteDesMoteurs): Promise<PointMoteurVue[]> {
	const { moteur, commande } = duService;
	const commandes = COMMANDES[moteur.id];
	const points: PointMoteurVue[] = [];
	const lu = await moteur.declarationMcp.lire({ executer: p.executer, main: p.main, commande, plateforme: p.plateforme, env: p.env, delaiMs: DELAI_POSTE_MS }).catch((e: unknown) => ({ echec: e instanceof Error ? e.message : String(e) }));
	const mcp = { cle: 'mcp', libelle: 'Serveur MCP mnemo' } as const;
	if (typeof lu !== 'string') points.push({ ...mcp, ok: false, etat: 'illisible', detail: lu.echec });
	else if (lu === 'deja') points.push({ ...mcp, ok: true, etat: 'déclaré' });
	else if (lu === 'absent') points.push({ ...mcp, ok: false, etat: 'non déclaré', detail: `Les sessions de ${moteur.nom} lancées hors de Mnemo ne lisent pas la mémoire.`, remede: terminal(commandes.declarer) });
	else if (lu === 'perime') points.push({ ...mcp, ok: false, etat: 'périmé', detail: 'Déclaré pour un autre Node ou une autre installation de Mnemo.', remede: terminal(commandes.remplacer) });
	else if (lu === 'desactive') points.push({ ...mcp, ok: false, etat: 'désactivé', detail: `Désactivé dans ${moteur.nom} (enabled = false) : Mnemo ne le réactive pas ; réactive-le dans sa configuration.` });
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
		const remede: Remede = { texte: '/hooks', dans: 'moteur' };
		if (approbation.etat === 'approuves') points.push({ ...a, ok: true, etat: 'approuvés' });
		else if (approbation.etat === 'a_approuver') points.push({ ...a, ok: false, etat: 'à approuver', remede });
		else points.push({ ...a, ok: null, etat: 'inconnue', remede });
	}
	return points;
}

/** Vue d'un moteur ; `poste` : avec ses points vérifiés. */
async function vueMoteur(duService: MoteurDuService, p: PosteDesMoteurs, poste: boolean): Promise<MoteurVue> {
	const { moteur, commande } = duService;
	const [version, modeles] = await Promise.all([
		versionDe(moteur, commande, p),
		moteur.modeles({ executer: p.executer, commande, env: p.env }).catch((): readonly string[] => []),
	]);
	const tropAncien = moteur.refusDeVersion?.(version) ?? null;
	const indisponible = commande === null ? `${moteur.nom} introuvable sur ce poste (${COMMANDES[moteur.id].introuvable}).` : tropAncien === null ? null : `${tropAncien}.`;
	const vue: MoteurVue = { id: moteur.id, nom: moteur.nom, indisponible, manuel: commande === null && moteur.sansCommande === 'manuel', version, modeles: [...modeles] };
	if (!poste) return vue;
	const points: PointMoteurVue[] = [
		commande === null
			? { cle: 'commande', libelle: 'Commande', ok: false, etat: 'introuvable', detail: COMMANDES[moteur.id].introuvable }
			: { cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: commande.avant[0] ?? commande.commande },
	];
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
	return [
		{
			methode: 'GET',
			chemin: ROUTES.moteurs,
			action: async (r) => {
				const poste = r.params.get('poste') === '1';
				const moteurs = await Promise.all(Object.values(p.moteurs).flatMap((m) => (m === undefined ? [] : [vueMoteur(m, p, poste)])));
				return { statut: 200, corps: { moteurs } satisfies ReponseMoteurs };
			},
		},
	];
}
