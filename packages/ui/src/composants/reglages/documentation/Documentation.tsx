/**
 * Onglet Documentation de la vue Réglages : une seule page qui défile, le panneau de gauche en sommaire. Un lien du sommaire
 * fait défiler jusqu'à sa section (en douceur, sauf mouvement réduit) et met le focus sur son titre ; la section visible est
 * marquée dans le sommaire (`aria-current`) pendant le défilement. Le contenu vient de `reglages/documentation.ts` ; ce
 * composant ne fait que le mettre en forme (définitions, étapes, tableaux, tableau des capacités).
 */
import { Fragment, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { HOOKS_PROFIL } from '../../../profils/hooks.ts';
import { SECTIONS_DOC, type BlocDoc, type SectionDoc } from '../../../reglages/documentation.ts';
import d from '../Panneau.module.css';
import s from './Documentation.module.css';

/** Marge sous le haut de la page en deçà de laquelle une section compte comme visible (px). */
const MARGE_ACTIVE = 48;
/** Silence du défilement après lequel un défilement demandé par le sommaire est tenu pour fini (ms). */
const FIN_DEFILEMENT_MS = 150;

/** `**gras**` et `` `code` `` d'un texte du contenu. */
export function enLigne(texte: string): ReactNode[] {
	return texte.split(/(\*\*[^*]+\*\*|`[^`]+`)/u).map((morceau, i) => {
		if (morceau.startsWith('**') && morceau.endsWith('**') && morceau.length > 4) return <b key={i}>{morceau.slice(2, -2)}</b>;
		if (morceau.startsWith('`') && morceau.endsWith('`') && morceau.length > 2) return <code key={i}>{morceau.slice(1, -1)}</code>;
		return <Fragment key={i}>{morceau}</Fragment>;
	});
}

/** Un tableau dans un cadre qui défile seul en petite largeur (atteignable au clavier). */
function Tableau(p: { legende: string; colonnes: readonly string[]; lignes: readonly (readonly ReactNode[])[] }): ReactNode {
	return (
		<div className={s.cadre} role="region" aria-label={p.legende.replace(/`/gu, '')} tabIndex={0}>
			<table className={s.tableau}>
				<caption>{enLigne(p.legende)}</caption>
				<thead>
					<tr>
						{p.colonnes.map((c) => (
							<th key={c} scope="col">
								{c}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{p.lignes.map((l, i) => (
						<tr key={i}>
							{l.map((cellule, j) =>
								j === 0 ? (
									<th key={j} scope="row">
										{typeof cellule === 'string' ? enLigne(cellule) : cellule}
									</th>
								) : (
									<td key={j}>{typeof cellule === 'string' ? enLigne(cellule) : cellule}</td>
								),
							)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function Bloc(p: { bloc: BlocDoc }): ReactNode {
	const b = p.bloc;
	switch (b.genre) {
		case 'intertitre':
			return <h3 className={s.intertitre}>{b.texte}</h3>;
		case 'note':
			return <p className={s.note}>{enLigne(b.texte)}</p>;
		case 'etapes':
			return (
				<ol className={s.etapes}>
					{b.etapes.map((x) => (
						<li key={x}>{enLigne(x)}</li>
					))}
				</ol>
			);
		case 'definitions':
			return (
				<dl className={s.definitions}>
					{b.termes.map(([terme, definition]) => (
						<Fragment key={terme}>
							<dt>{terme}</dt>
							<dd>{enLigne(definition)}</dd>
						</Fragment>
					))}
				</dl>
			);
		case 'tableau':
			return <Tableau legende={b.legende} colonnes={b.colonnes} lignes={b.lignes} />;
		case 'capacites':
			return (
				<Tableau
					legende="Capacités et hooks, dans l’ordre de la session (Agents › Capacités)"
					colonnes={['Capacité', 'Hook', 'Effet', 'Réglable']}
					lignes={HOOKS_PROFIL.map((h) => [
						<>
							<span className={s.symbole} aria-hidden="true">
								{h.symbole}
							</span>{' '}
							{h.capacite}
						</>,
						`\`${h.cle}\``,
						b.effets[h.cle],
						h.toujours ? 'non, toujours actif' : 'oui',
					])}
				/>
			);
	}
}

function Section(p: { section: SectionDoc }): ReactNode {
	const titre = `${p.section.id}-titre`;
	return (
		<section id={p.section.id} className={s.section} aria-labelledby={titre}>
			<h2 id={titre} className={s.titre} tabIndex={-1}>
				{p.section.titre}
			</h2>
			{p.section.blocs.map((b, i) => (
				<Bloc key={i} bloc={b} />
			))}
		</section>
	);
}

const mouvementReduit = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Section visible : la dernière dont le haut a passé le haut de la page (la dernière tout court en bas de page). */
function sectionVisible(page: HTMLElement): string {
	if (page.scrollHeight > page.clientHeight && page.scrollTop + page.clientHeight >= page.scrollHeight - 2) return SECTIONS_DOC.at(-1)!.id;
	const haut = page.getBoundingClientRect().top + MARGE_ACTIVE;
	let active = SECTIONS_DOC[0]!.id;
	for (const x of SECTIONS_DOC) {
		const el = document.getElementById(x.id);
		if (el !== null && el.getBoundingClientRect().top <= haut) active = x.id;
	}
	return active;
}

export function Documentation(): ReactNode {
	const [active, setActive] = useState(SECTIONS_DOC[0]!.id);
	const page = useRef<HTMLDivElement>(null);
	// défilement demandé par le sommaire : la section choisie reste marquée jusqu'à ce qu'il s'arrête
	const demande = useRef<number | null>(null);

	const surDefilement = useCallback(() => {
		if (page.current === null) return;
		if (demande.current !== null) {
			window.clearTimeout(demande.current);
			demande.current = window.setTimeout(() => (demande.current = null), FIN_DEFILEMENT_MS);
			return;
		}
		setActive(sectionVisible(page.current));
	}, []);
	useEffect(() => () => window.clearTimeout(demande.current ?? undefined), []);

	const aller = (e: MouseEvent<HTMLButtonElement>, id: string) => {
		e.preventDefault();
		const section = document.getElementById(id);
		if (section === null) return;
		setActive(id);
		window.clearTimeout(demande.current ?? undefined);
		demande.current = window.setTimeout(() => (demande.current = null), FIN_DEFILEMENT_MS);
		section.scrollIntoView?.({ behavior: mouvementReduit() ? 'auto' : 'smooth', block: 'start' });
		document.getElementById(`${id}-titre`)?.focus({ preventScroll: true });
	};

	return (
		<section className={d.page} aria-label="Documentation">
			<nav className={d.liste} aria-label="Sommaire">
				<ul className={d.lignes}>
					{SECTIONS_DOC.map((x) => (
						<li key={x.id}>
							<button type="button" className={`${d.ligne} ${s.lien}`} aria-controls={x.id} aria-current={x.id === active ? 'true' : undefined} onClick={(e) => aller(e, x.id)}>
								<span className={d.nom}>{x.titre}</span>
							</button>
						</li>
					))}
				</ul>
			</nav>
			<div ref={page} className={s.contenu} onScroll={surDefilement}>
				{SECTIONS_DOC.map((x) => (
					<Section key={x.id} section={x} />
				))}
			</div>
		</section>
	);
}
