/** llama.cpp rend des logits pour bge-reranker : la sigmoïde les ramène dans [0, 1], dans le même ordre. */
export function sigmoide(x: number): number {
	return 1 / (1 + Math.exp(-x));
}
