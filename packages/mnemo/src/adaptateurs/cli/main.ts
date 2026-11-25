#!/usr/bin/env node
const [majeure] = process.versions.node.split('.').map(Number);
if (majeure === undefined || majeure < 24) {
	console.error(`Mnemo demande Node 24 ou plus (version actuelle : ${process.versions.node}).`);
	process.exit(1);
}

const { DOSSIER_MEMOIRE } = await import('../../domaine/dossier-memoire.ts');
const { FICHES_MOTEURS } = await import('../../domaine/moteurs/catalogue.ts');

/** Une entrée de l'aide : la commande, puis sa description repliée à 120 colonnes, en retrait de 20. */
function entree(commande: string, description: string): string {
	const lignes: string[] = [];
	let ligne = '';
	for (const mot of description.split(' ')) {
		if (ligne !== '' && 20 + ligne.length + 1 + mot.length > 120) {
			lignes.push(ligne);
			ligne = mot;
		} else ligne = ligne === '' ? mot : `${ligne} ${mot}`;
	}
	lignes.push(ligne);
	return `  ${commande.padEnd(18)}${lignes.join(`\n${' '.repeat(20)}`)}`;
}
/** « a, b et c ». */
const enumeration = (noms: readonly string[]): string => (noms.length < 2 ? noms.join('') : `${noms.slice(0, -1).join(', ')} et ${noms.at(-1)}`);
const FACULTATIFS = FICHES_MOTEURS.filter((m) => m.facultatif);
const IDS = FICHES_MOTEURS.map((m) => m.id).join('|');
const NOMS = FICHES_MOTEURS.map((m) => m.nom);

const USAGE = `Usage : mnemo [dossier] | mnemo <commande>

  mnemo [dossier]   service local (API et interface) du dossier Mnemo ; sans argument : celui du dossier courant

Commandes :
${entree(
	'init [dossier]',
	`crée la mémoire (dossier ${DOSSIER_MEMOIRE}/) ; dans un terminal, guide pas à pas (dossier, projets, déclaration MCP à Claude Code, modèles, commande, lanceur) [--oui : les défauts, sans question] [--mcp|--sans-mcp] [--modeles|--sans-modeles] [--commande|--sans-commande] [--lanceur|--sans-lanceur] : l'étape faite ou sautée sans question ; ${FACULTATIFS.map((m) => `[${m.optionInit}]`).join(' ')} : déclare aussi le serveur MCP à ${FACULTATIFS.map((m) => m.nom).join(', à ')}, et y installe les hooks ; [--json] : une ligne JSON par événement, sans question`,
)}
${entree('verifier-poste', `git, ${enumeration(NOMS)} (facultatifs, avec leur déclaration MCP et leurs hooks) et Node sur ce poste [--json]`)}
  lit <chemin>      affiche une fiche, chemin relatif à ${DOSSIER_MEMOIRE}/
  liste [dossier]   liste le contenu d'un dossier de la mémoire
  cherche <texte>   cherche dans la mémoire [--dossier <chemin>] [--tout] [--limite N] [--contexte]
  index             met l'index de recherche à jour [--reconstruire]
  migrer            migre l'ancien format (« Synthèse : », type_origine) en un commit ; sans effet si déjà fait
  source <chemin>   référence un document du dossier [--type <t>] [--version-de <fiche>] [--apres-proches]
  amorce            importe la mémoire de Claude Code comme sources [--dossier-claude <chemin>]
  modeles etat      état des modèles locaux (sens, reranker) et du moteur llama.cpp
  modeles installer installe les modèles qui manquent [--depuis <dossier>]
  modeles arreter   arrête les serveurs de modèles (un seul jeu pour la machine)
  banc [questions]  mesure la qualité de la recherche (sans fichier : mémoire d'essai) [--json]
  banc consignes    banc des consignes (vérification et rappel, sans claude) [--json]
  banc contexte     rejoue les cas étiquetés de .mnemo/banc-contexte.json (sans claude) [--extraire <session>] [--json] ; --gestes : comptes des gestes ; --apprendre : note de confiance
  banc extraction|contradictions --reel  bancs de l'archiviste : lancent le vrai claude -p (abonnement consommé) [--json]
  jeton             adresse de première ouverture dans un navigateur (avec le jeton) [--renouveler]
  ouvrir [dossier]  ouvre Mnemo en fenêtre d'application (démarre le service, détaché, s'il ne tourne pas)
  arreter [dossier] arrête le service du dossier (comme Ctrl-C ; pour un service démarré par « ouvrir »)
  lanceur           crée ~/Applications/Mnemo.app (macOS), qui fait « mnemo ouvrir » pour ce dossier [--retirer]
  commande          installe la commande « mnemo » dans ~/.local/bin (macOS, Linux) [--retirer]
${entree('declarer', `déclaration MCP existante (${FACULTATIFS.map((m) => m.nom).join(', ')} : et leurs hooks) : --remplacer (sur ce Node et ce Mnemo) | --retirer [--moteur ${IDS}] (claude-code par défaut) [--json]`)}
${entree('mcp', `serveur MCP pour ${enumeration(NOMS)} (stdio)`)}
${entree('hook <événement>', `hook de session (debut, message, outil, apres_outil, arret, fin) [--moteur ${IDS}], entrée JSON sur stdin`)}
  ligne-etat        ligne d'état des sessions Mnemo : transmet les quotas du compte au service, entrée JSON sur stdin
  sessions          sessions en cours (service lancé)
  session <action>  lancer <dossier> [--profil p] [--objectif t] | terminer <id> [--sans-bilan] | voir <id>

Option : --aide    affiche ce message`;

const { ErreurCli } = await import('./erreurs.ts');
const { COMMANDES_CLI } = await import('../../domaine/commandes.ts');

async function executer(args: string[]): Promise<void> {
	const [commande, ...reste] = args;
	switch (commande) {
		case undefined: {
			// sans argument : le service du dossier courant s'il est dans une mémoire, sinon l'aide
			const { trouverRacine } = await import('./racine.ts');
			if (trouverRacine(process.cwd()) !== null) return (await import('./service.ts')).commandeService(process.cwd());
			console.log(USAGE);
			return;
		}
		case '--aide':
		case '-h':
		case 'aide':
			console.log(USAGE);
			return;
		case 'init':
			return (await import('./init.ts')).commandeInit(reste);
		case 'verifier-poste':
			return (await import('./poste.ts')).commandeVerifierPoste(reste);
		case 'lit':
			return (await import('./lit.ts')).commandeLit(reste);
		case 'liste':
			return (await import('./liste.ts')).commandeListe(reste);
		case 'cherche':
			return (await import('./cherche.ts')).commandeCherche(reste);
		case 'index':
			return (await import('./reindexer.ts')).commandeIndex(reste);
		case 'migrer':
			return (await import('./migrer.ts')).commandeMigrer(reste);
		case 'source':
			return (await import('./source.ts')).commandeSource(reste);
		case 'amorce':
			return (await import('./amorce.ts')).commandeAmorce(reste);
		case 'modeles':
			return (await import('./modeles.ts')).commandeModeles(reste);
		case 'banc':
			return (await import('./banc.ts')).commandeBanc(reste);
		case 'jeton':
			return (await import('./jeton.ts')).commandeJeton(reste);
		case 'ouvrir':
			return (await import('./ouvrir.ts')).commandeOuvrir(reste);
		case 'arreter':
			return (await import('./arreter.ts')).commandeArreter(reste);
		case 'lanceur':
			return (await import('./lanceur.ts')).commandeLanceur(reste);
		case 'commande':
			return (await import('./commande.ts')).commandeCommande(reste);
		case 'declarer':
			return (await import('./declaration.ts')).commandeDeclarer(reste);
		case 'mcp':
			return (await import('./mcp.ts')).commandeMcp(reste);
		case 'hook':
			return (await import('./hook.ts')).commandeHook(reste);
		case 'ligne-etat':
			return (await import('./ligne-etat.ts')).commandeLigneEtat();
		case 'sessions':
			return (await import('./sessions.ts')).commandeSessions(reste);
		case 'session':
			return (await import('./sessions.ts')).commandeSession(reste);
		default: {
			if (COMMANDES_CLI.includes(commande)) throw new Error(`Commande sans aiguillage : « ${commande} ».`);
			// un premier argument qui n'est pas une commande mais un dossier : le service de ce dossier
			const { statSync } = await import('node:fs');
			const dossier = reste.length === 0 && !commande.startsWith('-') ? statSync(commande, { throwIfNoEntry: false }) : undefined;
			if (dossier?.isDirectory()) return (await import('./service.ts')).commandeService(commande);
			throw new ErreurCli(`Commande inconnue : « ${commande} ».\n\n${USAGE}`, 2);
		}
	}
}

try {
	await executer(process.argv.slice(2));
} catch (erreur) {
	if (erreur instanceof ErreurCli) {
		console.error(erreur.message);
		process.exitCode = erreur.code;
	} else {
		console.error(`Erreur : ${erreur instanceof Error ? erreur.message : String(erreur)}`);
		process.exitCode = 1;
	}
}
