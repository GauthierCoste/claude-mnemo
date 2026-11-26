/**
 * Alignement à gauche (demande du 22/11 : « je préfère aligner le côté gauche que tout centrer ») : aucun bloc des
 * modules CSS n'est centré, sauf ce qui l'est par nature (pastille de nombre, icône seule dans un bouton carré, rail
 * d'icônes, case de l'heure d'un commit).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..', 'src');

function fichiers(dossier: string): string[] {
	return readdirSync(dossier).flatMap((n) => {
		const c = join(dossier, n);
		return statSync(c).isDirectory() ? fichiers(c) : c.endsWith('.css') ? [c] : [];
	});
}

/** Blocs `sélecteur { déclarations }` d'un fichier CSS (sans les commentaires ; les @media sont aplatis). */
function blocs(css: string): { selecteur: string; corps: string }[] {
	const net = css.replace(/\/\*[\s\S]*?\*\//g, '');
	return [...net.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selecteur: m[1]!.trim(), corps: m[2]! }));
}

/** Raisons pour lesquelles un bloc centre son contenu ou se centre lui-même. */
function centrages(corps: string): string[] {
	const raisons: string[] = [];
	const decl = (nom: string) => new RegExp(`(^|;|\\s)${nom}\\s*:\\s*([^;]+)`).exec(corps)?.[2]?.trim() ?? null;
	if (decl('text-align') === 'center') raisons.push('text-align: center');
	if (decl('justify-content') === 'center') raisons.push('justify-content: center');
	for (const p of ['place-items', 'place-content', 'place-self', 'justify-items', 'justify-self']) if (decl(p)?.split(/\s+/).includes('center')) raisons.push(`${p}: center`);
	const marge = decl('margin');
	if (marge !== null && /^(\S+\s+)?auto(\s+\S+)?$/.test(marge) && (marge === 'auto' || marge.split(/\s+/)[1] === 'auto')) raisons.push(`margin: ${marge}`);
	if (decl('left') === '50%') raisons.push('left: 50%');
	if (decl('flex-direction') === 'column' && decl('align-items') === 'center') raisons.push('colonne : align-items: center');
	return raisons;
}

/** Centrés par nature. */
const PERMIS = new Set([
	'composants/Navigation.module.css .cote',
	'composants/Navigation.module.css .entree',
	'composants/Navigation.module.css .pastille',
	'composants/commun/BoutonsArbre.module.css .bouton',
	'composants/archiviste/CommitsDuJour.module.css .heure',
	'composants/sessions/GrilleSessions.module.css .rail > .railb',
	// la créature du profil au milieu de sa tuile carrée (avatar d'une session)
	'composants/sessions/AvatarSession.module.css .tuile',
	// Réglages : le logo (moteur, initiale d'un serveur MCP, pouls du service) au milieu de sa case carrée
	'composants/reglages/Cartes.module.css .logo',
	// Nouvelle session : la scène est symétrique autour de l'agent choisi (lui, son sol, son nom), la rangée centrée sous
	// elle ; la marque « ! » d'une vignette et la flèche dans son bouton rond
	'composants/sessions/nouvelle/SceneAgents.module.css .carrousel::after',
	'composants/sessions/nouvelle/SceneAgents.module.css .agent',
	'composants/sessions/nouvelle/SceneAgents.module.css .plaque',
	'composants/sessions/nouvelle/SceneAgents.module.css .fleche',
	'composants/sessions/nouvelle/RangeeAgents.module.css .rangee',
	'composants/sessions/nouvelle/RangeeAgents.module.css .vignette[data-eteint]::after',
]);

function trouves(): Map<string, string[]> {
	const sortie = new Map<string, string[]>();
	for (const f of fichiers(SRC))
		for (const b of blocs(readFileSync(f, 'utf8'))) {
			const r = centrages(b.corps);
			if (r.length) sortie.set(`${relative(SRC, f).split(sep).join('/')} ${b.selecteur}`, r);
		}
	return sortie;
}

describe('alignement à gauche', () => {
	it('aucun bloc centré hors de ceux qui le sont par nature', () => {
		const centres = [...trouves()].filter(([cle]) => !PERMIS.has(cle)).map(([cle, r]) => `${cle} : ${r.join(', ')}`);
		expect(centres).toEqual([]);
	});

	it('les centrés permis existent encore (la liste ne garde pas de restes)', () => {
		expect([...PERMIS].filter((cle) => !trouves().has(cle))).toEqual([]);
	});

	it('zone de dépôt et états vides : texte et boutons à gauche', () => {
		const lire = (f: string) => new Map(blocs(readFileSync(join(SRC, f), 'utf8')).map((b) => [b.selecteur, b.corps]));
		const depot = lire('composants/archiviste/ZoneDepot.module.css');
		expect(depot.get('.zone')).toMatch(/text-align:\s*left/);
		expect(depot.get('.actions')).toMatch(/justify-content:\s*flex-start/);
		for (const [f, sel] of [
			['composants/sessions/Sessions.module.css', '.vide'],
			['composants/sessions/CarteSession.module.css', '.sansTerminal'],
			['composants/archiviste/CentreArchiviste.module.css', '.absent'],
			['composants/archiviste/PageArchiviste.module.css', '.ailleurs'],
		] as const)
			expect(lire(f).get(sel), `${f} ${sel}`).toMatch(/align-items:\s*flex-start/);
		expect(lire('composants/memoire/Memoire.module.css').get('.vide')).toMatch(/place-self:\s*start/);
		const graphe = lire('composants/memoire/graphe/Graphe3D.module.css');
		expect(graphe.get('.message')).toMatch(/text-align:\s*left/);
		expect(graphe.get('.aide')).toMatch(/text-align:\s*left/);
	});
});
