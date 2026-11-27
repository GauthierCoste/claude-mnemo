/**
 * Niveau des modèles pour une session, aligné à droite de « Injecté dans la session » : un texte nu à gauche de l'icône, sans
 * cadre. Ce qui est en cours, avec un reflet : l'activité de la session (« Recherche… », prioritaire), l'étape du calcul du
 * message (« reranker… », « affinage 10/30… »), l'affinage du classement. Au repos, atténué : l'état du classement
 * (« ordre seul », sa raison en info-bulle et dans le menu, avec « Entraîner la note » quand l'entraînement y remédie ;
 * « calibré » ; « injection coupée »). Un clic ouvre le menu : comme partout, complets, sens seul, coupés ; un niveau plus
 * large que celui de partout est désactivé, avec son motif. Rien tant que l'état des modèles n'est pas connu ou qu'ils ne sont pas
 * installés.
 */
import { libelleEtapeCalcul, NIVEAUX_MODELES, niveauEffectif, plusLarge, type NiveauModeles } from '@mnemo/commun';
import type { ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useEtapeSession, useModeles, useNiveauModelesSession } from '../../client/hooks.ts';
import { useTextes } from '../../langue/langue.tsx';
import { useNavigation } from '../../navigation.tsx';
import { cx } from '../commun/classes.ts';
import { useToast } from '../Toast.tsx';
import { IconeModeles } from './IconeModeles.tsx';
import { libelleActivite } from './libelles.ts';
import { GroupeMenu, ItemMenu, MenuModeles } from './MenuModeles.tsx';
import r from '../commun/Reflet.module.css';
import s from './Modeles.module.css';

/**
 * L'état du classement du dernier message, dit par le bouton : affinage en cours, ordre seul (sa raison ; null : notes
 * calibrées) ; `repos` : le texte au repos (« ordre seul », « calibré », « injection coupée ») ; `entrainer` : l'ordre seul
 * vient de la note (de départ, pas apprise, refusée), le menu propose de l'entraîner.
 */
export type EtatClassementSession = { affinage: boolean; ordreSeul: string | null; repos?: string; entrainer?: boolean };

export function ModelesSession(p: { session: string; niveau: NiveauModeles | null; classement?: EtatClassementSession }): ReactNode {
	const { etat: e } = useModeles(true);
	const etape = useEtapeSession(p.session);
	const changer = useNiveauModelesSession();
	const toast = useToast();
	const nav = useNavigation();
	const t = useTextes();
	const x = t.modeles.session;
	const noms = t.modeles.niveaux;
	if (e?.installes !== true) {
		// modèles inconnus ou non installés : pas de menu, mais l'état du classement reste dit
		const ordre = p.classement?.ordreSeul ?? null;
		if (p.classement?.affinage === true)
			return (
				<span className={s.etatSeul} title={x.titreAffinage}>
					<span className={r.reflet}>{x.affinage}</span>
				</span>
			);
		return ordre === null ? null : (
			<span className={s.etatSeul} title={ordre}>
				{x.ordreSeul}
			</span>
		);
	}
	const propre = p.niveau;
	const effectif = niveauEffectif(e.niveau, propre);
	const activite = e.activites.findLast((a) => a.session === p.session);
	const affinage = p.classement?.affinage === true;
	const ordreSeul = p.classement?.ordreSeul ?? null;
	// ce qui est en cours d'abord (en texte, point animé), puis l'état du classement, puis le niveau
	const enCours = activite !== undefined ? libelleActivite(activite, t) : etape !== null ? libelleEtapeCalcul(etape) : affinage ? x.affinage : null;
	const texte = enCours ?? p.classement?.repos ?? (ordreSeul !== null ? x.ordreSeul : x.textes[effectif]);
	const niveauDit = propre === null ? x.niveauCommePartout(noms[e.niveau]) : x.niveauPropre(noms[propre]);
	const titre = [niveauDit, ...(activite === undefined && affinage ? [x.titreAffinage] : []), ...(ordreSeul !== null ? [ordreSeul] : [])].join('\n');
	const choisir = (niveau: NiveauModeles | null) =>
		void changer(p.session, niveau).catch((erreur: unknown) => toast(erreur instanceof ErreurApi ? erreur.message : x.actionImpossible));
	return (
		<MenuModeles
			libelle={[niveauDit, ...(enCours !== null ? [enCours] : []), ...(ordreSeul !== null ? [x.ordreSeul] : [])].join(' – ')}
			titre={titre}
			classeBouton={cx(s.boutonSession, effectif === 'coupes' && s.eteint, propre !== null && s.propre)}
			alignement="droite"
			contenuBouton={
				<>
					{/* le texte à gauche de l'icône : il s'étend vers la gauche, l'icône ne bouge pas ; un reflet tant que c'est en cours */}
					{texte !== '' && <span className={cx(s.texte, enCours !== null && r.reflet)}>{texte}</span>}
					<span className={s.icone}>
						<IconeModeles coupes={effectif === 'coupes'} taille={13} />
						{enCours !== null && <span className={cx(s.point, s.actif)} aria-hidden="true" />}
					</span>
				</>
			}
			entete={
				<>
					<div className={s.entete}>{x.titre}</div>
					<dl className={s.etats}>
						<dt>{x.sens}</dt>
						<dd>{effectif === 'coupes' ? x.nonUtilise : x.utilise}</dd>
						<dt>{x.reclassement}</dt>
						<dd>{effectif === 'complets' ? x.utilise : x.nonUtilise}</dd>
						<dt>{x.enCours}</dt>
						<dd>{enCours === null ? x.rien : activite !== undefined || etape !== null ? enCours : x.affinageDuClassement}</dd>
						{ordreSeul !== null && (
							<>
								<dt>{x.classement}</dt>
								<dd>{x.ordreSeulSansPourcent}</dd>
							</>
						)}
					</dl>
					{ordreSeul !== null && <p className={s.note}>{ordreSeul}</p>}
				</>
			}
			pied={<p className={s.note}>{x.pied}</p>}
		>
			{(fermer) => (
				<>
					<div className={s.separateur} role="separator" />
					{ordreSeul !== null && p.classement?.entrainer === true && (
						<>
							<ItemMenu
								libelle={x.entrainer}
								detail={x.entrainerDetail}
								surChoix={() => {
									fermer();
									nav.ouvrirEntrainement();
								}}
							/>
							<div className={s.separateur} role="separator" />
						</>
					)}
					<GroupeMenu titre={x.groupe}>
						<ItemMenu
							coche={propre === null}
							libelle={x.commePartout(noms[e.niveau])}
							detail={x.commePartoutDetail}
							surChoix={() => {
								choisir(null);
								fermer();
							}}
						/>
						{NIVEAUX_MODELES.map((n) => {
							// plus large que le niveau de partout : il permettrait un modèle que la machine exclut
							const bloque = plusLarge(n, e.niveau);
							return (
								<ItemMenu
									key={n}
									coche={propre === n}
									libelle={noms[n]}
									detail={bloque ? x.indisponible(noms[e.niveau]) : t.modeles.detailsSession[n]}
									desactive={bloque}
									surChoix={() => {
										choisir(n);
										fermer();
									}}
								/>
							);
						})}
					</GroupeMenu>
				</>
			)}
		</MenuModeles>
	);
}
