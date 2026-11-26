/**
 * Onglet Réglages de la vue Réglages : les sections à gauche (Branchements, Mémoire, Système), la section choisie à droite.
 * Branchements : les moteurs et leur liaison à Mnemo, puis l'app Claude (sans réglage à enregistrer : chaque geste écrit tout
 * de suite). Mémoire (cartes Rappel et Confiance) et Système : les réglages du dossier (`ReglagesVue` : `.mnemo/reglages.json`,
 * et les règles de `SCHEMA.md`), enregistrés ensemble par un seul pied Annuler / Enregistrer, validés par le service (tout ou
 * rien). Les trois sections restent montées (cachées hors de la section choisie) : une saisie survit au changement de section.
 * Une pastille ambre sur Branchements quand un moteur attend un geste. Changer d'onglet ou quitter les Réglages avec une
 * saisie non enregistrée (réglages ou serveur MCP) est retenu : un avertissement propose de l'enregistrer, de l'abandonner ou
 * de rester.
 */
import type { ReglagesVue } from '@mnemo/contrat';
import { ROUTES } from '@mnemo/contrat';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { useMoteurs, useReglages } from '../../client/hooks.ts';
import { attendUnGeste } from '../../moteurs/circuit.ts';
import { useNavigation } from '../../navigation.tsx';
import { appliquerAccent } from '../../reglages/accent.ts';
import { enSaisie, enValeur, modifications, type Saisie } from '../../reglages/brouillon.ts';
import { CARTES_REGLAGES, champsNonDisposes, sectionDuChamp } from '../../reglages/disposition.ts';
import { oublierSectionDemandee, sectionDemandeeALire, type SectionReglages } from '../../reglages/onglet-retenu.ts';
import { Bouton } from '../commun/Bouton.tsx';
import { CarteReglages, type Saisies } from './CarteReglages.tsx';
import { AppClaude } from './claude-desktop/AppClaude.tsx';
import { EtatService } from './EtatService.tsx';
import { Moteurs } from './moteurs/Moteurs.tsx';
import c from './Cartes.module.css';
import d from './profils/Profils.module.css';
import r from './Reglages.module.css';

const SECTIONS: readonly { cle: SectionReglages; titre: string; sous: string }[] = [
	{ cle: 'branchements', titre: 'Branchements', sous: 'moteurs et app Claude' },
	{ cle: 'memoire', titre: 'Mémoire', sous: 'rappel et confiance' },
	{ cle: 'systeme', titre: 'Système', sous: 'service, modèles, couleur' },
];

const saisiesDe = (vue: ReglagesVue | undefined): Record<string, Saisie> => Object.fromEntries((vue?.champs ?? []).map((x) => [x.cle, enSaisie(x, x.valeur)]));

/** `surModifie` : prévenu quand une saisie diffère (ou plus) de ce qui est enregistré (changement d'onglet retenu). */
export function OngletReglages(p: { surModifie(modifie: boolean): void }): ReactNode {
	const { api } = useClient();
	const ressource = useReglages();
	const [enregistree, setEnregistree] = useState<ReglagesVue | null>(null);
	const vue = enregistree ?? ressource.donnees;
	// « Voir dans Réglages » d'une autre vue : la section demandée ouverte d'emblée
	const [section, setSection] = useState<SectionReglages>(() => sectionDemandeeALire() ?? 'branchements');
	useEffect(() => oublierSectionDemandee(), []);
	const geste = useMoteurs(true).donnees?.moteurs.some(attendUnGeste) ?? false;

	const [saisies, setSaisies] = useState(() => saisiesDe(vue));
	// réglages lus, relus ou enregistrés : la saisie repart de ce que le service a gardé
	const [base, setBase] = useState(vue);
	if (base !== vue) {
		setBase(vue);
		setSaisies(saisiesDe(vue));
	}
	const [envoi, setEnvoi] = useState(false);
	const [erreur, setErreur] = useState<string | null>(null);
	const [serveurModifie, setServeurModifie] = useState(false);
	const aEnvoyer = vue === undefined ? {} : modifications(vue.champs, saisies);
	const reglagesModifies = Object.keys(aEnvoyer).length > 0;
	const modifie = reglagesModifies || serveurModifie;

	// modifications non enregistrées : changer d'onglet ou quitter les Réglages est retenu
	const nav = useNavigation();
	const modifieCourant = useRef(modifie);
	modifieCourant.current = modifie;
	const { surModifie } = p;
	useEffect(() => surModifie(modifie), [surModifie, modifie]);
	const { definirGardeSortie } = nav;
	useEffect(() => {
		definirGardeSortie(() => modifieCourant.current);
		return () => definirGardeSortie(null);
	}, [definirGardeSortie]);
	// sortie retenue pour un serveur MCP en cours de saisie : sa section est montrée, avec son avertissement
	useEffect(() => {
		if (nav.sortieRetenue && serveurModifie && !reglagesModifies) setSection('branchements');
	}, [nav.sortieRetenue, serveurModifie, reglagesModifies]);

	// la couleur principale choisie s'applique tout de suite (aperçu) ; sans enregistrement, la page retrouve celle du service
	const accentSaisi = saisies['interface.accent'];
	const accentEnregistre = vue?.champs.find((x) => x.cle === 'interface.accent')?.valeur;
	useEffect(() => {
		if (accentEnregistre === undefined) return;
		appliquerAccent(document.documentElement, typeof accentSaisi === 'string' ? accentSaisi : accentEnregistre);
		return () => appliquerAccent(document.documentElement, accentEnregistre);
	}, [accentSaisi, accentEnregistre]);

	const enregistrer = async (): Promise<boolean> => {
		setEnvoi(true);
		setErreur(null);
		try {
			setEnregistree(await api.remplacer<ReglagesVue>(ROUTES.reglages, { valeurs: aEnvoyer }));
			// le cache des réglages suit : la couleur principale ne dépend pas d'une relecture tardive
			ressource.recharger();
			return true;
		} catch (e) {
			setErreur(e instanceof ErreurApi ? e.message : 'Enregistrement impossible.');
			return false;
		} finally {
			setEnvoi(false);
		}
	};
	const enregistrerPuisPartir = async () => {
		if (await enregistrer()) nav.poursuivreSortie();
		else nav.annulerSortie();
	};

	const surSaisie = useCallback((cle: string, v: Saisie) => setSaisies((x) => ({ ...x, [cle]: v })), []);
	const s: Saisies = {
		champs: vue?.champs ?? [],
		saisies,
		surSaisie,
		valeurDe: (cle) => {
			const champ = vue?.champs.find((x) => x.cle === cle);
			const saisie = saisies[cle];
			if (champ === undefined || saisie === undefined) return undefined;
			const v = enValeur(champ, saisie);
			return typeof v === 'number' ? v : undefined;
		},
	};
	const marque = (cle: SectionReglages): ReactNode => {
		if (cle === 'branchements') return geste ? <span className={r.pastille} title="Un moteur attend un geste" /> : null;
		return Object.keys(aEnvoyer).some((x) => sectionDuChamp(x) === cle) ? <span className={d.badge}>modifié</span> : null;
	};
	const libelles = (cles: string[]) => cles.map((cle) => vue?.champs.find((x) => x.cle === cle)?.libelle ?? cle).join(', ');
	const chargement = <p className={vue === undefined && ressource.erreur !== null ? c.erreur : c.discret}>{ressource.erreur ?? 'Chargement des réglages…'}</p>;
	const port = vue?.champs.find((x) => x.cle === 'service.port')?.valeur;

	return (
		<div className={d.page}>
			<nav className={d.liste} aria-label="Sections des réglages">
				<ul className={d.profils}>
					{SECTIONS.map((x) => (
						<li key={x.cle}>
							<button type="button" className={d.ligneProfil} aria-current={x.cle === section ? 'true' : undefined} onClick={() => setSection(x.cle)}>
								<span className={d.identite}>
									<span className={d.nomProfil}>
										{x.titre}
										{marque(x.cle)}
									</span>
									<span className={d.description}>{x.sous}</span>
								</span>
							</button>
						</li>
					))}
				</ul>
				<p className={d.discret}>
					Dans <code>.mnemo/reglages.json</code> ; la confiance dans <code>SCHEMA.md</code> (un commit). Raccourci : <kbd>⌥,</kbd>
				</p>
			</nav>
			<div className={c.contenu}>
				{vue !== undefined && vue.avertissements.length > 0 && (
					<ul className={c.avis} aria-label="Avertissements">
						{vue.avertissements.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				)}
				{vue !== undefined && vue.enAttente.length > 0 && (
					<p className={c.avis} role="status">
						Redémarrage du service requis pour : {libelles(vue.enAttente)} — « mnemo arreter » puis « mnemo ouvrir ».
					</p>
				)}
				<div className={c.seule} hidden={section !== 'branchements'}>
					<section className={c.carte} aria-labelledby="titre-branchements">
						<h2 id="titre-branchements" className={c.titreCarte}>
							Branchements
						</h2>
						<p className={c.sous}>Les moteurs de tes agents, et ce que l’app Claude peut utiliser.</p>
						<Moteurs />
						<AppClaude surModifie={setServeurModifie} />
					</section>
				</div>
				<div className={c.duo} hidden={section !== 'memoire'}>
					{vue === undefined
						? chargement
						: CARTES_REGLAGES.memoire.map((carte) => <CarteReglages key={carte.cle} carte={carte} s={s} {...(carte.cle === 'rappel' ? { enPlus: champsNonDisposes(vue.champs) } : {})} />)}
				</div>
				<div className={c.seule} hidden={section !== 'systeme'}>
					{vue === undefined
						? chargement
						: CARTES_REGLAGES.systeme.map((carte) => (
								<CarteReglages
									key={carte.cle}
									carte={carte}
									s={s}
									etatService={<EtatService port={port === undefined ? undefined : String(port)} portEnAttente={vue.enAttente.includes('service.port')} />}
								/>
							))}
				</div>
				{(section !== 'branchements' || reglagesModifies || erreur !== null) && (
					<footer className={c.pied}>
						{nav.sortieRetenue && reglagesModifies && (
							<div className={c.avis} role="alert">
								<p>Modifications non enregistrées : les enregistrer avant de quitter les Réglages ?</p>
								<div className={c.actions}>
									<Bouton genre="primaire" disabled={envoi} onClick={() => void enregistrerPuisPartir()}>
										Enregistrer
									</Bouton>
									<Bouton disabled={envoi} onClick={nav.poursuivreSortie}>
										Abandonner
									</Bouton>
									<Bouton disabled={envoi} onClick={nav.annulerSortie}>
										Rester
									</Bouton>
								</div>
							</div>
						)}
						{erreur !== null && (
							<p className={c.erreur} role="alert">
								{erreur}
							</p>
						)}
						<div className={c.actions}>
							{reglagesModifies ? (
								<p className={c.etat}>Modifié, non enregistré</p>
							) : (
								enregistree !== null && (
									<p className={c.statut} role="status">
										Enregistré.
									</p>
								)
							)}
							<Bouton disabled={!reglagesModifies || envoi} onClick={() => setSaisies(saisiesDe(vue))}>
								Annuler
							</Bouton>
							<Bouton genre="primaire" disabled={!reglagesModifies || envoi} onClick={() => void enregistrer()}>
								Enregistrer
							</Bouton>
						</div>
					</footer>
				)}
			</div>
		</div>
	);
}
