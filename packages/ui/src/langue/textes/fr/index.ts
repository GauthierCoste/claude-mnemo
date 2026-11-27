import { agents } from './agents.tsx';
import { archiviste } from './archiviste.ts';
import { commun } from './commun.ts';
import { coquille } from './coquille.tsx';
import { documentation } from './documentation.ts';
import { memoire } from './memoire.tsx';
import { modeles } from './modeles.ts';
import { reglages } from './reglages.tsx';
import { sessions } from './sessions.tsx';

/** Textes de l'interface en français : la référence dont `Textes` tire sa forme. Un fichier par zone de l'interface. */
export const fr = { commun, coquille, sessions, memoire, archiviste, modeles, reglages, agents, documentation };
