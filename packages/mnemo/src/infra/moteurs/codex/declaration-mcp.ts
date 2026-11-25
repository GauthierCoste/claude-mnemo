import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppelDeclaration, DeclarationMcp, LectureDeclaration, ResultatDeclaration, ResultatRedeclaration, ResultatRetraitMcp } from '../../../application/ports.ts';
import { commandeManuelleCodex, estDeclarationMnemo, lanceCeMnemo, lignesTomlCodex, lireDeclarationCodex, reglagesDansConfig } from '../../../domaine/moteurs/codex/declaration.ts';
import type { DeclarationCodex } from '../../../domaine/moteurs/codex/declaration.ts';
import { nodeDurable } from '../../node-durable.ts';
import { dossierCodex } from './dossier-codex.ts';

const INTROUVABLE = '`codex` introuvable (PATH, MNEMO_CODEX, ou ChatGPT.app).';
const DESACTIVEE = 'déclaration MCP « mnemo » désactivée dans Codex (enabled = false) : Mnemo ne la réactive pas.';

/** `config.toml` de Codex : `$CODEX_HOME`, sinon `~/.codex`. */
const cheminConfig = (env: Record<string, string | undefined>): string => join(dossierCodex(env), 'config.toml');

/** Texte de `config.toml`, lu seulement (jamais écrit par Mnemo) ; null : illisible ou absent. */
async function texteConfig(chemin: string): Promise<string | null> {
	try {
		return await readFile(chemin, 'utf8');
	} catch {
		return null;
	}
}

function raisonCourte(texte: string): string {
	return (texte.split(/\r?\n/u).find((l) => l.trim() !== '') ?? '').trim().slice(0, 200);
}

const echecDe = (erreur: unknown): { echec: string } => {
	const e = erreur as { code?: string; message?: string };
	return { echec: e.code === 'ENOENT' ? INTROUVABLE : raisonCourte(e.message ?? '') || 'codex ne répond pas.' };
};

/** Lecture par `codex mcp get mnemo --json` : la déclaration, `absent`, ou l'échec (sortie illisible, autre erreur). */
type Existante = { declaration: DeclarationCodex } | 'absent' | { echec: string };

/**
 * Codex déclare au niveau de l'utilisateur (`~/.codex/config.toml`, `[mcp_servers.mnemo]`), par sa ligne de commande
 * seulement : `mcp get --json`, `mcp add mnemo -- <node> <main> mcp` (réécrit une déclaration existante), `mcp remove`.
 */
function declarationCodex(a: AppelDeclaration) {
	const { commande } = a;
	const node = nodeDurable(a.plateforme as NodeJS.Platform);
	const lancer = (args: string[]) => {
		if (commande === null) throw Object.assign(new Error(INTROUVABLE), { code: 'ENOENT' });
		return a.executer(commande.commande, [...commande.avant, ...args], a.delaiMs === undefined ? undefined : { delaiMs: a.delaiMs });
	};
	const existante = async (): Promise<Existante> => {
		const r = await lancer(['mcp', 'get', 'mnemo', '--json']);
		if (r.code !== 0) return /No MCP server named/u.test(r.erreur) ? 'absent' : { echec: raisonCourte(r.erreur) || `codex mcp get : code ${r.code}` };
		const declaration = lireDeclarationCodex(r.sortie);
		return declaration === null ? { echec: 'Sortie de « codex mcp get --json » illisible.' } : { declaration };
	};
	const ajouter = () => lancer(['mcp', 'add', 'mnemo', '--', node, a.main, 'mcp']);
	return { node, lancer, existante, ajouter };
}

async function lire(a: AppelDeclaration): Promise<LectureDeclaration> {
	if (a.commande === null) return { echec: INTROUVABLE };
	const { node, existante } = declarationCodex(a);
	try {
		const e = await existante();
		if (e === 'absent' || 'echec' in e) return e;
		if (!e.declaration.active) return 'desactive';
		if (lanceCeMnemo(e.declaration, node, a.main)) return 'deja';
		return estDeclarationMnemo(e.declaration) ? 'perime' : 'autre';
	} catch (erreur) {
		return echecDe(erreur);
	}
}

/** Déclare si rien ne l'est ; une déclaration `mnemo` existante n'est jamais réécrite (périmée : commande manuelle ; désactivée : laissée). */
async function declarer(a: AppelDeclaration): Promise<ResultatDeclaration> {
	const { node, existante, ajouter } = declarationCodex(a);
	const manuel = commandeManuelleCodex(node, a.main, a.plateforme);
	if (a.commande === null) return { manuel, introuvable: true, raison: INTROUVABLE };
	try {
		const e = await existante();
		if (e !== 'absent' && 'echec' in e) return { manuel, introuvable: false, raison: e.echec };
		if (e !== 'absent') {
			if (!e.declaration.active) return { manuel, introuvable: false, raison: DESACTIVEE };
			if (lanceCeMnemo(e.declaration, node, a.main)) return 'deja';
			return { perime: true, manuel, remplacable: estDeclarationMnemo(e.declaration) };
		}
		const ajout = await ajouter();
		if (ajout.code === 0) return 'declare';
		return { manuel, introuvable: false, raison: raisonCourte(ajout.erreur) || `code ${ajout.code}` };
	} catch (erreur) {
		const e = erreur as { code?: string; message?: string };
		return { manuel, introuvable: e.code === 'ENOENT', raison: raisonCourte(e.message ?? '') };
	}
}

/**
 * Refait une déclaration de Mnemo qui lance un autre Node ou un autre `main.ts`, seulement si elle ne porte que `command` et
 * `args` (lus dans `codex mcp get --json` et dans `config.toml`) ; sinon un échec qui dit quoi changer à la main. Ne déclare
 * rien de neuf, ne touche pas une autre déclaration.
 */
async function remplacer(a: AppelDeclaration): Promise<ResultatRedeclaration> {
	if (a.commande === null) return { echec: INTROUVABLE };
	const { node, existante, ajouter } = declarationCodex(a);
	try {
		const e = await existante();
		if (e === 'absent' || 'echec' in e) return e;
		if (lanceCeMnemo(e.declaration, node, a.main)) return 'deja';
		if (!estDeclarationMnemo(e.declaration)) return 'autre';
		// `codex mcp add` réécrit toute la table `[mcp_servers.mnemo]` : jamais sur des réglages que Mnemo ne pose pas
		const chemin = cheminConfig(a.env);
		const texte = await texteConfig(chemin);
		if (texte === null) return { echec: `${chemin} illisible : impossible de vérifier que la déclaration MCP « mnemo » ne porte pas de réglages personnels ; mettez-la à jour à la main : ${lignesTomlCodex(node, a.main)}.` };
		const reglages = [...new Set([...e.declaration.reglages, ...reglagesDansConfig(texte)])];
		if (reglages.length > 0)
			return { echec: `la déclaration MCP « mnemo » de Codex porte des réglages personnels (${reglages.join(', ')}) : mettez-la à jour à la main dans ${chemin}, section [mcp_servers.mnemo] : ${lignesTomlCodex(node, a.main)}.` };
		// déclaration nue de Mnemo : `codex mcp add` la réécrit, sans moment sans déclaration
		const ajout = await ajouter();
		if (ajout.code !== 0) return { echec: raisonCourte(ajout.erreur) || `codex mcp add : code ${ajout.code}` };
		return 'remplace';
	} catch (erreur) {
		return echecDe(erreur);
	}
}

/** Retire la déclaration seulement si elle lance ce Node et ce `main.ts`. */
async function retirer(a: AppelDeclaration): Promise<ResultatRetraitMcp> {
	if (a.commande === null) return { echec: INTROUVABLE };
	const { node, lancer, existante } = declarationCodex(a);
	try {
		const e = await existante();
		if (e === 'absent' || 'echec' in e) return e;
		if (!lanceCeMnemo(e.declaration, node, a.main)) return 'autre';
		const retrait = await lancer(['mcp', 'remove', 'mnemo']);
		if (retrait.code !== 0) return { echec: raisonCourte(retrait.erreur) || `codex mcp remove : code ${retrait.code}` };
		return 'retire';
	} catch (erreur) {
		return echecDe(erreur);
	}
}

/** Codex : `codex mcp get mnemo --json | add mnemo -- … | remove mnemo`. */
export const DECLARATION_MCP_CODEX: DeclarationMcp = { manuelle: commandeManuelleCodex, lire, declarer, remplacer, retirer };
