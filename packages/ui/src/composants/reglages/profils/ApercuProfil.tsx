/**
 * Aperçu, en lecture seule, de ce que reçoit une session du profil : chaque bloc avec son origine (profil, Mnemo, mémoire,
 * plugin, hors Mnemo, système) et s'il se règle ici. Il montre l'état enregistré, pas la saisie en cours.
 */
import type { BlocApercuVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useApercuProfil } from '../../../client/hooks.ts';
import s from './Profils.module.css';

const ORIGINES: Record<BlocApercuVue['origine'], string> = {
	profil: 'Profil',
	mnemo: 'Mnemo',
	memoire: 'Mémoire',
	plugin: 'Plugin',
	hors_mnemo: 'Hors Mnemo',
	systeme: 'Système',
};

export function ApercuProfil(p: { nom: string; modifie: boolean }): ReactNode {
	const apercu = useApercuProfil(p.nom);
	return (
		<section className={s.apercu} aria-labelledby="apercu-profil">
			<h3 id="apercu-profil" className={s.titreSection}>
				Ce que reçoit une session
			</h3>
			{p.modifie && <p className={s.discret}>Version enregistrée.</p>}
			{apercu.donnees === undefined ? (
				<p className={s.discret}>{apercu.erreur ?? 'Chargement de l’aperçu…'}</p>
			) : (
				<>
					{apercu.donnees.avertissements.length > 0 && (
						<ul className={s.avertissements} aria-label="Avertissements de l’aperçu">
							{apercu.donnees.avertissements.map((a) => (
								<li key={a}>{a}</li>
							))}
						</ul>
					)}
					{apercu.donnees.blocs.map((b) => (
						<Bloc key={b.titre} bloc={b} />
					))}
				</>
			)}
		</section>
	);
}

function Bloc(p: { bloc: BlocApercuVue }): ReactNode {
	const b = p.bloc;
	return (
		<details className={s.bloc} open={b.origine === 'profil'}>
			<summary className={s.blocTitre}>
				<span className={s.origine} data-origine={b.origine}>
					{ORIGINES[b.origine]}
				</span>
				<span>{b.titre}</span>
				{!b.reglable && <span className={s.discret}>lecture seule</span>}
				{b.elements !== undefined && <span className={s.discret}>{b.elements.filter((e) => e.actif).length} actif(s)</span>}
			</summary>
			{b.texte !== undefined && <pre className={s.texteBloc}>{b.texte}</pre>}
			{b.elements !== undefined &&
				(b.elements.length === 0 ? (
					<p className={s.discret}>Aucun.</p>
				) : (
					<ul className={s.elements}>
						{b.elements.map((e) => (
							<li key={e.nom} className={s.element} data-actif={e.actif}>
								<span className={s.nomElement}>{e.nom}</span>
								{!e.actif && <span className={s.inactif}>inactif</span>}
								{e.detail !== '' && <span className={s.discret}>{e.detail}</span>}
							</li>
						))}
					</ul>
				))}
		</details>
	);
}
