/**
 * La carte d'un moteur : emblème à la couleur de son fournisseur (sa lettre, jamais un logo), nom, fournisseur et statut en
 * un mot ; le circuit de liaison ; l'encadré d'action de la première étape cassée ; l'équipe et les modèles.
 */
import { FOURNISSEURS_MOTEURS } from '@mnemo/commun';
import type { IdMoteur } from '@mnemo/commun';
import type { MoteurVue, ProfilVue } from '@mnemo/contrat';
import { useId, type CSSProperties, type ReactNode } from 'react';
import { actionDuMoteur, etapesDuCircuit, statutDuMoteur } from '../../../moteurs/circuit.ts';
import { couleurFournisseur, lettreFournisseur } from '../../../moteurs/fournisseurs.ts';
import { ActionMoteur } from './ActionMoteur.tsx';
import { CircuitLiaison } from './CircuitLiaison.tsx';
import { EquipeMoteur } from './EquipeMoteur.tsx';
import { ModelesMoteur } from './ModelesMoteur.tsx';
import s from './Moteurs.module.css';

/** `lecture` : une vérification du poste en cours. */
export function CarteMoteur(p: { moteur: MoteurVue; profils: readonly ProfilVue[] | undefined; lecture: boolean; surNouveauProfil?(moteur: IdMoteur): void }): ReactNode {
	const m = p.moteur;
	const id = useId();
	const statut = statutDuMoteur(m);
	const action = actionDuMoteur(m);
	const absent = statut.cle === 'pas-installe';
	return (
		<section className={s.carte} data-absent={absent || undefined} style={absent ? undefined : ({ '--c': couleurFournisseur(m.id) } as CSSProperties)} aria-labelledby={`${id}-nom ${id}-statut`}>
			<div className={s.haut}>
				<span className={s.embleme} aria-hidden="true">
					{lettreFournisseur(m.id)}
				</span>
				<div className={s.ident}>
					<h4 id={`${id}-nom`} className={s.nom}>
						{m.nom}
					</h4>
					<span className={s.fournisseur}>{FOURNISSEURS_MOTEURS[m.id]}</span>
				</div>
				<span id={`${id}-statut`} className={s.statut} data-statut={statut.cle}>
					{statut.libelle}
				</span>
			</div>
			<CircuitLiaison moteur={m.nom} etapes={etapesDuCircuit(m)} />
			{/* une action par moteur : le retour d'une liaison reste quand l'étape qui bloque change avec la vue relue */}
			{action !== null && <ActionMoteur key={m.id} id={m.id} moteur={m.nom} action={action} lecture={p.lecture} />}
			<div className={s.bas}>
				<EquipeMoteur id={m.id} moteur={m.nom} profils={p.profils} indisponible={absent && !m.manuel} {...(p.surNouveauProfil ? { surNouveauProfil: p.surNouveauProfil } : {})} />
				<ModelesMoteur moteur={m.nom} modeles={m.modeles} />
			</div>
		</section>
	);
}
