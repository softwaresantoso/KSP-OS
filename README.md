# Aplikasi Koperasi Simpan Pinjam

PWA multi-koperasi untuk Pengurus dan Anggota. **Seluruhnya gratis, tanpa paket Blaze.**

| Bagian | Layanan | Paket |
|---|---|---|
| Aplikasi web (PWA) + API `/api/*` | Cloudflare Pages + Pages Functions | Free |
| Login | Firebase Authentication (Email/Password) | Spark (gratis) |
| Database + mode offline | Cloud Firestore | Spark (gratis) |
| Kode | GitHub | Free |

Operasi yang tidak boleh dipercayakan ke browser (membuat akun, mengatur peran, persetujuan dan pencairan pinjaman) dijalankan di `functions/` (Cloudflare), memakai logika yang sama dengan unit test di `src/core`.

## Status

| Bagian | Status |
|---|---|
| Logika inti `src/core` (angsuran flat/menurun, denda, kelayakan, persetujuan, simpanan, kas, SHU, hak akses) | Selesai, diuji |
| Backend Cloudflare `functions/` | Selesai, **10 tes lulus terhadap Google palsu di memori**; belum pernah dipanggil ke Google sungguhan |
| Security Rules `firestore.rules` | Ditulis, **belum diuji di emulator** |
| UI Tahap 1 (login, anggota, simpanan, pinjaman, pengaturan, portal anggota, mode offline) | Ditulis, **belum pernah di-build** |
| Tahap 2: laporan, ekspor PDF/Excel, cetak buku simpanan/kartu, UI pengaturan SHU | Belum |
| Tahap 3: laporan RAT dan desa/dusun, impor data lama, audit log | Belum |

## Langkah pertama

Prasyarat: Node.js 22.18+.

```bash
npm install
npm test            # 41 tes (logika inti + backend) harus lulus
npm run typecheck   # UI belum pernah dikompilasi: kirim hasilnya ke Claude bila ada error
```

## 1. Firebase (paket Spark)

1. Firebase Console > Add project. **Jangan upgrade ke Blaze.**
2. Authentication > Sign-in method > aktifkan **Email/Password**.
3. Firestore Database > Create database, lokasi `asia-southeast2` (Jakarta), mode production.
4. Project settings > General > Your apps > tambah **Web app**. Salin konfigurasinya ke `.env.local` (contoh: `.env.example`).
5. Project settings > Service accounts > **Generate new private key**. Simpan file JSON-nya; isinya dipakai di langkah Cloudflare. Jangan di-commit ke GitHub.
6. Deploy rules dan indeks:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,firestore:indexes
   ```
7. Authentication > Users > **Add user**: buat akun Anda sendiri (pemilik platform), email dan sandi bebas.

## 2. Cloudflare Pages

1. Push repo ke GitHub (pastikan `.env.local`, `.dev.vars`, dan file service account tidak ikut).
2. Cloudflare > Workers & Pages > Create > Pages > Connect to Git, pilih repo.
3. Build command `npm run build`, output directory `dist`.
4. Settings > Variables and Secrets (Production), tambahkan:

   | Nama | Jenis | Isi |
   |---|---|---|
   | `NODE_VERSION` | Text | `22` |
   | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Text | dari konfigurasi Web app Firebase |
   | `FIREBASE_PROJECT_ID` | Text | id project Firebase |
   | `FIREBASE_API_KEY` | Text | nilai yang sama dengan `VITE_FIREBASE_API_KEY` |
   | `FIREBASE_SERVICE_ACCOUNT` | **Secret** | seluruh isi file JSON service account |
   | `SUPERADMIN_EMAILS` | Text | email akun pemilik platform dari langkah 1.7 |

5. Deploy ulang. Lalu Firebase Console > Authentication > Settings > Authorized domains: tambahkan domain `*.pages.dev` Anda.
6. Hapus file JSON service account dari komputer setelah dimasukkan sebagai Secret.

## Alur pemakaian pertama

1. Login dengan akun pemilik platform: halaman **Buat koperasi baru** muncul. Isi nama koperasi dan akun Ketua.
2. Login sebagai Ketua > **Pengaturan**: buat produk pinjaman, atur batas persetujuan, buat akun Bendahara/Sekretaris/Admin.
3. Sekretaris/Admin > **Anggota**: tambah anggota lalu buat akun login mereka.
4. Anggota login dan memakai portalnya.

## Menjalankan lokal (opsional)

Isi `.dev.vars` (contoh: `.dev.vars.example`) dan `.env.local`, lalu `npm run dev:api`. Pakai project Firebase terpisah untuk uji coba, bukan data koperasi sungguhan. Backend memakai Firestore sungguhan, bukan emulator.

## Batas paket gratis dan akibatnya

- **Firestore Spark**: 50.000 baca, 20.000 tulis per hari, 1 GiB. Untuk 100-200 anggota per koperasi ini cukup, tetapi satu Beranda pengurus saat ini membaca seluruh transaksi simpanan dan kas. Pada koperasi dengan puluhan ribu transaksi, ringkasan terhitung (agregat) akan ditambahkan di Tahap 2. Cache offline menghemat pembacaan berulang.
- **Cloudflare Free**: 100.000 permintaan API per hari. Hanya `/api/*` yang memanggil Function (`public/_routes.json`).
- Lonjakan melewati kuota Firebase Spark membuat layanan berhenti sampai kuota reset (bukan ditagih), karena tidak ada kartu kredit yang terhubung.
- Tidak ada pencadangan otomatis di Spark. Rencanakan ekspor data berkala (Tahap 3 menambahkan ekspor lengkap).
- Reset kata sandi: pengurus belum bisa mengatur ulang sandi anggota (itu butuh endpoint tambahan). Sementara, anggota memakai "lupa sandi" bila emailnya aktif, atau pengurus membuatkan akun baru.

## Keputusan desain

- **Hak akses** ada di `src/core/permissions.ts` dan disalin ke `firestore.rules`; ubah keduanya bersamaan.
- **Persetujuan pinjaman**: Diajukan > Verifikasi (Admin/Bendahara) > Persetujuan (satu pengurus untuk pinjaman kecil, Ketua **dan** Bendahara untuk pinjaman besar) > Pencairan (Bendahara). Pengurus tidak dapat memproses pinjamannya sendiri.
- **Transaksi append-only**: simpanan, kas, pembayaran tidak bisa diubah/dihapus (dikunci di Security Rules). Salah catat dikoreksi dengan transaksi pembalik.
- **Offline**: pencatatan simpanan, kas, pembayaran, dan anggota berjalan tanpa internet lalu tersinkron. Persetujuan/pencairan pinjaman dan pembuatan akun butuh internet.
- **Saldo simpanan tidak divalidasi server**: batas penarikan hanya dicek di aplikasi. Dua pengurus offline yang menarik dari saldo sama bisa membuat saldo negatif.
- **Status "lunas"** dihitung dari pembayaran saat rincian dibuka, belum disimpan sebagai status.
- **Parameter SHU** di kode hanya contoh; tiap koperasi mengisi sesuai AD/ART (UI di Tahap 2).
- **NIK anggota opsional**. Bila diisi, pertimbangkan UU Pelindungan Data Pribadi dan batasi akses.
