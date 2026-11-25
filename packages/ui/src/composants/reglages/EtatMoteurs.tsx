/**
 * Réglages › Système › Moteurs : l'état de chaque agent de code sur ce poste (commande, version, serveur MCP, hooks et leur
 * approbation), en lecture seule, comme `mnemo verifier-poste`. Chaque point non satisfaisant dit pourquoi et donne la
 * commande qui y remédie, à copier (dans un terminal, ou à taper dans le moteur). « Relire » après l'avoir lancée.
 */
import type { MoteurVue, PointMoteurVue } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { useMoteurs } from '../../client/hooks.ts';
import { copierTexte } from '../commun/copier.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { useToast } from '../Toast.tsx';
import d from './profils/Profils.module.css';
import s from './Reglages.module.css';

const SYMBOLES: Record<string, { signe: string; libelle: string }> = {
	true: { signe: '✓', libelle: 'satisfait' },
	false: { signe: '✗', libelle: 'à régler' },
	null: { signe: '?', libelle: 'à vérifier' },
};

export function EtatMoteurs(): ReactNode {
	const ressource = useMoteurs(true);
	const moteurs = ressource.donnees?.moteurs;
	return (
		<section className={s.moteurs} aria-labelledby="titre-moteurs" aria-busy={moteurs === undefined && ressource.erreur === null}>
			<div className={d.ligne}>
				<h3 id="titre-moteurs" className={d.titreSection}>
					Moteurs
				</h3>
				<Bouton petit disabled={moteurs === undefined && ressource.erreur === null} onClick={ressource.recharger}>
					Relire
				</Bouton>
			</div>
			<p className={d.discret}>Les agents de code qui font tourner les sessions, vus sur ce poste. Après une commande lancée, « Relire ».</p>
			{moteurs === undefined ? (
				<p className={d.discret} role="status">
					{ressource.erreur ?? 'Vérification des moteurs… (quelques secondes)'}
				</p>
			) : (
				moteurs.map((m) => <Moteur key={m.id} moteur={m} />)
			)}
		</section>
	);
}

function Moteur(p: { moteur: MoteurVue }): ReactNode {
	const m = p.moteur;
	return (
		<div className={d.section} role="group" aria-labelledby={`moteur-${m.id}`}>
			<div className={d.ligne}>
				<h4 id={`moteur-${m.id}`} className={s.nomMoteur}>
					{m.nom}
				</h4>
				{m.indisponible === null ? <span className={s.okMoteur}>sessions possibles</span> : <span className={d.inactif}>{m.manuel ? 'ligne à coller' : 'sessions refusées'}</span>}
			</div>
			{m.indisponible !== null && <p className={d.discret}>{m.indisponible}</p>}
			<ul className={s.points}>
				{(m.poste ?? []).map((x) => (
					<Point key={x.cle} point={x} moteur={m.nom} />
				))}
			</ul>
		</div>
	);
}

function Point(p: { point: PointMoteurVue; moteur: string }): ReactNode {
	const x = p.point;
	const toast = useToast();
	const symbole = SYMBOLES[String(x.ok)]!;
	return (
		<li className={s.point} data-ok={String(x.ok)}>
			<span className={s.signe} role="img" aria-label={symbole.libelle} title={symbole.libelle}>
				{symbole.signe}
			</span>
			<span className={s.corpsPoint}>
				<span>
					<span className={s.libellePoint}>{x.libelle}</span> : {x.etat}
				</span>
				{x.detail !== undefined && <span className={s.detailPoint}>{x.detail}</span>}
				{x.remede !== undefined && (
					<span className={s.remede}>
						<span className={d.discret}>{x.remede.dans === 'terminal' ? 'À lancer dans un terminal :' : `À taper dans ${p.moteur} :`}</span>
						<code>{x.remede.texte}</code>
						<Bouton petit aria-label={`Copier « ${x.remede.texte} »`} onClick={() => copierTexte(x.remede!.texte, toast, 'Commande copiée.')}>
							Copier
						</Bouton>
					</span>
				)}
			</span>
		</li>
	);
}
