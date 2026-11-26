/**
 * Fiche de l'agent choisi dans la Nouvelle session : nom, étiquette (par défaut, intégré, personnalisé), description, puis
 * en clair son fournisseur, son moteur et sa version, son modèle, où il se lance, son équipement (skills, plugins, hooks)
 * et l'état de son moteur. Annoncée aux lecteurs d'écran quand l'agent change.
 */
import { FOURNISSEURS_MOTEURS } from '@mnemo/commun';
import type { MoteurVue, ProfilVue } from '@mnemo/contrat';
import type { CSSProperties, ReactNode } from 'react';
import { couleurFournisseur } from '../../../moteurs/fournisseurs.ts';
import { nomDuMoteur } from '../../../moteurs/noms.ts';
import { HOOKS_PROFIL } from '../../../profils/hooks.ts';
import { etiquetteDuProfil, LIEUX_DE_LANCEMENT, modeleDuProfil, montrePlugins, motPlugins, motSkills, texteHooks, type EtatMoteurAgent as Etat } from '../../../sessions/agents.ts';
import { EtatMoteurAgent } from './EtatMoteurAgent.tsx';
import s from './FicheAgent.module.css';

type Props = { profil: ProfilVue; moteur: MoteurVue | undefined; etat: Etat; verification: boolean; idRaison: string; surVoirReglages(): void };

export function FicheAgent(p: Props): ReactNode {
	const a = p.profil;
	const nomMoteur = p.moteur?.nom ?? nomDuMoteur(a.moteur);
	const modele = modeleDuProfil(a);
	const { skills, plugins, hooks } = a.equipement;
	const lance = LIEUX_DE_LANCEMENT[a.lancement];
	return (
		<div className={s.fiche} aria-live="polite">
			<div className={s.titre}>
				<h3 className={s.nom}>{a.nom}</h3>
				<span className={s.etiquette}>{etiquetteDuProfil(a)}</span>
			</div>
			<p className={s.desc}>{a.description}</p>
			<dl className={s.attributs}>
				<dt>Fournisseur</dt>
				<dd>
					<span className={s.fournisseur} style={{ '--c': couleurFournisseur(a.moteur) } as CSSProperties}>
						<i aria-hidden="true" />
						{FOURNISSEURS_MOTEURS[a.moteur]}
					</span>
				</dd>
				<dt>Moteur</dt>
				<dd title={p.moteur?.version ? `${nomMoteur} ${p.moteur.version}` : nomMoteur}>
					{nomMoteur}
					{p.moteur?.version && <span className={`${s.sec} ${s.mono}`}>{` ${p.moteur.version}`}</span>}
				</dd>
				<dt>Modèle</dt>
				<dd title={modele.texte}>{modele.parDefaut ? <span className={s.sec}>{modele.texte}</span> : <span className={s.mono}>{modele.texte}</span>}</dd>
				<dt>Se lance</dt>
				<dd>{lance}</dd>
			</dl>
			<ul className={s.equipement} aria-label="Équipement">
				<li>
					<b>{skills}</b> {motSkills(skills)}
				</li>
				{montrePlugins(a) && (
					<li>
						<b>{plugins}</b> {motPlugins(plugins)}
					</li>
				)}
				<li title={HOOKS_PROFIL.filter((h) => hooks.includes(h.cle)).map((h) => `${h.libelle} : ${h.detail}`).join('\n')}>{`hooks : ${texteHooks(hooks)}`}</li>
			</ul>
			<EtatMoteurAgent key={a.moteur} id={a.moteur} moteur={nomMoteur} etat={p.etat} verification={p.verification} idRaison={p.idRaison} surVoirReglages={p.surVoirReglages} />
		</div>
	);
}
