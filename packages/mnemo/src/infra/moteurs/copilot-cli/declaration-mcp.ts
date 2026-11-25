import type { AppelDeclaration, DeclarationMcp, LectureDeclaration, ResultatDeclaration, ResultatRedeclaration, ResultatRetraitMcp } from '../../../application/ports.ts';
import { commandeManuelleCopilotCli, declarationDansConfig, desactiveDansReglages, entreeAColler, texteAvecDeclaration } from '../../../domaine/moteurs/copilot-cli/declaration.ts';
import type { ConfigMcpLue, DeclarationCopilotCli } from '../../../domaine/moteurs/copilot-cli/declaration.ts';
import { estLancementDeMnemo, lanceCeMnemo } from '../../../domaine/moteurs/declaration-mnemo.ts';
import { ecrireConfiguration, lireConfiguration, texteOuAbsent } from '../../fichier-de-configuration.ts';
import type { ConfigurationLue } from '../../fichier-de-configuration.ts';
import { nodeDurable } from '../../node-durable.ts';
import { cheminConfigMcpCopilot, cheminReglagesCopilot } from './dossier-copilot.ts';

const INTROUVABLE = '`copilot` introuvable (PATH, Homebrew, ~/.npm-global/bin, ou MNEMO_COPILOT).';

/** `mcp-config.json` lu et analysé ; ou l'échec. */
type Lue = { chemin: string; lu: ConfigurationLue; config: ConfigMcpLue } | { echec: string };

async function lireDeclaration(env: Record<string, string | undefined>): Promise<Lue> {
	const chemin = cheminConfigMcpCopilot(env);
	const lu = await lireConfiguration(chemin);
	if ('echec' in lu) return lu;
	const config = declarationDansConfig(lu.texte);
	if ('echec' in config) return { echec: `${chemin} : ${config.echec} ; corrigez-le, Mnemo ne le réécrit pas.` };
	return { chemin, lu, config };
}

/** `disabledMcpServers` de `settings.json` nomme `mnemo` ; illisible : tenu pour actif. */
const desactive = (env: Record<string, string | undefined>): Promise<boolean> => texteOuAbsent(cheminReglagesCopilot(env)).then(desactiveDansReglages, () => false);

const deCeMnemo = (d: DeclarationCopilotCli, node: string, main: string): boolean => d.lancement !== null && lanceCeMnemo(d.lancement, node, main);
const deMnemo = (d: DeclarationCopilotCli): boolean => d.lancement !== null && estLancementDeMnemo(d.lancement);

/** Pourquoi Mnemo n'écrit pas ce fichier : il porte des commentaires ou des virgules finales, que la réécriture perdrait. */
const refusJsonc = (chemin: string, node: string, main: string, action: string): string =>
	`${chemin} porte des commentaires ou des virgules finales, que Mnemo perdrait en le réécrivant : ${action} à la main, dans « mcpServers » : ${entreeAColler(node, main)}.`;

async function lire(a: AppelDeclaration): Promise<LectureDeclaration> {
	if (a.commande === null) return { echec: INTROUVABLE };
	const e = await lireDeclaration(a.env);
	if ('echec' in e) return e;
	const d = e.config.declaration;
	if (d === null) return 'absent';
	if (await desactive(a.env)) return 'desactive';
	if (deCeMnemo(d, nodeDurable(a.plateforme as NodeJS.Platform), a.main)) return 'deja';
	return deMnemo(d) ? 'perime' : 'autre';
}

/** Déclare si rien ne l'est (entrée ajoutée à `mcpServers`) ; une déclaration `mnemo` existante n'est jamais réécrite. */
async function declarer(a: AppelDeclaration): Promise<ResultatDeclaration> {
	const node = nodeDurable(a.plateforme as NodeJS.Platform);
	const manuel = commandeManuelleCopilotCli(node, a.main, a.plateforme);
	if (a.commande === null) return { manuel, introuvable: true, raison: INTROUVABLE };
	const e = await lireDeclaration(a.env);
	if ('echec' in e) return { manuel, introuvable: false, raison: e.echec };
	const d = e.config.declaration;
	if (d !== null) {
		// désactivée par l'utilisateur : laissée telle quelle
		if (await desactive(a.env)) return 'desactive';
		if (deCeMnemo(d, node, a.main)) return 'deja';
		return { perime: true, manuel, remplacable: deMnemo(d) };
	}
	if (e.config.jsonc) return { manuel, introuvable: false, raison: refusJsonc(e.chemin, node, a.main, 'ajoutez la déclaration') };
	const echec = await ecrireConfiguration(e.chemin, e.lu, texteAvecDeclaration(e.lu.texte, e.config.racine, { node, main: a.main }));
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
	const d = e.config.declaration;
	if (d === null) return 'absent';
	if (deCeMnemo(d, node, a.main)) return 'deja';
	if (!deMnemo(d)) return 'autre';
	if (d.reglages.length > 0) {
		return { echec: `la déclaration MCP « mnemo » de GitHub Copilot CLI porte des réglages personnels (${d.reglages.join(', ')}) : mettez-la à jour à la main dans ${e.chemin}, dans « mcpServers » : ${entreeAColler(node, a.main)}.` };
	}
	if (e.config.jsonc) return { echec: refusJsonc(e.chemin, node, a.main, 'remplacez la déclaration') };
	const echec = await ecrireConfiguration(e.chemin, e.lu, texteAvecDeclaration(e.lu.texte, e.config.racine, { node, main: a.main }));
	return echec ?? 'remplace';
}

/**
 * Retire la déclaration seulement si elle lance ce Node et ce `main.ts` et ne porte que ce que Mnemo écrit (des réglages
 * personnels, ou un fichier avec commentaires : un échec qui dit quoi faire, rien n'est perdu) ; le reste tel quel.
 */
async function retirer(a: AppelDeclaration): Promise<ResultatRetraitMcp> {
	if (a.commande === null) return { echec: INTROUVABLE };
	const e = await lireDeclaration(a.env);
	if ('echec' in e) return e;
	const d = e.config.declaration;
	if (d === null) return 'absent';
	const node = nodeDurable(a.plateforme as NodeJS.Platform);
	if (!deCeMnemo(d, node, a.main)) return 'autre';
	if (d.reglages.length > 0) {
		return { echec: `la déclaration MCP « mnemo » de GitHub Copilot CLI porte des réglages personnels (${d.reglages.join(', ')}) : Mnemo ne la retire pas ; retirez à la main l'entrée « mnemo » de « mcpServers » dans ${e.chemin}.` };
	}
	if (e.config.jsonc) return { echec: `${e.chemin} porte des commentaires ou des virgules finales, que Mnemo perdrait en le réécrivant : retirez à la main l'entrée « mnemo » de « mcpServers ».` };
	const echec = await ecrireConfiguration(e.chemin, e.lu, texteAvecDeclaration(e.lu.texte, e.config.racine, null));
	return echec ?? 'retire';
}

/**
 * GitHub Copilot CLI : l'entrée `mcpServers.mnemo` de `mcp-config.json` (`$COPILOT_HOME`, sinon `~/.copilot`), écrite par Mnemo
 * lui-même, atomiquement, les autres serveurs, leurs champs et le style du fichier gardés (`copilot mcp add` réécrirait tout
 * le fichier, champs inconnus et commentaires perdus ; mesuré). Désactivation : `disabledMcpServers` de `settings.json`.
 */
export const DECLARATION_MCP_COPILOT_CLI: DeclarationMcp = { manuelle: commandeManuelleCopilotCli, lire, declarer, remplacer, retirer };
