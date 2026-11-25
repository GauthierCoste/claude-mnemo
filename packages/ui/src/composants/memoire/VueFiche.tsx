/**
 * Fiche ouverte dans Mémoire › Fichiers : fil d'Ariane, « Édition », « Voir dans le graphe »,
 * « Déplacer », titre, propriétés, corps rendu ; en édition, le Markdown brut (`textarea.raw`) enregistré par `brut`
 * avec l'empreinte lue à l'ouverture de l'édition.
 *
 * Une fiche que Mnemo ne suggère plus jamais (« Ne plus jamais suggérer ») le dit en tête, avec « Rétablir ».
 *
 * Conflits : un enregistrement sur une version dépassée est refusé (409) et le texte saisi reste dans la zone jusqu'à
 * « Recharger » ; un message `memoire` pendant l'édition recharge la fiche sans toucher la zone, et un avis le dit si
 * la fiche a changé sur le disque. Hors édition, la fiche se recharge en silence (`useFiche`).
 *
 * Modifications non enregistrées (texte ≠ brut lu) : quitter la fiche (garde de `FournisseurMemoire`), couper « Édition »
 * ou « Déplacer » passe par l'avis « Modifications non enregistrées » (Enregistrer, Abandonner, Rester) ; fermer l'onglet
 * passe par `beforeunload`.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { useEcarteesToujours } from '../../client/hooks.ts';
import type { Ressource } from '../../client/ressources.ts';
import { ROUTES, type FicheVue, type ResultatEcriture } from '@mnemo/contrat';
import { CorpsFiche } from '../../memoire/rendu-fiche.tsx';
import { Bascule } from '../commun/Bascule.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { useToast } from '../Toast.tsx';
import { useAnnonceEcriture } from '../commun/annonce-ecriture.ts';
import { useNavigationMemoire } from './navigation-memoire.tsx';
import s from './VueFiche.module.css';
import { avertissementsDe } from '@mnemo/commun';

type Avis = { genre: 'conflit' } | { genre: 'refus'; motif: string };
/** Rechargement demandé par « Recharger » : la zone prend la fiche relue, une fois la lecture finie. */
type Relecture = 'aucune' | 'demandee' | 'en_cours';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** « 25.11.2026 », heure locale. */
function dateCourte(ms: number): string {
	const d = new Date(ms);
	return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** `updated: 2026-11-21` s'affiche « modifié 21.11.2026 » ; les autres propriétés telles quelles. */
function propriete(cle: string, valeur: string): [string, string] {
	if (cle !== 'updated') return [cle, valeur];
	const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur.trim());
	return ['modifié', date ? `${date[3]}.${date[2]}.${date[1]}` : valeur];
}

export function VueFiche(p: { chemin: string; fiche: Ressource<FicheVue>; editionInitiale?: boolean }): ReactNode {
	const { api } = useClient();
	const toast = useToast();
	const annoncer = useAnnonceEcriture();
	const memoire = useNavigationMemoire();
	const { chemin, fiche } = p;
	const donnees = fiche.donnees;
	// Relecture en 404 alors que la fiche était lue : supprimée ou déplacée ailleurs. Une autre erreur (service injoignable…)
	// ne dit rien de la fiche : elle est seulement signalée.
	const disparue = fiche.erreur !== null && donnees !== undefined && fiche.statut === 404;
	const relectureEnEchec = fiche.erreur !== null && donnees !== undefined && !disparue;

	const [edition, setEdition] = useState(p.editionInitiale ?? false);
	const [texte, setTexte] = useState('');
	const [brutLu, setBrutLu] = useState('');
	const [quitter, setQuitter] = useState<{ suite: () => void } | null>(null);
	const [empreinteLue, setEmpreinteLue] = useState<string | null>(null);
	const [avis, setAvis] = useState<Avis | null>(null);
	const [enregistrement, setEnregistrement] = useState(false);
	const [relecture, setRelecture] = useState<Relecture>('aucune');
	const [dossier, setDossier] = useState<string | null>(null);
	const [refusDeplacement, setRefusDeplacement] = useState<string | null>(null);
	const toujours = useEcarteesToujours();
	const ecarteeToujours = toujours.liste.find((e) => e.chemin === chemin) ?? null;
	const retablirSuggestions = async () => {
		try {
			await toujours.retablir(chemin);
			annoncer('Mnemo peut de nouveau suggérer cette fiche');
		} catch (e) {
			toast(message(e));
		}
	};

	const adopter = (f: FicheVue) => {
		setTexte(f.brut);
		setBrutLu(f.brut);
		setEmpreinteLue(f.empreinte);
		setAvis(null);
	};

	const modifie = edition && empreinteLue !== null && texte !== brutLu;
	const modifieCourant = useRef(modifie);
	modifieCourant.current = modifie;

	// Garde : une autre fiche demandée pendant une édition modifiée attend la décision de l'utilisateur.
	const { poserGarde } = memoire;
	useEffect(
		() =>
			poserGarde((suite) => {
				if (!modifieCourant.current) return false;
				setQuitter({ suite });
				return true;
			}),
		[poserGarde],
	);

	// Fermer l'onglet avec des modifications : le navigateur demande confirmation.
	useEffect(() => {
		if (!modifie) return;
		const retenir = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			e.returnValue = '';
		};
		window.addEventListener('beforeunload', retenir);
		return () => window.removeEventListener('beforeunload', retenir);
	}, [modifie]);

	// Édition ouverte avant que la fiche soit lue (mode démo `&edition=1`) : la zone la prend dès qu'elle arrive.
	useEffect(() => {
		if (edition && empreinteLue === null && donnees) adopter(donnees);
	}, [edition, empreinteLue, donnees]);

	// « Recharger » après un 409 : attendre la fin de la nouvelle lecture avant de remplacer le texte saisi.
	useEffect(() => {
		if (relecture === 'demandee' && fiche.chargement) setRelecture('en_cours');
		else if (relecture === 'en_cours' && !fiche.chargement) {
			setRelecture('aucune');
			if (donnees && fiche.erreur === null) adopter(donnees);
		}
	}, [relecture, fiche.chargement, fiche.erreur, donnees]);

	const quitterEdition = () => {
		modifieCourant.current = false;
		setEdition(false);
		setEmpreinteLue(null);
		setAvis(null);
		setRelecture('aucune');
	};

	const basculerEdition = (actif: boolean) => {
		if (!actif && modifieCourant.current) {
			setQuitter({ suite: () => {} });
			return;
		}
		setEdition(actif);
		setAvis(null);
		setRelecture('aucune');
		if (actif && donnees) adopter(donnees);
		else setEmpreinteLue(null);
	};

	const recharger = () => {
		// La fiche déjà relue (message `memoire`) est prise tout de suite ; sinon elle est relue d'abord.
		if (donnees && donnees.empreinte !== empreinteLue) adopter(donnees);
		else {
			setRelecture('demandee');
			fiche.recharger();
		}
	};

	/** Vrai si la fiche est enregistrée. */
	const enregistrer = async (): Promise<boolean> => {
		if (empreinteLue === null || disparue) return false;
		setEnregistrement(true);
		setAvis(null);
		try {
			const r = await api.envoyer<ResultatEcriture>(ROUTES.brut, { chemin, texte, empreinte: empreinteLue });
			modifieCourant.current = false;
			setEdition(false);
			setEmpreinteLue(null);
			annoncer('Fiche enregistrée', avertissementsDe(r));
			fiche.recharger();
			return true;
		} catch (e) {
			setAvis(e instanceof ErreurApi && e.statut === 409 ? { genre: 'conflit' } : { genre: 'refus', motif: message(e) });
			return false;
		} finally {
			setEnregistrement(false);
		}
	};

	/** Le champ s'ouvre sur le dossier actuel de la fiche. */
	const basculerDeplacement = () => {
		setDossier((d) => (d === null ? chemin.split('/').slice(0, -1).join('/') : null));
		setRefusDeplacement(null);
	};

	const deplacer = (e: FormEvent) => {
		e.preventDefault();
		if (dossier === null) return;
		const vers = dossier.trim().replace(/^\/+|\/+$/g, '');
		if (modifieCourant.current) setQuitter({ suite: () => void deplacerVers(vers) });
		else void deplacerVers(vers);
	};

	const deplacerVers = async (vers: string) => {
		const nom = chemin.split('/').pop() ?? chemin;
		setRefusDeplacement(null);
		try {
			const r = await api.envoyer<ResultatEcriture | null>(ROUTES.deplacer, { id: chemin, dossier: vers });
			setDossier(null);
			annoncer(vers ? `Fiche déplacée dans ${vers}` : 'Fiche déplacée à la racine', ...(r === null ? [] : [avertissementsDe(r)]));
			// le chemin rendu par le service fait foi ; à défaut, la même règle que lui (`<dossier>/<nom>`)
			memoire.ouvrirFiche(r !== null && 'fiche' in r ? r.fiche : vers ? `${vers}/${nom}` : nom);
		} catch (err) {
			setRefusDeplacement(message(err));
		}
	};

	const decider = {
		rester: () => setQuitter(null),
		abandonner: () => {
			const suite = quitter?.suite;
			setQuitter(null);
			quitterEdition();
			suite?.();
		},
		enregistrer: async () => {
			const suite = quitter?.suite;
			setQuitter(null);
			if (await enregistrer()) suite?.();
		},
	};

	const changeeSurLeDisque =
		edition && donnees !== undefined && empreinteLue !== null && donnees.empreinte !== empreinteLue && relecture === 'aucune' && avis?.genre !== 'conflit';
	const alertes: ReactNode[] = [];
	if (disparue)
		alertes.push(
			<div key="disparue" role="alert" className={s.avis}>
				<span>
					Cette fiche n'existe plus à cet endroit ({fiche.erreur}).{edition ? ' Ton texte reste dans la zone ; copie-le avant de quitter.' : ''}
				</span>
			</div>,
		);
	if (relectureEnEchec)
		alertes.push(
			<div key="relecture" role="alert" className={s.avis}>
				<span>Relecture de la fiche impossible ({fiche.erreur}). La version affichée est peut-être dépassée.</span>
			</div>,
		);
	if (avis?.genre === 'conflit')
		alertes.push(
			<div key="conflit" role="alert" className={s.avis}>
				<span>La fiche a changé depuis l'ouverture. Ton texte reste dans la zone : recharge pour repartir de la version du disque.</span>
				<Bouton petit onClick={recharger}>
					Recharger
				</Bouton>
			</div>,
		);
	if (avis?.genre === 'refus')
		alertes.push(
			<div key="refus" role="alert" className={s.avis}>
				<span>Enregistrement refusé : {avis.motif}</span>
			</div>,
		);
	if (ecarteeToujours !== null)
		alertes.push(
			<div key="jamais" role="note" className={s.avis}>
				<span>Mnemo ne suggère plus cette fiche, dans aucune session (« Ne plus jamais suggérer », le {dateCourte(ecarteeToujours.horodatageMs)}).</span>
				<Bouton petit title="Mnemo peut de nouveau la proposer en piste ou l'injecter" onClick={() => void retablirSuggestions()}>
					Rétablir
				</Bouton>
			</div>,
		);
	if (changeeSurLeDisque)
		alertes.push(
			<div key="disque" role="alert" className={s.avis}>
				<span>La fiche a changé sur le disque pendant ton édition.</span>
				<Bouton petit onClick={recharger}>
					Recharger
				</Bouton>
			</div>,
		);

	return (
		<div className={s.note}>
			<div className={s.in}>
				<div className={s.crumb}>
					<span className={s.chemin}>{chemin.split('/').join(' / ')}</span>
					<span className={s.espace} />
					<Bascule actif={edition} surChangement={basculerEdition}>
						Édition
					</Bascule>
					<Bouton petit onClick={() => memoire.voirDansLeGraphe(chemin)}>
						Voir dans le graphe
					</Bouton>
					<Bouton petit aria-expanded={dossier !== null} onClick={basculerDeplacement}>
						Déplacer
					</Bouton>
				</div>
				{quitter && (
					<div role="alertdialog" aria-label="Modifications non enregistrées" className={s.quitter}>
						<span>Modifications non enregistrées.</span>
						<Bouton petit genre="primaire" disabled={enregistrement || disparue} onClick={() => void decider.enregistrer()}>
							Enregistrer
						</Bouton>
						<Bouton petit onClick={decider.abandonner}>
							Abandonner les modifications
						</Bouton>
						<Bouton petit onClick={decider.rester} autoFocus>
							Rester
						</Bouton>
					</div>
				)}
				{dossier !== null && (
					<form className={s.deplacement} onSubmit={deplacer}>
						<input
							type="text"
							aria-label="Dossier d’arrivée"
							placeholder="Dossier d’arrivée (vide = racine)"
							value={dossier}
							onChange={(e) => setDossier(e.target.value)}
							autoFocus
						/>
						<Bouton petit genre="primaire" type="submit">
							Déplacer ici
						</Bouton>
						<Bouton petit onClick={() => setDossier(null)}>
							Annuler
						</Bouton>
						{refusDeplacement && <span className={s.refus}>{refusDeplacement}</span>}
					</form>
				)}
				{donnees === undefined ? (
					<p className={s.attente}>{fiche.erreur ?? 'Chargement de la fiche…'}</p>
				) : (
					<>
						<h1>{donnees.titre}</h1>
						{donnees.proprietes.length > 0 && (
							<dl className={s.props} aria-label="Propriétés">
								{donnees.proprietes.map(([cle, valeur], i) => {
									const [nom, texteValeur] = propriete(cle, valeur);
									return (
										<div key={i} className={s.prop}>
											<dt>{nom}</dt>
											<dd>{texteValeur}</dd>
										</div>
									);
								})}
							</dl>
						)}
						{donnees.avertissements.length > 0 && (
							<div role="note" aria-labelledby="titre-a-verifier" className={s.avis}>
								<span id="titre-a-verifier">À vérifier dans cette fiche</span>
								<ul className={s.avertissements}>
									{donnees.avertissements.map((a, i) => (
										<li key={i}>{a}</li>
									))}
								</ul>
							</div>
						)}
						{alertes}
						{edition ? (
							<>
								<textarea className={s.raw} aria-label="Markdown de la fiche" spellCheck={false} value={texte} readOnly={enregistrement} onChange={(e) => setTexte(e.target.value)} />
								<div className={s.actions}>
									<Bouton genre="primaire" disabled={enregistrement || empreinteLue === null || disparue} onClick={() => void enregistrer()}>
										Enregistrer
									</Bouton>
									<span className={s.aide}>Fichier Markdown, lisible aussi dans Obsidian</span>
								</div>
							</>
						) : (
							<CorpsFiche corps={donnees.corps} liens={donnees.liens} ouvrir={memoire.ouvrirFiche} />
						)}
					</>
				)}
			</div>
		</div>
	);
}
