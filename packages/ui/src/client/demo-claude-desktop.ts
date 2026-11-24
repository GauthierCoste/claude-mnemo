/**
 * App Claude du mode démo (`?demo&vue=reglages`) : une imitation en mémoire des routes `claudeDesktop…` du service
 * (brancher la mémoire, ajouter, modifier, retirer un serveur), pour voir Réglages › App Claude sans service. Comme le
 * service, aucune valeur de variable n'est rendue.
 */
import { MOTIF_NOM_SERVEUR } from '@mnemo/commun';
import { ROUTES, type ClaudeDesktopVue, type ServeurMcpEcriture } from '@mnemo/contrat';
import { ErreurApi } from './api.ts';

type Serveur = { commande: string; args: string[]; env: Record<string, string>; modifiable: boolean };

export function creerClaudeDesktopDemo() {
	let mnemo: ClaudeDesktopVue['mnemo'] = 'perime';
	const serveurs = new Map<string, Serveur>([
		['notes', { commande: 'npx', args: ['-y', 'serveur-notes'], env: { CLE_API: 'valeur-fictive' }, modifiable: true }],
		['agenda', { commande: 'https://agenda.exemple.test/mcp', args: [], env: {}, modifiable: false }],
	]);
	const vue = (): ClaudeDesktopVue => ({
		installee: true,
		fichier: '~/Library/Application Support/Claude/claude_desktop_config.json',
		mnemo,
		serveurs: [...serveurs].map(([nom, x]) => ({ nom, commande: x.commande, args: [...x.args], env: Object.keys(x.env), modifiable: x.modifiable })),
	});
	const nomDe = (chemin: string): string | undefined => {
		const prefixe = ROUTES.claudeDesktopServeur.replace(':id', '');
		return chemin.startsWith(prefixe) ? decodeURIComponent(chemin.slice(prefixe.length)) : undefined;
	};
	const ecrire = (demande: ServeurMcpEcriture, avant: Serveur | undefined): Serveur => {
		// mêmes règles que le service : nom réservé quelle que soit la casse, variable nouvelle sans valeur refusée
		if (!MOTIF_NOM_SERVEUR.test(demande.nom) || demande.nom.toLowerCase() === 'mnemo') throw new ErreurApi(`Nom de serveur refusé : « ${demande.nom} ».`, 400);
		if (demande.commande.trim() === '') throw new ErreurApi('Commande vide.', 400);
		const env: Record<string, string> = {};
		for (const [nom, valeur] of Object.entries(demande.env)) {
			const gardee = valeur ?? (avant !== undefined && Object.hasOwn(avant.env, nom) ? avant.env[nom] : undefined);
			if (gardee === undefined) throw new ErreurApi(`Variable « ${nom} » : valeur requise (elle n'existe pas encore).`, 400);
			env[nom] = gardee;
		}
		return { commande: demande.commande, args: [...demande.args], env, modifiable: true };
	};

	return {
		/** La vue, si `chemin` est une route de l'app Claude et `methode` l'une des siennes ; sinon `undefined`. */
		traiter(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', chemin: string, corps?: unknown): ClaudeDesktopVue | undefined {
			if (chemin === ROUTES.claudeDesktop && methode === 'GET') return vue();
			if (chemin === ROUTES.claudeDesktopMnemo && (methode === 'PUT' || methode === 'DELETE')) {
				mnemo = methode === 'PUT' ? 'branche' : 'absent';
				return vue();
			}
			if (chemin === ROUTES.claudeDesktopServeurs && methode === 'POST') {
				const demande = corps as ServeurMcpEcriture;
				if (serveurs.has(demande.nom)) throw new ErreurApi(`Un serveur « ${demande.nom} » existe déjà.`, 409);
				serveurs.set(demande.nom, ecrire(demande, undefined));
				return vue();
			}
			const nom = nomDe(chemin);
			if (nom === undefined || (methode !== 'PUT' && methode !== 'DELETE')) return undefined;
			const avant = serveurs.get(nom);
			if (avant === undefined) throw new ErreurApi(`Serveur « ${nom} » introuvable.`, 404);
			if (methode === 'DELETE') {
				serveurs.delete(nom);
				return vue();
			}
			const demande = corps as ServeurMcpEcriture;
			if (demande.nom !== nom && serveurs.has(demande.nom)) throw new ErreurApi(`Un serveur « ${demande.nom} » existe déjà.`, 409);
			const ecrit = ecrire(demande, avant);
			// renommé : même place dans la liste
			const entrees = [...serveurs].map(([n, x]): [string, Serveur] => (n === nom ? [demande.nom, ecrit] : [n, x]));
			serveurs.clear();
			for (const [n, x] of entrees) serveurs.set(n, x);
			return vue();
		},
	};
}
