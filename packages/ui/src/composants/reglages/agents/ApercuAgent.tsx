/**
 * Aperçu, en lecture seule, de ce que reçoit une session de l'agent : chaque bloc avec son origine (agent, Mnemo, mémoire,
 * plugin, hors Mnemo, système) et s'il se règle ici. Il montre l'état enregistré, pas la saisie en cours.
 */
import type { BlocApercuVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useApercuProfil } from '../../../client/hooks.ts';
import { useTextes } from '../../../langue/langue.tsx';
import s from './Agents.module.css';

export function ApercuAgent(p: { nom: string; modifie: boolean }): ReactNode {
	const apercu = useApercuProfil(p.nom);
	const t = useTextes().agents.apercu;
	return (
		<div className={s.apercu}>
			{p.modifie && <p className={s.effet}>{t.versionEnregistree}</p>}
			{apercu.donnees === undefined ? (
				<p className={s.effet}>{apercu.erreur ?? t.chargement}</p>
			) : (
				<>
					{apercu.donnees.avertissements.length > 0 && (
						<ul className={s.avertissements} aria-label={t.avertissements}>
							{apercu.donnees.avertissements.map((a) => (
								<li key={a}>{a}</li>
							))}
						</ul>
					)}
					{apercu.donnees.blocs.map((b) => (
						<BlocApercu key={b.titre} bloc={b} />
					))}
				</>
			)}
		</div>
	);
}

function BlocApercu(p: { bloc: BlocApercuVue }): ReactNode {
	const b = p.bloc;
	const t = useTextes().agents.apercu;
	return (
		<details className={s.blocApercu} open={b.origine === 'profil'}>
			<summary className={s.titreApercu}>
				<span className={s.origine} data-origine={b.origine}>
					{t.origines[b.origine]}
				</span>
				<span>{b.titre}</span>
				{!b.reglable && <span className={s.effet}>{t.lectureSeule}</span>}
				{b.elements !== undefined && <span className={s.effet}>{t.actifs(b.elements.filter((e) => e.actif).length)}</span>}
			</summary>
			{b.texte !== undefined && <pre className={s.texteBloc}>{b.texte}</pre>}
			{b.elements !== undefined &&
				(b.elements.length === 0 ? (
					<p className={s.effet}>{t.aucun}</p>
				) : (
					<ul className={s.elements}>
						{b.elements.map((e) => (
							<li key={e.nom} className={s.element} data-actif={e.actif}>
								<span className={s.nomElement}>{e.nom}</span>
								{!e.actif && <span className={s.inactif}>{t.inactif}</span>}
								{e.detail !== '' && <span className={s.effet}>{e.detail}</span>}
							</li>
						))}
					</ul>
				))}
		</details>
	);
}
