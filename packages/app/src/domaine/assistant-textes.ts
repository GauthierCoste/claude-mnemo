/**
 * Textes de l'assistant qui dépendent de la plateforme : l'ordinateur (« ce Mac », « cet ordinateur »), l'aide pour
 * installer git (outils en ligne de commande d'Apple, ou Git pour Windows), où vit l'icône de Mnemo (barre des menus, zone
 * de notification), les choix proposés et les renvois à la commande « mnemo » (sous Windows, ni l'une ni les autres).
 * Dans la langue de `t` (par défaut le français).
 */
import { choixProposes, type ChoixInstallation } from './assistant.ts';
import { LIENS_EXTERNES } from './assistant-pont.ts';
import { TEXTES_FR, type TextesApp } from './langue/textes.ts';
import type { PlateformeApp } from './plateforme.ts';

/** Aide quand git manque : une commande à lancer dans un terminal (ou rien), puis un lien. */
export type AideGit = { commande: string | null; libelleLien: string; lien: string };

/**
 * `relance` : après une étape en échec, comment la refaire plus tard (sous Windows, rien : la commande « mnemo » n'y est
 * pas installée, aucun renvoi vers elle).
 */
export type TextesAssistant = { intro: string; aideGit: AideGit; cases: { cle: keyof ChoixInstallation; titre: string; detail: string }[]; relance: string | null };

export function textesAssistant(plateforme: PlateformeApp, t: TextesApp = TEXTES_FR): TextesAssistant {
	const windows = plateforme === 'win32';
	const a = t.assistant;
	const c = a.choix;
	const ordinateur = windows ? a.verifications.ordinateur : a.verifications.mac;
	const cases: Record<keyof ChoixInstallation, { titre: string; detail: string }> = {
		mcp: { titre: c.mcp.titre, detail: c.mcp.detail },
		commande: { titre: c.commande.titre, detail: c.commande.detail },
		modeles: { titre: c.modeles.titre, detail: windows ? c.modeles.detailWindows(ordinateur, c.tailleModeles) : c.modeles.detail(ordinateur, c.tailleModeles) },
		ouvrirALaSession: { titre: c.ouvrirALaSession.titre, detail: windows ? c.ouvrirALaSession.detailWindows : c.ouvrirALaSession.detail },
	};
	return {
		intro: a.verifications.intro(ordinateur),
		aideGit: windows
			? { commande: null, libelleLien: a.verifications.installerGitWindows, lien: LIENS_EXTERNES.gitWindows }
			: { commande: 'xcode-select --install', libelleLien: a.verifications.installerGit, lien: LIENS_EXTERNES.git },
		cases: choixProposes(plateforme).map((cle) => ({ cle, ...cases[cle] })),
		relance: windows ? null : a.termine.relance,
	};
}
