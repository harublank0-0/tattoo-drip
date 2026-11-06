/**
 * The limits of a studio's own FAQ and policies (the migration checks the
 * same lengths and positions): the editor, the validators and
 * StudioContentService read them from here.
 */
export const MAX_FAQ_ENTRIES = 20;
export const MAX_POLICY_SECTIONS = 12;
export const FAQ_LIMITS = { question: 200, answer: 2000 } as const;
export const POLICY_LIMITS = { title: 80, text: 4000 } as const;
