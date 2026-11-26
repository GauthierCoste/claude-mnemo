/**
 * Onglet Documentation de la vue Réglages : les six chapitres à gauche (le chapitre ouvert est retenu dans ce navigateur), le
 * chapitre choisi à droite. Le contenu vient de `reglages/documentation.ts` ; ce composant ne fait que le mettre en forme
 * (schémas, frise des pouvoirs, glossaire, sorts d'une fiche, formule de la confiance).
 */
import { Fragment, useState, type ReactNode } from 'react';
import { HOOKS_PROFIL } from '../../../profils/hooks.ts';
import { CHAPITRES_DOC, type BlocDoc, type ChapitreDoc } from '../../../reglages/documentation.ts';
import { chapitreRetenu, retenirChapitre } from '../../../reglages/onglet-retenu.ts';
import d from '../Panneau.module.css';
import s from './Documentation.module.css';

const CLES = CHAPITRES_DOC.map((c) => c.cle);

/** `**gras**` et `` `code` `` d'un texte du contenu. */
export function enLigne(texte: string): ReactNode[] {
	return texte.split(/(\*\*[^*]+\*\*|`[^`]+`)/u).map((morceau, i) => {
		if (morceau.startsWith('**') && morceau.endsWith('**') && morceau.length > 4) return <b key={i}>{morceau.slice(2, -2)}</b>;
		if (morceau.startsWith('`') && morceau.endsWith('`') && morceau.length > 2) return <code key={i}>{morceau.slice(1, -1)}</code>;
		return <Fragment key={i}>{morceau}</Fragment>;
	});
}

function Bloc(p: { bloc: BlocDoc }): ReactNode {
	const b = p.bloc;
	switch (b.genre) {
		case 'chapo':
			return <p className={s.chapo}>{enLigne(b.texte)}</p>;
		case 'intertitre':
			return <h3 className={s.intertitre}>{b.texte}</h3>;
		case 'paragraphe':
			return <p className={s.paragraphe}>{enLigne(b.texte)}</p>;
		case 'note':
			return <p className={s.note}>{enLigne(b.texte)}</p>;
		case 'points':
			return (
				<ul className={s.points}>
					{b.points.map((x) => (
						<li key={x}>{enLigne(x)}</li>
					))}
				</ul>
			);
		case 'schema':
			return (
				<ol className={s.schema}>
					{b.cases.map((c, i) => (
						<Fragment key={c.titre}>
							{i > 0 && (
								<li className={s.fleche} aria-hidden="true">
									{b.fleche}
								</li>
							)}
							<li className={c.accent === true ? `${s.case} ${s.accent}` : s.case}>
								{c.icone !== undefined && (
									<span className={s.icone} aria-hidden="true">
										{c.icone}
									</span>
								)}
								<b>{c.titre}</b>
								<span className={s.texteCase}>{enLigne(c.texte)}</span>
							</li>
						</Fragment>
					))}
				</ol>
			);
		case 'frise':
			return (
				<ol className={s.frise} aria-label="Les six pouvoirs, dans l’ordre de la session">
					{HOOKS_PROFIL.map((h) => (
						<li key={h.cle}>
							<span className={s.rune} aria-hidden="true">
								{h.rune}
							</span>
							<b>{h.pouvoir}</b>
							<span className={s.etape}>{enLigne(b.etapes[h.cle])}</span>
						</li>
					))}
				</ol>
			);
		case 'glossaire':
			return (
				<dl className={s.glossaire}>
					{b.termes.map(([terme, definition]) => (
						<Fragment key={terme}>
							<dt>{terme}</dt>
							<dd>{enLigne(definition)}</dd>
						</Fragment>
					))}
				</dl>
			);
		case 'sorts':
			return (
				<ul className={s.sorts}>
					{b.sorts.map((x) => (
						<li key={x.nom}>
							<span className={`${s.pastille} ${s[x.ton] ?? ''}`} aria-hidden="true" />
							<b>{x.nom}</b>
							<span className={s.etape}>{enLigne(x.texte)}</span>
						</li>
					))}
				</ul>
			);
		case 'formule':
			return (
				<p className={s.formule}>
					{b.facteurs.map((f, i) => (
						<Fragment key={f.nom}>
							{i > 0 && (
								<span className={s.operateur} aria-label={i === b.facteurs.length - 1 ? 'égale' : 'multiplié par'}>
									{i === b.facteurs.length - 1 ? '=' : '×'}
								</span>
							)}
							<span className={f.resultat === true ? `${s.facteur} ${s.resultat}` : s.facteur}>
								{f.nom}
								<small>{f.detail}</small>
							</span>
						</Fragment>
					))}
				</p>
			);
	}
}

function Chapitre(p: { chapitre: ChapitreDoc }): ReactNode {
	const titre = `doc-${p.chapitre.cle}`;
	return (
		<article className={s.chapitre} aria-labelledby={titre}>
			<h2 id={titre} className={s.titre}>
				{p.chapitre.titreLong}
			</h2>
			{p.chapitre.blocs.map((b, i) => (
				<Bloc key={i} bloc={b} />
			))}
		</article>
	);
}

export function Documentation(): ReactNode {
	const [cle, setCle] = useState(() => chapitreRetenu(CLES));
	const chapitre = CHAPITRES_DOC.find((c) => c.cle === cle) ?? CHAPITRES_DOC[0]!;
	const ouvrir = (c: string) => {
		setCle(c);
		retenirChapitre(c);
	};
	return (
		<section className={d.page} aria-label="Documentation">
			<nav className={d.liste} aria-label="Chapitres">
				<ul className={d.lignes}>
					{CHAPITRES_DOC.map((c) => (
						<li key={c.cle}>
							<button type="button" className={d.ligne} aria-current={c.cle === chapitre.cle ? 'true' : undefined} onClick={() => ouvrir(c.cle)}>
								<span className={d.identite}>
									<span className={d.nom}>{c.titre}</span>
									<span className={d.description}>{c.sous}</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			</nav>
			<div className={s.contenu}>
				<Chapitre chapitre={chapitre} />
			</div>
		</section>
	);
}
