// Passages des documents : dérivés des fichiers d'origine, refaits quand leur empreinte change (jetables, dans l'index).
import { lireFiche } from '../domaine/fiche.ts';
import { messageDErreur } from '../domaine/texte.ts';
import { contenuDeSource, descripteurDeSource } from '../domaine/source.ts';
import type { DescripteurSource } from '../domaine/source.ts';
import { empreinteContenu } from './contenu.ts';
import { passagesDeMarkdown } from './extraire-passages.ts';
import { ErreurFichier } from './ports.ts';
import type { CibleExtraction, Dependances, DocumentOuvert, EtatSource, ResultatCible } from './ports.ts';

type EtatConnu = EtatSource & { passages: number };
type Etat = Omit<EtatSource, 'fiche'>;
type Base = Pick<EtatSource, 'descripteur' | 'versionDe' | 'parente'>;
/** Une source dont le document est à relire (et peut-être à réextraire). */
type ARelire = { fiche: string; d: DescripteurSource; connue: EtatConnu | undefined; meme: boolean; base: Base; mtimeMs: number; taille: number };

/** Une réservation plus ancienne est reprise : son processus est sans doute mort. */
export const PEREMPTION_RESERVATION_MS = 10 * 60 * 1000;
/**
 * Pendant la lecture et l'extraction d'un fichier, ses réservations sont renouvelées à ce rythme : une extraction plus longue
 * que la péremption (jusqu'à 22 min pour 10 Go) n'est jamais reprise par un autre processus tant que le sien vit.
 */
export const RENOUVELLEMENT_RESERVATION_MS = PEREMPTION_RESERVATION_MS / 5;

export type OptionsPassages = {
	/**
	 * Faux : rien n'est lu ni extrait (les hooks, sensibles à la latence, se servent de ce qui est indexé) ; seuls les
	 * fichiers disparus et les notes amorcées sont traités.
	 */
	extraire: boolean;
	/** Seules ces fiches sont lues et extraites (les autres : comme sans extraction). */
	seulement?: ReadonlySet<string>;
	/**
	 * Passages déjà extraits d'un fichier (par `extraireSource`, juste avant) : pris tels quels pour les fiches nommées, si
	 * le fichier est le même ; sinon (il a changé entre-temps), extraits comme d'habitude. Même (mtime, taille) qu'à cette
	 * lecture : son empreinte est reprise, le fichier n'est pas relu pour la calculer.
	 */
	dejaExtraites?: { fichier: string; empreinte: string; etat: { mtimeMs: number; taille: number }; resultats: ReadonlyMap<string, ResultatCible> };
	/** Rythme du renouvellement des réservations (tests) ; `RENOUVELLEMENT_RESERVATION_MS` par défaut. */
	renouvellementMs?: number;
};

/** Contenu amorcé d'une fiche source (section `## Contenu`), ou null (fiche illisible, sans contenu). */
function contenuAmorce(fiche: string, texte: string | null): string | null {
	if (texte === null) return null;
	try {
		return contenuDeSource(lireFiche(fiche, texte));
	} catch {
		return null;
	}
}

/** Cible d'extraction d'une fiche source, tirée de son descripteur. */
export const cibleDe = (fiche: string, d: DescripteurSource): CibleExtraction => ({
	fiche, fil: d.fil, piece: d.piece, positionPiece: d.positionPiece, titre: d.titre, date: d.date, auteur: d.auteur, typeSource: d.typeSource, resume: d.resume,
});

const message = messageDErreur;

/** « 1 fil nouveau », « N fils nouveaux ». */
export const avisFilsNouveaux = (n: number): string => (n > 1 ? `${n} fils nouveaux` : '1 fil nouveau');

/**
 * Met les passages de chaque fiche `source` d'accord avec son document, après la synchronisation des fiches.
 * Pour une source à fichier : (mtime, taille) d'abord, puis l'empreinte des octets ; inchangé → rien. L'extraction passe
 * par le port `Extraction` (isolée, bornée), HORS de toute transaction et hors verrou, une fois par fichier pour toutes ses
 * cibles (fils, pièces jointes) ; puis une transaction par source (`remplacerPassages`). Avant d'extraire, les sources sont
 * réservées dans l'index : un autre processus qui les trouve réservées les saute (il garde les anciens passages).
 * Fichier absent → passages retirés, état `disparue` (les faits citants deviennent `source_disparue`). Extraction en échec
 * → source dans `illisibles` avec son motif, anciens passages gardés, état `illisible` (réessayée quand le fichier ou la
 * fiche change). Note amorcée (sans fichier) : passages de sa section `## Contenu`. Une erreur de l'index remonte.
 *
 * `textes` : texte des fiches `source` réindexées à l'instant (descripteur à jour sans relecture).
 * `avis` : ce qui n'est pas une erreur mais demande un geste, par fiche (un `.mbox` qui a des fils sans fiche : rien n'est
 * écrit ici, `extraire_source` sur le même chemin les référence). `incompletes` : sources indexées en partie, par fiche, et
 * pourquoi (texte coupé à `TEXTE_MAX_DOCUMENT`, message trop gros écarté…). `differees` : sans extraction, les sources dont
 * le fichier a changé (ou n'a jamais été lu), laissées à une synchronisation complète.
 */
export async function synchroniserPassages(
	dep: Dependances,
	textes: Map<string, string>,
	illisibles: Map<string, string>,
	options: OptionsPassages,
	avis: Map<string, string> = new Map(),
	incompletes: Map<string, string> = new Map(),
	differees: Set<string> = new Set(),
): Promise<void> {
	const fiches = (await dep.index.elements({ genres: ['fiche'], typesFiche: ['source'] })).map((e) => e.chemin);
	const connues = new Map((await dep.index.sources()).map((s) => [s.fiche, s]));
	if (fiches.length === 0 && connues.size === 0) return;

	// Une fiche qui n'est plus une source (type changé) : ses passages et son état sont oubliés.
	const presentes = new Set(fiches);
	for (const fiche of connues.keys()) if (!presentes.has(fiche)) await dep.index.retirerPassages(fiche);

	/** Texte d'une fiche source : celui de la synchronisation, sinon relu ; null si illisible. */
	const texteDe = async (fiche: string): Promise<string | null> => {
		const deja = textes.get(fiche);
		if (deja !== undefined) return deja;
		try {
			const texte = await dep.coffre.lire(fiche);
			if (texte !== null) textes.set(fiche, texte);
			return texte;
		} catch {
			return null;
		}
	};
	const descripteurs = new Map<string, DescripteurSource>();
	for (const fiche of fiches) {
		const connue = connues.get(fiche);
		let descripteur: DescripteurSource | null = null;
		if (!textes.has(fiche) && connue !== undefined && connue.descripteur !== '') descripteur = (JSON.parse(connue.descripteur) as { source: DescripteurSource }).source;
		else {
			const texte = await texteDe(fiche);
			try {
				descripteur = texte === null ? null : descripteurDeSource(lireFiche(fiche, texte));
			} catch {
				descripteur = null;
			}
		}
		if (descripteur !== null) descripteurs.set(fiche, descripteur);
	}

	const sans = (base: Base, etat: EtatSource['etat']): Etat => ({ ...base, mtimeMs: null, taille: null, empreinteFichier: null, etat, secrets: 0, avertissements: [] });
	const disparue = async (fiche: string, base: Base, connue: EtatConnu | undefined, meme: boolean): Promise<void> => {
		if (!meme || connue?.etat !== 'disparue' || connue.passages > 0) await dep.index.remplacerPassages(fiche, [], [], sans(base, 'disparue'));
	};

	const etats = new Map<string, { mtimeMs: number; taille: number } | null>();
	const parFichier = new Map<string, ARelire[]>();
	for (const fiche of fiches) {
		const d = descripteurs.get(fiche);
		if (d === undefined) continue;
		const connue = connues.get(fiche);
		// Le fichier lu : le sien, ou celui de la source parente ; il fait partie du descripteur (la parente peut changer de fichier).
		const fichier = d.document ?? (d.parente === null ? null : (descripteurs.get(d.parente)?.document ?? null));
		const descripteur = JSON.stringify({ source: d, fichier });
		const meme = connue !== undefined && connue.descripteur === descripteur;
		const base: Base = { descripteur, versionDe: d.versionDe, parente: d.parente };

		if (fichier === null) {
			if (d.empreinteContenu === null) {
				if (!meme || connue.etat !== 'sans_document' || connue.passages > 0) await dep.index.remplacerPassages(fiche, [], [], sans(base, 'sans_document'));
				continue;
			}
			if (meme && connue.etat === 'indexee') continue;
			const contenu = contenuAmorce(fiche, await texteDe(fiche));
			if (contenu === null) continue;
			const { passages, sections, secrets } = passagesDeMarkdown(cibleDe(fiche, d), contenu, null);
			await dep.index.remplacerPassages(fiche, passages, sections, { ...sans(base, 'indexee'), empreinteFichier: d.empreinteContenu, secrets });
			continue;
		}

		let etat = etats.get(fichier);
		if (etat === undefined) {
			try {
				etat = await dep.documents.etat(fichier);
			} catch (erreur) {
				// chemin refusé (hors du dossier, caché, lien symbolique…) : signalé, rien n'est touché
				illisibles.set(fiche, erreur instanceof ErreurFichier ? message(erreur) : `chemin refusé : ${message(erreur)}`);
				continue;
			}
			etats.set(fichier, etat);
		}
		if (etat === null) {
			await disparue(fiche, base, connue, meme);
			continue;
		}
		if (meme && connue.etat !== 'disparue' && connue.mtimeMs === etat.mtimeMs && connue.taille === etat.taille) continue;
		if (!options.extraire) differees.add(fiche);
		if (!options.extraire || (options.seulement !== undefined && !options.seulement.has(fiche))) continue;
		const groupe = parFichier.get(fichier) ?? [];
		groupe.push({ fiche, d, connue, meme, base, mtimeMs: etat.mtimeMs, taille: etat.taille });
		parFichier.set(fichier, groupe);
	}

	/** Fils du fichier sans fiche (comparés par clé ; fiches à l'ancienne, par rang : rien à dire) → avis sur la fiche du fichier. */
	const noterFilsNouveaux = (fichier: string, cles: string[]): void => {
		const duFichier = [...descripteurs].filter(([, d]) => (d.document ?? (d.parente === null ? null : (descripteurs.get(d.parente)?.document ?? null))) === fichier);
		if (duFichier.some(([, d]) => typeof d.fil === 'number')) return;
		const connues = new Set(duFichier.flatMap(([, d]) => (typeof d.fil === 'string' ? [d.fil] : [])));
		const principale = duFichier.find(([, d]) => d.document !== null && d.fil === null);
		if (principale === undefined) return;
		// Une fiche seule (pas conteneur) couvre un fil, le plus ancien : les autres sont nouveaux.
		const nouveaux = cles.filter((c) => !connues.has(c)).length - (principale[1].conteneur ? 0 : 1);
		if (nouveaux > 0) avis.set(principale[0], `${avisFilsNouveaux(nouveaux)} : relancer extraire_source`);
	};

	if (parFichier.size === 0) return;
	const jeton = dep.systeme.nouvelId();
	for (const [fichier, groupe] of parFichier) {
		const reservees = new Set(await dep.index.reserverSources(groupe.map((g) => g.fiche), jeton, dep.systeme.maintenant().getTime(), PEREMPTION_RESERVATION_MS));
		// Réservées par un autre processus en train de les extraire : sautées, leurs anciens passages restent.
		const mien = groupe.filter((g) => reservees.has(g.fiche));
		if (mien.length === 0) continue;
		// renouvelées tant que le fichier est lu et extrait (un échec : réessayé au tour suivant, la péremption laisse de la marge)
		const renouvellement = setInterval(() => {
			dep.index.reserverSources([...reservees], jeton, dep.systeme.maintenant().getTime(), PEREMPTION_RESERVATION_MS).catch(() => {});
		}, options.renouvellementMs ?? RENOUVELLEMENT_RESERVATION_MS);
		try {
			let ouvert: DocumentOuvert | null;
			try {
				ouvert = await dep.documents.ouvrir(fichier);
			} catch (erreur) {
				// lecture impossible (verrou, droits, trop gros) : réessayée à la synchronisation suivante
				for (const g of mien) illisibles.set(g.fiche, `lecture impossible : ${message(erreur)}`);
				continue;
			}
			if (ouvert === null) {
				for (const g of mien) await disparue(g.fiche, g.base, g.connue, g.meme);
				continue;
			}
			let empreinteFichier: string;
			let resultats: ResultatCible[];
			const aExtraire: ARelire[] = [];
			const lu = (g: ARelire) => ({ ...g.base, mtimeMs: g.mtimeMs, taille: g.taille, empreinteFichier });
			try {
				// hachée en flux, puis lue par l'extraction à sa demande : le fichier n'est jamais chargé d'un bloc
				const deja = options.dejaExtraites;
				const memeLecture = deja !== undefined && deja.fichier === fichier && mien.every((g) => g.mtimeMs === deja.etat.mtimeMs && g.taille === deja.etat.taille);
				try {
					empreinteFichier = memeLecture ? deja.empreinte : await empreinteContenu(ouvert);
				} catch (erreur) {
					for (const g of mien) illisibles.set(g.fiche, `lecture impossible : ${message(erreur)}`);
					continue;
				}
				for (const g of mien) {
					// Fichier découpé en fils : sa fiche n'a pas de passages propres (ceux des fils), seulement l'état de son fichier.
					if (g.d.conteneur) await dep.index.remplacerPassages(g.fiche, [], [], { ...lu(g), etat: 'indexee', secrets: 0, avertissements: [] });
					else if (g.meme && g.connue!.empreinteFichier === empreinteFichier && g.connue!.etat !== 'disparue') {
						// seul l'horodatage a bougé : noté, pour ne plus relire
						await dep.index.noterSource(g.fiche, { ...lu(g), etat: g.connue!.etat, secrets: g.connue!.secrets, avertissements: g.connue!.avertissements });
					} else aExtraire.push(g);
				}
				if (aExtraire.length === 0) continue;
				resultats =
					deja !== undefined && deja.fichier === fichier && deja.empreinte === empreinteFichier && aExtraire.every((g) => deja.resultats.has(g.fiche))
						? aExtraire.map((g) => deja.resultats.get(g.fiche)!)
						: await dep.extraction.extraire(fichier, ouvert, aExtraire.map((g) => cibleDe(g.fiche, g.d)));
			} finally {
				await ouvert.fermer();
			}
			const cles = resultats.find((r) => r.ok && r.fils !== undefined && r.fils.length > 1);
			if (cles !== undefined && cles.ok) noterFilsNouveaux(fichier, cles.fils!);
			for (const [i, g] of aExtraire.entries()) {
				const r = resultats[i] ?? { ok: false as const, motif: 'extraction impossible : aucun résultat' };
				if (r.ok) {
					const avertissements = r.avertissements ?? [];
					await dep.index.remplacerPassages(g.fiche, r.passages, r.sections, { ...lu(g), etat: 'indexee', secrets: r.secrets, avertissements });
					if (avertissements.length > 0) incompletes.set(g.fiche, avertissements.join(' ; '));
				} else {
					// Extraction en échec : anciens passages gardés ; l'empreinte est notée pour ne pas réessayer à chaque recherche.
					illisibles.set(g.fiche, r.motif);
					await dep.index.noterSource(g.fiche, { ...lu(g), etat: 'illisible', secrets: g.connue?.secrets ?? 0, avertissements: [r.motif] });
				}
			}
		} finally {
			clearInterval(renouvellement);
			await dep.index.libererSources([...reservees], jeton);
		}
	}
}
