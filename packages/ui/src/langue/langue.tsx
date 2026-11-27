/**
 * Langue de l'interface. Le réglage `interface.langue` du service est la source ; avant qu'il soit lu (premier rendu, écran
 * du jeton, service coupé), la dernière langue montrée sur cette origine, sinon celle du navigateur. Hors de `LangueFournie`
 * (composant rendu seul dans un test), le français : la langue de référence.
 */
import { type ChoixLangue, estChoixLangue, estLangue, type Langue, langueDuChoix } from '@mnemo/commun';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { TEXTES, type Textes } from './textes.ts';

export type LangueCourante = { langue: Langue; t: Textes };

const CLE_STOCKAGE = 'mnemo.langue';

const Contexte = createContext<LangueCourante>({ langue: 'fr', t: TEXTES.fr });

/** La langue courante et ses textes. */
export function useLangue(): LangueCourante {
	return useContext(Contexte);
}

/** Les textes de la langue courante. */
export function useTextes(): Textes {
	return useContext(Contexte).t;
}

function etiquetteDuNavigateur(): string | undefined {
	return typeof navigator === 'undefined' ? undefined : navigator.language;
}

function langueRetenue(): Langue | null {
	try {
		const valeur = localStorage.getItem(CLE_STOCKAGE);
		return estLangue(valeur) ? valeur : null;
	} catch {
		return null;
	}
}

function retenirLangue(langue: Langue): void {
	try {
		localStorage.setItem(CLE_STOCKAGE, langue);
	} catch {
		// stockage bloqué : la langue du navigateur reprendra la main au prochain chargement
	}
}

/** La langue à montrer : celle du réglage s'il est lu, sinon la dernière montrée, sinon celle du navigateur. */
export function langueAMontrer(reglage: unknown): Langue {
	if (estChoixLangue(reglage)) return langueDuChoix(reglage, etiquetteDuNavigateur());
	return langueRetenue() ?? langueDuChoix('systeme', etiquetteDuNavigateur());
}

/**
 * Fournit la langue à tout ce qu'il enveloppe. `reglage` : la valeur de `interface.langue` (undefined tant qu'elle n'est
 * pas lue). Pose `lang` sur `<html>`, que l'app de bureau suit pour ses menus, et retient la langue pour le prochain chargement.
 */
export function LangueFournie(p: { reglage?: ChoixLangue | undefined; children: ReactNode }): ReactNode {
	const langue = langueAMontrer(p.reglage);
	const valeur = useMemo<LangueCourante>(() => ({ langue, t: TEXTES[langue] }), [langue]);
	useEffect(() => {
		document.documentElement.lang = langue;
		if (p.reglage !== undefined) retenirLangue(langue);
	}, [langue, p.reglage]);
	return <Contexte value={valeur}>{p.children}</Contexte>;
}
