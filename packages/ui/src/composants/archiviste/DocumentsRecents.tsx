/**
 * Documents récents de Mémoire › Archiviste (colonne « Enrichir ») : les fiches de type `source` référencées, plus récentes
 * d'abord, avec leur état. Un document « à traiter » mène à son action dans « À faire » (le bouton « Traiter » de sa
 * ligne prend le focus) ; un document traité ouvre sa fiche source dans Fichiers.
 */
import type { DocumentVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { DePlus } from '../commun/DePlus.tsx';
import { Puce } from '../commun/Puce.tsx';
import { useNavigationMemoire } from '../memoire/navigation-memoire.tsx';
import s from './DocumentsRecents.module.css';
import { allerALAction } from './SourcesATraiter.tsx';

/** « 2026-11-21 » → « 21.11.2026 ». */
const dateLisible = (date: string) => date.split('-').reverse().join('.');

/** `total` : documents référencés, listés ou non (null tant que le service n'a pas répondu). */
export function DocumentsRecents(p: { documents: readonly DocumentVue[] | undefined; total: number | null; erreur: string | null; surToutVoir(): void }): ReactNode {
	const memoire = useNavigationMemoire();
	const liste = p.documents ?? [];
	return (
		<section aria-labelledby="titre-documents-recents">
			<h3 id="titre-documents-recents" className={s.lbl}>
				Documents récents
			</h3>
			{p.erreur !== null && <p className={s.mu}>{p.erreur}</p>}
			{p.erreur === null && liste.length === 0 && <p className={s.mu}>{p.documents === undefined ? 'Chargement…' : 'Aucun document référencé.'}</p>}
			<ul className={s.liste} aria-label="Documents récents">
				{liste.map((d) => (
					<li key={d.chemin}>
						<button
							type="button"
							className={s.document}
							title={d.aTraiter ? `${d.chemin} — à traiter : aller à son action` : d.chemin}
							onClick={() => {
								// sa ligne a pu disparaître de « À faire » (marquée traitée entre-temps) : sa fiche, alors
								if (!d.aTraiter || !allerALAction(d.chemin)) memoire.ouvrirFiche(d.chemin);
							}}
						>
							<span className={s.titre}>
								<bdi>{d.titre}</bdi>
								<span className={s.fichier}>{d.document ?? d.chemin}</span>
							</span>
							<span className={s.date}>{dateLisible(d.date)}</span>
							{d.aTraiter ? <Puce couleur="ambre">à traiter</Puce> : <Puce ton="succes">traité</Puce>}
						</button>
					</li>
				))}
			</ul>
			{p.total !== null && <DePlus nombre={p.total - liste.length} surToutVoir={p.surToutVoir} />}
		</section>
	);
}
