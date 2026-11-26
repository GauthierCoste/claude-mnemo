/**
 * Skills de la mémoire du mode démo (`?demo&vue=reglages`) : une imitation en mémoire des routes `skills`, `skill` et
 * `skillOrigine` du service (détail, création, modification avec empreinte et renommage, suppression, retour à la version
 * d'origine), pour voir l'éditeur de skill sans service. Les profils qui la listent suivent un renommage ou une suppression.
 */
import type { ReponseEcritureSkill, SkillDetailVue, SkillEditableVue, SkillVue } from '@mnemo/contrat';
import { ErreurApi } from './api.ts';

/** Ce que les skills demandent aux profils de la démo : qui reçoit une skill, et suivre un renommage (`nouveau`) ou une suppression (null). */
export type ProfilsPourSkills = { equipes(nom: string): string[]; suivreSkill(ancien: string, nouveau: string | null): void };

type Etat = { description: string; icone: string | null; contenu: string; version: number };

/** Version fournie par Mnemo de la skill `compte-rendu` de la démo : la démo montre l'avertissement et le retour à l'origine. */
const FOURNIES: Readonly<Record<string, Omit<Etat, 'version'>>> = {
	'compte-rendu': { description: 'Rédiger le compte rendu d’une réunion client.', icone: '📝', contenu: '# Compte rendu\n\n1. Date, participants, projet.\n2. Décisions, actions (qui, quoi, pour quand), points ouverts.' },
};

const motifs = (s: SkillEditableVue): string[] => {
	const refus: string[] = [];
	if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(s.nom)) refus.push('nom refusé : minuscules, chiffres et tirets, 40 caractères au plus, sans tiret au début');
	if (s.description.trim() === '') refus.push('description obligatoire : c’est elle qui fait charger la skill par l’agent');
	if (s.icone !== null && (s.icone === '' || /\s/u.test(s.icone))) refus.push('icône refusée : un emoji ou un caractère, sans espace');
	return refus;
};

export function creerSkillsDemo(profils: ProfilsPourSkills) {
	const skills = new Map<string, Etat>([
		['devis', { description: 'Rédiger un devis au format de la maison.', icone: '📜', contenu: '# Devis\n\nUn devis suit le modèle de la maison : périmètre, lots, jours, total HT.', version: 1 }],
		['relecture', { description: 'Relire un courrier avant envoi.', icone: '🔍', contenu: '# Relecture\n\nRelire le ton, les chiffres et les noms avant tout envoi.', version: 1 }],
		['compte-rendu', { ...FOURNIES['compte-rendu']!, version: 1 }],
	]);
	const etat = (nom: string): Etat => {
		const e = skills.get(nom);
		if (!e) throw new ErreurApi(`Skill inconnue : « ${nom} ».`, 404);
		return e;
	};
	const empreinte = (nom: string, e: Etat) => `${nom}-${e.version}`;
	const valider = (s: SkillEditableVue, ancien: string | null) => {
		const refus = motifs(s);
		if (s.nom !== ancien && skills.has(s.nom)) refus.push(`la skill « ${s.nom} » existe déjà`);
		if (refus.length > 0) throw new ErreurApi(`Skill refusée : ${refus.join(' ; ')}`, 400);
	};
	const editable = (corps: unknown): SkillEditableVue => {
		const { nom, description, icone, contenu } = corps as SkillEditableVue;
		return { nom: String(nom ?? ''), description: String(description ?? ''), icone: icone ?? null, contenu: String(contenu ?? '') };
	};
	const memeQueFournie = (nom: string, e: Etat) => {
		const f = FOURNIES[nom];
		return f !== undefined && f.description === e.description && f.icone === e.icone && f.contenu === e.contenu;
	};

	return {
		/** Les skills de la mémoire, triées par nom, comme `skillsMemoireDisponibles`. */
		liste(): SkillVue[] {
			return [...skills.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([nom, e]) => ({ nom, description: e.description, ...(e.icone === null ? {} : { icone: e.icone }) }));
		},

		detail(nom: string): SkillDetailVue {
			const e = etat(nom);
			return {
				nom,
				description: e.description,
				icone: e.icone,
				contenu: e.contenu,
				origine: nom in FOURNIES ? 'mnemo' : 'memoire',
				modifiee: nom in FOURNIES && !memeQueFournie(nom, e),
				agents: profils.equipes(nom),
				empreinte: empreinte(nom, e),
				avertissements: [],
			};
		},

		creer(corps: unknown): ReponseEcritureSkill {
			const s = editable(corps);
			valider(s, null);
			skills.set(s.nom, { description: s.description.trim(), icone: s.icone, contenu: s.contenu.trim(), version: 1 });
			return { commit: 'demo0101', nom: s.nom };
		},

		modifier(nom: string, corps: unknown): ReponseEcritureSkill {
			const e = etat(nom);
			if ((corps as { empreinte?: unknown }).empreinte !== empreinte(nom, e)) throw new ErreurApi('Le SKILL.md de la skill a changé depuis son ouverture : rechargez-la.', 409);
			const s = editable(corps);
			valider(s, nom);
			const suivante: Etat = { description: s.description.trim(), icone: s.icone, contenu: s.contenu.trim(), version: e.version + 1 };
			if (s.nom === nom && suivante.description === e.description && suivante.icone === e.icone && suivante.contenu === e.contenu) return { commit: null, nom };
			skills.delete(nom);
			skills.set(s.nom, suivante);
			if (s.nom !== nom) profils.suivreSkill(nom, s.nom);
			return { commit: 'demo0102', nom: s.nom };
		},

		supprimer(nom: string): ReponseEcritureSkill {
			etat(nom);
			skills.delete(nom);
			profils.suivreSkill(nom, null);
			return { commit: 'demo0103', nom };
		},

		revenir(nom: string): ReponseEcritureSkill {
			const e = etat(nom);
			const f = FOURNIES[nom];
			if (f === undefined) throw new ErreurApi(`Skill refusée : la skill « ${nom} » n’est pas fournie par Mnemo : pas de version d’origine`, 400);
			if (memeQueFournie(nom, e)) return { commit: null, nom };
			skills.set(nom, { ...f, version: e.version + 1 });
			return { commit: 'demo0104', nom };
		},
	};
}
