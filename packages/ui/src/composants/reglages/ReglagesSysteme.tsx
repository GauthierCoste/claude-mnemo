/**
 * Onglet Système de la vue Réglages, disposé comme l'onglet Profils (groupes à gauche, le groupe choisi à droite) : l'état
 * des moteurs sur ce poste (groupe « Moteurs », en lecture seule), puis les réglages du dossier (`.mnemo/reglages.json`), groupés par thème,
 * chacun avec son explication, son défaut et « Rétablir le défaut » ; enregistrement explicite, validé par le service (tout
 * ou rien). Ce qui ne vaut qu'au redémarrage du service (ou au prochain démarrage des modèles) est signalé, comme un réglage
 * remplacé par une variable d'environnement. Quitter la vue avec des modifications non enregistrées est retenu : un
 * avertissement dans la page propose de les enregistrer ou de les abandonner.
 */
import type { ChampReglageVue, GroupeReglageVue, ReglagesVue } from '@mnemo/contrat';
import { ROUTES } from '@mnemo/contrat';
import { appliquerAccent, CONTRASTE_MINIMAL, contraste } from '../../reglages/accent.ts';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ACCENT_PAR_DEFAUT, estCouleurHex, GROUPES_REGLAGES } from '@mnemo/commun';
import { ErreurApi } from '../../client/api.ts';
import { useClient } from '../../client/contexte.tsx';
import { useReglages } from '../../client/hooks.ts';
import { enSaisie, enValeur, egales, modifications, valeurLisible, type Saisie } from '../../reglages/brouillon.ts';
import { useNavigation } from '../../navigation.tsx';
import { Bouton } from '../commun/Bouton.tsx';
import { EtatMoteurs } from './EtatMoteurs.tsx';
// disposition partagée avec l'onglet Profils : liste à gauche, carte à droite, pied collant
import d from './profils/Profils.module.css';
import s from './Reglages.module.css';

const TITRES_GROUPES: Record<GroupeReglageVue, string> = {
	contexte: 'Contexte injecté',
	memoire: 'Mémoire',
	archiviste: 'Archiviste',
	recherche: 'Recherche',
	projets: 'Projets',
	modeles: 'Modèles',
	service: 'Service',
	interface: 'Interface',
};
const GROUPES = GROUPES_REGLAGES.map((cle) => ({ cle, titre: TITRES_GROUPES[cle] }));

const EFFETS: Record<ChampReglageVue['effet'], string | null> = {
	immediat: null,
	service: 'Redémarrage du service requis',
	modeles: 'Au prochain démarrage des modèles',
};

const saisiesDe = (vue: ReglagesVue): Record<string, Saisie> => Object.fromEntries(vue.champs.map((c) => [c.cle, enSaisie(c, c.valeur)]));

/** `surModifie` : prévenu quand la saisie diffère (ou plus) des réglages enregistrés (changement d'onglet retenu). */
export function ReglagesSysteme(p: { surModifie?(modifie: boolean): void }): ReactNode {
	const ressource = useReglages();
	const [enregistree, setEnregistree] = useState<ReglagesVue | null>(null);
	const vue = enregistree ?? ressource.donnees;
	if (vue === undefined) {
		return (
			<section className={d.droite} aria-label="Réglages système">
				<p className={d.discret}>{ressource.erreur ?? 'Chargement des réglages…'}</p>
			</section>
		);
	}
	const surEnregistree = (v: ReglagesVue) => {
		setEnregistree(v);
		// le cache des réglages suit : la couleur principale ne dépend pas d'une relecture tardive
		ressource.recharger();
	};
	return <Formulaire vue={vue} enregistree={enregistree !== null} surEnregistree={surEnregistree} {...(p.surModifie ? { surModifie: p.surModifie } : {})} />;
}

function Formulaire(p: { vue: ReglagesVue; enregistree: boolean; surEnregistree(v: ReglagesVue): void; surModifie?(modifie: boolean): void }): ReactNode {
	const { api } = useClient();
	const [saisies, setSaisies] = useState(() => saisiesDe(p.vue));
	// réglages relus ou enregistrés : la saisie repart de ce que le service a gardé
	const [base, setBase] = useState(p.vue);
	if (base !== p.vue) {
		setBase(p.vue);
		setSaisies(saisiesDe(p.vue));
	}
	const [envoi, setEnvoi] = useState(false);
	const [erreur, setErreur] = useState<string | null>(null);
	// « moteurs » : l'état des moteurs, pas un groupe de réglages
	const [choisi, setChoisi] = useState<GroupeReglageVue | 'moteurs' | null>(null);
	const aEnvoyer = modifications(p.vue.champs, saisies);
	const modifie = Object.keys(aEnvoyer).length > 0;
	const libelles = (cles: string[]) => cles.map((c) => p.vue.champs.find((x) => x.cle === c)?.libelle ?? c).join(', ');

	const nav = useNavigation();
	// modifications non enregistrées : un changement de vue est retenu (avertissement dans la page)
	const modifieCourant = useRef(modifie);
	modifieCourant.current = modifie;
	const { surModifie } = p;
	useEffect(() => surModifie?.(modifie), [surModifie, modifie]);
	const { definirGardeSortie } = nav;
	useEffect(() => {
		definirGardeSortie(() => modifieCourant.current);
		return () => definirGardeSortie(null);
	}, [definirGardeSortie]);

	// la couleur principale choisie s'applique tout de suite (aperçu) ; sans enregistrement, la page retrouve celle du service
	const accentSaisi = saisies['interface.accent'];
	const accentEnregistre = p.vue.champs.find((c) => c.cle === 'interface.accent')?.valeur;
	useEffect(() => {
		appliquerAccent(document.documentElement, typeof accentSaisi === 'string' ? accentSaisi : accentEnregistre);
		return () => appliquerAccent(document.documentElement, accentEnregistre);
	}, [accentSaisi, accentEnregistre]);

	const enregistrer = async (): Promise<boolean> => {
		setEnvoi(true);
		setErreur(null);
		try {
			p.surEnregistree(await api.remplacer<ReglagesVue>(ROUTES.reglages, { valeurs: aEnvoyer }));
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

	const modifiesParGroupe = new Set(Object.keys(aEnvoyer).map((cle) => p.vue.champs.find((c) => c.cle === cle)?.groupe));
	const groupes = GROUPES.filter((g) => p.vue.champs.some((c) => c.groupe === g.cle));
	const voirMoteurs = choisi === 'moteurs';
	const groupe = voirMoteurs ? undefined : (groupes.find((g) => g.cle === choisi) ?? groupes[0]);
	const champs = groupe === undefined ? [] : p.vue.champs.filter((c) => c.groupe === groupe.cle);

	return (
		<form className={d.page} aria-label="Réglages système" onSubmit={(e) => e.preventDefault()}>
			<nav className={d.liste} aria-label="Groupes de réglages">
				<ul className={d.profils}>
					{groupes.map((g) => (
						<li key={g.cle}>
							<button type="button" className={d.ligneProfil} aria-current={g.cle === groupe?.cle ? 'true' : undefined} onClick={() => setChoisi(g.cle)}>
								<span className={d.identite}>
									<span className={d.nomProfil}>
										{g.titre}
										{modifiesParGroupe.has(g.cle) && <span className={d.badge}>modifié</span>}
									</span>
									<span className={d.description}>
										{p.vue.champs.filter((c) => c.groupe === g.cle).length} réglage(s)
									</span>
								</span>
							</button>
						</li>
					))}
					<li>
						<button type="button" className={d.ligneProfil} aria-current={voirMoteurs ? 'true' : undefined} onClick={() => setChoisi('moteurs')}>
							<span className={d.identite}>
								<span className={d.nomProfil}>Moteurs</span>
								<span className={d.description}>État sur ce poste, en lecture seule</span>
							</span>
						</button>
					</li>
				</ul>
				<p className={d.discret}>
					Dans <code>.mnemo/reglages.json</code> ; Mémoire dans <code>SCHEMA.md</code> (un commit). Raccourci : <kbd>⌥,</kbd>
				</p>
			</nav>
			<div className={d.droite}>
				{p.vue.avertissements.length > 0 && (
					<ul className={d.avertissements} aria-label="Avertissements">
						{p.vue.avertissements.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				)}
				{p.vue.enAttente.length > 0 && (
					<div className={d.avis} role="status">
						<p>Redémarrage du service requis pour : {libelles(p.vue.enAttente)} — « mnemo arreter » puis « mnemo ouvrir ».</p>
					</div>
				)}
				{voirMoteurs && <EtatMoteurs />}
				{groupe !== undefined && (
					<fieldset className={d.section}>
						<legend className={d.titreSection}>{groupe.titre}</legend>
						{champs.map((c) => (
							<Champ key={c.cle} champ={c} saisie={saisies[c.cle]!} surSaisie={(v) => setSaisies((x) => ({ ...x, [c.cle]: v }))} />
						))}
					</fieldset>
				)}
				<footer className={d.pied}>
					{nav.sortieRetenue && (
						<div className={d.avis} role="alert">
							<p>Modifications non enregistrées : les enregistrer avant de quitter les Réglages ?</p>
							<div className={d.actions}>
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
					{p.enregistree && !modifie && (
						<p className={d.statut} role="status">
							Enregistré.
						</p>
					)}
					{erreur !== null && (
						<p className={d.erreur} role="alert">
							{erreur}
						</p>
					)}
					<div className={d.actions}>
						<Bouton genre="primaire" disabled={!modifie || envoi} onClick={() => void enregistrer()}>
							Enregistrer
						</Bouton>
						<Bouton disabled={!modifie || envoi} onClick={() => setSaisies(saisiesDe(p.vue))}>
							Annuler les modifications
						</Bouton>
					</div>
				</footer>
			</div>
		</form>
	);
}

function Champ(p: { champ: ChampReglageVue; saisie: Saisie; surSaisie(v: Saisie): void }): ReactNode {
	const c = p.champ;
	const id = useId();
	const effet = c.fixePar === undefined ? EFFETS[c.effet] : `Fixé par ${c.fixePar}`;
	const auDefaut = egales(enValeur(c, p.saisie), c.defaut);
	return (
		<fieldset className={s.champ} aria-label={c.libelle} aria-describedby={`${id}-explication`}>
			<div className={s.ligne}>
				{c.genre === 'choix-multiple' ? (
					<span className={s.libelle}>{c.libelle}</span>
				) : (
					<label className={s.libelle} htmlFor={id}>
						{c.libelle}
					</label>
				)}
				{effet !== null && <span className={s.effet}>{effet}</span>}
			</div>
			<p id={`${id}-explication`} className={s.explication}>
				{c.explication}
				{c.fixePar !== undefined && ` La variable d’environnement ${c.fixePar} du service l’emporte sur ce réglage tant qu’elle est posée.`}
			</p>
			<div className={s.ligne}>
				<Saisir champ={c} id={id} saisie={p.saisie} surSaisie={p.surSaisie} />
				{c.unite !== undefined && c.genre !== 'choix-multiple' && <span className={s.discret}>{c.unite}</span>}
			</div>
			<div className={s.ligne}>
				<span className={s.discret}>Défaut : {valeurLisible(c, c.defaut)}</span>
				<Bouton petit disabled={auDefaut} onClick={() => p.surSaisie(enSaisie(c, c.defaut))}>
					Rétablir le défaut
				</Bouton>
			</div>
			{c.genre === 'couleur' && <AvertissementContraste couleur={typeof p.saisie === 'string' ? p.saisie : ''} />}
		</fieldset>
	);
}

/** Sous le sélecteur de couleur : prévient quand l'accent se lit mal sur le fond (contraste sous 3:1). */
function AvertissementContraste(p: { couleur: string }): ReactNode {
	const fond = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
	if (!estCouleurHex(p.couleur) || !estCouleurHex(fond)) return null;
	const rapport = contraste(p.couleur, fond);
	if (rapport >= CONTRASTE_MINIMAL) return null;
	return (
		<p className={s.avertissement} role="status">
			Cette couleur se lit mal sur le fond sombre (contraste {rapport.toFixed(1).replace('.', ',')}:1, au moins {CONTRASTE_MINIMAL}:1 conseillé) : les liens, filets et titres seront peu visibles.
		</p>
	);
}

function Saisir(p: { champ: ChampReglageVue; id: string; saisie: Saisie; surSaisie(v: Saisie): void }): ReactNode {
	const c = p.champ;
	const texte = typeof p.saisie === 'string' ? p.saisie : '';
	switch (c.genre) {
		case 'entier':
			return <input id={p.id} className={s.nombre} type="number" inputMode="numeric" min={c.min} max={c.max} step={1} value={texte} onChange={(e) => p.surSaisie(e.target.value)} />;
		case 'decimal':
			// texte, pas `type=number` : virgule ou point selon l'habitude, jamais effacés par le navigateur
			return <input id={p.id} className={s.nombre} type="text" inputMode="decimal" spellCheck={false} value={texte} onChange={(e) => p.surSaisie(e.target.value)} />;
		case 'couleur':
			return (
				<span className={s.couleur}>
					<input id={p.id} type="color" value={estCouleurHex(texte) ? texte.toLowerCase() : ACCENT_PAR_DEFAUT} onChange={(e) => p.surSaisie(e.target.value)} />
					<code>{texte}</code>
				</span>
			);
		case 'liste':
			return <input id={p.id} className={s.texte} type="text" spellCheck={false} value={texte} placeholder="noms séparés par des virgules" onChange={(e) => p.surSaisie(e.target.value)} />;
		case 'choix':
			return (
				<select id={p.id} value={texte} onChange={(e) => p.surSaisie(e.target.value)}>
					{(c.choix ?? []).map((x) => (
						<option key={x.valeur} value={x.valeur}>
							{x.libelle}
						</option>
					))}
				</select>
			);
		case 'choix-multiple': {
			const coches = Array.isArray(p.saisie) ? p.saisie : [];
			return (
				<div className={s.cases}>
					{(c.choix ?? []).map((x) => (
						<label key={x.valeur} className={s.case}>
							<input
								type="checkbox"
								checked={coches.includes(x.valeur)}
								onChange={(e) => p.surSaisie(e.target.checked ? (c.choix ?? []).map((y) => y.valeur).filter((v) => v === x.valeur || coches.includes(v)) : coches.filter((v) => v !== x.valeur))}
							/>
							{x.libelle}
						</label>
					))}
				</div>
			);
		}
	}
}
