/** Ce qu'un appel d'outil de la session dit pour le contexte servi : la fiche lue ou écrite. */
import { cheminValide } from './chemin.ts';
import { OUTILS_CLAUDE_CODE } from './moteurs/claude-code/outils.ts';
import type { OutilsDuMoteur } from './moteurs/moteur.ts';
import { estObjet } from './valeurs.ts';

export type AppelOutil = { nom: string; entree: Record<string, unknown> };
export type FicheTouchee = { chemin: string; action: 'lue' | 'ecrite' };

const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function cheminDeFiche(brut: string | null): string | null {
	if (brut === null) return null;
	const chemin = cheminValide(brut.split('#')[0]!);
	return chemin !== null && chemin.endsWith('.md') ? chemin : null;
}

/** `outils` : ceux du moteur de la session (préfixe de ses outils MCP ; Claude Code par défaut). */
export function ficheTouchee(appel: AppelOutil, outils: Pick<OutilsDuMoteur, 'prefixeMcp'> = OUTILS_CLAUDE_CODE): FicheTouchee | null {
	if (!appel.nom.startsWith(outils.prefixeMcp)) return null;
	const outil = appel.nom.slice(outils.prefixeMcp.length);
	if (outil === 'lire' || outil === 'voisins') {
		const chemin = cheminDeFiche(texte(appel.entree.id));
		return chemin === null ? null : { chemin, action: 'lue' };
	}
	if (outil === 'proposer' && estObjet(appel.entree.demande)) {
		const demande = appel.entree.demande;
		const chemin = cheminDeFiche(texte(demande.fiche) ?? texte(demande.chemin));
		return chemin === null ? null : { chemin, action: 'ecrite' };
	}
	if (outil === 'entretenir') {
		// la fiche qui reste écrite : celle qui reçoit la fusion ou les informations déplacées, celle dont un lien ou une information est corrigé, la redirection d'une suppression
		const e = appel.entree;
		const enPlace = e.action === 'corriger_lien' || e.action === 'corroborer' || e.action === 'retoucher_information';
		const brut = e.action === 'fusionner' || e.action === 'deplacer_informations' ? texte(e.dans) : enPlace ? texte(e.id) : e.action === 'supprimer' ? texte(e.redirection) : null;
		const chemin = cheminDeFiche(brut);
		return chemin === null ? null : { chemin, action: 'ecrite' };
	}
	return null;
}
