/**
 * Logo de Mnemo dans la page : le dessin de `reglages/logo.ts` en SVG en ligne, le trait à la couleur principale
 * (`var(--ac)`) : il suit le réglage `interface.accent` comme le reste de l'interface.
 */
import type { ReactNode } from 'react';
import { cheminLettre, COTE, COUCHES, FOND, TRAIT, TRANSFORMATION_COUCHES } from '../../reglages/logo.ts';

export function LogoMnemo(p: { taille: number; className?: string; titre?: string }): ReactNode {
	return (
		<svg className={p.className} width={p.taille} height={p.taille} viewBox={`0 0 ${COTE} ${COTE}`} role="img" aria-label={p.titre ?? 'Mnemo'}>
			<rect x={FOND.marge} y={FOND.marge} width={COTE - 2 * FOND.marge} height={COTE - 2 * FOND.marge} rx={FOND.rayon} fill="var(--s1)" />
			<g transform={TRANSFORMATION_COUCHES} fill="none" stroke="var(--ac)" strokeWidth={TRAIT} strokeLinecap="round" strokeLinejoin="round">
				{COUCHES.map((k, i) => (
					<path key={i} d={cheminLettre(k.lettre)} transform={`translate(${k.dx} ${k.dy})`} opacity={k.opacite < 1 ? k.opacite : undefined} />
				))}
			</g>
		</svg>
	);
}
