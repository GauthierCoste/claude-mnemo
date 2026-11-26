/**
 * Skills du mode démo (`?demo&vue=reglages`), de la mémoire ou d'un profil (`?profil=<nom>`) : une imitation en mémoire des
 * routes `skills`, `skill` et `skillOrigine` du service (détail, création, modification avec empreinte et renommage,
 * suppression, retour à la version d'origine), pour voir l'éditeur de skill sans service. Les profils qui listent une skill
 * de la mémoire suivent son renommage ou sa suppression ; les skills par défaut de l'archiviste sont fournies par Mnemo.
 */
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import type { ReponseEcritureSkill, SkillDetailVue, SkillEditableVue, SkillVue } from '@mnemo/contrat';
import { ErreurApi } from './api.ts';

/**
 * Ce que les skills demandent aux profils de la démo : s'il existe, qui reçoit une skill de la mémoire, et suivre son
 * renommage (`nouveau`) ou sa suppression (null).
 */
export type ProfilsPourSkills = { existe(nom: string): boolean; equipes(nom: string): string[]; suivreSkill(ancien: string, nouveau: string | null): void };

type Etat = { description: string; icone: string | null; contenu: string; version: number };
type Version = Omit<Etat, 'version'>;

/** Skills par défaut de l'archiviste, version fournie (abrégée pour la démo). */
const FOURNIES: Readonly<Record<string, Readonly<Record<string, Version>>>> = {
	[PROFIL_ARCHIVISTE]: {
		emails: { description: 'Ranger un email ou un fil d’emails (.eml, .mbox) dans la mémoire Mnemo.', icone: null, contenu: '1. `extraire_source` sur le fichier, avec `type` `email`.\n2. Ne garde que ce qui dure : décisions, engagements, montants, échéances.' },
		specs: { description: 'Ranger une spécification, un cahier des charges ou un document de conception dans la mémoire Mnemo.', icone: null, contenu: '1. `extraire_source` sur le document.\n2. Extrais le périmètre, les exigences et les échéances, une information par ligne.' },
		'comptes-rendus': { description: 'Ranger un compte rendu de réunion ou une transcription dans la mémoire Mnemo.', icone: null, contenu: '1. `extraire_source`, avec `type` `compte_rendu`.\n2. Les décisions, les actions et les points ouverts, chacun avec sa citation.' },
		menage: { description: 'Faire le ménage dans la mémoire Mnemo (doublons, fiches inutiles, liens cassés ou faux, fiches mal nommées).', icone: null, contenu: '1. Commence par `diagnostiquer`.\n2. Propose un lot que l’utilisateur valide dans « À arbitrer ».' },
	},
};

const MOTIF_NOM = 'nom refusé : minuscules, chiffres et tirets, 40 caractères au plus, sans tiret au début';
const motifFixe = (nom: string, profil: string) =>
	`skill « ${nom} » fournie par Mnemo : elle se modifie ou revient à sa version d'origine, mais ne se renomme ni ne se supprime (le prochain lancement de « ${profil} » la redéposerait)`;
/** Mêmes bornes que le service (`domaine/skill.ts`). */
const motifs = (s: SkillEditableVue): string[] => {
	const refus: string[] = [];
	if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(s.nom)) refus.push(MOTIF_NOM);
	if (s.description.trim() === '') refus.push('description obligatoire : c’est elle qui fait charger la skill par l’agent');
	else if (/[\r\n]/u.test(s.description)) refus.push('description sur une seule ligne');
	else if (s.description.length > 1024) refus.push('description de 1024 caractères au plus');
	if (s.icone !== null && (s.icone === '' || s.icone.length > 16 || /[\s\p{Cc}]/u.test(s.icone))) refus.push('icône refusée : un emoji ou un caractère, sans espace');
	if (s.contenu.length > 100_000) refus.push('contenu de 100000 caractères au plus');
	return refus;
};
/** Clés admises dans un corps, comme le service : celles d'une skill, plus `empreinte` au `PUT`. */
const CLES = ['nom', 'description', 'icone', 'contenu'];
const memes = (a: Version, b: Version) => a.description === b.description && a.icone === b.icone && a.contenu === b.contenu;

/** `profil` null : la mémoire. Clé d'une portée dans l'état de la démo. */
const cle = (profil: string | null) => profil ?? '';

export function creerSkillsDemo(profils: ProfilsPourSkills) {
	const portees = new Map<string, Map<string, Etat>>([
		[
			cle(null),
			new Map([
				['devis', { description: 'Rédiger un devis au format de la maison.', icone: '📜', contenu: '# Devis\n\nUn devis suit le modèle de la maison : périmètre, lots, jours, total HT.', version: 1 }],
				['relecture', { description: 'Relire un courrier avant envoi.', icone: '🔍', contenu: '# Relecture\n\nRelire le ton, les chiffres et les noms avant tout envoi.', version: 1 }],
			]),
		],
		[PROFIL_ARCHIVISTE, new Map(Object.entries(FOURNIES[PROFIL_ARCHIVISTE]!).map(([nom, v]) => [nom, { ...v, version: 1 }]))],
		['redaction', new Map([['signature', { description: 'Signer un courrier.', icone: '✍️', contenu: 'Signer au nom de la maison.', version: 1 }]])],
	]);

	/** Les skills de la portée ; un profil inconnu → 404. */
	const skillsDe = (profil: string | null): Map<string, Etat> => {
		if (profil !== null && !profils.existe(profil)) throw new ErreurApi(`Profil inconnu : « ${profil} ».`, 404);
		let skills = portees.get(cle(profil));
		if (!skills) portees.set(cle(profil), (skills = new Map()));
		return skills;
	};
	const etat = (nom: string, profil: string | null): Etat => {
		const e = skillsDe(profil).get(nom);
		if (!e) throw new ErreurApi(`Skill inconnue : « ${nom} ».`, 404);
		return e;
	};
	const fournie = (nom: string, profil: string | null): Version | undefined => (profil === null ? undefined : FOURNIES[profil]?.[nom]);
	const empreinte = (nom: string, e: Etat) => `${nom}-${e.version}`;
	/** Refus des champs (400) : motifs de la skill, et renommage d'une skill fournie. */
	const refuser = (refus: string[]) => {
		if (refus.length > 0) throw new ErreurApi(`Skill refusée : ${refus.join(' ; ')}`, 400);
	};
	const champs = (s: SkillEditableVue, ancien: string | null, profil: string | null): string[] => {
		const refus = motifs(s);
		if (ancien !== null && s.nom !== ancien && fournie(ancien, profil) !== undefined) refus.push(motifFixe(ancien, profil!));
		return refus;
	};
	const nomPris = (s: SkillEditableVue, ancien: string | null, profil: string | null) => {
		if (s.nom !== ancien && skillsDe(profil).has(s.nom)) refuser([`la skill « ${s.nom} » existe déjà`]);
	};
	/** Corps reçu, forme vérifiée comme le service (clés inconnues, types) ; `autres` : clés admises en plus. */
	const editable = (corps: unknown, autres: readonly string[] = []): SkillEditableVue => {
		if (typeof corps !== 'object' || corps === null || Array.isArray(corps)) throw new ErreurApi(`Corps attendu : { ${[...CLES, ...autres].join(', ')} }.`, 400);
		for (const cle of Object.keys(corps)) if (!CLES.includes(cle) && !autres.includes(cle)) throw new ErreurApi(`Champ inconnu « ${cle} ».`, 400);
		const { nom, description, icone, contenu } = corps as Record<string, unknown>;
		if (typeof nom !== 'string') throw new ErreurApi('Champ « nom » : texte attendu.', 400);
		if (typeof description !== 'string') throw new ErreurApi('Champ « description » : texte attendu.', 400);
		if (icone !== null && typeof icone !== 'string') throw new ErreurApi('Champ « icone » : texte ou null attendu.', 400);
		if (typeof contenu !== 'string') throw new ErreurApi('Champ « contenu » : texte attendu.', 400);
		return { nom, description, icone, contenu };
	};
	const liste = (profil: string | null): SkillVue[] =>
		[...(portees.get(cle(profil)) ?? new Map<string, Etat>()).entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([nom, e]) => ({ nom, description: e.description, ...(e.icone === null ? {} : { icone: e.icone }), origine: fournie(nom, profil) === undefined ? 'memoire' : 'mnemo' }));

	return {
		/** Les skills de la mémoire, triées par nom, comme `skillsMemoireDisponibles`. */
		memoire: (): SkillVue[] => liste(null),
		/** Les skills propres au profil `nom`, comme `skillsDuProfil`. */
		duProfil: (nom: string): SkillVue[] => liste(nom),
		/** Copie les skills propres du profil `source` dans le profil `cible` (duplication d'un profil). */
		copierProfil(source: string, cible: string): void {
			const copie = new Map([...(portees.get(cle(source)) ?? new Map<string, Etat>()).entries()].map(([nom, e]) => [nom, { ...e, version: 1 }]));
			portees.set(cle(cible), copie);
		},
		/** Retire les skills propres du profil `nom` (suppression d'un profil). */
		retirerProfil(nom: string): void {
			portees.delete(cle(nom));
		},

		detail(nom: string, profil: string | null): SkillDetailVue {
			const e = etat(nom, profil);
			const f = fournie(nom, profil);
			return {
				nom,
				description: e.description,
				icone: e.icone,
				contenu: e.contenu,
				profil,
				origine: f === undefined ? 'memoire' : 'mnemo',
				modifiee: f !== undefined && !memes(f, e),
				agents: profil === null ? profils.equipes(nom) : [profil],
				empreinte: empreinte(nom, e),
				motifFixe: f === undefined ? null : motifFixe(nom, profil!),
				avertissements: [],
			};
		},

		creer(corps: unknown, profil: string | null): ReponseEcritureSkill {
			skillsDe(profil);
			const s = editable(corps);
			refuser(champs(s, null, profil));
			nomPris(s, null, profil);
			skillsDe(profil).set(s.nom, { description: s.description.trim(), icone: s.icone, contenu: s.contenu.trim(), version: 1 });
			return { commit: 'demo0101', nom: s.nom };
		},

		/** Comme le service : 404, puis 400 sur les champs, puis 409 sur l'empreinte, puis 400 si le nouveau nom est pris. */
		modifier(nom: string, corps: unknown, profil: string | null): ReponseEcritureSkill {
			const e = etat(nom, profil);
			const s = editable(corps, ['empreinte']);
			const lue = (corps as { empreinte?: unknown }).empreinte;
			if (typeof lue !== 'string') throw new ErreurApi('Champ « empreinte » : texte attendu.', 400);
			refuser(champs(s, nom, profil));
			if (lue !== empreinte(nom, e)) throw new ErreurApi('Le SKILL.md de la skill a changé depuis son ouverture : à recharger.', 409);
			nomPris(s, nom, profil);
			const suivante: Etat = { description: s.description.trim(), icone: s.icone, contenu: s.contenu.trim(), version: e.version + 1 };
			if (s.nom === nom && memes(suivante, e)) return { commit: null, nom };
			const skills = skillsDe(profil);
			skills.delete(nom);
			skills.set(s.nom, suivante);
			if (s.nom !== nom && profil === null) profils.suivreSkill(nom, s.nom);
			return { commit: 'demo0102', nom: s.nom };
		},

		supprimer(nom: string, profil: string | null): ReponseEcritureSkill {
			etat(nom, profil);
			if (fournie(nom, profil) !== undefined) throw new ErreurApi(`Skill refusée : ${motifFixe(nom, profil!)}`, 400);
			skillsDe(profil).delete(nom);
			if (profil === null) profils.suivreSkill(nom, null);
			return { commit: 'demo0103', nom };
		},

		revenir(nom: string, profil: string | null): ReponseEcritureSkill {
			const e = etat(nom, profil);
			const f = fournie(nom, profil);
			if (f === undefined) throw new ErreurApi(`Skill refusée : la skill « ${nom} » n’est pas fournie par Mnemo : pas de version d’origine`, 400);
			if (memes(f, e)) return { commit: null, nom };
			skillsDe(profil).set(nom, { ...f, version: e.version + 1 });
			return { commit: 'demo0104', nom };
		},
	};
}
