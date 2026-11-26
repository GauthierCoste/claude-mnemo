/**
 * Textes de l'assistant qui dépendent de la plateforme : l'ordinateur (« ce Mac », « cet ordinateur »), l'aide pour
 * installer git (outils en ligne de commande d'Apple, ou Git pour Windows), où vit l'icône de Mnemo (barre des menus, zone
 * de notification), les choix proposés et les renvois à la commande « mnemo » (sous Windows, ni l'une ni les autres).
 */
import { choixProposes, type ChoixInstallation, TAILLE_MODELES } from './assistant.ts';
import { LIENS_EXTERNES } from './assistant-pont.ts';
import type { PlateformeApp } from './plateforme.ts';

/** Aide quand git manque : une commande à lancer dans un terminal (ou rien), puis un lien. */
export type AideGit = { commande: string | null; libelleLien: string; lien: string };

/**
 * `relance` : après une étape en échec, comment la refaire plus tard (sous Windows, rien : la commande « mnemo » n'y est
 * pas installée, aucun renvoi vers elle).
 */
export type TextesAssistant = { intro: string; aideGit: AideGit; cases: { cle: keyof ChoixInstallation; titre: string; detail: string }[]; relance: string | null };

export function textesAssistant(plateforme: PlateformeApp): TextesAssistant {
	const windows = plateforme === 'win32';
	const ordinateur = windows ? 'cet ordinateur' : 'ce Mac';
	const cases: Record<keyof ChoixInstallation, { titre: string; detail: string }> = {
		mcp: { titre: 'Déclarer Mnemo à Claude Code', detail: 'Toutes tes sessions Claude Code peuvent lire la mémoire et y proposer (serveur MCP).' },
		commande: { titre: 'Installer la commande « mnemo »', detail: 'Pour le terminal : ~/.local/bin/mnemo.' },
		modeles: { titre: 'Télécharger les modèles locaux', detail: `Recherche par le sens, sur ${ordinateur} ; ${TAILLE_MODELES} à télécharger. Sans eux, la recherche se fait par les mots${windows ? '.' : ' ; plus tard : mnemo modeles installer.'}` },
		ouvrirALaSession: { titre: 'Ouvrir Mnemo à l’ouverture de session', detail: windows ? 'Mnemo reste dans la zone de notification.' : 'Mnemo reste dans la barre des menus.' },
	};
	return {
		intro: `Mnemo donne une mémoire à tes sessions Claude Code. Il lui faut git et Claude Code sur ${ordinateur}.`,
		aideGit: windows ? { commande: null, libelleLien: 'Installer Git pour Windows', lien: LIENS_EXTERNES.gitWindows } : { commande: 'xcode-select --install', libelleLien: 'installer git', lien: LIENS_EXTERNES.git },
		cases: choixProposes(plateforme).map((cle) => ({ cle, ...cases[cle] })),
		relance: windows ? null : 'Tu pourras le refaire plus tard (mnemo init, dans ce dossier).',
	};
}
