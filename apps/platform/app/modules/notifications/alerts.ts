/** What a staff alert is about (TAT-52). The deposit-proof alert is a follow-up (spec ruling 12). */
export const ALERT_KINDS = ["new_inquiry"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
