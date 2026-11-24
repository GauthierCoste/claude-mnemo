import { VARIABLES_NEUTRALISEES } from '../../../../outils-tests/isolement.ts';

/**
 * Environnement des processus `mnemo` lancés par les tests : `init` ne doit jamais appeler le vrai `claude`, et aucune
 * variable ne désigne une mémoire, une session ou un projet de l'utilisateur (déjà vidées par la garde des tests ; ici
 * aussi, pour qu'un test qui importe ce module avant elle ne les transmette pas).
 */
const env: Record<string, string | undefined> = { ...process.env, MNEMO_SANS_MCP: '1' };
for (const nom of VARIABLES_NEUTRALISEES) delete env[nom];
export const ENV_TEST = env;
