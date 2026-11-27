/**
 * Au lancement : l'interface ou l'assistant ? L'assistant si la configuration manque (ou ne se lit pas) ou si sa racine n'a
 * plus de mémoire (`_mnemo/SCHEMA.md`). Il lance alors `mnemo` avec le Node et le `main.ts` de la configuration s'ils
 * s'y lisent, sinon avec ceux donnés par l'appelant (ceux du paquet), sinon il n'a rien à lancer et le dit.
 *
 * App empaquetée ouverte depuis un emplacement provisoire (l'image disque, une copie de translocation de macOS) :
 * l'assistant n'installe rien (la commande, la déclaration MCP et la configuration pointeraient vers un chemin bientôt
 * disparu) ; il demande de glisser Mnemo dans Applications puis de le rouvrir.
 */
import type { ExecutableMnemo } from './assistant.ts';
import type { Configuration, ResultatConfiguration } from './configuration.ts';
import { TEXTES_FR } from './langue/textes.ts';

/** `provisoire` : rien à lancer, l'assistant montre seulement `MESSAGE_PROVISOIRE`. */
export type DecisionDemarrage =
	| { assistant: false; configuration: Configuration }
	| { assistant: true; raison: string; executable: ExecutableMnemo | null; port?: number; provisoire?: true };

/** En français (dans une langue : `t.assistant.deplacer.message`). */
export const MESSAGE_PROVISOIRE = TEXTES_FR.assistant.deplacer.message;

/** `provisoire` : l'app empaquetée tourne depuis un emplacement provisoire (`emplacementProvisoire`). */
export function decisionDemarrage(lue: ResultatConfiguration, memoirePresente: boolean, parDefaut: ExecutableMnemo | null, provisoire = false): DecisionDemarrage {
	if (lue.ok && memoirePresente) return { assistant: false, configuration: lue.configuration };
	const raison = lue.ok ? `Plus de mémoire Mnemo dans ${lue.configuration.racine}.` : lue.erreurs.join(' ');
	if (provisoire) return { assistant: true, raison, executable: null, provisoire: true };
	if (!lue.ok) return { assistant: true, raison, executable: parDefaut };
	const { node, main, path, port } = lue.configuration;
	const decision: DecisionDemarrage = { assistant: true, raison, executable: { node, main, path } };
	if (port !== undefined) decision.port = port;
	return decision;
}
