/**
 * Vérification au lancement de l'app empaquetée : la commande `mnemo`, la déclaration MCP de Claude Code et l'entrée `mnemo`
 * de l'app Claude pointent-elles vers son Node et son `main.ts` ? Ce qui est de Mnemo mais pointe ailleurs (mise à jour de
 * l'app, app déplacée, ancienne installation depuis le dépôt) est refait par les commandes de `mnemo`, lancées avec le Node
 * du paquet (`mnemo commande`, `mnemo declarer --remplacer`) ou par la route du service (`PUT /api/claude-desktop/mnemo`,
 * le service écrivant son propre Node et son `main.ts`). Ce qui est absent ou n'est pas de Mnemo n'est jamais touché.
 * En arrière-plan, sans boîte : tout va au journal de l'app. Chaque élément est indépendant.
 */
import { ROUTES } from '@mnemo/contrat';
import type { Lancement } from '../domaine/configuration.ts';
import { aRefaire, type ElementInstalle, entreeAppClaudeRefaisable } from '../domaine/installation.ts';
import { requeteLocale } from './api-service.ts';
import { declarer, lancerMnemo } from './commande-mnemo.ts';
import { lireEntreeAppClaude, lireEtatInstallation } from './installation-fichiers.ts';
import type { Journal } from './journal-app.ts';
import type { ServiceLocal } from './service-local.ts';

const DELAI_APP_CLAUDE_MS = 10_000;

export type DependancesVerification = {
	home: string;
	lancement: Lancement;
	/** La racine de la configuration (celle du service) : l'entrée de l'app Claude n'est refaite que pour elle. */
	racine: string;
	/** `PATH` de la configuration (pour `claude`). */
	path: string;
	/** Le service vivant (la route de l'app Claude), ou null. */
	service: ServiceLocal | null;
	journal: Journal;
	/** Environnement de base des commandes (par défaut celui de l'app). */
	base?: NodeJS.ProcessEnv;
};

type Resultat = { ok: true; note: string } | { ok: false; raison: string };

const NOMS: Record<ElementInstalle, string> = { commande: 'commande mnemo', claudeCode: 'déclaration MCP de Claude Code', appClaude: 'entrée mnemo de l’app Claude' };

async function refaire(element: ElementInstalle, d: DependancesVerification): Promise<Resultat> {
	switch (element) {
		case 'commande': {
			const r = await lancerMnemo(d.lancement, ['commande'], d.path, d.base);
			return r.ok ? { ok: true, note: r.sortie.trim().split('\n')[0] ?? '' } : r;
		}
		case 'claudeCode': {
			const r = await declarer(d.lancement, '--remplacer', d.path, d.base);
			return r.ok ? { ok: true, note: r.message } : r;
		}
		case 'appClaude': {
			if (!entreeAppClaudeRefaisable(lireEntreeAppClaude(d.home), d.racine)) return { ok: false, raison: `laissée : elle n’est pas pour ${d.racine}, ou porte d’autres réglages.` };
			if (d.service === null) return { ok: false, raison: 'service arrêté : réessayé au prochain lancement.' };
			const r = await requeteLocale(d.service.port, 'PUT', ROUTES.claudeDesktopMnemo, d.service.jeton, DELAI_APP_CLAUDE_MS);
			if ('echec' in r) return { ok: false, raison: `le service ne répond pas (${r.echec}).` };
			return r.statut === 200 ? { ok: true, note: 'entrée refaite par le service.' } : { ok: false, raison: `le service a répondu ${r.statut}.` };
		}
	}
}

/** Rend les éléments refaits qui pointent désormais vers le paquet. */
export async function verifierInstallation(d: DependancesVerification): Promise<ElementInstalle[]> {
	const avant = aRefaire(lireEtatInstallation(d.home, d.lancement));
	if (avant.length === 0) return [];
	d.journal(`Vérification : à refaire (pointe hors de ${d.lancement.main}) : ${avant.map((e) => NOMS[e]).join(', ')}.`);
	for (const element of avant) {
		let r: Resultat;
		try {
			r = await refaire(element, d);
		} catch (e) {
			r = { ok: false, raison: e instanceof Error ? e.message : String(e) };
		}
		d.journal(r.ok ? `${NOMS[element]} : ${r.note}` : `${NOMS[element]} : non refaite : ${r.raison}`);
	}
	const apres = lireEtatInstallation(d.home, d.lancement);
	const refaits = avant.filter((e) => apres[e] === 'nous');
	const restes = avant.filter((e) => apres[e] !== 'nous');
	if (restes.length > 0) d.journal(`Vérification : pointe encore ailleurs : ${restes.map((e) => NOMS[e]).join(', ')}.`);
	return refaits;
}
