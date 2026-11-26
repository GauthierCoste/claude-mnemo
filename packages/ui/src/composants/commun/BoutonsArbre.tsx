/**
 * Boutons icônes d'en-tête d'un arbre (Mémoire › Fichiers, panneau Dossier) : « Tout replier », « Tout déplier », et
 * « Localiser la fiche ouverte » quand l'arbre le propose. Les raccourcis (⌘- et ⌘+ / ⌘= sous macOS, Ctrl ailleurs) sont lus
 * par l'arbre (`pliageArbre`) et annoncés selon la plateforme.
 */
import type { ReactNode } from 'react';
import { raccourciAlt, toucheCommande } from '../../raccourcis.ts';
import s from './BoutonsArbre.module.css';

const trait = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Chevrons qui se rejoignent (replier) ou s'écartent (déplier). */
function Chevrons(p: { vers: 'dedans' | 'dehors' }): ReactNode {
	const d = p.vers === 'dedans' ? 'M5 2.5 8 5.5 11 2.5M5 13.5 8 10.5 11 13.5' : 'M5 5.5 8 2.5 11 5.5M5 10.5 8 13.5 11 10.5';
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<path d={d} {...trait} />
		</svg>
	);
}

function Cible(): ReactNode {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
			<circle cx="8" cy="8" r="4.5" {...trait} />
			<circle cx="8" cy="8" r="1.2" fill="currentColor" />
			<path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" {...trait} />
		</svg>
	);
}

export function BoutonsArbre(p: { surReplier(): void; surDeplier(): void; localiser?: { possible: boolean; surLocaliser(): void } }): ReactNode {
	const { libelle: affiche, aria: touche } = toucheCommande();
	return (
		<span className={s.boutons}>
			{p.localiser && (
				<button
					type="button"
					className={s.bouton}
					title={`Localiser la fiche ouverte (${raccourciAlt('L')})`}
					aria-label="Localiser la fiche ouverte"
					aria-keyshortcuts="Alt+L"
					disabled={!p.localiser.possible}
					onClick={p.localiser.surLocaliser}
				>
					<Cible />
				</button>
			)}
			<button type="button" className={s.bouton} title={`Tout replier (${affiche}-)`} aria-label="Tout replier" aria-keyshortcuts={`${touche}+-`} onClick={p.surReplier}>
				<Chevrons vers="dedans" />
			</button>
			<button type="button" className={s.bouton} title={`Tout déplier (${affiche}+)`} aria-label="Tout déplier" aria-keyshortcuts={`${touche}+=`} onClick={p.surDeplier}>
				<Chevrons vers="dehors" />
			</button>
		</span>
	);
}
