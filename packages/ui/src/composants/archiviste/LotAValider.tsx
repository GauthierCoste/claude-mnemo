import { avertissementsDe, type AvecAvertissements } from '@mnemo/commun';
import { ROUTES, type DemandeValidationLot, type GenreLotVue, type InformationDuLotVue, type LigneDeLotVue, type LotVue, type ReponseRejetLot, type ReponseValidationLot } from '@mnemo/contrat';
import { useId, useState, type ReactNode } from 'react';
import { compteEnMots, compteLot, etiquetteLot, intituleLot, lireInformation, resumeChangement, titreDuLot } from '../../archiviste/lots.ts';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { avecId, useGraphe } from '../../client/hooks.ts';
import { rendreEnLigne } from '../../memoire/rendu-fiche.tsx';
import { resoudreLien } from '../../memoire/resoudre-lien.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { cx } from '../commun/classes.ts';
import { Puce } from '../commun/Puce.tsx';
import { useAnnonceEcriture } from '../commun/annonce-ecriture.ts';
import { useNavigationMemoire } from '../memoire/navigation-memoire.tsx';
import { useToast } from '../Toast.tsx';
import s from './Propositions.module.css';

/** Refus 409 de `lotValider` : une information visée a changé depuis la proposition, le service a écarté le lot. */
export const FICHE_CHANGEE = 'Une information visée a changé depuis la proposition : lot écarté, demander à l’archiviste de le reproposer.';
/** Note d'un lot périmé, encore en attente : rien ne le repropose seul. */
export const LOT_PERIME = 'Une information visée a changé depuis la proposition : rejeter ce lot, puis demander à l’archiviste de le reproposer.';

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n === 1 ? un : plusieurs}`;

/**
 * Un lot d'informations proposé par l'archiviste, dans « À arbitrer » : intitulé (« 3 doublons proposés dans Module
 * stocks »), motif, puis **Tout valider**, **Revoir** (déplie les lignes cochables, une par information, avec ce qui
 * change) et **Rejeter**. Valider envoie les indices des lignes cochées (toutes pour « Tout valider ») ; le service applique
 * en un commit. Un lot tranché reste grisé jusqu'à la relecture des lots (`surDecide`, puis message `lots`), qui le fait
 * disparaître. Un lot reproposé est un autre composant (clé : id et date de proposition) : ses cases repartent cochées.
 */
export function LotAValider(p: { lot: LotVue; surDecide(): void }): ReactNode {
	const { lot } = p;
	const { api } = useClient();
	const toast = useToast();
	const annoncer = useAnnonceEcriture();
	const idLignes = useId();
	const [revoir, setRevoir] = useState(false);
	const [decoches, setDecoches] = useState<ReadonlySet<number>>(() => new Set());
	const [enCours, setEnCours] = useState(false);
	/** Le lot tranché, tel qu'affiché au moment du choix : grisé tant que c'est lui qui est affiché. */
	const [tranche, setTranche] = useState<LotVue | null>(null);
	const occupe = enCours || tranche === lot;
	const cochees = lot.lignes.map((l) => l.indice).filter((i) => !decoches.has(i));
	const intitule = intituleLot(lot);

	/** `action` rend le succès à annoncer et les avertissements de la réponse. */
	async function decider(action: () => Promise<{ succes: string; avertissements: AvecAvertissements }>): Promise<void> {
		setEnCours(true);
		try {
			const { succes, avertissements } = await action();
			setTranche(lot);
			annoncer(succes, avertissements);
		} catch (e) {
			if (e instanceof ErreurApi && e.statut === 409) toast(FICHE_CHANGEE);
			else toast(e instanceof Error ? e.message : 'Écriture impossible.');
		} finally {
			setEnCours(false);
		}
		// le service diffuse `lots` après chaque décision ; relire aussi d'ici (lot écarté sur 409, déjà décidé sur 404)
		p.surDecide();
	}

	const valider = (lignes: number[]) =>
		decider(async () => {
			const r = await api.envoyer<ReponseValidationLot>(avecId(ROUTES.lotValider, lot.id), { lignes } satisfies DemandeValidationLot);
			return { succes: `Lot validé : ${pluriel(r.lignes.length, 'ligne appliquée', 'lignes appliquées')}`, avertissements: avertissementsDe(r) };
		});

	const rejeter = () =>
		decider(async () => {
			await api.envoyer<ReponseRejetLot>(avecId(ROUTES.lotRejeter, lot.id), {});
			return { succes: 'Lot rejeté', avertissements: {} };
		});

	const basculer = (indice: number, coche: boolean) =>
		setDecoches((x) => {
			const suivant = new Set(x);
			if (coche) suivant.delete(indice);
			else suivant.add(indice);
			return suivant;
		});

	return (
		<article className={cx(s.proposition, occupe && s.off)} aria-busy={occupe} aria-label={intitule}>
			<span className={cx(s.genre, s.lot)}>
				{etiquetteLot(lot.genre)} | {titreDuLot(lot)}
			</span>
			<span className={s.texte}>{intitule}</span>
			<span className={s.detail}>{lot.motif}</span>
			{lot.perime && (
				<span className={s.detail} role="note">
					{LOT_PERIME}
				</span>
			)}
			<div className={s.actions}>
				<Bouton petit genre="primaire" onClick={() => void valider(lot.lignes.map((l) => l.indice))} disabled={occupe || lot.perime}>
					Tout valider
				</Bouton>
				<Bouton petit onClick={() => setRevoir((x) => !x)} aria-expanded={revoir} aria-controls={idLignes}>
					{revoir ? 'Replier' : 'Revoir'}
				</Bouton>
				<Bouton petit onClick={() => void rejeter()} disabled={occupe}>
					Rejeter
				</Bouton>
			</div>
			{revoir && (
				<form
					id={idLignes}
					className={s.revue}
					onSubmit={(e) => {
						e.preventDefault();
						void valider(cochees);
					}}
				>
					<LignesDuLot lot={lot} decoches={decoches} desactive={occupe || lot.perime} surCocher={basculer} />
					<div className={s.actions}>
						<Bouton petit genre="primaire" type="submit" disabled={occupe || lot.perime || cochees.length === 0}>
							{`Valider ${compteEnMots(lot.genre, compteLot(lot, cochees))}`}
						</Bouton>
					</div>
				</form>
			)}
		</article>
	);
}

/** Rôle d'une information visée par une ligne, pour « Détail » : la gardée puis les absorbées d'une fusion ; la visée sinon. */
function role(genre: GenreLotVue, i: number): string {
	if (genre === 'fusionner') return i === 0 ? 'gardée' : 'absorbée';
	return genre === 'supprimer' ? 'supprimée' : 'à confirmer';
}

/** Lignes écrites d'une information, telles quelles (« Détail »). */
function Ecrit(p: { info: InformationDuLotVue; role: string }): ReactNode {
	return (
		<div className={s.information}>
			<span className={s.role}>{p.role}</span>
			{p.info.lignes.length === 0 ? (
				<span className={s.brut}>{p.info.ancre} : absente de la fiche</span>
			) : (
				p.info.lignes.map((x, i) => (
					<span key={i} className={s.brut}>
						{x}
					</span>
				))
			)}
		</div>
	);
}

/**
 * Les lignes du lot dans « Revoir », compactes : une par information (case, catégorie, énoncé avec ses liens), puis ce qui
 * change en une ou deux lignes courtes ; les lignes écrites, avant et après, sous « Détail ». Les liens `[[…]]` sont
 * résolus sur le graphe (lu seulement quand « Revoir » est ouvert).
 */
function LignesDuLot(p: { lot: LotVue; decoches: ReadonlySet<number>; desactive: boolean; surCocher(indice: number, coche: boolean): void }): ReactNode {
	const graphe = useGraphe();
	const memoire = useNavigationMemoire();
	const fiches = graphe.donnees?.fiches ?? [];
	const enLigne = (texte: string) => rendreEnLigne(texte, (ecrit) => resoudreLien(ecrit, fiches), memoire.ouvrirFiche);
	return (
		<fieldset className={s.lignes}>
			<legend className={s.legende}>Lignes à appliquer</legend>
			{p.lot.lignes.map((l) => (
				<LigneDuLot key={l.indice} ligne={l} genre={p.lot.genre} cochee={!p.decoches.has(l.indice)} desactive={p.desactive} surCocher={(c) => p.surCocher(l.indice, c)} enLigne={enLigne} />
			))}
		</fieldset>
	);
}

function LigneDuLot(p: { ligne: LigneDeLotVue; genre: GenreLotVue; cochee: boolean; desactive: boolean; surCocher(coche: boolean): void; enLigne(texte: string): ReactNode[] }): ReactNode {
	const { ligne } = p;
	const idTexte = useId();
	const visee = ligne.avant[0] ? lireInformation(ligne.avant[0]) : null;
	const texte = visee?.texte ?? `${ligne.avant[0]?.ancre ?? `Ligne ${ligne.indice + 1}`} (absente)`;
	return (
		<div className={s.ligne}>
			<div className={s.case}>
				<input type="checkbox" checked={p.cochee} disabled={p.desactive} aria-labelledby={idTexte} onChange={(e) => p.surCocher(e.target.checked)} />
				<span className={s.enonce}>
					{visee?.categorie != null && (
						<Puce className={s.categorie}>
							<bdi>{visee.categorie}</bdi>
						</Puce>
					)}
					<span id={idTexte}>{visee?.barre ? <s>{p.enLigne(texte)}</s> : p.enLigne(texte)}</span>
				</span>
			</div>
			{resumeChangement(ligne, p.genre).map((x, i) => (
				<span key={i} className={s.changement}>
					{p.enLigne(x)}
				</span>
			))}
			{ligne.motif !== null && (
				<span className={s.changement} role="note">
					{ligne.motif}
				</span>
			)}
			<details className={s.ecrit}>
				<summary>Détail</summary>
				<span className={s.etape}>Avant</span>
				{ligne.avant.map((info, i) => (
					<Ecrit key={info.ancre} info={info} role={role(p.genre, i)} />
				))}
				<span className={s.etape}>Après</span>
				{ligne.apres ? <Ecrit info={ligne.apres} role={p.genre === 'fusionner' ? 'gardée' : 'confirmée'} /> : <span className={s.role}>Information retirée de la fiche.</span>}
			</details>
		</div>
	);
}
