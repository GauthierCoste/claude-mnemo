import type { Textes } from '../../textes.ts';
import { agents } from './agents.ts';
import { archiviste } from './archiviste.ts';
import { commun } from './commun.ts';
import { coquille } from './coquille.tsx';
import { documentation } from './documentation.ts';
import { memoire } from './memoire.ts';
import { modeles } from './modeles.ts';
import { reglages } from './reglages.ts';
import { sessions } from './sessions.ts';

export const en: Textes = { commun, coquille, sessions, memoire, archiviste, modeles, reglages, agents, documentation };
