/**
 * Dessins des avatars de profil : petites créatures en aplat deux tons, dans un carré `0 0 48 48`. La couleur du profil est
 * `currentColor` ; les détails clairs et sombres du visage suivent les jetons du thème (`--tx`, `--bg`).
 */
import type { FormeAvatar } from '@mnemo/commun';
import type { ReactNode } from 'react';

const CLAIR = 'var(--tx)';
const SOMBRE = 'var(--bg)';

/** Deux yeux ronds sombres. */
const yeux = (y: number, ecart = 4, r = 2) => (
	<>
		<circle cx={24 - ecart} cy={y} r={r} fill={SOMBRE} />
		<circle cx={24 + ecart} cy={y} r={r} fill={SOMBRE} />
	</>
);

export const DESSINS_AVATAR: Record<FormeAvatar, ReactNode> = {
	robot: (
		<>
			<rect x="11" y="15" width="26" height="21" rx="7" fill="currentColor" />
			<rect x="22.5" y="9" width="3" height="7" rx="1.5" fill="currentColor" />
			<circle cx="24" cy="9" r="2.6" fill="currentColor" />
			<rect x="15" y="20" width="18" height="10" rx="5" fill={SOMBRE} fillOpacity=".55" />
			<circle cx="20" cy="25" r="2.2" fill={CLAIR} />
			<circle cx="28" cy="25" r="2.2" fill={CLAIR} />
		</>
	),
	chouette: (
		<>
			<path d="M12 12l6 5h12l6-5v18c0 6-5 8-12 8s-12-2-12-8z" fill="currentColor" />
			<circle cx="19" cy="23" r="5" fill={CLAIR} />
			<circle cx="29" cy="23" r="5" fill={CLAIR} />
			<circle cx="19.5" cy="23.5" r="2.2" fill={SOMBRE} />
			<circle cx="28.5" cy="23.5" r="2.2" fill={SOMBRE} />
			<path d="M22 29l2 3 2-3z" fill="var(--amber)" />
		</>
	),
	renard: (
		<>
			<path d="M10 11l9 8h10l9-8-2 15c0 8-6 12-12 12s-12-4-12-12z" fill="currentColor" />
			<path d="M14 27c3 0 6 2 10 9 4-7 7-9 10-9-1 6-5 10-10 10s-9-4-10-10z" fill={CLAIR} />
			{yeux(24, 5, 1.8)}
			<circle cx="24" cy="33" r="1.6" fill={SOMBRE} />
		</>
	),
	fantome: (
		<>
			<path d="M13 22a11 11 0 0 1 22 0v15l-3.7-3-3.6 3-3.7-3-3.7 3-3.6-3-3.7 3z" fill="currentColor" />
			<ellipse cx="19.5" cy="23" rx="2" ry="2.8" fill={SOMBRE} />
			<ellipse cx="28.5" cy="23" rx="2" ry="2.8" fill={SOMBRE} />
		</>
	),
	chat: (
		<>
			<path d="M12 12l7 6h10l7-6v16c0 7-5 10-12 10s-12-3-12-10z" fill="currentColor" />
			{yeux(25, 5)}
			<path d="M22.5 29.5h3l-1.5 1.8z" fill={SOMBRE} />
			<path d="M9 28h7M9 31l7-1M39 28h-7M39 31l-7-1" stroke={CLAIR} strokeOpacity=".5" strokeWidth="1.2" strokeLinecap="round" />
		</>
	),
	goutte: (
		<>
			<path d="M24 9c6 8 12 14 12 20a12 12 0 0 1-24 0c0-6 6-12 12-20z" fill="currentColor" />
			{yeux(28)}
			<path d="M21 33c2 1.5 4 1.5 6 0" stroke={SOMBRE} strokeWidth="1.8" fill="none" strokeLinecap="round" />
		</>
	),
	lapin: (
		<>
			<ellipse cx="18.5" cy="14" rx="3.5" ry="8" fill="currentColor" />
			<ellipse cx="29.5" cy="14" rx="3.5" ry="8" fill="currentColor" />
			<ellipse cx="18.5" cy="14" rx="1.5" ry="5" fill={CLAIR} fillOpacity=".55" />
			<ellipse cx="29.5" cy="14" rx="1.5" ry="5" fill={CLAIR} fillOpacity=".55" />
			<circle cx="24" cy="28" r="11" fill="currentColor" />
			{yeux(26)}
			<path d="M22.5 30.5h3l-1.5 1.6z" fill={SOMBRE} />
		</>
	),
	grenouille: (
		<>
			<circle cx="17" cy="17" r="5" fill="currentColor" />
			<circle cx="31" cy="17" r="5" fill="currentColor" />
			<ellipse cx="24" cy="28" rx="13" ry="10" fill="currentColor" />
			<circle cx="17" cy="17" r="2.6" fill={CLAIR} />
			<circle cx="31" cy="17" r="2.6" fill={CLAIR} />
			<circle cx="17" cy="17.4" r="1.3" fill={SOMBRE} />
			<circle cx="31" cy="17.4" r="1.3" fill={SOMBRE} />
			<path d="M17 29c4 3.5 10 3.5 14 0" stroke={SOMBRE} strokeWidth="1.8" fill="none" strokeLinecap="round" />
		</>
	),
	pingouin: (
		<>
			<ellipse cx="24" cy="25" rx="12" ry="14" fill="currentColor" />
			<ellipse cx="24" cy="28" rx="8" ry="10" fill={CLAIR} />
			{yeux(22, 3.5, 1.7)}
			<path d="M21.5 25.5h5l-2.5 2.5z" fill="var(--amber)" />
		</>
	),
	escargot: (
		<>
			<path d="M8 35h28c3 0 4-2 4-4v-9l-3 1v7H8z" fill="currentColor" fillOpacity=".7" />
			<circle cx="21" cy="24" r="10" fill="currentColor" />
			<circle cx="21" cy="24" r="5.5" stroke={SOMBRE} strokeOpacity=".5" strokeWidth="1.8" fill="none" />
			<circle cx="21" cy="24" r="2" fill={SOMBRE} fillOpacity=".5" />
			<path d="M37 22l-1.5-6M39.5 22l1.5-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
			<circle cx="35.5" cy="15.5" r="1.5" fill="currentColor" />
			<circle cx="41" cy="15.5" r="1.5" fill="currentColor" />
			<circle cx="37.5" cy="26" r="1.2" fill={SOMBRE} />
		</>
	),
	champignon: (
		<>
			<path d="M9 24a15 13 0 0 1 30 0z" fill="currentColor" />
			<circle cx="17" cy="18" r="2.2" fill={CLAIR} fillOpacity=".7" />
			<circle cx="27" cy="15" r="2.6" fill={CLAIR} fillOpacity=".7" />
			<circle cx="32" cy="21" r="1.6" fill={CLAIR} fillOpacity=".7" />
			<rect x="16" y="24" width="16" height="14" rx="6" fill={CLAIR} />
			{yeux(30, 3.5, 1.6)}
		</>
	),
	nuage: (
		<>
			<path d="M15 34a7 7 0 0 1-1-13.9A9 9 0 0 1 31.5 17 7.5 7.5 0 0 1 34 34z" fill="currentColor" />
			{yeux(26)}
			<path d="M21 30c2 1.5 4 1.5 6 0" stroke={SOMBRE} strokeWidth="1.8" fill="none" strokeLinecap="round" />
		</>
	),
};
