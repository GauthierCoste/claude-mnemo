// Ce qui arrive à une consigne destinée à l'archiviste : confiée, reprise, lancée, ou rendue à taper à la main.
import { CONSIGNE_CHEMINS_MAX, consigneATraiter, PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { cleDeCasse } from '../domaine/chemin.ts';
import { messageDErreur } from '../domaine/texte.ts';
import type { Session } from '../domaine/session.ts';
import { fichesATraiter } from './amorcer.ts';
import { consigneDesDossiers, dossiersNonRattaches, lotDeDossiers } from './dossiers-non-rattaches.ts';
import type { Pilote } from './pilote.ts';
import type { Dependances, Pilotage } from './ports.ts';
import { sourcesDeDocuments } from './referencer-document.ts';

/** Ce dont l'archiviste a besoin : la mémoire, le pilotage, et les tâches de fond du service. */
export type ContexteArchiviste = {
	dep: Dependances;
	pil: Pilotage;
	pilote: Pilote;
	/** Tâche de fond : le service l'attend avant de s'arrêter. */
	enFond(tache: Promise<unknown>): void;
	/** Le service s'arrête : plus aucun lancement. */
	arrete(): boolean;
	journal?: (message: string) => void;
};

/** `manuel` : l'archiviste ne peut pas tourner ici (mode dégradé) ; la commande à coller le lance ou le reprend avec la consigne. */
export type Remise = { archiviste: 'confie' } | { archiviste: 'repris' } | { archiviste: 'lance' } | { archiviste: 'manuel'; manuel: string };

/** Refus d'un lancement ; `arret` : le service s'arrête ; `conflit` : l'état du service l'empêche (dossier, profil de l'archiviste). */
export type RefusArchiviste = { refus: string; arret: boolean; conflit?: true };

/** `confie` : remise aux archivistes qui tournent ; `en_attente` : aucun ne tourne, la marque « à traiter » attend son lancement. */
type RemiseAuxActifs = 'confie' | 'en_attente';

const refusArret = (): RefusArchiviste => ({ refus: 'Le service s’arrête : l’archiviste ne peut pas être lancé.', arret: true });

/** Une ligne de consigne : jamais de retour à la ligne (tapée dans le terminal). */
const enUneLigne = (texte: string): string => texte.trim().replace(/\s*\n\s*/gu, ' ');

/** Sessions archivistes qui tournent ici. */
async function archivistesActifs(ctx: ContexteArchiviste): Promise<Session[]> {
	return (await ctx.pil.etat.lister()).filter((s) => s.profil === PROFIL_ARCHIVISTE && ctx.pilote.enCours(s.id));
}

function journaliser(ctx: ContexteArchiviste, motif: string): (e: unknown) => void {
	return (e) => ctx.journal?.(`${motif} : consigne non remise à l'archiviste (${messageDErreur(e)})`);
}

/** Tapée en fond chez chaque archiviste qui tourne (Échap d'abord si un dialogue est ouvert) ; il n'est jamais lancé pour ça. */
async function confierAuxActifs(ctx: ContexteArchiviste, consigne: string, motif: string): Promise<RemiseAuxActifs> {
	const actifs = await archivistesActifs(ctx);
	if (actifs.length === 0) return 'en_attente';
	const taper = async (): Promise<void> => {
		for (const s of actifs) await ctx.pilote.taper(s.id, consigne);
	};
	ctx.enFond(taper().catch(journaliser(ctx, motif)));
	return 'confie';
}

/** Une seule consigne aux archivistes qui tournent : elle nomme `fiches` (encore marquées), ou désigne la marque sans `fiches`. */
export async function confierLesFichesATraiter(
	ctx: ContexteArchiviste,
	motif: string,
	fiches?: readonly string[],
): Promise<{ fiches: string[]; archiviste: RemiseAuxActifs | 'rien' }> {
	const marquees = await fichesATraiter(ctx.dep);
	const aTraiter = fiches === undefined ? marquees : fiches.filter((f) => marquees.includes(f));
	if (aTraiter.length === 0) return { fiches: [], archiviste: 'rien' };
	const consigne = fiches === undefined ? consigneATraiter(aTraiter.length) : consigneATraiter(aTraiter.length, aTraiter);
	return { fiches: aTraiter, archiviste: await confierAuxActifs(ctx, consigne, motif) };
}

/** Fin d'un lot de dépôts : les fiches de ces documents encore « à traiter », en une seule consigne aux archivistes qui tournent. */
export async function confierLesDepots(ctx: ContexteArchiviste, documents: readonly string[]): Promise<{ fiches: string[]; archiviste: RemiseAuxActifs | 'rien' }> {
	const sources = await sourcesDeDocuments(ctx.dep);
	const fiches = documents.flatMap((d) => {
		const source = sources.get(cleDeCasse(d));
		return source === undefined ? [] : [source.chemin];
	});
	return confierLesFichesATraiter(ctx, 'depot', [...new Set(fiches)]);
}

/**
 * La consigne pour cet archiviste existant : tapée s'il tourne, repris d'abord s'il peut tourner ici, sinon la commande à
 * coller. `terminee` : il s'est terminé entre-temps, rien ne peut le reprendre.
 */
async function remettreA(ctx: ContexteArchiviste, session: Session, consigne: string, motif: string): Promise<Remise | RefusArchiviste | 'terminee'> {
	const { pilote } = ctx;
	if (!pilote.enCours(session.id) && !pilote.lancePossible()) {
		let manuel: string | null;
		try {
			manuel = await pilote.ligneDeReprise(session.id, consigne === '' ? undefined : consigne);
		} catch (erreur) {
			ctx.journal?.(`${motif} : commande de reprise impossible (${messageDErreur(erreur)})`);
			return { refus: `Commande de reprise de l’archiviste impossible : ${messageDErreur(erreur)}`, arret: false, conflit: true };
		}
		return manuel === null ? 'terminee' : { archiviste: 'manuel', manuel };
	}
	const enCours = pilote.enCours(session.id);
	if (consigne !== '') ctx.enFond(pilote.confier(session.id, consigne).catch(journaliser(ctx, motif)));
	return { archiviste: enCours ? 'confie' : 'repris' };
}

const refusTermine = (): RefusArchiviste => ({ refus: 'L’archiviste s’est terminé pendant la demande : réessaie.', arret: false });

/** Lancé avec la consigne pour objectif ; un archiviste apparu entre-temps (`existant`) la reçoit à sa place. */
async function lancerAvec(ctx: ContexteArchiviste, consigne: string, motif: string): Promise<Remise | RefusArchiviste> {
	const r = await ctx.pilote.lancer({ profil: PROFIL_ARCHIVISTE, dossier: '', objectif: consigne });
	if ('refus' in r) return { refus: r.refus, arret: ctx.arrete() };
	if ('existant' in r) {
		const remise = await remettreA(ctx, r.session, consigne, motif);
		return remise === 'terminee' ? refusTermine() : remise;
	}
	return 'manuel' in r ? { archiviste: 'manuel', manuel: r.manuel } : { archiviste: 'lance' };
}

/** Archiviste qui tourne : `confie` ; arrêté : `repris` ; aucun : `lance` ; mode dégradé : `manuel`. Jamais deux archivistes. */
export async function remettreConsigne(ctx: ContexteArchiviste, consigne: string): Promise<Remise | RefusArchiviste> {
	const motif = 'traiter';
	if ((await confierAuxActifs(ctx, consigne, motif)) === 'confie') return { archiviste: 'confie' };
	if (ctx.arrete()) return refusArret();
	const [arrete] = (await ctx.pil.etat.lister()).filter((s) => s.profil === PROFIL_ARCHIVISTE && s.etat !== 'terminee').sort((a, b) => b.majMs - a.majMs);
	if (arrete !== undefined) {
		const remise = await remettreA(ctx, arrete, consigne, motif);
		if (remise !== 'terminee') return remise;
	}
	return lancerAvec(ctx, consigne, motif);
}

/**
 * Fiches à remettre : celles demandées (`chemins`), ou toutes les fiches à traiter sauf celles déjà confiées (`sauf`).
 */
export type FichesDemandees = { chemins: readonly string[] } | { sauf: readonly string[] };

/**
 * Les fiches demandées encore « à traiter », remises à l'archiviste en une consigne (`consigneATraiter` : elle les nomme, ou
 * désigne la marque au-delà de `CONSIGNE_CHEMINS_MAX`) ; null : aucune n'est à traiter.
 */
export async function traiterLesFiches(ctx: ContexteArchiviste, demande: FichesDemandees): Promise<{ chemins: string[]; remise: Remise | RefusArchiviste } | null> {
	const enAttente = await fichesATraiter(ctx.dep);
	const marquees = new Set(enAttente);
	const sauf = new Set('sauf' in demande ? demande.sauf : []);
	const chemins = 'chemins' in demande ? demande.chemins.filter((c) => marquees.has(c)) : enAttente.filter((c) => !sauf.has(c));
	if (chemins.length === 0) return null;
	return { chemins, remise: await remettreConsigne(ctx, consigneATraiter(chemins.length, chemins)) };
}

/**
 * Les dossiers demandés encore non rattachés, remis à l'archiviste en une consigne qui nomme le premier lot (`lotDeDossiers`)
 * et dit combien restent ; rend les dossiers nommés ; null : aucun ne l'est.
 */
export async function traiterLesDossiers(ctx: ContexteArchiviste, demandes: readonly string[]): Promise<{ chemins: string[]; remise: Remise | RefusArchiviste } | null> {
	const enAttente = new Set((await dossiersNonRattaches(ctx.dep, ctx.pil.etat)).map((d) => d.dossier));
	const aRattacher = demandes.filter((d) => enAttente.has(d));
	if (aRattacher.length === 0) return null;
	return { chemins: lotDeDossiers(aRattacher), remise: await remettreConsigne(ctx, consigneDesDossiers(aRattacher)) };
}

/** Ce qui attend l'archiviste à son lancement, en consignes : les fiches « à traiter », puis les dossiers non rattachés. */
async function consignesEnAttente(ctx: ContexteArchiviste): Promise<string[]> {
	const fiches = (await fichesATraiter(ctx.dep)).length;
	const dossiers = (await dossiersNonRattaches(ctx.dep, ctx.pil.etat)).map((d) => d.dossier);
	return [...(fiches > 0 ? [consigneATraiter(fiches)] : []), ...(dossiers.length > 0 ? [consigneDesDossiers(dossiers)] : [])];
}

/** Un archiviste lancé reçoit les fiches « à traiter » et les dossiers non rattachés avec son objectif ; déjà là (`nouvelle` faux), l'objectif lui est remis. */
export async function lancerSession(
	ctx: ContexteArchiviste,
	d: { profil: string; dossier: string; objectif?: string },
): Promise<{ session: Session; nouvelle: boolean; manuel?: string } | RefusArchiviste> {
	if (ctx.arrete()) return { refus: 'Le service s’arrête : aucune session ne peut être lancée.', arret: true };
	let objectif = d.objectif;
	if (d.profil === PROFIL_ARCHIVISTE) {
		const consignes = await consignesEnAttente(ctx);
		if (consignes.length > 0) objectif = [...(objectif === undefined || objectif.trim() === '' ? [] : [objectif]), ...consignes].join('\n\n');
	}
	const lancer = () => ctx.pilote.lancer({ profil: d.profil, dossier: d.dossier, ...(objectif === undefined ? {} : { objectif }) });
	let r = await lancer();
	if ('existant' in r) {
		const remise = await remettreA(ctx, r.session, enUneLigne(objectif ?? ''), 'lancement');
		if (remise === 'terminee') r = await lancer();
		else if ('refus' in remise) return remise;
		else return { session: r.session, nouvelle: false, ...(remise.archiviste === 'manuel' ? { manuel: remise.manuel } : {}) };
	}
	if ('refus' in r) return { refus: r.refus, arret: ctx.arrete() };
	if ('existant' in r) return refusTermine();
	return { session: r.session, nouvelle: true, ...('manuel' in r ? { manuel: r.manuel } : {}) };
}
