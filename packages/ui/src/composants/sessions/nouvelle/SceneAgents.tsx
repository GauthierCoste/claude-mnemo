/**
 * Scène de la Nouvelle session : l'agent choisi en grand sur un sol à sa couleur (`--profil`), ses voisins réduits et
 * estompés de chaque côté (un clic en choisit un), flèches pour passer au précédent ou au suivant. Un agent dont le moteur
 * bloque le lancement est éteint. Image pour la souris : les lecteurs d'écran choisissent dans la rangée (`RangeeAgents`),
 * les flèches restent des boutons nommés.
 */
import type { ProfilVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { ecartCirculaire, placeDansScene } from '../../../sessions/agents.ts';
import { AvatarProfil } from '../../commun/AvatarProfil.tsx';
import { useTextes } from '../../../langue/langue.tsx';
import s from './SceneAgents.module.css';

/** `choisi` : indice de l'agent choisi ; `eteints` : noms des agents dont le moteur bloque le lancement ; `surChoisir` reçoit un indice à ramener dans la liste. */
export function SceneAgents(p: { agents: readonly ProfilVue[]; choisi: number; eteints: ReadonlySet<string>; surChoisir(i: number): void }): ReactNode {
	const t = useTextes().sessions.nouvelle;
	const n = p.agents.length;
	const agent = p.agents[p.choisi];
	return (
		<div className={s.carrousel}>
			<div className={s.piste} aria-hidden="true">
				{p.agents.map((a, j) => {
					const ecart = ecartCirculaire(j, p.choisi, n);
					return (
						<div key={a.nom} className={s.agent} data-pos={placeDansScene(ecart)} data-eteint={p.eteints.has(a.nom) || undefined} title={ecart === 0 ? undefined : a.nom} onClick={() => ecart !== 0 && p.surChoisir(j)}>
							<AvatarProfil avatar={a.avatar} taille="pleine" sansFond titre={a.nom} />
						</div>
					);
				})}
			</div>
			{n > 1 && (
				<>
					<button type="button" className={`${s.fleche} ${s.gauche}`} aria-label={t.precedent} onClick={() => p.surChoisir(p.choisi - 1)}>
						‹
					</button>
					<button type="button" className={`${s.fleche} ${s.droite}`} aria-label={t.suivant} onClick={() => p.surChoisir(p.choisi + 1)}>
						›
					</button>
				</>
			)}
			{agent !== undefined && (
				<div className={s.plaque} aria-hidden="true">
					<span className={s.nom}>{agent.nom}</span>
					<span className={s.rang}>{`${p.choisi + 1} / ${n}`}</span>
				</div>
			)}
		</div>
	);
}
