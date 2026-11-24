/** Options de tout appel de Mnemo à git : chemins non échappés, chemins longs sous Windows, ni signature ni demande de clé. */
const OPTIONS_COMMUNES = ['core.quotepath=false', 'core.longpaths=true', 'commit.gpgsign=false'] as const;

/** Arguments d'un appel à git : les options communes, puis `propres` (réglages `cle=valeur` de cet usage), puis `args`. */
export function argumentsGit(propres: readonly string[], args: readonly string[]): string[] {
	return [...[...OPTIONS_COMMUNES, ...propres].flatMap((option) => ['-c', option]), ...args];
}
