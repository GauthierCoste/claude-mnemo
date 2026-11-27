/**
 * Bouton à état des modèles locaux (barre de titre, entre les quotas et l'Archiviste) : icône, point d'état et texte en direct
 * (« Modèles prêts », « Vectorisation 120/800 », « Recherche… »). Un clic ouvre le panneau : état de chaque pièce et activités
 * en cours (en-tête), puis le menu (niveau partout : complets, sens seul, coupés ; démarrer ou arrêter), puis le délai d'arrêt.
 * Absent tant que les modèles ne sont pas installés.
 */
import { NIVEAUX_MODELES, type NiveauModeles } from '@mnemo/commun';
import type { EtatModelesVue, ReponseArretModeles } from '@mnemo/contrat';
import type { ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useModeles, useReglages } from '../../client/hooks.ts';
import { useTextes } from '../../langue/langue.tsx';
import { TEXTES } from '../../langue/textes.ts';
import { aDemarrer } from '../../modeles/etat.ts';
import { useNavigation } from '../../navigation.tsx';
import { cx } from '../commun/classes.ts';
import { useToast } from '../Toast.tsx';
import { IconeModeles } from './IconeModeles.tsx';
import { libelleActivite, lignesPieces, resume } from './libelles.ts';
import { GroupeMenu, ItemMenu, MenuModeles } from './MenuModeles.tsx';
import r from '../commun/Reflet.module.css';
import s from './Modeles.module.css';

/** Arrêt qui a trouvé des modèles encore en chargement, en français : le texte des tests. */
export const ENCORE_EN_CHARGEMENT = TEXTES.fr.modeles.bouton.encoreEnChargement;

export function BoutonModeles(): ReactNode {
	const modeles = useModeles(true);
	const { sessionPremierPlan } = useNavigation();
	const toast = useToast();
	const t = useTextes();
	const b = t.modeles.bouton;
	const e = modeles.etat;
	if (e?.installes !== true) return null;
	const { texte, point } = resume(e, t);
	const coupes = e.niveau === 'coupes';
	const agir = (geste: () => Promise<void>) =>
		void geste().catch((erreur: unknown) => toast(erreur instanceof ErreurApi ? erreur.message : b.actionImpossible));
	/** Un arrêt qui a trouvé des modèles encore en chargement (geste « Arrêter », ou niveau qui en retire un) : le dire. */
	const direArret = (arret: ReponseArretModeles['arret'] | null) => {
		if (arret !== null && typeof arret === 'object') toast(b.encoreEnChargement);
	};
	const choisirNiveau = (n: NiveauModeles) => agir(async () => direArret(await modeles.changerNiveau(n)));
	return (
		<MenuModeles
			libelle={b.libelle(texte)}
			classeBouton={cx(s.bouton, coupes && s.eteint)}
			alignement="droite"
			contenuBouton={
				<>
					<span className={s.icone}>
						<IconeModeles coupes={coupes} />
						{point !== null && <span className={cx(s.point, s[point])} aria-hidden="true" />}
					</span>
					{/* une activité ou un chargement en cours : le même reflet que le bouton des modèles d'une session */}
					<span className={cx(s.texte, point === 'actif' && r.reflet)}>{texte}</span>
				</>
			}
			entete={<EtatPieces e={e} sessionAffichee={sessionPremierPlan} />}
			pied={<NoteInactivite minutes={e.inactiviteMinutes} />}
		>
			{(fermer) => (
				<>
					<div className={s.separateur} role="separator" />
					<GroupeMenu titre={b.partout}>
						{NIVEAUX_MODELES.map((n) => (
							<ItemMenu key={n} coche={e.niveau === n} libelle={t.modeles.niveaux[n]} detail={t.modeles.detailsNiveaux[n]} surChoix={() => choisirNiveau(n)} />
						))}
					</GroupeMenu>
					<div className={s.separateur} role="separator" />
					{aDemarrer(e) ? (
						<ItemMenu
							libelle={b.demarrer}
							desactive={coupes}
							detail={coupes ? b.coupesPartout : undefined}
							surChoix={() => {
								agir(modeles.demarrer);
								fermer();
							}}
						/>
					) : (
						<ItemMenu
							libelle={b.arreter}
							surChoix={() => {
								agir(async () => direArret(await modeles.arreter()));
								fermer();
							}}
						/>
					)}
				</>
			)}
		</MenuModeles>
	);
}

/** En-tête du panneau (hors du menu) : chaque pièce, puis les appels en cours, avec leur session et leur dossier. */
function EtatPieces(p: { e: EtatModelesVue; sessionAffichee: string | null }): ReactNode {
	const t = useTextes();
	return (
		<>
			<div className={s.entete}>{t.modeles.bouton.titre}</div>
			<ul className={s.pieces}>
				{lignesPieces(p.e, t).map((x) => (
					<li key={x.role} title={x.titre}>
						<span className={s.role}>{x.role}</span>
						<span className={s.etatPiece}>{x.etat}</span>
						{x.modele !== '' && <span className={s.modele}>{x.modele}</span>}
						{x.detail !== '' && <span className={s.detail}>{x.detail}</span>}
					</li>
				))}
			</ul>
			{p.e.activites.length > 0 && (
				<ul className={s.activites}>
					{p.e.activites.map((a, i) => (
						<li key={i}>
							<span className={cx(s.point, s.actif)} aria-hidden="true" />
							{libelleActivite(a, t)}
							{a.session !== null && a.session === p.sessionAffichee && <span className={s.detail}>{t.modeles.bouton.cetteSession}</span>}
							{!a.ceDossier && <span className={s.detail}>{t.modeles.bouton.autreDossier}</span>}
						</li>
					))}
				</ul>
			)}
		</>
	);
}

/**
 * Délai d'arrêt pour inactivité : celui du gardien en marche ; sinon celui des réglages du dossier (lu à l'ouverture du
 * panneau), qu'aura le prochain gardien lancé d'ici. Rien tant qu'aucun n'est connu.
 */
function NoteInactivite(p: { minutes: number | null }): ReactNode {
	return p.minutes !== null ? <TexteInactivite minutes={p.minutes} /> : <InactiviteDesReglages />;
}

function InactiviteDesReglages(): ReactNode {
	const reglages = useReglages();
	const champ = reglages.donnees?.champs.find((c) => c.cle === 'modeles.inactiviteMinutes');
	return typeof champ?.valeur === 'number' ? <TexteInactivite minutes={champ.valeur} /> : null;
}

function TexteInactivite(p: { minutes: number }): ReactNode {
	const t = useTextes();
	return <p className={s.note}>{t.modeles.bouton.inactivite(p.minutes)}</p>;
}
