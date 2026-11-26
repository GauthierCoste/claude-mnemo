/**
 * Ce que la Nouvelle session dit des profils qu'elle ne propose pas, discrètement sous la fiche : les profils lancés par
 * leur propre chemin, ceux lus autrement qu'ils ne se déclarent, ceux ignorés (nom refusé), et des profils illisibles.
 */
import type { ReponseProfils } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { LIEUX_DE_LANCEMENT } from '../../../sessions/agents.ts';
import s from './AutresProfils.module.css';

export function AutresProfils(p: { profils: ReponseProfils | undefined; erreur: string | null }): ReactNode {
	const lignes = [
		...(p.erreur === null ? [] : [{ cle: 'erreur', texte: `Profils illisibles : ${p.erreur}`, erreur: true }]),
		...(p.profils?.profils ?? []).filter((x) => x.lanceur === 'propre').map((x) => ({ cle: `propre-${x.nom}`, texte: `${x.nom} : lancé par son propre chemin, ${LIEUX_DE_LANCEMENT[x.lancement]}.`, erreur: false })),
		...(p.profils?.avertissements ?? []).map((x, i) => ({ cle: `avert-${i}`, texte: `Profil ${x.nom} : ${x.motif}`, erreur: false })),
		...(p.profils?.ignores ?? []).map((x, i) => ({ cle: `ignore-${i}`, texte: `Profil ignoré, ${x.nom} : ${x.motif}`, erreur: false })),
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
