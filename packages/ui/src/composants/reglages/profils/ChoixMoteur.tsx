/**
 * Moteur et modèle d'un profil (Réglages › Agents) : l'agent de code de ses sessions et son fournisseur, chacun avec son état sur ce poste
 * (version, ou pourquoi il ne lancera pas de session : il reste choisissable), puis le modèle, en saisie libre avec les
 * modèles proposés par le moteur ; vide : le modèle par défaut du moteur. L'archiviste reste sur Claude Code.
 */
import { estModele, FOURNISSEURS_MOTEURS, IDS_MOTEURS, MODELE_MAX, PROFIL_ARCHIVISTE } from '@mnemo/commun';
import type { IdMoteur } from '@mnemo/commun';
import type { MoteurVue } from '@mnemo/contrat';
import { useId, type ReactNode } from 'react';
import { useMoteurs } from '../../../client/hooks.ts';
import { NOMS_MOTEURS } from '../../../moteurs/noms.ts';
import { Bouton } from '../../commun/Bouton.tsx';
import s from './Profils.module.css';

/**
 * Ce que change le moteur pour la session, dit sur la ligne de chaque choix : ce qu'il apporte et ce qui lui manque (quotas de
 * l'abonnement lus ou non).
 */
const EFFETS: Record<IdMoteur, string> = {
	'claude-code': 'skills et hooks par un plugin de session, plugins Claude Code au choix, quotas de l’abonnement lus',
	codex: 'skills listées dans la consigne et lues par l’outil lire, hooks à approuver une fois dans Codex, quotas de l’abonnement lus ; pas de plugins',
	'mistral-vibe': 'skills listées dans la consigne et lues par l’outil lire ; ni plugins, ni quotas de l’abonnement',
};

/** Ligne d'état d'un moteur sur ce poste : sa version, ou pourquoi ses sessions ne se lanceront pas ici. */
function etatDe(m: MoteurVue | undefined, chargement: boolean): { texte: string; manque: boolean } {
	if (m === undefined) return { texte: chargement ? 'état en lecture…' : 'état inconnu', manque: false };
	if (m.indisponible !== null) return { texte: m.indisponible, manque: true };
	return { texte: m.version === null ? 'trouvé sur ce poste' : `version ${m.version}`, manque: false };
}

export function ChoixMoteur(p: { profil: string; moteur: IdMoteur; modele: string; surMoteur(m: IdMoteur): void; surModele(m: string): void }): ReactNode {
	const ressource = useMoteurs();
	const moteurs = ressource.donnees?.moteurs ?? [];
	const chargement = ressource.donnees === undefined && ressource.erreur === null;
	const id = useId();
	const choisi = moteurs.find((m) => m.id === p.moteur);
	const nom = NOMS_MOTEURS[p.moteur];
	const archiviste = p.profil === PROFIL_ARCHIVISTE;
	const modeleValide = estModele(p.modele);
	const proposes = choisi?.modeles ?? [];

	return (
		<>
			<div role="radiogroup" aria-label="Moteur" className={s.liste2}>
				{IDS_MOTEURS.map((m) => {
					const etat = etatDe(
						moteurs.find((x) => x.id === m),
						chargement,
					);
					const reserve = archiviste && m !== 'claude-code';
					return (
						// la description hors du libellé : lue une fois, comme description (aria-describedby), pas aussi dans le nom
						<div key={m} className={s.choix} data-desactive={reserve || undefined}>
							<label className={s.case}>
								<input type="radio" name={`${id}-moteur`} checked={p.moteur === m} disabled={reserve} aria-describedby={reserve ? `${id}-${m}` : `${id}-${m}-etat ${id}-${m}-effet`} onChange={() => p.surMoteur(m)} />
								<span>
									{NOMS_MOTEURS[m]} <span className={s.fournisseurChoix}>· {FOURNISSEURS_MOTEURS[m]}</span> {etat.manque && <span className={s.inactif}>indisponible</span>}
								</span>
							</label>
							{reserve ? (
								<span id={`${id}-${m}`} className={s.detailChoix}>
									Réservé : l’archiviste reste sur Claude Code.
								</span>
							) : (
								// l'état sur ce poste, puis l'effet : deux lignes, lues l'une après l'autre comme description
								<span>
									<span id={`${id}-${m}-etat`} className={s.detailChoix}>
										{etat.texte}
									</span>
									<span id={`${id}-${m}-effet`} className={s.detailChoix}>
										{EFFETS[m]}
									</span>
								</span>
							)}
						</div>
					);
				})}
			</div>
			{ressource.erreur !== null && <p className={s.discret}>État des moteurs illisible : {ressource.erreur}</p>}
			{choisi !== undefined && choisi.indisponible !== null && (
				<p className={s.avis} role="note">
					{choisi.manuel
						? `Tant que ${nom} manque, les sessions de ce profil se lancent par une ligne de commande à coller dans un terminal.`
						: `Tant que ${nom} manque, les sessions de ce profil sont refusées.`}{' '}
					État détaillé et commandes : Réglages › Branchements.
				</p>
			)}

			<div className={s.ligne}>
				<label className={s.libelle} htmlFor={`${id}-modele`}>
					Modèle
				</label>
				<input
					id={`${id}-modele`}
					className={s.champTexte}
					list={`${id}-modeles`}
					spellCheck={false}
					autoComplete="off"
					maxLength={MODELE_MAX}
					placeholder={`par défaut de ${nom}`}
					value={p.modele}
					aria-invalid={!modeleValide || undefined}
					aria-describedby={`${id}-aide-modele`}
					onChange={(e) => p.surModele(e.target.value.trim())}
				/>
				<datalist id={`${id}-modeles`}>
					{proposes.map((m) => (
						<option key={m} value={m} />
					))}
				</datalist>
				{p.modele !== '' && (
					<Bouton petit onClick={() => p.surModele('')}>
						Modèle par défaut
					</Bouton>
				)}
			</div>
			{proposes.length > 0 && (
				<div className={s.ligne} role="group" aria-label={`Modèles proposés par ${nom}`}>
					<span className={s.discret}>Proposés :</span>
					{proposes.map((m) => (
						<button key={m} type="button" className={s.pastilleChoix} aria-pressed={p.modele === m} onClick={() => p.surModele(m)}>
							{m}
						</button>
					))}
				</div>
			)}
			<p id={`${id}-aide-modele`} className={modeleValide ? s.discret : s.erreur}>
				{!modeleValide
					? `Nom refusé : lettres et chiffres ASCII et « . _ : / @ + [ ] - », ${MODELE_MAX} caractères au plus, commençant par une lettre ou un chiffre.`
					: chargement
						? `Vide : le modèle par défaut de ${nom}. Lecture des modèles proposés…`
						: proposes.length === 0
							? `Vide : le modèle par défaut de ${nom}. ${nom} ne propose pas de liste ici : saisie libre.`
							: `Vide : le modèle par défaut de ${nom}. Un autre nom peut être saisi.`}
			</p>
		</>
	);
}
