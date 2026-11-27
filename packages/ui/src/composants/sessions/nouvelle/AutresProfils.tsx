/**
 * Ce que la Nouvelle session dit des profils qu'elle ne propose pas, discrètement sous la fiche : les profils lancés par
 * leur propre chemin, ceux lus autrement qu'ils ne se déclarent, ceux ignorés (nom refusé), et des profils illisibles.
 */
import type { ReponseProfils } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useTextes } from '../../../langue/langue.tsx';
import s from './AutresProfils.module.css';

export function AutresProfils(p: { profils: ReponseProfils | undefined; erreur: string | null }): ReactNode {
	const t = useTextes().sessions.nouvelle;
	const a = t.autres;
	const lignes = [
		...(p.erreur === null ? [] : [{ cle: 'erreur', texte: a.illisibles(p.erreur), erreur: true }]),
		...(p.profils?.profils ?? []).filter((x) => x.lanceur === 'propre').map((x) => ({ cle: `propre-${x.nom}`, texte: a.propre(x.nom, t.lieux[x.lancement]), erreur: false })),
		...(p.profils?.avertissements ?? []).map((x, i) => ({ cle: `avert-${i}`, texte: a.avertissement(x.nom, x.motif), erreur: false })),
		...(p.profils?.ignores ?? []).map((x, i) => ({ cle: `ignore-${i}`, texte: a.ignore(x.nom, x.motif), erreur: false })),
	];
	if (lignes.length === 0) return null;
	return (
		<ul className={s.autres}>
			{lignes.map((l) => (
				<li key={l.cle} data-erreur={l.erreur || undefined}>
					{l.texte}
				</li>
			))}
		</ul>
	);
}
