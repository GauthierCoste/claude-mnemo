/**
 * Fenêtre de contexte de Claude Code d'une session, en jauge fine au bas de la barre de titre : sa largeur est la part
 * occupée, sa couleur passe à l'ambre puis au rouge en approchant du plein ; le détail au survol. Rien tant qu'elle est inconnue.
 */
import type { CSSProperties, ReactNode } from 'react';
import { useFenetre } from '../../client/hooks.ts';
import { useTextes } from '../../langue/langue.tsx';
import { TEXTES, type Textes } from '../../langue/textes.ts';
import s from './JaugeContexte.module.css';

/** Seuils (part occupée) où la jauge passe à l'ambre, puis au rouge. */
const SEUIL_AMBRE = 0.6;
const SEUIL_ROUGE = 0.85;

/** « 124 k » ; « 1 M » au million. */
export function tokensLisibles(n: number, t: Textes['sessions'] = TEXTES.fr.sessions): string {
	return t.formats.tokens(n);
}

export function libelleFenetre(f: { utilises: number; max: number; avantResume?: true }, t: Textes['sessions'] = TEXTES.fr.sessions): string {
	return t.jauge.fenetre(tokensLisibles(f.utilises, t), tokensLisibles(f.max, t), Math.round((f.utilises / f.max) * 100), f.avantResume === true);
}

export function JaugeContexte(p: { session: string }): ReactNode {
	const fenetre = useFenetre(p.session);
	const t = useTextes().sessions;
	if (fenetre === null) return null;
	const part = Math.min(1, fenetre.utilises / fenetre.max);
	const couleur = part >= SEUIL_ROUGE ? 'var(--red)' : part >= SEUIL_AMBRE ? 'var(--amber)' : 'var(--ac)';
	const libelle = libelleFenetre(fenetre, t);
	return (
		<span className={s.jauge} role="meter" aria-label={libelle} aria-valuemin={0} aria-valuemax={fenetre.max} aria-valuenow={fenetre.utilises} title={libelle}>
			<span className={s.rempli} style={{ '--part': part, '--c': couleur } as CSSProperties} />
		</span>
	);
}
