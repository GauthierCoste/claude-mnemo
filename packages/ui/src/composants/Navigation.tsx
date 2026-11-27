import type { ReactNode } from 'react';
import type { Vue } from '../navigation.tsx';
import { useTextes } from '../langue/langue.tsx';
import type { Textes } from '../langue/textes.ts';
import { cx } from './commun/classes.ts';
import s from './Navigation.module.css';

const ICONES: Record<Vue, ReactNode> = {
	sessions: (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<rect x="3" y="4" width="18" height="16" rx="3" />
			<path d="M7 10l3 2.5L7 15M13 15h4" />
		</svg>
	),
	memoire: (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="6" cy="7" r="2.2" />
			<circle cx="18" cy="6" r="2.2" />
			<circle cx="12" cy="17" r="2.6" />
			<path d="M7.5 8.8l3.2 6M16.8 7.9l-3.4 6.8M8.2 6.8l7.6-.6" />
		</svg>
	),
	reglages: (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
		</svg>
	),
};

/** `bas` : poussée en bas du rail (Réglages, sous les vues). */
const VUES: { cle: Vue; infoPastille?(t: Textes['coquille']['vues'], n: number): string; raccourci?: string; bas?: boolean }[] = [
	{ cle: 'sessions', infoPastille: (t, n) => t.pastilleSessions(n), raccourci: 'Alt+0' },
	{ cle: 'memoire', infoPastille: (t, n) => t.pastilleMemoire(n) },
	{ cle: 'reglages', raccourci: 'Alt+Comma', bas: true },
];

/**
 * Barre latérale (`.side` / `.nv`) : une entrée par vue, avec sa pastille (sessions qui attendent, éléments à faire) ; la
 * roue dentée des Réglages en bas du rail (⌥,).
 */
export function Navigation(p: { vue: Vue; pastilles: Partial<Record<Vue, number>>; surChoix(v: Vue): void }): ReactNode {
	const t = useTextes().coquille.vues;
	return (
		<nav className={s.cote} aria-label={t.navigation}>
			{VUES.map((v) => {
				const n = p.pastilles[v.cle] ?? 0;
				return (
					<button key={v.cle} type="button" className={cx(s.entree, v.bas && s.bas, p.vue === v.cle && s.on)} aria-current={p.vue === v.cle ? 'page' : undefined} aria-keyshortcuts={v.raccourci} onClick={() => p.surChoix(v.cle)}>
						{ICONES[v.cle]}
						{t[v.cle]}
						{n > 0 && (
							<span className={s.pastille} title={v.infoPastille?.(t, n)}>
								{n}
							</span>
						)}
					</button>
				);
			})}
		</nav>
	);
}
