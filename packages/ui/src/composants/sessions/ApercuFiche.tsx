/**
 * Aperçu d'une fiche du panneau Contexte, déplié sous sa ligne au clic sur son titre : de quoi juger si la fiche convient
 * sans quitter la session. Son type et son dossier, sa synthèse et ses premières informations (lues à l'ouverture, avec
 * un squelette pendant la lecture), puis « Ouvrir la fiche » et les gestes de la ligne (`actions`). Le titre entier et la
 * raison de la proposition restent dans la ligne, au-dessus.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useFiche } from '../../client/hooks.ts';
import { dossierDe, resumerFiche } from '../../memoire/resume-fiche.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { useTextes } from '../../langue/langue.tsx';
import s from './ApercuFiche.module.css';

export function ApercuFiche(p: {
	id: string;
	/** Identifiant de la ligne : la fiche, ou `chemin#^ancre` d'une information (montrée en tête). */
	cible: string;
	titre: string;
	actions?: ReactNode;
	surOuvrir(): void;
}): ReactNode {
	const t = useTextes().sessions.apercu;
	const [chemin = '', suite = ''] = p.cible.split('#');
	const ancre = suite.startsWith('^') ? suite.slice(1) : null;
	const fiche = useFiche(chemin, false);
	const resume = fiche.donnees === undefined ? null : resumerFiche(fiche.donnees, ancre);
	const dossier = dossierDe(chemin);
	const racine = useRef<HTMLDivElement>(null);
	const lue = resume !== null;
	// déplié en bas de la liste (qui défile), l'aperçu se montre en entier, une fois ouvert puis une fois lu
	useEffect(() => {
		(racine.current?.closest('li') ?? racine.current)?.scrollIntoView?.({ block: 'nearest' });
	}, [lue]);
	const reste = resume === null ? 0 : resume.total - resume.informations.length;
	return (
		<div ref={racine} id={p.id} className={s.apercu} role="region" aria-label={t.region(p.titre)}>
			<p className={s.meta} title={chemin}>
				{resume !== null && <span className={s.type}>{resume.type}</span>}
				<span className={s.dossier}>{dossier === '' ? t.racine : dossier}</span>
			</p>
			{resume === null ? (
				fiche.erreur !== null ? (
					<p className={s.erreur}>{t.indisponible(fiche.erreur)}</p>
				) : (
					<div className={s.squelette} role="status" aria-label={t.lecture}>
						<span />
						<span />
						<span />
					</div>
				)
			) : resume.synthese === '' && resume.informations.length === 0 ? (
				<p className={s.vide}>{t.vide}</p>
			) : (
				<>
					{resume.synthese !== '' && (
						<p className={s.synthese} title={resume.synthese}>
							{resume.synthese}
						</p>
					)}
					{resume.informations.length > 0 && (
						<ul className={s.informations} aria-label={t.informations}>
							{resume.informations.map((i, n) => (
								<li key={i.ancre ?? n} title={i.texte} data-visee={i.ancre !== null && i.ancre === ancre ? 'true' : undefined}>
									{i.categorie !== null && <span className={s.categorie}>{i.categorie}</span>}
									{i.texte}
								</li>
							))}
						</ul>
					)}
					{reste > 0 && <p className={s.reste}>{t.reste(reste)}</p>}
				</>
			)}
			<div className={s.actions}>
				<Bouton petit genre="primaire" onClick={p.surOuvrir} title={t.ouvrirTitre}>
					{t.ouvrir}
				</Bouton>
				{p.actions}
			</div>
		</div>
	);
}
