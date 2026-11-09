// Share links for LinkedIn, X and WhatsApp. Each opens the app's own post box; the user presses Post.
function shareLinks(joinUrl, p) {
  const text = `I'm building ${p.ownerName}/${p.repoName} and looking for teammates. Join here:`, e = encodeURIComponent;
  return { linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${e(joinUrl)}`, x: `https://x.com/intent/post?text=${e(text)}&url=${e(joinUrl)}`, whatsapp: `https://wa.me/?text=${e(text + " " + joinUrl)}` };
}
module.exports = { shareLinks };
