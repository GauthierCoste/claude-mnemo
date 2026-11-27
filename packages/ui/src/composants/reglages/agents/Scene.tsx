/**
 * Scène du créateur d'agent : l'agent en grand sur son podium (il respire, sauf mouvement réduit), son nom et son rôle, sa
 * classe (logo, moteur · modèle, fournisseur), ses stats en barres (skills, plugins avec Claude Code, capacités ; chacune
 * rapportée à ce qui peut être équipé) et l'interrupteur « Démarre dans la mémoire » avec sa phrase. Tout suit le brouillon.
 */
import { FOURNISSEURS_MOTEURS, NOMS_MOTEURS } from '@mnemo/commun';
import type { ProfilDetailVue, ProfilEditableVue } from '@mnemo/contrat';
import { useId, type ReactNode } from 'react';
import { useTextes } from '../../../langue/langue.tsx';
import { LogoMoteur } from '../../../moteurs/logos.tsx';
import { HOOKS_PROFIL, capacitesActives } from '../../../profils/hooks.ts';
import { compterEquipement } from '../../../reglages/equipement.ts';
import { AvatarProfil } from '../../commun/AvatarProfil.tsx';
import s from './Agents.module.css';

export function Scene(p: { nom: string; role: string; editable: ProfilEditableVue; detail: ProfilDetailVue; surLancement(l: ProfilEditableVue['lancement']): void }): ReactNode {
	const e = p.editable;
	const t = useTextes().agents.scene;
	const depart = e.lancement === 'memoire' ? t.departMemoire : t.departProjet;
	const id = useId();
	const { skills, plugins } = compterEquipement(e, p.detail);
	const propres = new Set(p.detail.skillsDuProfil.map((x) => x.nom));
	const disponibles = propres.size + p.detail.skillsMemoireDisponibles.filter((x) => !propres.has(x.nom)).length;
	const stats: { nom: string; valeur: number; sur: number }[] = [
		{ nom: t.skills, valeur: skills, sur: disponibles },
		...(e.moteur === 'claude-code' ? [{ nom: t.plugins, valeur: plugins, sur: p.detail.pluginsInstalles.length }] : []),
		{ nom: t.capacites, valeur: capacitesActives(e.hooks), sur: HOOKS_PROFIL.length },
	];
	const memoire = e.lancement === 'memoire';
	return (
		<aside className={s.scene} aria-label={t.agent(p.nom)}>
			<div className={s.podium}>
				<div className={s.nomPerso}>
					<h2 className={s.nomAgent}>{p.nom}</h2>
					{p.role !== '' && <p className={s.role}>{p.role}</p>}
				</div>
				<span className={s.portrait}>
					<AvatarProfil avatar={e.avatar} taille="pleine" sansFond titre={t.avatar(p.nom)} />
				</span>
			</div>
			<div className={s.classeResume}>
				<span className={s.blason}>
					<LogoMoteur moteur={e.moteur} taille={20} />
				</span>
				<span className={s.identite}>
					<b>
						{NOMS_MOTEURS[e.moteur]} · {e.modele === '' ? <span className={s.dim}>{t.modeleParDefaut}</span> : <span className={s.mono}>{e.modele}</span>}
					</b>
					<span>{FOURNISSEURS_MOTEURS[e.moteur]}</span>
				</span>
			</div>
			<ul className={s.stats} aria-label={t.stats}>
				{stats.map((x) => (
					<li key={x.nom} className={s.stat} title={t.surTotal(x.valeur, x.sur)}>
						<span>{x.nom}</span>
						<span className={s.barre} aria-hidden="true">
							<i style={{ width: `${x.sur === 0 ? 0 : Math.min(100, (x.valeur / x.sur) * 100)}%` }} />
						</span>
						<b>{x.valeur}</b>
					</li>
				))}
			</ul>
			<div className={s.depart}>
				<span className={s.identite}>
					<span id={`${id}-libelle`}>{t.demarreEnMemoire}</span>
					<small id={`${id}-aide`}>{p.detail.lancementModifiable ? depart : `${depart} ${t.archivisteEnMemoire}`}</small>
				</span>
				<button
					type="button"
					role="switch"
					className={s.interrupteur}
					aria-checked={memoire}
					aria-labelledby={`${id}-libelle`}
					aria-describedby={`${id}-aide`}
					aria-disabled={!p.detail.lancementModifiable || undefined}
					onClick={() => p.detail.lancementModifiable && p.surLancement(memoire ? 'projet' : 'memoire')}
				/>
			</div>
		</aside>
	);
}
