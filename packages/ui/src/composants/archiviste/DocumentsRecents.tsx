/**
 * Documents récents de Mémoire › Archiviste (colonne « Enrichir ») : les fiches de type `source` référencées, plus récentes
 * d'abord, avec leur état. Un document « à traiter » mène à son action dans « À faire » (le bouton « Traiter » de sa
 * ligne prend le focus) ; un document traité ouvre sa fiche source dans Fichiers.
 */
import type { DocumentVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useTextes } from '../../langue/langue.tsx';
import { DePlus } from '../commun/DePlus.tsx';
import { Puce } from '../commun/Puce.tsx';
import { useNavigationMemoire } from '../memoire/navigation-memoire.tsx';
import s from './DocumentsRecents.module.css';
import { allerALAction } from './SourcesATraiter.tsx';

/** Date « 2026-11-21 » au format de la langue (minuit local) ; telle quelle si elle est mal formée. */
function dateLisible(date: string, format: (ms: number) => string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	return m ? format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()) : date;
}

/** `total` : documents référencés, listés ou non (null tant que le service n'a pas répondu). */
export function DocumentsRecents(p: { documents: readonly DocumentVue[] | undefined; total: number | null; erreur: string | null; surToutVoir(): void }): ReactNode {
	const textes = useTextes();
	const t = textes.archiviste.documents;
	const memoire = useNavigationMemoire();
	const liste = p.documents ?? [];
	return (
		<section aria-labelledby="titre-documents-recents">
			<h3 id="titre-documents-recents" className={s.lbl}>
				{t.titre}
			</h3>
			{p.erreur !== null && <p className={s.mu}>{p.erreur}</p>}
			{p.erreur === null && liste.length === 0 && <p className={s.mu}>{p.documents === undefined ? t.chargement : t.aucun}</p>}
			<ul className={s.liste} aria-label={t.titre}>
				{liste.map((d) => (
					<li key={d.chemin}>
						<button
							type="button"
							className={s.document}
							title={d.aTraiter ? t.allerALAction(d.chemin) : d.chemin}
							onClick={() => {
								// sa ligne a pu disparaître de « À faire » (marquée traitée entre-temps) : sa fiche, alors
								if (!d.aTraiter || !allerALAction(d.chemin)) memoire.ouvrirFiche(d.chemin);
							}}
						>
							<span className={s.titre}>
								<bdi>{d.titre}</bdi>
								<span className={s.fichier}>{d.document ?? d.chemin}</span>
							</span>
							<span className={s.date}>{dateLisible(d.date, textes.commun.formats.date)}</span>
							{d.aTraiter ? <Puce couleur="ambre">{t.aTraiter}</Puce> : <Puce ton="succes">{t.traite}</Puce>}
						</button>
					</li>
				))}
			</ul>
			{p.total !== null && <DePlus nombre={p.total - liste.length} surToutVoir={p.surToutVoir} />}
		</section>
	);
}
