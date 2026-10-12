# MIMIC — rumus skor dan batas keakuratan

Dokumen ini menjelaskan implementasi `public/scoring.js` dan `public/transcriber-worker.js`, bukan hasil benchmark suara manusia. Konfigurasi publik yang diperiksa pada pembaruan ini: musim 1, bobot Precision 30/35/20/15, ambang applause 50, ambang sempurna 98. Admin bisa mengubah konfigurasi; setiap room memakai snapshot aturan ketika dibuat.

## 1. Alur giliran

Permainan yang dimulai setelah pembaruan memakai urutan pemain di lobby: host, lalu urutan bergabung. Semua pemain memperoleh sound yang sama untuk satu ronde. Untuk **setiap** pemain, server menjadwalkan:

1. Putar referensi pada `listenAt` (2,5 detik setelah giliran dijadwalkan).
2. Setelah durasi referensi (dibulatkan ke atas ke milidetik) dan jeda aman 1 detik, tampilkan `Ready` selama 1 detik.
3. `3`, `2`, `1`, masing-masing 1 detik.
4. `Start` pada awal rekaman; tulisan bertahan 1 detik, lalu menjadi sisa detik rekaman.
5. Hanya pemain aktif merekam. Batas durasi = min(batas admin, ceil(durasi referensi) + 2 detik).
6. Tunggu upload/penilaian, lalu putar take dan reaksi kepada anggota room. Baru lanjut pemain berikutnya. Setelah semua pemain, lanjut ronde berikutnya atau klasemen akhir.

Client menghitung tampilan dari waktu server dengan estimasi selisih jam, bukan hitungan lokal yang dimulai dari nol setiap polling. Polling kira-kira 1,1 detik; pembaruan countdown 80 ms. Ini bukan jaminan sinkronisasi sample-accurate: latensi, izin mikrofon, autoplay, perangkat, dan tab latar belakang tetap memengaruhi timing. Tetap buka tab dan gunakan headset. Audio pemain tidak disiarkan langsung; pemain lain mendengar **playback setelah penilaian**.

Server menolak take pemain yang bukan giliran aktif, sebelum `recordAt`, setelah batas pengumpulan, atau untuk ronde lain. Satu take per pemain per ronde; retry upload tidak membuat take baru. Party menunggu maksimal 30 detik setelah akhir rekam, Precision 140 detik untuk ASR. Take yang tidak diterima menjadi nol lalu permainan berlanjut. Kemajuan server terjadi saat room dipolling; jika seluruh pemain offline, state dilanjutkan ketika ada yang kembali. Batas room tetap 2 jam; kombinasi banyak ronde/pemain dan timeout panjang dapat mencapai batas ini.

Room yang sudah memulai pertandingan sebelum pembaruan menyelesaikan protokol lama. Room baru dan lobby yang baru dimulai memakai giliran berurutan. Muat ulang halaman sebelum memulai pertandingan baru.

## 2. Notasi rumus

- `W`: skor kata; `P`: skor pitch/nada; `T`: skor timbre/karakter bunyi; `R`: skor ritme.
- Semua komponen dibatasi 0–100. `C(x) = max(0, min(100, x))`.
- Perbandingan urutan frame memakai DTW (dynamic time warping), agar rangkaian yang sedikit berbeda waktu bisa disejajarkan.
- Persis di kode: `D(i,j) = loss(i,j) + min(D(i−1,j), D(i,j−1), D(i−1,j−1))`. `D(0,0)=0`, tepi lain tak hingga. `L = D(n,m)/max(n,m)`, **bukan** dibagi panjang jalur DTW. Jika salah satu urutan kosong, `L=1`.
- Nilai komponen yang ditampilkan dibulatkan. Total dan syarat sempurna dihitung dari nilai komponen **sebelum** pembulatan.

## 3. Transkrip / kosakata (W)

Browser memakai `onnx-community/whisper-tiny`, multilingual, quantization q8, WASM, melalui Transformers.js 3.8.1. Bahasa diambil dari metadata sound; task `transcribe`, temperature 0, maksimal 96 token. Tidak meminta word timestamps atau confidence terkalibrasi. ASR dibutuhkan untuk profil Precision, bukan Party.

Teks referensi dan hasil ASR dinormalisasi: huruf kecil, Unicode NFKC, tanda baca menjadi spasi, spasi ganda dirapikan. Token kata memakai `Intl.Segmenter` jika tersedia; ada pemisahan fallback.

`W = max(0, 100 × (1 − d / max(Nref, Ntake)))`

`d` adalah jarak edit Levenshtein token: tambah, hapus, atau ganti masing-masing berbiaya 1. Referensi kosong menghasilkan 0. Contoh: referensi 5 kata dan take 5 kata dengan 1 kata diganti → W=80. Huruf kapital/tanda baca tidak memengaruhi hasil; sinonim, angka tertulis vs digit, slang, dan susunan kata tetap bisa berbeda.

Ini **kemiripan dua transkrip**, bukan pengukuran akurasi ASR. Denominator `max(Nref,Ntake)` berbeda dari WER standar. Jika ASR salah mendengar, kata yang benar diucapkan dapat mendapat nilai rendah; ASR juga dapat menghasilkan teks yang tidak benar-benar diucapkan. Dalam ranked, admin mendengarkan rekaman dan mengisi transkrip terverifikasi, lalu server menghitung ulang.

## 4. Nada / pitch (P)

Audio mono 16 kHz, frame pitch 1.024 sampel (64 ms), langkah 320 sampel (20 ms). Pitch dicari melalui normalized autocorrelation, lag 32–266 sampel (rentang pencarian sekitar 60–500 Hz). Frame dengan energi <0,006 atau korelasi maksimum <0,65 tidak dianggap voiced. Pilihan puncak lokal menggunakan lag integer, bukan interpolasi sub-sampel. Angka 0,65 adalah threshold detektor, **bukan akurasi 65%**.

Hanya frame voiced disejajarkan. Untuk Precision, `o=1`. Untuk Party, `o = median(fref)/median(ftake)` sehingga perbedaan tinggi dasar suara dinormalisasi.

`loss_pitch(i,j) = min(1, abs(12 × log2(fref_i / (ftake_j × o))) / 10)`

`P = C(100 × (1 − DTW(loss_pitch)))`

`12 × log2(rasio frekuensi)` mengubah selisih frekuensi menjadi semitone. Pada contoh frame seragam/alignment identik: selisih 0 semitone → 100, 1 → 90, 5 → 50, ≥10 → 0. Suara nyata tidak selalu mengikuti contoh sederhana ini karena estimasi pitch, voicing, dan jalur DTW. Party menilai kontur relatif; Precision juga menuntut tinggi nada absolut. Suara sangat tinggi/rendah, teriakan atau frame tak periodik dapat tidak terdeteksi oleh algoritme ini.

## 5. Notasi musik

**Belum ada komponen notasi terpisah.** Game belum mengekstrak do–re–mi, nama not C/D/E, nomor MIDI, onset/durasi setiap not, atau transkripsi partitur. Selisih semitone pada komponen P tidak sama dengan sistem penilaian notasi. Karena belum diimplementasikan, tidak ada angka akurasi notasi yang sah; bukan berarti akurasinya 0%.

## 6. Timbre / kemiripan karakter suara (T)

Sebelum ekstraksi: hening awal/akhir dipangkas pada ambang `max(0,003, peak × 0,025)` dengan margin 40 ms; gain `min(12, 0,8/peak)`. MFCC dihitung dari 512 sampel (32 ms), pre-emphasis 0,97, Hann window, 24 mel bands sekitar 80–7.600 Hz, log power, dan 12 koefisien DCT non-C0. Urutan lebih dari 180 frame disampling menjadi 180 untuk membatasi biaya DTW.

`loss_timbre(i,j) = min(1, sqrt(sum[k=1..12]((MFCCref_ik − MFCCtake_jk)²)/12) / 3)`

`T = C(100 × (1 − DTW(loss_timbre)))`

Ini membandingkan karakter spektral bunyi. **Tidak memakai speaker embedding, voiceprint, atau model verifikasi identitas.** T=85 tidak berarti identitas suara 85% sama. Vokal, pengucapan, mikrofon, kompresi dan suara latar dapat memengaruhi hasil. Belum ada kalibrasi hubungan nilai T dengan penilaian manusia tentang seberapa mirip sebuah mimic.

## 7. Ritme / durasi dan energi (R)

`Ld = min(1, abs(ln(durasi_take / durasi_ref)))`

`loss_energy(i,j) = min(1, abs(ln((Eref_i + 0,005)/(Etake_j + 0,005))) / 3)`

`Le = DTW(loss_energy)`

`R = C(100 × (1 − (0,55 × Ld + 0,45 × Le)))`

Durasi adalah durasi setelah trimming. Energi adalah RMS frame setelah normalisasi gain. Komponen ini membandingkan panjang ucapan dan pola keras-lemah, **bukan** beat tracking, tempo BPM, onset suku kata, atau notasi musik yang eksplisit. DTW bisa memaafkan sebagian perbedaan timing lokal.

## 8. Total, sempurna, dan reaksi

Precision, bobot aktif yang diperiksa pada pembaruan ini:

`Sraw = 0,30P + 0,35W + 0,20T + 0,15R`

Party selalu:

`Sraw = 0,60P + 0,40R`

Jika tidak sempurna: `S = min(99, round(Sraw))`. Contoh Precision: P=80, W=90, T=75, R=85 → Sraw=83,25 → S=83.

Sempurna bukan sekadar total dibulatkan ke 100. Setiap komponen dengan bobot >0 harus mencapai ambang sempurna (bawaan 98); khusus kata, **W harus tepat 100** apabila bobot kata aktif. Maka Precision bawaan membutuhkan P≥98, W=100, T≥98, R≥98; Party membutuhkan P≥98, R≥98. Hanya jika semua syarat terpenuhi total dipromosikan ke **100**. Admin bisa mengubah bobot Precision dan ambang komponen, tetapi aturan kata tetap 100 bila dinilai.

Rekaman hening (`peak<0,008` atau RMS<0,002), voiced frame <3, atau tanpa frame langsung mendapat semua komponen 0, total 0, roast. Take hilang saat timeout juga nol.

- Bawaan 0–49: roast.
- Bawaan 50–99: applause.
- Tepat 100: perfect/fanfare, didahulukan dari ambang applause.

Admin dapat mengganti ambang applause, teks dan audio reaksi. Skor room dijumlahkan antarronde; rating leaderboard tidak sama dengan total poin room. Leaderboard hanya memakai hasil ranked disahkan: rata-rata personal best per sound berbeda untuk kategori, lalu rata-rata kategori yang dimainkan untuk keseluruhan.

## 9. Tingkat keakuratan yang benar-benar diketahui

| Komponen | Sudah ada | Persentase akurasi terverifikasi |
|---|---|---|
| Transkrip | Whisper tiny multilingual + kemiripan token | Belum diukur pada dataset game Indonesia/Inggris |
| Nada | Autocorrelation + semitone/DTW | Belum diuji terhadap ground truth pitch suara manusia |
| Notasi | Belum ada deteksi/penilaian not terpisah | Tidak berlaku / belum tersedia |
| Timbre | MFCC + DTW | Belum dikalibrasi dengan rating mimic manusia; bukan biometrik |
| Ritme | Durasi dan pola energi | Belum diuji terhadap anotasi timing manusia |

Tes otomatis memverifikasi rumus, boundary, giliran, dan keamanan alur. Lulus tes perangkat lunak **tidak** menunjukkan akurasi transkripsi atau kemiripan suara manusia. Tidak ada angka 90%, 95%, atau 99% yang bisa diklaim secara jujur untuk komponen tersebut saat ini.

Untuk mengukur dengan benar, siapkan data uji berizin yang terpisah dari penyetelan skor: penutur Indonesia/Inggris, variasi aksen, gaya meme, perangkat dan kondisi bising; beberapa mimic per sound. Bandingkan ASR dengan transkrip manusia (WER/CER), pitch dengan anotasi f0 (error cents dan kesalahan voiced/unvoiced), notasi dengan onset/pitch/durasi not setelah fiturnya dibangun, serta timbre/total dengan rating beberapa penilai manusia dan korelasi/agreement. Laporkan hasil per bahasa/kondisi beserta jumlah sampel, bukan satu angka perkiraan global. Ini rencana validasi, **belum dijalankan**.
