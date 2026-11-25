/**
 * Bouton à état des modèles locaux (barre de titre, entre les quotas et l'Archiviste) : icône, point d'état et texte en direct
 * (« Modèles prêts », « Vectorisation 120/800 », « Recherche… »). Un clic ouvre le menu : état de chaque pièce, activités en
 * cours, niveau partout (complets, sens seul, coupés), démarrer ou arrêter. Absent tant que les modèles ne sont pas installés.
 */
import { NIVEAUX_MODELES, type NiveauModeles } from '@mnemo/commun';
import type { ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useModeles, useReglages } from '../../client/hooks.ts';
import { useNavigation } from '../../navigation.tsx';
import { cx } from '../commun/classes.ts';
import { useToast } from '../Toast.tsx';
import { IconeModeles } from './IconeModeles.tsx';
import { DETAILS_NIVEAUX, NOMS_NIVEAUX, libelleActivite, lignesPieces, resume } from './libelles.ts';
import { ChoixMenu, MenuModeles } from './MenuModeles.tsx';
import s from './Modeles.module.css';

export const ENCORE_EN_CHARGEMENT = 'Des modèles chargent encore : réessayez dans un instant.';
const COUPES_PARTOUT = 'Les modèles sont coupés partout';

export function BoutonModeles(): ReactNode {
	const modeles = useModeles(true);
	const { sessionPremierPlan } = useNavigation();
	const toast = useToast();
	const e = modeles.etat;
	if (e?.installes !== true) return null;
	const { texte, point } = resume(e);
	const coupes = e.niveau === 'coupes';
	const agir = (geste: () => Promise<void>) =>
		void geste().catch((erreur: unknown) => toast(erreur instanceof ErreurApi ? erreur.message : 'Action impossible.'));
	const choisirNiveau = (n: NiveauModeles) => agir(() => modeles.changerNiveau(n));
	return (
		<MenuModeles
			libelle={`Modèles locaux : ${texte}`}
			classeBouton={cx(s.bouton, coupes && s.eteint)}
			alignement="droite"
			contenuBouton={
				<>
					<span className={s.icone}>
						<IconeModeles coupes={coupes} />
						{point !== null && <span className={cx(s.point, s[point])} aria-hidden="true" />}
					</span>
					<span className={s.texte}>{texte}</span>
				</>
			}
		>
			{(fermer) => (
				<>
					<div className={s.entete}>Modèles locaux</div>
					<ul className={s.pieces}>
						{lignesPieces(e).map((x) => (
							<li key={x.role} title={x.titre}>
								<span className={s.role}>{x.role}</span>
								<span className={s.etatPiece}>{x.etat}</span>
								{x.modele !== '' && <span className={s.modele}>{x.modele}</span>}
								{x.detail !== '' && <span className={s.detail}>{x.detail}</span>}
							</li>
						))}
					</ul>
					{e.activites.length > 0 && (
						<ul className={s.activites}>
							{e.activites.map((a, i) => (
								<li key={i}>
									<span className={cx(s.point, s.actif)} aria-hidden="true" />
									{libelleActivite(a)}
									{a.session !== null && a.session === sessionPremierPlan && <span className={s.detail}> – cette session</span>}
									{!a.ceDossier && <span className={s.detail}> – autre dossier</span>}
								</li>
							))}
						</ul>
					)}
					<div className={s.separateur} role="separator" />
					<div className={s.sousTitre}>Partout</div>
					{NIVEAUX_MODELES.map((n) => (
						<ChoixMenu key={n} coche={e.niveau === n} libelle={NOMS_NIVEAUX[n]} detail={DETAILS_NIVEAUX[n]} surChoix={() => choisirNiveau(n)} />
					))}
					<div className={s.separateur} role="separator" />
					{e.gardien === 'arrete' || e.gardien === 'echec' ? (
						<button
							type="button"
							role="menuitem"
							className={s.item}
							disabled={coupes}
							onClick={() => {
								agir(modeles.demarrer);
								fermer();
							}}
						>
							<span className={s.coche} />
							<span className={s.texteItem}>
								<span>Démarrer maintenant</span>
								{coupes && <span className={s.detail}>{COUPES_PARTOUT}</span>}
							</span>
						</button>
					) : (
						<button
							type="button"
							role="menuitem"
							className={s.item}
							onClick={() => {
								agir(async () => {
									const arret = await modeles.arreter();
									if (typeof arret === 'object') toast(ENCORE_EN_CHARGEMENT);
								});
								fermer();
							}}
						>
							<span className={s.coche} />
							Arrêter maintenant
						</button>
					)}
					<NoteInactivite />
				</>
			)}
		</MenuModeles>
	);
}

/** Délai d'arrêt pour inactivité : celui des réglages du dossier, lu à l'ouverture du menu (15 min en attendant). */
function NoteInactivite(): ReactNode {
	const reglages = useReglages();
	const champ = reglages.donnees?.champs.find((c) => c.cle === 'modeles.inactiviteMinutes');
	const minutes = typeof champ?.valeur === 'number' ? champ.valeur : 15;
	return <p className={s.note}>Ils démarrent au besoin et s’arrêtent seuls après {minutes} min sans requête.</p>;
}
