/**
 * Rendu d'une fiche, au format des fiches : uniquement des éléments
 * React, jamais de HTML interprété. Le contenu de la mémoire est une donnée : `<script>`, `<img onerror>` ou
 * `[[<b>x</b>]]` s'affichent tels quels.
 */
import { useMemo, useState, type JSX, type ReactNode } from 'react';
import type { FicheVue } from '@mnemo/contrat';
import { cx } from '../composants/commun/classes.ts';
import { Puce } from '../composants/commun/Puce.tsx';
import { useToast } from '../composants/Toast.tsx';
import { useTextes } from '../langue/langue.tsx';
import s from './rendu-fiche.module.css';

export type LigneAnalysee =
	| { genre: 'titre2'; texte: string }
	| { genre: 'paragraphe'; texte: string }
	| { genre: 'citation'; texte: string }
	/** Bloc de code clôturé : ses lignes telles quelles, retraits et lignes vides compris. */
	| { genre: 'code'; texte: string }
	/** Liste numérotée : `debut`, le numéro de son premier élément. */
	| { genre: 'liste'; debut: number; items: string[] }
	/** Source ajoutée après coup sous une information : `  + src: … | corroboré AAAA-MM-JJ` (sa citation suit en `citation`). */
	| { genre: 'corroboration'; source: string; le: string }
	| { genre: 'puce'; texte: string; categorie: string | null; meta: string[] /* segments après « | » */; barre: boolean; ancre: string | null };

const RE_TITRE = /^(#{1,6})\s+(.*)$/;
const RE_PUCE = /^\s*[-*]\s+(.*)$/;
const RE_CITATION = /^\s*>\s?(.*)$/;
const RE_NUMERO = /^\s*(\d+)[.)]\s+(.*)$/;
const RE_CLOTURE = /^\s*(`{3,}|~{3,})/;
/** Catégorie en tête d'un fait : `[delai]`, mais pas un lien `[[…]]`. */
const RE_CATEGORIE = /^\[([^[\]]+)\]\s+/;
const RE_ANCRE = /\s\^(f-\d+)\s*$/;
const RE_BARRE = /^~~(.+)~~$/;

/** Corroboration écrite sous une information : la source (telle qu'écrite après `src: `) et le jour de l'ajout. */
const RE_CORROBORATION = /^\s*\+ src: (.+) \| corroboré (\d{4}-\d{2}-\d{2})\s*$/u;

export function analyserCorroboration(ligne: string): { source: string; le: string } | null {
	const m = RE_CORROBORATION.exec(ligne);
	return m === null ? null : { source: m[1]!.trim(), le: m[2]! };
}

/** Titre de la section des informations ; `## Faits`, l'ancien titre, est lu et affiché de même. */
export const TITRE_INFORMATIONS = 'Informations';
const TITRES_INFORMATIONS = new Set([TITRE_INFORMATIONS, 'Faits']);

/** Une information de `## Informations` : `- [categorie] énoncé | mention | … ^f-NNNN` (`|` sans espaces autour : du texte). */
export function analyserFait(texte: string): Extract<LigneAnalysee, { genre: 'puce' }> {
	let reste = texte;
	const categorie = RE_CATEGORIE.exec(reste)?.[1] ?? null;
	if (categorie !== null) reste = reste.replace(RE_CATEGORIE, '');
	const ancre = RE_ANCRE.exec(reste)?.[1] ?? null;
	if (ancre !== null) reste = reste.replace(RE_ANCRE, '');
	const [enonce = '', ...meta] = reste.split(' | ');
	const barre = RE_BARRE.exec(enonce.trim());
	return { genre: 'puce', texte: barre ? barre[1]! : enonce.trim(), categorie, meta: meta.map((m) => m.trim()), barre: barre !== null, ancre };
}

/**
 * Lignes du corps : le titre de la fiche, sa première ligne non vide si elle est un titre `# ` (la règle du service, affiché
 * en h1), est sauté ; tout autre titre est rendu comme un `##`. Lignes vides ignorées hors des blocs de code ; les lignes
 * numérotées qui se suivent forment une liste ; les informations analysées dans `## Informations` (ou `## Faits`, affiché
 * « Informations »).
 */
export function analyserCorps(corps: string): LigneAnalysee[] {
	const lignes: LigneAnalysee[] = [];
	let section = '';
	let cloture: string | null = null;
	let code: string[] = [];
	const fermerCode = () => lignes.push({ genre: 'code', texte: code.join('\n') });
	const brutes = corps.split(/\r?\n/);
	const premiere = brutes.findIndex((l) => l.trim() !== '');
	const ligneDuTitre = premiere !== -1 && RE_TITRE.exec(brutes[premiere]!)?.[1] === '#' ? premiere : -1;
	for (const [i, brute] of brutes.entries()) {
		// Bloc de code : ses lignes restent du texte (ni titre, ni fait).
		const marque = RE_CLOTURE.exec(brute)?.[1];
		if (cloture !== null) {
			if (marque && marque[0] === cloture[0] && marque.length >= cloture.length && brute.trim() === marque) {
				cloture = null;
				fermerCode();
			} else code.push(brute);
			continue;
		}
		if (marque) {
			cloture = marque;
			code = [];
			continue;
		}
		if (!brute.trim()) continue;
		const titre = RE_TITRE.exec(brute);
		if (titre) {
			if (i === ligneDuTitre) continue;
			section = titre[2]!.trim();
			if (titre[1] === '##' && TITRES_INFORMATIONS.has(section)) section = TITRE_INFORMATIONS;
			lignes.push({ genre: 'titre2', texte: section });
			continue;
		}
		const citation = RE_CITATION.exec(brute);
		if (citation) {
			lignes.push({ genre: 'citation', texte: citation[1]! });
			continue;
		}
		const corroboration = section === TITRE_INFORMATIONS ? analyserCorroboration(brute) : null;
		if (corroboration !== null) {
			lignes.push({ genre: 'corroboration', ...corroboration });
			continue;
		}
		const puce = RE_PUCE.exec(brute);
		if (puce) {
			lignes.push(section === TITRE_INFORMATIONS ? analyserFait(puce[1]!) : { genre: 'puce', texte: puce[1]!, categorie: null, meta: [], barre: false, ancre: null });
			continue;
		}
		const numero = RE_NUMERO.exec(brute);
		if (numero) {
			const derniere = lignes.at(-1);
			if (derniere?.genre === 'liste') derniere.items.push(numero[2]!);
			else lignes.push({ genre: 'liste', debut: Number(numero[1]), items: [numero[2]!] });
			continue;
		}
		lignes.push({ genre: 'paragraphe', texte: brute.trim() });
	}
	// bloc de code jamais clôturé : rendu jusqu'à la fin, comme un éditeur Markdown
	if (cloture !== null) fermerCode();
	return lignes;
}

/**
 * Un groupe d'informations : une catégorie (`cle` = la catégorie), ou un groupe réservé, `[sans-categorie]` ou les barrées
 * (`[barrees]`) ; une catégorie ne contient jamais de crochets, les clés ne se confondent pas. `section` : rang de la
 * section des informations dans la fiche (d'ordinaire 0), pour une clé React stable. `categorie` : null pour un groupe réservé.
 */
export type GroupeInformations = { cle: string; section: number; categorie: string | null; barrees: boolean; nombre: number; lignes: LigneAnalysee[] };
export type BlocCorps = { genre: 'ligne'; ligne: LigneAnalysee } | { genre: 'groupe'; groupe: GroupeInformations };

const CLE_SANS_CATEGORIE = '[sans-categorie]';
const CLE_BARREES = '[barrees]';

/**
 * Blocs à afficher : les lignes telles quelles, sauf dans la section des informations, où chaque information (et ce qui
 * la suit : citation, ligne gardée telle quelle) rejoint le groupe de sa catégorie, dans l'ordre d'apparition des
 * catégories ; les informations barrées (retirées ou périmées) forment un dernier groupe.
 */
export function grouperInformations(lignes: LigneAnalysee[]): BlocCorps[] {
	const blocs: BlocCorps[] = [];
	let groupes: GroupeInformations[] | null = null;
	let courant: GroupeInformations | null = null;
	let section = -1;
	const fermer = () => {
		if (groupes === null) return;
		const barrees = groupes.filter((g) => g.barrees);
		for (const groupe of [...groupes.filter((g) => !g.barrees), ...barrees]) blocs.push({ genre: 'groupe', groupe });
		groupes = null;
		courant = null;
	};
	const groupeDe = (cle: string, categorie: string | null, barrees: boolean): GroupeInformations => {
		let groupe = groupes!.find((g) => g.cle === cle);
		if (groupe === undefined) {
			groupe = { cle, section, categorie, barrees, nombre: 0, lignes: [] };
			groupes!.push(groupe);
		}
		return groupe;
	};
	for (const ligne of lignes) {
		if (ligne.genre === 'titre2') {
			fermer();
			blocs.push({ genre: 'ligne', ligne });
			if (ligne.texte === TITRE_INFORMATIONS) {
				groupes = [];
				section++;
			}
			continue;
		}
		if (groupes === null) {
			blocs.push({ genre: 'ligne', ligne });
			continue;
		}
		if (ligne.genre === 'puce') {
			courant = ligne.barre ? groupeDe(CLE_BARREES, null, true) : groupeDe(ligne.categorie ?? CLE_SANS_CATEGORIE, ligne.categorie, false);
			courant.nombre++;
		}
		(courant ?? groupeDe(CLE_SANS_CATEGORIE, null, false)).lignes.push(ligne);
	}
	fermer();
	return blocs;
}

/** Un groupe repliable : son titre (catégorie et nombre) ouvre et ferme la liste. */
function Groupe(p: { groupe: GroupeInformations; children: ReactNode }): JSX.Element {
	const { groupe } = p;
	const t = useTextes().memoire.rendu;
	const [ouvert, setOuvert] = useState(!groupe.barrees);
	return (
		<div className={s.groupe} data-groupe={groupe.cle}>
			<button type="button" className={s.titreGroupe} aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}>
				<bdi>{groupe.categorie ?? (groupe.barrees ? t.barrees : t.sansCategorie)}</bdi>
				<Puce className={s.nombre}>{groupe.nombre}</Puce>
			</button>
			{ouvert && <div className={s.contenuGroupe}>{p.children}</div>}
		</div>
	);
}

/** Ton d'une mention du format, telle qu'écrite (avec ou sans accents). */
function tonDe(mention: string): 'avertissement' | 'succes' | 'neutre' {
	if (mention === 'à confirmer' || mention === 'a confirmer') return 'avertissement';
	if (mention === 'déclaré' || mention === 'declare') return 'succes';
	return 'neutre';
}

/** Lien `[[cible]]` ou `[[cible|alias]]` (`.wl`) ; cible absente : `.wl.x`, et un clic le dit. */
function LienFiche(p: { ecrit: string; chemin: string | null; ouvrir(chemin: string): void }): ReactNode {
	const toast = useToast();
	const t = useTextes().memoire.rendu;
	const separateur = p.ecrit.indexOf('|');
	const cible = separateur < 0 ? p.ecrit : p.ecrit.slice(0, separateur);
	const libelle = separateur < 0 ? p.ecrit : p.ecrit.slice(separateur + 1);
	const { chemin } = p;
	return (
		<button
			type="button"
			className={cx(s.wl, chemin === null && s.x)}
			title={chemin ?? undefined}
			onClick={() => (chemin === null ? toast(t.ficheAbsente(cible)) : p.ouvrir(chemin))}
		>
			<bdi>{libelle}</bdi>
		</button>
	);
}

/**
 * Lien, code, barré. La cible d'un lien exclut `[` et `]` : sans retour arrière possible, l'analyse reste linéaire même
 * sur 100 Ko de `[` ou de `[[a` (une fiche est une donnée, éventuellement hostile).
 */
const RE_EN_LIGNE = /\[\[([^[\]\n]+)\]\]|`([^`\n]+)`|~~(.+?)~~/g;

/** Texte d'une ligne en éléments : `[[liens]]`, `code` → puce, `~~barré~~` ; le reste en texte brut. */
export function rendreEnLigne(texte: string, cibles: (ecrit: string) => string | null, ouvrir: (chemin: string) => void): ReactNode[] {
	const morceaux: ReactNode[] = [];
	let depuis = 0;
	for (const m of texte.matchAll(RE_EN_LIGNE)) {
		if (m.index > depuis) morceaux.push(texte.slice(depuis, m.index));
		const cle = `${m.index}`;
		if (m[1] !== undefined) morceaux.push(<LienFiche key={cle} ecrit={m[1]} chemin={cibles(m[1])} ouvrir={ouvrir} />);
		else if (m[2] !== undefined)
			morceaux.push(
				<Puce key={cle} ton={tonDe(m[2])} className={s.puce}>
					<bdi>{m[2]}</bdi>
				</Puce>,
			);
		else morceaux.push(<s key={cle}>{rendreEnLigne(m[3]!, cibles, ouvrir)}</s>);
		depuis = m.index + m[0].length;
	}
	if (depuis < texte.length) morceaux.push(texte.slice(depuis));
	return morceaux;
}

/** Analyse et rendu mémorisés sur le corps (et les liens) : une fiche relue à l'identique ne se réanalyse pas. */
export function CorpsFiche(p: { corps: string; liens: FicheVue['liens']; ouvrir(chemin: string): void }): JSX.Element {
	const { corps, liens, ouvrir } = p;
	const t = useTextes().memoire.rendu;
	const blocs = useMemo(() => grouperInformations(analyserCorps(corps)), [corps]);
	return useMemo(() => {
		const parEcrit = new Map(liens.sortants.map((l) => [l.ecrit, l.chemin]));
		const cibles = (ecrit: string) => parEcrit.get(ecrit) ?? null;
		const enLigne = (texte: string) => rendreEnLigne(texte, cibles, ouvrir);
		const rendreLigne = (l: LigneAnalysee, cle: string): JSX.Element => {
			switch (l.genre) {
				case 'titre2':
					return <h3 key={cle}>{enLigne(l.texte)}</h3>;
				case 'paragraphe':
					return <p key={cle}>{enLigne(l.texte)}</p>;
				case 'citation':
					return <blockquote key={cle}>{enLigne(l.texte)}</blockquote>;
				case 'code':
					return (
						<pre key={cle} className={s.code}>
							<code>{l.texte}</code>
						</pre>
					);
				case 'liste':
					return (
						<ol key={cle} start={l.debut} className={s.liste}>
							{l.items.map((texte, j) => (
								<li key={j}>{enLigne(texte)}</li>
							))}
						</ol>
					);
				case 'corroboration':
					return (
						<div key={cle} className={s.corroboration} data-genre="corroboration">
							<Puce className={s.puce}>
								<bdi>{enLigne(`src: ${l.source}`)}</bdi>
							</Puce>
							<Puce className={s.puce}>
								<bdi>{t.corroboree(l.le)}</bdi>
							</Puce>
						</div>
					);
				case 'puce':
					return (
						<div key={cle} className={cx(s.li, l.barre && s.barre)} data-genre="puce">
							{l.categorie !== null && (
								<Puce className={s.categorie}>
									<bdi>{l.categorie}</bdi>
								</Puce>
							)}
							{l.barre ? <s>{enLigne(l.texte)}</s> : enLigne(l.texte)}
							{l.meta.map((m, j) => {
								return (
									<Puce key={j} ton={tonDe(m)} className={s.puce}>
										<bdi>{enLigne(t.mention(m))}</bdi>
									</Puce>
								);
							})}
						</div>
					);
			}
		};
		// Un groupe est désigné par sa section et sa catégorie, jamais par sa position : son état replié le suit.
		return (
			<article className={s.corps}>
				{blocs.map((b, i) =>
					b.genre === 'ligne' ? (
						rendreLigne(b.ligne, `l${i}`)
					) : (
						<Groupe key={`g${b.groupe.section}:${b.groupe.cle}`} groupe={b.groupe}>
							{b.groupe.lignes.map((l, j) => rendreLigne(l, `${j}`))}
						</Groupe>
					),
				)}
			</article>
		);
	}, [blocs, liens, ouvrir, t]);
}
