import type { AppelDeclaration, DeclarationMcp, LectureDeclaration, ResultatDeclaration, ResultatRedeclaration, ResultatRetraitMcp } from '../../../application/ports.ts';
import { estLancementDeMnemo, lanceCeMnemo } from '../../../domaine/moteurs/declaration-mnemo.ts';
import { commandeManuelleMistralVibe, declarationDansConfig, lignesTomlMistralVibe, texteAvecDeclaration, texteSansDeclaration } from '../../../domaine/moteurs/mistral-vibe/declaration.ts';
import type { DeclarationMistralVibe } from '../../../domaine/moteurs/mistral-vibe/declaration.ts';
import { ecrireConfiguration, lireConfiguration } from '../../fichier-de-configuration.ts';
import type { ConfigurationLue } from '../../fichier-de-configuration.ts';
import { nodeDurable } from '../../node-durable.ts';
import { cheminConfigVibe } from './dossier-vibe.ts';

const INTROUVABLE = '`vibe` introuvable (PATH, ~/.local/bin, ou MNEMO_VIBE).';

/** `config.toml` lu, et la déclaration `mnemo` qu'il porte (null : aucune) ; ou l'échec. */
type Lue = { chemin: string; lu: ConfigurationLue; declaration: DeclarationMistralVibe | null } | { echec: string };

async function lireDeclaration(env: Record<string, string | undefined>): Promise<Lue> {
	const chemin = cheminConfigVibe(env);
	const lu = await lireConfiguration(chemin);
	if ('echec' in lu) return lu;
	const d = declarationDansConfig(lu.texte);
	if ('echec' in d) return { echec: `${chemin} : ${d.echec} ; Mnemo ne le réécrit pas.` };
	return { chemin, lu, declaration: d.declaration };
}

const deCeMnemo = (d: DeclarationMistralVibe, node: string, main: string): boolean => d.lancement !== null && lanceCeMnemo(d.lancement, node, main);
const deMnemo = (d: DeclarationMistralVibe): boolean => d.lancement !== null && estLancementDeMnemo(d.lancement);

async function lire(a: AppelDeclaration): Promise<LectureDeclaration> {
	if (a.commande === null) return { echec: INTROUVABLE };
	const e = await lireDeclaration(a.env);
	if ('echec' in e) return e;
	const d = e.declaration;
	if (d === null) return 'absent';
	if (!d.active) return 'desactive';
	if (deCeMnemo(d, nodeDurable(a.plateforme as NodeJS.Platform), a.main)) return 'deja';
	return deMnemo(d) ? 'perime' : 'autre';
}

/** Déclare si rien ne l'est (bloc ajouté à la fin de `config.toml`) ; une déclaration `mnemo` existante n'est jamais réécrite. */
async function declarer(a: AppelDeclaration): Promise<ResultatDeclaration> {
	const node = nodeDurable(a.plateforme as NodeJS.Platform);
	const manuel = commandeManuelleMistralVibe(node, a.main, a.plateforme);
	if (a.commande === null) return { manuel, introuvable: true, raison: INTROUVABLE };
	const e = await lireDeclaration(a.env);
	if ('echec' in e) return { manuel, introuvable: false, raison: e.echec };
	const d = e.declaration;
	if (d !== null) {
		// désactivée par l'utilisateur : laissée telle quelle
		if (!d.active) return 'desactive';
		if (deCeMnemo(d, node, a.main)) return 'deja';
		return { perime: true, manuel, remplacable: deMnemo(d) };
	}
	const echec = await ecrireConfiguration(e.chemin, e.lu, texteAvecDeclaration(e.lu.texte, node, a.main));
	return echec === null ? 'declare' : { manuel, introuvable: false, raison: echec.echec };
}

/**
 * Refait une déclaration de Mnemo qui lance un autre Node ou un autre `main.ts`, seulement si elle ne porte que ce que Mnemo
 * écrit ; sinon un échec qui dit quoi changer à la main. Ne déclare rien de neuf, ne touche pas une autre déclaration.
 */
async function remplacer(a: AppelDeclaration): Promise<ResultatRedeclaration> {
	if (a.commande === null) return { echec: INTROUVABLE };
	const node = nodeDurable(a.plateforme as NodeJS.Platform);
	const e = await lireDeclaration(a.env);
	if ('echec' in e) return e;
	const d = e.declaration;
	if (d === null) return 'absent';
	if (deCeMnemo(d, node, a.main)) return 'deja';
	if (!deMnemo(d)) return 'autre';
	if (d.reglages.length > 0) {
		return { echec: `la déclaration MCP « mnemo » de Mistral Vibe porte des réglages personnels (${d.reglages.join(', ')}) : mettez-la à jour à la main dans ${e.chemin}, bloc [[mcp_servers]] name = "mnemo" : ${lignesTomlMistralVibe(node, a.main)}.` };
	}
	const echec = await ecrireConfiguration(e.chemin, e.lu, texteAvecDeclaration(e.lu.texte, node, a.main, d.plage));
	return echec ?? 'remplace';
}

/** Retire la déclaration seulement si elle lance ce Node et ce `main.ts` ; le reste de `config.toml` tel quel. */
async function retirer(a: AppelDeclaration): Promise<ResultatRetraitMcp> {
	if (a.commande === null) return { echec: INTROUVABLE };
	const e = await lireDeclaration(a.env);
	if ('echec' in e) return e;
	const d = e.declaration;
	if (d === null) return 'absent';
	if (!deCeMnemo(d, nodeDurable(a.plateforme as NodeJS.Platform), a.main)) return 'autre';
	const echec = await ecrireConfiguration(e.chemin, e.lu, texteSansDeclaration(e.lu.texte!, d.plage));
	return echec ?? 'retire';
}

/**
 * Mistral Vibe : le bloc `[[mcp_servers]]` `name = "mnemo"` de `config.toml`, écrit par Mnemo lui-même, atomiquement, sans
 * toucher au reste (`vibe mcp add` réécrirait tout le fichier, commentaires perdus).
 */
export const DECLARATION_MCP_MISTRAL_VIBE: DeclarationMcp = { manuelle: commandeManuelleMistralVibe, lire, declarer, remplacer, retirer };
