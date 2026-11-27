import type { ReactNode } from 'react';
import type { DonneesGraphe } from '@mnemo/contrat';
import { useTextes } from '../../langue/langue.tsx';
import type { Textes } from '../../langue/textes.ts';

/** « n fiches | n faits | n liens » ; faits actifs seulement. */
export function texteStatistiques(d: DonneesGraphe, t: Textes['memoire']['vue']): string {
	return t.statistiques(d.fiches.length, d.fiches.reduce((n, f) => n + f.faitsActifs, 0), d.liens.length);
}

export function StatistiquesMemoire(p: { donnees: DonneesGraphe | undefined; className?: string }): ReactNode {
	const t = useTextes().memoire.vue;
	return <span className={p.className}>{p.donnees ? texteStatistiques(p.donnees, t) : ''}</span>;
}
