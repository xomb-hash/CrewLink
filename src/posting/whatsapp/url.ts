// Official WhatsApp click-to-chat link. Building it never contacts WhatsApp and
// never reveals whether the number exists; the owner picks a recipient in the
// WhatsApp UI. Kept dependency-free so the dashboard can build the same link.

export const WHATSAPP_SHARE_ORIGIN = 'https://wa.me/';

export function whatsAppShareUrl(text: string): string | null {
  const message = String(text ?? '');
  if (!message.trim()) return null;
  // encodeURIComponent keeps line breaks as %0A and encodes URLs correctly, so
  // the prepared message reaches WhatsApp exactly as approved.
  return `${WHATSAPP_SHARE_ORIGIN}?text=${encodeURIComponent(message)}`;
}

export default { WHATSAPP_SHARE_ORIGIN, whatsAppShareUrl };
