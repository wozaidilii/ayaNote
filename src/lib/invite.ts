import { randomBytes } from "node:crypto";
import { addDays } from "date-fns";

export function createInviteToken() {
  return randomBytes(24).toString("hex");
}

export function inviteExpiry(days = 14) {
  return addDays(new Date(), days);
}
