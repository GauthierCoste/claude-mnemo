/**
 * Routes de l'app Claude (Claude Desktop, Réglages › App Claude) : brancher la mémoire Mnemo, gérer les autres serveurs MCP
 * de son fichier de configuration. Chaque écriture relit le fichier, le transforme (domaine) et le réécrit d'un trait, sans
 * attente entre lecture et écriture. Les valeurs des variables d'environnement ne sont jamais rendues. Mêmes protections que
 * toute route de l'API (jeton, `Host`, `Origin` : vérifiés par le serveur).
 */
import { ROUTES } from '@mnemo/contrat';
import type { ClaudeDesktopVue, ServeurMcpEcriture } from '@mnemo/contrat';
import {
	brancherMnemo,
	debrancherMnemo,
	ecrireServeur,
	entreeMnemo,
	etatMnemo,
	lireConfigClaudeDesktop,
	retirerServeur,
	serveursVus,
	texteConfigClaudeDesktop,
} from '../../domaine/config-claude-desktop.ts';
import type { ConfigClaudeDesktop, ResultatConfig } from '../../domaine/config-claude-desktop.ts';
import { estObjet } from '../../domaine/valeurs.ts';
import { ecrireFichierClaudeDesktop, lireFichierClaudeDesktop } from '../../infra/config-claude-desktop.ts';
import { ErreurHttp } from './routes.ts';
import type { Reponse, Route } from './routes.ts';
import { racineAffichee } from './vues.ts';

/**
 * Ce que les routes savent de la machine : `fichier` de configuration de l'app Claude, `maison` (pour l'abréger en `~`),
 * `node` (durable) et `main` (`main.ts`) de l'entrée de Mnemo, `racine` du dossier (sa `MNEMO_RACINE`).
 */
export type AppClaude = { fichier: string; maison: string; node: string; main: string; racine: string };

const STATUT_REFUS = { refuse: 400, inconnu: 404, existe: 409 } as const;

/** Corps d'une écriture de serveur : forme vérifiée ici, contenu (noms, bornes) validé par le domaine. */
function demandeDe(brut: unknown): ServeurMcpEcriture {
	const attendu = 'Corps attendu : { nom, commande, args: string[], env: { NOM: valeur | null } }.';
	if (!estObjet(brut)) throw new ErreurHttp(400, attendu);
	for (const cle of Object.keys(brut)) if (cle !== 'nom' && cle !== 'commande' && cle !== 'args' && cle !== 'env') throw new ErreurHttp(400, `Champ inconnu « ${cle.slice(0, 80)} ».`);
	const { nom, commande, args, env } = brut;
	if (typeof nom !== 'string') throw new ErreurHttp(400, 'Champ « nom » : texte attendu.');
	if (typeof commande !== 'string') throw new ErreurHttp(400, 'Champ « commande » : texte attendu.');
	if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) throw new ErreurHttp(400, 'Champ « args » : liste de textes attendue.');
	if (!estObjet(env) || !Object.values(env).every((v) => v === null || typeof v === 'string')) throw new ErreurHttp(400, 'Champ « env » : objet { NOM: valeur | null } attendu.');
	return { nom, commande, args, env: env as Record<string, string | null> };
}

export function routesClaudeDesktop(app: AppClaude): Route[] {
	const attendue = entreeMnemo(app.node, app.main, app.racine);
	const fichier = racineAffichee(app.fichier, app.maison);

	/** Vue de l'état actuel du fichier. */
	const vue = (): ClaudeDesktopVue => {
		const lu = lireFichierClaudeDesktop(app.fichier);
		if (!lu.installee) return { installee: false, fichier, mnemo: 'absent', serveurs: [] };
		if ('erreur' in lu) return { installee: true, fichier, erreur: lu.erreur, mnemo: 'absent', serveurs: [] };
		const config = lireConfigClaudeDesktop(lu.texte);
		if (!config.ok) return { installee: true, fichier, erreur: config.erreur, mnemo: 'absent', serveurs: [] };
		return { installee: true, fichier, mnemo: etatMnemo(config.config, attendue), serveurs: serveursVus(config.config) };
	};

	/** Lit, transforme et réécrit le fichier (refus traduit en statut HTTP) ; rend la vue à jour. */
	const ecrire = (transformer: (config: ConfigClaudeDesktop) => ResultatConfig, statut = 200): Reponse => {
		const lu = lireFichierClaudeDesktop(app.fichier);
		if (!lu.installee) throw new ErreurHttp(409, "L'app Claude n'est pas installée : rien n'est écrit.");
		if ('erreur' in lu) throw new ErreurHttp(409, `${lu.erreur} Il n'est pas réécrit.`);
		const config = lireConfigClaudeDesktop(lu.texte);
		if (!config.ok) throw new ErreurHttp(409, `Fichier de l'app Claude illisible : ${config.erreur} Il n'est pas réécrit.`);
		const r = transformer(config.config);
		if (!r.ok) throw new ErreurHttp(STATUT_REFUS[r.genre], r.motif);
		ecrireFichierClaudeDesktop(app.fichier, texteConfigClaudeDesktop(r.config));
		return { statut, corps: vue() };
	};

	return [
		{ methode: 'GET', chemin: ROUTES.claudeDesktop, action: async () => ({ statut: 200, corps: vue() }) },
		{ methode: 'PUT', chemin: ROUTES.claudeDesktopMnemo, action: async () => ecrire((c) => ({ ok: true, config: brancherMnemo(c, attendue) })) },
		{ methode: 'DELETE', chemin: ROUTES.claudeDesktopMnemo, action: async () => ecrire((c) => ({ ok: true, config: debrancherMnemo(c) })) },
		{
			methode: 'POST',
			chemin: ROUTES.claudeDesktopServeurs,
			corps: 'json',
			action: async (r) => {
				const demande = demandeDe(await r.json());
				return ecrire((c) => ecrireServeur(c, demande), 201);
			},
		},
		{
			methode: 'PUT',
			chemin: ROUTES.claudeDesktopServeur,
			corps: 'json',
			action: async (r) => {
				const demande = demandeDe(await r.json());
				return ecrire((c) => ecrireServeur(c, demande, r.id));
			},
		},
		{ methode: 'DELETE', chemin: ROUTES.claudeDesktopServeur, action: async (r) => ecrire((c) => retirerServeur(c, r.id)) },
	];
}
