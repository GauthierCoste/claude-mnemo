import { avecAvertissements, EMPLACEMENTS_PAR_DEFAUT } from '@mnemo/commun';
import { cleDeCasse, nomDeFichier } from '../domaine/chemin.ts';
import { empreinte, empreinteOctets } from '../domaine/empreinte.ts';
import { analyserFiche, lireFiche } from '../domaine/fiche.ts';
import { CLE_EMPREINTE, CLE_EMPREINTES_ORIGINES, empreintesNotees, estOrigineDeNote, originesDe, retirerOrigine } from '../domaine/origines-importees.ts';
import { masquerSecrets } from '../domaine/secrets.ts';
import { CLE_A_TRAITER, TITRE_CONTENU } from '../domaine/source.ts';
import { messageDErreur } from '../domaine/texte.ts';
import type { Fiche } from '../domaine/fiche.ts';
import { lirePlage } from './contenu.ts';
import { aujourdhui, cheminDeFiche, cheminExistant, dossiersManquants, ecrireEtCommiter, enFichier, ficheVide, motifTitreInvalide, sousVerrou, texteDeFiche } from './commun.ts';
import type { AvecAvertissements } from '@mnemo/commun';
import { ErreurFichier } from './ports.ts';
import type { Dependances, DossierClaude, FichierIgnore, InstructionClaude, MemoireClaude, NoteClaude, ProjetsClaude } from './ports.ts';
import { referencerDocument, sourcesDeDocuments } from './referencer-document.ts';
import { avertissementsPassages, reindexerApresEcriture, synchroniserApresEcriture } from './synchroniser.ts';
import { sourcesDuCoffre } from './sources.ts';

/** Compte d'un genre de fichier importé : fiches nouvelles, réécrites (le fichier a changé), inchangées. */
export type CompteAmorcage = { ajoutees: number; mises_a_jour: number; inchangees: number };

/**
 * Bilan d'un amorçage. Les compteurs de tête valent pour les notes de mémoire (et le CLAUDE.md global) ; `instructions` :
 * les CLAUDE.md et `.claude/*.md` des projets ; `rattachees` : fiches rattachées à un dossier par cet amorçage (notes, ou
 * instructions déjà référencées dont seul le projet change) ; `secrets` : secrets masqués dans les fichiers importés ou
 * réimportés ; `ignorees` = `ignores.length` ; `aTraiter` : fiches nouvelles ou modifiées par cet import, marquées
 * `a_traiter` pour l'archiviste (`document` : le fichier d'une instruction de projet) ; `regroupees` : notes de même contenu qu'une fiche
 * déjà importée sous une autre origine (même note vue dans plusieurs projets) : aucune fiche en plus, l'origine est notée sur
 * la fiche existante ; `avertissements` : ce qui n'a pas pu se faire
 * sans annuler l'import (passages non indexés).
 */
export type BilanAmorcage = CompteAmorcage & {
	ignorees: number;
	instructions: CompteAmorcage;
	rattachees: number;
	regroupees: number;
	secrets: number;
	ignores: FichierIgnore[];
	aTraiter: { fiche: string; document?: string }[];
	commit: string | null;
} & AvecAvertissements;

/** Taille maximale d'un fichier d'instructions importé (comme une note de mémoire) ; au-delà, ignoré. */
export const TAILLE_MAX_INSTRUCTION = 1024 * 1024;

/** Bloc de code dont la clôture est plus longue que toute suite d'accents graves de la note : rien dedans ne peut l'en faire sortir. */
function blocDeCode(texte: string): string {
	const plusLongue = Math.max(0, ...(texte.match(/`+/gu) ?? []).map((s) => s.length));
	const cloture = '`'.repeat(Math.max(3, plusLongue + 1));
	return `${cloture}\n${texte.replace(/\r\n|\r/gu, '\n').replace(/\n+$/u, '')}\n${cloture}`;
}

const origineDe = (note: NoteClaude, nom: string): string =>
	note.origine === 'claude_md' ? 'claude-code/CLAUDE.md' : `claude-code/${note.projet}/memory/${nom}.md`;

/** Dossier des notes importées de la mémoire de Claude Code (fiches `source`). */
export const DOSSIER_CLAUDE_CODE = EMPLACEMENTS_PAR_DEFAUT.claudeCode;

function cheminDeNote(note: NoteClaude): string | null {
	return cheminDeFiche(`${DOSSIER_CLAUDE_CODE}/${nomDeFichier(note.projet)}/${nomDeFichier(note.nom)}.md`);
}

/**
 * Notes déjà importées, par leur donnée `origine` (unique pour une note de mémoire ou le CLAUDE.md global), où que
 * l'archiviste les ait rangées. Deux fiches de même origine : la première par chemin est retenue, l'autre est signalée.
 */
async function notesParOrigine(dep: Dependances, ignores: FichierIgnore[]): Promise<Map<string, string>> {
	const parOrigine = new Map<string, string>();
	for (const { chemin, fiche } of await sourcesDuCoffre(dep)) {
		const origine = fiche.donnees['origine'];
		if (typeof origine !== 'string' || !estOrigineDeNote(origine)) continue;
		const deja = parOrigine.get(origine);
		if (deja === undefined) parOrigine.set(origine, chemin);
		else ignores.push({ chemin, raison: `même origine que ${deja} (${origine}) : seule ${deja} est mise à jour` });
	}
	return parOrigine;
}

/**
 * Fiches importées par le contenu de leur note (`empreinte_origine`), pour reconnaître la même note vue dans un autre projet.
 * Seules les notes de mémoire comptent (pas le CLAUDE.md global). Deux fiches de même empreinte : la première par chemin.
 * `regroupees` : pour chaque origine notée dans les `origines` d'une fiche (autre que la sienne), cette fiche.
 */
async function notesParEmpreinte(dep: Dependances): Promise<{ parEmpreinte: Map<string, FicheImportee>; regroupees: Map<string, FicheImportee> }> {
	const parEmpreinte = new Map<string, FicheImportee>();
	const regroupees = new Map<string, FicheImportee>();
	for (const { chemin, fiche } of await sourcesDuCoffre(dep)) {
		const origine = fiche.donnees['origine'];
		const hache = fiche.donnees[CLE_EMPREINTE];
		if (typeof origine !== 'string' || origine === 'claude-code/CLAUDE.md' || !estOrigineDeNote(origine) || typeof hache !== 'string') continue;
		if (!parEmpreinte.has(hache)) parEmpreinte.set(hache, { chemin, fiche });
		for (const autre of originesDe(fiche)) if (autre !== origine && !regroupees.has(autre)) regroupees.set(autre, { chemin, fiche });
	}
	return { parEmpreinte, regroupees };
}

type FicheImportee = { chemin: string; fiche: Fiche };

/**
 * Origines versées dans une fiche par l'entretien (fusion, suppression avec redirection), notées avec l'empreinte de leur
 * note dans `empreintes_origines` : origine → la fiche (de tout type) et cette empreinte. Deux fiches pour une même origine :
 * la première par chemin.
 */
async function originesVersees(dep: Dependances): Promise<Map<string, FicheImportee & { empreinte: string }>> {
	const versees = new Map<string, FicheImportee & { empreinte: string }>();
	for (const chemin of [...(await dep.coffre.toutesLesFiches())].sort()) {
		const texte = await dep.coffre.lire(chemin);
		if (texte === null || !texte.includes(CLE_EMPREINTES_ORIGINES)) continue;
		const { fiche, anomalies } = analyserFiche(chemin, texte);
		if (anomalies.some((a) => a.genre !== 'ligne')) continue;
		for (const [origine, empreinte] of empreintesNotees(fiche)) if (!versees.has(origine)) versees.set(origine, { chemin, fiche, empreinte });
	}
	return versees;
}

function titreDeNote(note: NoteClaude): string {
	const brut = masquerSecrets(note.nom.trim()).texte;
	return motifTitreInvalide(brut) === null ? brut : nomDeFichier(note.nom);
}

/** Nom de fiche d'une instruction : son chemin dans le projet, sans `.md` ni points de tête (`.claude/rules/x.md` → `claude-rules-x`). */
const nomDInstruction = (nom: string): string =>
	nomDeFichier(
		nom
			.replace(/\.md$/iu, '')
			.split('/')
			.map((s) => s.replace(/^\.+/u, ''))
			.filter((s) => s !== '')
			.join('-'),
	);

function titreDInstruction(i: InstructionClaude): string {
	const brut = masquerSecrets(`${i.nom} (${i.dossier})`).texte;
	return motifTitreInvalide(brut) === null ? brut : nomDInstruction(i.nom);
}

type Lue = InstructionClaude & { octets: Uint8Array };
type Liste = Awaited<ReturnType<ProjetsClaude['lister']>>;
const AUCUN_PROJET: Liste = { dossiers: [], instructions: [], ignores: [] };

/** Instructions lues par le port des documents (mêmes refus que `extraire_source`) ; un refus devient un fichier ignoré. */
async function lireInstructions(dep: Dependances, instructions: InstructionClaude[], ignores: FichierIgnore[]): Promise<Lue[]> {
	const lues: Lue[] = [];
	for (const i of instructions) {
		try {
			const etat = await dep.documents.etat(i.chemin);
			if (etat === null) {
				ignores.push({ chemin: i.chemin, raison: 'introuvable' });
				continue;
			}
			if (etat.taille > TAILLE_MAX_INSTRUCTION) {
				ignores.push({ chemin: i.chemin, raison: 'plus de 1 Mo' });
				continue;
			}
			const chemin = (await dep.documents.cheminReel(i.chemin)) ?? i.chemin;
			const ouvert = await dep.documents.ouvrir(chemin);
			if (ouvert === null) {
				ignores.push({ chemin: i.chemin, raison: 'introuvable' });
				continue;
			}
			try {
				// relu sous la même borne : un fichier qui a grossi entre-temps est ignoré comme les autres
				if (ouvert.taille > TAILLE_MAX_INSTRUCTION) ignores.push({ chemin: i.chemin, raison: 'plus de 1 Mo' });
				else lues.push({ ...i, chemin, octets: await lirePlage(ouvert, 0, ouvert.taille) });
			} finally {
				await ouvert.fermer();
			}
		} catch (erreur) {
			ignores.push({ chemin: i.chemin, raison: erreur instanceof ErreurFichier ? erreur.message : `illisible (${messageDErreur(erreur)})` });
		}
	}
	return lues;
}

/**
 * Importe la mémoire native de Claude Code comme fiches `source` (une par note), et référence les fichiers d'instructions
 * des projets (CLAUDE.md, `.claude/*.md`, listés par `projets`, lus par le port des documents) comme sources `note` à
 * document, rattachées à leur projet. Le tout en un seul commit, sous verrou ; puis les passages de ces instructions sont
 * indexés. Une note est rattachée (`projet`) au dossier dont la clé de dossier de Claude Code est la sienne. Aucun fait
 * n'est extrait ici : c'est le travail de l'archiviste. Un fichier inchangé (même empreinte) n'est pas réécrit ; une fiche
 * n'est jamais supprimée.
 */
export async function amorcer(dep: Dependances, memoire: MemoireClaude, projets?: ProjetsClaude): Promise<BilanAmorcage> {
	const lu = await memoire.lire();
	const notes = lu.notes;
	const ignores: FichierIgnore[] = [...lu.ignores];
	const liste = projets === undefined ? AUCUN_PROJET : await projets.lister();
	ignores.push(...liste.ignores);
	const parCle = new Map<string, DossierClaude>(liste.dossiers.map((d) => [d.cle.toLowerCase(), d]));
	const nomDe = new Map(liste.dossiers.map((d) => [d.dossier, d.nom]));
	const lues = await lireInstructions(dep, liste.instructions, ignores);

	const ecrit = await sousVerrou(dep, async () => {
		const bilan = { ajoutees: 0, mises_a_jour: 0, inchangees: 0, rattachees: 0, regroupees: 0, secrets: 0 };
		const instructions: CompteAmorcage = { ajoutees: 0, mises_a_jour: 0, inchangees: 0 };
		const aTraiter: BilanAmorcage['aTraiter'] = [];
		const fiches: { chemin: string; texte: string }[] = [];
		const dossiers: { chemin: string; texte: string }[] = [];
		const aIndexer = new Set<string>();
		const vus = new Set<string>();
		const dossiersVus = new Set<string>();
		const documents = await sourcesDeDocuments(dep);
		const notesDejaImportees = await notesParOrigine(dep, ignores);
		const { parEmpreinte, regroupees } = await notesParEmpreinte(dep);
		const versees = await originesVersees(dep);
		// fiches écrites par cet amorçage, par chemin : une copie vue plus tard dans un autre projet les complète (un seul fichier par chemin)
		const enCours = new Map<string, Fiche>();
		const ecrire = async (fiche: Fiche): Promise<void> => {
			const fichier = enFichier(dep, fiche);
			const deja = fiches.findIndex((f) => f.chemin === fiche.chemin);
			if (deja >= 0) fiches[deja] = fichier;
			else fiches.push(fichier);
			enCours.set(fiche.chemin, fiche);
			const manquants = await dossiersManquants(dep, fiche.chemin);
			// Un dossier existant à la casse près : on garde la fiche, il sera créé sous son propre nom plus tard.
			if (typeof manquants === 'string') return;
			for (const dossier of manquants) {
				if (dossiersVus.has(dossier.chemin)) continue;
				dossiersVus.add(dossier.chemin);
				dossiers.push(enFichier(dep, dossier));
			}
		};

		// Une origine regroupée sur une autre fiche que `chemin` (son contenu a changé) en est retirée.
		const quitterRegroupement = async (origine: string, chemin: string): Promise<void> => {
			const ancienne = regroupees.get(origine);
			if (ancienne === undefined || ancienne.chemin === chemin) return;
			regroupees.delete(origine);
			const fiche = enCours.get(ancienne.chemin) ?? ancienne.fiche;
			if (!retirerOrigine(fiche, origine)) return;
			fiche.updated = aujourdhui(dep);
			await ecrire(fiche);
		};

		// Ordre fixe (par origine), indépendant de l'ordre de lecture : la fiche d'une note vue dans plusieurs projets est celle
		// de la première origine, et rattachée à son projet.
		const parOrigine = [...notes].sort((a, b) => {
			const [x, y] = [origineDe(a, a.nom), origineDe(b, b.nom)];
			return x < y ? -1 : x > y ? 1 : 0;
		});
		for (const note of parOrigine) {
			const origine = origineDe(note, note.nom);
			const hache = empreinte(note.texte);
			// Origine versée dans une fiche par l'entretien (fusion, suppression avec redirection) : connue tant que sa note
			// n'a pas changé (rien à écrire) ; modifiée depuis dans Claude Code, c'est du nouveau contenu, importé comme une
			// note nouvelle, et l'origine quitte la fiche qui l'avait reçue (comme une copie regroupée qui diverge).
			const versee = notesDejaImportees.has(origine) ? undefined : versees.get(origine);
			if (versee !== undefined) {
				if (versee.empreinte === hache) {
					bilan.inchangees++;
					continue;
				}
				versees.delete(origine);
				const fiche = enCours.get(versee.chemin) ?? versee.fiche;
				if (retirerOrigine(fiche, origine)) {
					fiche.updated = aujourdhui(dep);
					await ecrire(fiche);
				}
			}
			// Même contenu qu'une fiche importée sous une autre origine : pas de copie. La fiche, rattachée au premier projet
			// vu, garde dans `origines` toutes les origines du contenu (la première comprise) ; réimport : rien à écrire, rien
			// à compter (`regroupees` ne compte que les nouveaux regroupements).
			const jumelle = note.origine === 'memoire' && !notesDejaImportees.has(origine) ? parEmpreinte.get(hache) : undefined;
			if (jumelle !== undefined) {
				const fiche = enCours.get(jumelle.chemin) ?? jumelle.fiche;
				const connues = originesDe(fiche);
				const toutes = connues.length > 0 ? connues : [String(fiche.donnees['origine'])];
				if (!toutes.includes(origine)) {
					bilan.regroupees++;
					await quitterRegroupement(origine, jumelle.chemin);
					fiche.donnees['origines'] = [...toutes, origine];
					fiche.updated = aujourdhui(dep);
					await ecrire(fiche);
					regroupees.set(origine, { chemin: jumelle.chemin, fiche });
				}
				continue;
			}
			const chemin = notesDejaImportees.get(origine) ?? cheminDeNote(note);
			if (chemin === null) {
				ignores.push({ chemin: origine, raison: 'nom inutilisable comme nom de fiche' });
				continue;
			}
			if (vus.has(cleDeCasse(chemin))) {
				ignores.push({ chemin: origine, raison: `même nom de fiche qu'une autre note (${chemin})` });
				continue;
			}
			if ((await cheminExistant(dep, chemin)) !== null) {
				ignores.push({ chemin: origine, raison: `une fiche existe déjà sous ce nom à la casse près (${chemin})` });
				continue;
			}
			vus.add(cleDeCasse(chemin));
			const cible = note.cle === undefined ? undefined : parCle.get(note.cle.toLowerCase());
			const existant = await dep.coffre.lire(chemin);
			let fiche: Fiche | null = null;
			if (existant !== null) {
				try {
					fiche = lireFiche(chemin, existant);
				} catch {
					fiche = null;
				}
				// Une fiche illisible, qui n'est pas une source, ou qui référence un fichier n'est pas à nous : jamais écrasée.
				if (fiche === null || fiche.type !== 'source' || fiche.donnees['chemin'] !== undefined) {
					ignores.push({ chemin: origine, raison: `la fiche ${chemin} n'est pas une note importée : jamais écrasée` });
					continue;
				}
				if (String(fiche.donnees[CLE_EMPREINTE]) === hache) {
					bilan.inchangees++;
					if (cible !== undefined && fiche.donnees['projet'] !== cible.dossier) {
						fiche.donnees['projet'] = cible.dossier;
						fiche.updated = aujourdhui(dep);
						bilan.rattachees++;
						await ecrire(fiche);
					}
					continue;
				}
			}
			if (cible !== undefined && fiche?.donnees['projet'] !== cible.dossier) bilan.rattachees++;
			const donnees = {
				type_source: note.origine === 'claude_md' ? 'utilisateur' : 'note',
				origine,
				[CLE_EMPREINTE]: hache,
				...(cible === undefined ? {} : { projet: cible.dossier }),
				[CLE_A_TRAITER]: true,
			};
			// Les secrets de la note ne sont jamais recopiés dans la mémoire (versionnée par git) ; l'empreinte, elle, est celle
			// de la note telle quelle (pour reconnaître une note inchangée).
			const masque = masquerSecrets(note.texte);
			bilan.secrets += masque.masques;
			const contenu = { titre: TITRE_CONTENU, corps: blocDeCode(masque.texte) };
			if (fiche !== null) {
				Object.assign(fiche.donnees, donnees);
				fiche.updated = aujourdhui(dep);
				const section = fiche.autresSections.find((s) => s.titre === TITRE_CONTENU);
				if (section === undefined) fiche.autresSections.push(contenu);
				else section.corps = contenu.corps;
				bilan.mises_a_jour++;
			} else {
				fiche = ficheVide(dep, chemin, 'source', titreDeNote(note), donnees);
				fiche.autresSections.push(contenu);
				if (existant !== null) bilan.mises_a_jour++;
				else bilan.ajoutees++;
			}
			aTraiter.push({ fiche: chemin });
			await ecrire(fiche);
			// une copie qui a divergé a désormais sa fiche : elle n'est plus une origine de la fiche qui la regroupait
			if (note.origine === 'memoire') await quitterRegroupement(origine, chemin);
			if (note.origine === 'memoire') {
				// l'empreinte de cette fiche a changé : l'ancienne ne désigne plus ce chemin
				for (const [h, v] of parEmpreinte) if (v.chemin === chemin) parEmpreinte.delete(h);
				parEmpreinte.set(hache, { chemin, fiche });
			}
		}

		const documentsVus = new Set<string>();
		for (const lue of lues) {
			const cleDocument = cleDeCasse(lue.chemin);
			if (documentsVus.has(cleDocument)) {
				ignores.push({ chemin: lue.chemin, raison: 'même fichier qu\'une autre instruction (à la casse près)' });
				continue;
			}
			documentsVus.add(cleDocument);
			const secrets = masquerSecrets(new TextDecoder().decode(lue.octets)).masques;
			// Déjà référencé (par un import précédent, `extraire_source` ou un dépôt) : la même fiche, jamais un double.
			const reference = await referencerDocument(dep, documents, { document: lue.chemin, empreinte: empreinteOctets(lue.octets), rattachement: { projet: lue.dossier } }, async () => {
				const dossier = nomDeFichier(nomDe.get(lue.dossier) ?? lue.dossier.toLowerCase());
				const chemin = cheminDeFiche(`${DOSSIER_CLAUDE_CODE}/${dossier}/${nomDInstruction(lue.nom)}.md`);
				if (chemin === null || vus.has(cleDeCasse(chemin)) || (await cheminExistant(dep, chemin)) !== null || (await dep.coffre.lire(chemin)) !== null) {
					return `nom de fiche déjà pris${chemin === null ? '' : ` (${chemin})`}`;
				}
				vus.add(cleDeCasse(chemin));
				return { chemin, titre: titreDInstruction(lue), donnees: { format: 'markdown', type_source: 'note', origine: 'claude-code/instructions' } };
			});
			switch (reference.statut) {
				case 'refusee':
					ignores.push({ chemin: lue.chemin, raison: reference.motif });
					continue;
				case 'inchangee':
					instructions.inchangees++;
					continue;
				case 'rattachee':
					instructions.inchangees++;
					bilan.rattachees++;
					break;
				case 'modifiee':
					instructions.mises_a_jour++;
					break;
				case 'nouvelle':
					instructions.ajoutees++;
					break;
			}
			if (reference.statut !== 'rattachee') {
				bilan.secrets += secrets;
				aTraiter.push({ fiche: reference.chemin, document: lue.chemin });
			}
			aIndexer.add(reference.chemin);
			await ecrire(reference.fiche);
		}

		// tout ou rien : un échec ne laisse aucune écriture partielle (le marqueur `a_traiter` part avec le commit, ou pas du tout)
		const commit = fiches.length === 0 ? null : await ecrireEtCommiter(dep, [...fiches, ...dossiers], `mnemo: amorçage (${fiches.length} fiches)`);
		return { ...bilan, instructions, aTraiter, aIndexer, commit };
	});

	const { aIndexer, ...bilan } = ecrit;
	const avertissements: string[] = [];
	if (aIndexer.size > 0) {
		// Passages des instructions indexés tout de suite, comme après toute écriture : un échec de l'index n'annule pas l'import.
		const synchro = await synchroniserApresEcriture(dep, { extraire: true, seulement: aIndexer });
		if ('bilan' in synchro) {
			avertissements.push(...avertissementsPassages(synchro.bilan, aIndexer));
		} else avertissements.push(...synchro.avertissements);
	}
	return { ...bilan, ...avecAvertissements(avertissements), ignorees: ignores.length, ignores };
}

/** Fiches `source` marquées `a_traiter` (l'archiviste ne les a pas encore traitées), triées. */
export async function fichesATraiter(dep: Dependances): Promise<string[]> {
	return (await sourcesDuCoffre(dep)).filter((s) => s.fiche.donnees[CLE_A_TRAITER] === true).map((s) => s.chemin);
}


/**
 * Retire la marque `a_traiter` de ces fiches sources (l'utilisateur les dit traitées) : celles qui ne la portent pas sont
 * ignorées. Tout ou rien, un seul commit pour le lot ; rend les fiches traitées, dans l'ordre demandé.
 */
export async function marquerTraitees(dep: Dependances, chemins: readonly string[]): Promise<{ traites: string[] } & AvecAvertissements> {
	const traitees = await sousVerrou(dep, async () => {
		const aEcrire: { chemin: string; texte: string }[] = [];
		for (const chemin of chemins) {
			const texte = await dep.coffre.lire(chemin);
			if (texte === null) continue;
			let fiche: Fiche;
			try {
				fiche = lireFiche(chemin, texte);
			} catch {
				continue;
			}
			if (fiche.type !== 'source' || fiche.donnees[CLE_A_TRAITER] !== true) continue;
			const donnees = { ...fiche.donnees };
			delete donnees[CLE_A_TRAITER];
			aEcrire.push({ chemin, texte: texteDeFiche(dep, { ...fiche, donnees, updated: aujourdhui(dep) }) });
		}
		if (aEcrire.length === 0) return [];
		const message = aEcrire.length === 1 ? `mnemo: fiche ${aEcrire[0]!.chemin} (traitee)` : `mnemo: ${aEcrire.length} fiches sources traitées`;
		await ecrireEtCommiter(dep, aEcrire, message);
		return aEcrire.map((f) => f.chemin);
	});
	return { traites: traitees, ...(traitees.length > 0 ? await reindexerApresEcriture(dep) : {}) };
}

