import type { ReactNode } from 'react';

/** Icône des modèles locaux : trois nœuds reliés (un petit réseau) ; barrée quand ils sont coupés. */
export function IconeModeles(p: { coupes?: boolean; taille?: number; className?: string }): ReactNode {
	const t = p.taille ?? 15;
	return (
		<svg className={p.className} width={t} height={t} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
			<g opacity={p.coupes ? 0.55 : 1}>
				<path d="M4 4.5 L11.5 6 M4 4.5 L6 11.5 M11.5 6 L6 11.5" />
				<circle cx="4" cy="4.5" r="2" fill="currentColor" stroke="none" />
				<circle cx="11.5" cy="6" r="2" fill="currentColor" stroke="none" />
				<circle cx="6" cy="11.5" r="2" fill="currentColor" stroke="none" />
			</g>
			{p.coupes && <path d="M2 14 L14 2" strokeWidth="1.6" />}
		</svg>
	);
}
