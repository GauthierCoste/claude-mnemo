import type { ReactNode } from 'react';
import type { DonneesGraphe } from '@mnemo/contrat';

const nombre = (n: number) => n.toLocaleString('fr-FR');

/** « n fiches | n faits | n liens » ; faits actifs seulement. */
export function texteStatistiques(d: DonneesGraphe): string {
	return `${nombre(d.fiches.length)} fiches | ${nombre(d.fiches.reduce((t, f) => t + f.faitsActifs, 0))} informations | ${nombre(d.liens.length)} liens`;
}

export function StatistiquesMemoire(p: { donnees: DonneesGraphe | undefined; className?: string }): ReactNode {
	return <span className={p.className}>{p.donnees ? texteStatistiques(p.donnees) : ''}</span>;
}
