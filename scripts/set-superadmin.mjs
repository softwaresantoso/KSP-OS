// Menandai SATU akun Firebase Auth sebagai pemilik platform (boleh membuat koperasi baru).
// Jalankan sekali di komputer Anda:
//   1) Firebase Console > Project settings > Service accounts > Generate new private key
//      simpan sebagai scripts/serviceAccount.json (JANGAN di-commit; sudah ada di .gitignore)
//   2) npm i firebase-admin   (di folder scripts atau root)
//   3) node scripts/set-superadmin.mjs email-anda@contoh.com
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const email = process.argv[2];
if (!email) {
  console.error('Pemakaian: node scripts/set-superadmin.mjs email@contoh.com');
  process.exit(1);
}
const key = JSON.parse(readFileSync(new URL('./serviceAccount.json', import.meta.url), 'utf8'));
initializeApp({ credential: cert(key) });
const user = await getAuth().getUserByEmail(email);
await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), superadmin: true });
console.log(`OK: ${email} (${user.uid}) kini pemilik platform. Login ulang agar klaim aktif.`);
