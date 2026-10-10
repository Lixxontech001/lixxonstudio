// Key names this site never offers. WhatsApp is not a door, so its key names are filtered out of the owner's
// Keys list and refused by the keys function. The Keys page, the key list parser and the keys function all read this one list.
export const NOT_OFFERED_KEY_NAMES: readonly string[] = [
  "whatsapp_access_token",
  "whatsapp_phone_number_id",
];

export function isNotOfferedKey(name: string): boolean {
  return NOT_OFFERED_KEY_NAMES.includes(name);
}
