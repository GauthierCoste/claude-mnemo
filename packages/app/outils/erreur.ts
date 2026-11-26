/** Arrêt de la construction de l'app : levé (pas `process.exit`), pour que les dossiers de travail soient effacés. */
export class ErreurConstruction extends Error {}
