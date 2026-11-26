import { NOMS_MOTEURS } from '@mnemo/commun';
import type { MoteurDuPoste, ResultatDeclaration } from '../ports.ts';
import { remedesDuMoteur } from './remedes.ts';

/**
 * Messages de la liaison d'un moteur à Mnemo (serveur MCP, hooks du poste), communs à `mnemo init --<option>` et à la route
 * qui lie un moteur (Réglages › Système) : phrases neutres, sans impératif, lisibles dans un terminal comme dans l'interface.
 */

/** Une ligne pour le résultat de `declarationMcp.declarer` chez ce moteur. */
export function messageDeclarationMoteur(moteur: MoteurDuPoste, declaration: ResultatDeclaration): string {
	const { installation } = moteur;
	const nom = NOMS_MOTEURS[moteur.id];
	if (declaration === 'declare') return `Serveur MCP déclaré pour toutes les sessions ${nom}.`;
	if (declaration === 'deja') return `Serveur MCP déjà déclaré à ${nom}.`;
	if (declaration === 'desactive') return `Serveur MCP : déclaration désactivée dans ${nom} (${installation.desactivation}), laissée telle quelle.`;
	if ('perime' in declaration) {
		if (declaration.remplacable === true) return `Serveur MCP déclaré à ${nom} pour un autre Node ou un autre Mnemo : à refaire par « ${remedesDuMoteur(moteur).remplacer} ».`;
		// d'une autre portée (Claude Code) : la commande de retrait, de portée utilisateur, viserait une autre déclaration
		if (declaration.scope !== undefined && declaration.scope !== 'user')
			return `Une déclaration MCP « mnemo » d'une autre portée (${declaration.portee ?? declaration.scope}) existe chez ${nom} : laissée telle quelle.`;
		return `Une déclaration MCP « mnemo » qui ne lance pas Mnemo existe chez ${nom} : laissée telle quelle ; pour la remplacer, commandes à lancer à la main : ${installation.retraitManuel}, puis : ${declaration.manuel}`;
	}
	if (declaration.introuvable) return `${nom} introuvable : commande à lancer à la main : ${declaration.manuel}`;
	return `Déclaration automatique à ${nom} impossible (${declaration.raison}) : commande à lancer à la main : ${declaration.manuel}`;
}

/**
 * Une ligne pour les hooks de Mnemo du poste chez ce moteur : `installe` (il n'y en avait pas), `mis_a_jour` (ceux de cette
 * installation complétés), `remplace` (ceux d'une autre installation refaits), `deja` ; `chemin` : leur fichier. S'il les
 * fait approuver (Codex), comment.
 */
export function messageHooksMoteur(moteur: MoteurDuPoste, r: 'installe' | 'mis_a_jour' | 'remplace' | 'deja', chemin: string): string {
	const nom = NOMS_MOTEURS[moteur.id];
	const { approbation } = moteur.installation;
	const ou = approbation === null ? '' : `dans ${nom} (${approbation.commande})`;
	if (r === 'deja') return `Hooks de Mnemo déjà installés chez ${nom} (${chemin})${approbation === null ? '.' : ` ; à approuver ${ou} s’ils ne le sont pas encore.`}`;
	if (r === 'installe') return `Hooks de Mnemo installés chez ${nom} (${chemin})${approbation === null ? '.' : ` ; à approuver ${ou} : sans approbation, ${nom} ne les lance pas.`}`;
	const fait = r === 'mis_a_jour' ? 'mis à jour' : 'refaits avec ce Node et ce Mnemo';
	return `Hooks de Mnemo ${fait} chez ${nom} (${chemin})${approbation === null ? '.' : ` ; à approuver de nouveau ${ou}.`}`;
}
