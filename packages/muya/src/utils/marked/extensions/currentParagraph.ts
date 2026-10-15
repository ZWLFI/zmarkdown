/**
 * marked asks every block extension's `start()` where the paragraph at the head
 * of `src` must stop, once per paragraph, passing the whole rest of the
 * document. A block can only cut a paragraph before the paragraph's blank-line
 * end (after it, the block starts on its own and is tokenized there), so
 * scanning past that point finds nothing useful — and scanning the whole
 * remainder per paragraph is quadratic in document size.
 */
export function currentParagraph(src: string): string {
    const end = src.indexOf('\n\n');
    return end === -1 ? src : src.slice(0, end + 1);
}
