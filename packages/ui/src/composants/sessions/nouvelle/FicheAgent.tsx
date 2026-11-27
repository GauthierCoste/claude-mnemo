/**
 * Fiche de l'agent choisi dans la Nouvelle session : nom, étiquette (par défaut, intégré, personnalisé), description, puis
 * en clair son fournisseur, son moteur et sa version, son modèle, où il se lance, son équipement (skills, plugins, hooks)
 * et l'état de son moteur. Une seule région vivante, invisible, annonce aux lecteurs d'écran l'agent et l'état de son moteur
 * quand l'un ou l'autre change (pas toute la fiche).
 */
import { FOURNISSEURS_MOTEURS } from '@mnemo/commun';
import type { MoteurVue, ProfilVue } from '@mnemo/contrat';
import type { CSSProperties, ReactNode } from 'react';
import { couleurFournisseur } from '../../../moteurs/fournisseurs.ts';
import { nomDuMoteur } from '../../../moteurs/noms.ts';
import { hooksProfil } from '../../../profils/hooks.ts';
import { annonceDeLAgent, etiquetteDuProfil, modeleDuProfil, montrePlugins, texteHooks, type EtatMoteurAgent as Etat } from '../../../sessions/agents.ts';
import { useTextes } from '../../../langue/langue.tsx';
import { EtatMoteurAgent } from './EtatMoteurAgent.tsx';
import s from './FicheAgent.module.css';

type Props = { profil: ProfilVue; moteur: MoteurVue | undefined; etat: Etat; verification: boolean; idRaison: string; surVoirReglages(): void };

export function FicheAgent(p: Props): ReactNode {
	const textes = useTextes();
	const ts = textes.sessions;
	const t = ts.nouvelle;
	const a = p.profil;
	const nomMoteur = p.moteur?.nom ?? nomDuMoteur(a.moteur);
	const modele = modeleDuProfil(a, ts);
	const { skills, plugins, hooks } = a.equipement;
	const lance = t.lieux[a.lancement];
	return (
		<div className={s.fiche}>
			<p className={s.annonce} aria-live="polite">
				{annonceDeLAgent(a.nom, nomMoteur, p.etat, ts)}
			</p>
			<div className={s.titre}>
				<h3 className={s.nom} title={a.nom}>
					{a.nom}
				</h3>
				<span className={s.etiquette}>{etiquetteDuProfil(a, ts)}</span>
			</div>
			<p className={s.desc}>{a.description}</p>
			<dl className={s.attributs}>
				<dt>{t.fiche.fournisseur}</dt>
				<dd>
					<span className={s.fournisseur} style={{ '--c': couleurFournisseur(a.moteur) } as CSSProperties}>
						<i aria-hidden="true" />
						{FOURNISSEURS_MOTEURS[a.moteur]}
					</span>
				</dd>
				<dt>{t.fiche.moteur}</dt>
				<dd title={p.moteur?.version ? `${nomMoteur} ${p.moteur.version}` : nomMoteur}>
					{nomMoteur}
					{p.moteur?.version && <span className={`${s.sec} ${s.mono}`}>{` ${p.moteur.version}`}</span>}
				</dd>
				<dt>{t.fiche.modele}</dt>
				<dd title={modele.texte}>{modele.parDefaut ? <span className={s.sec}>{modele.texte}</span> : <span className={s.mono}>{modele.texte}</span>}</dd>
				<dt>{t.fiche.seLance}</dt>
				<dd>{lance}</dd>
			</dl>
			<ul className={s.equipement} aria-label={t.fiche.equipement}>
				<li>
					<b>{skills}</b> {t.skills(skills)}
				</li>
				{montrePlugins(a) && (
					<li>
						<b>{plugins}</b> {t.plugins(plugins)}
					</li>
				)}
				<li title={hooksProfil(textes.agents.hooks).filter((h) => hooks.includes(h.cle)).map((h) => ts.nouvelle.hookEtDetail(h.libelle, h.detail)).join('\n')}>{t.hooks(texteHooks(hooks, ts, textes.agents.hooks))}</li>
			</ul>
			<EtatMoteurAgent key={a.moteur} id={a.moteur} moteur={nomMoteur} etat={p.etat} verification={p.verification} idRaison={p.idRaison} surVoirReglages={p.surVoirReglages} />
		</div>
	);
}
