# Mağaza POS

Kiçik mağaza üçün satış, mal qəbulu, borc və kassa idarəetmə sistemi.

## Xüsusiyyətlər

- Giriş/şifrə ilə autentifikasiya, iki rol: **Admin** (tam səlahiyyət) və **Satıcı** (mal qəbulu + satış)
- Mal qəbulu: alış qiyməti, satış qiyməti, miqdar, ölçü vahidi (ədəd / kq)
- Mal qəbulunda barkodun avtomatik yaradılması və kiçik ölçülü (50x30mm) etiket çapı
- Satış (POS): barkod skaneri ilə və ya adla axtarışla, hər sətirdə qiymət/endirim dəyişdirmə, nağd / kartla / köçürmə / borca yazma
- Müştəri məlumatları (ad, telefon) borc satışlarında qeydə alınır
- Müştəri borc idarəetməsi: ümumi borc, qismən/tam ödəniş qeydiyyatı
- Təchizatçı idarəetməsi: mal qəbulunda ödənilib/borclu statusu, təchizatçı üzrə borcumuzun izlənməsi və ödəniş qeydiyyatı (yalnız Admin)
- Xərc idarəetməsi (yalnız Admin): icarə, maaş, kommunal və s. xərclərin kateqoriya üzrə qeydiyyatı
- Mal kateqoriya/alt-kateqoriya təsnifatı
- Kassa: açılış məbləği, nağd/kart/köçürmə/borc məbləğləri, nağd xərc/təchizatçı ödənişlərinin çıxılması ilə kassada olmalı nağd hesablanması, bağlanışda faktiki say ilə müqayisə
- Hesabatlar (yalnız Admin): günlük hesabat, aylıq maliyyə analizi (gross/net mənfəət, margin, break-even, inventory turnover), mal üzrə mənfəət, kateqoriya üzrə satış, kritik stok
- Panel: aylıq mənfəət/zərər statusu, ən çox satılan və ən çox mənfəətli mallar

## Texnologiya

Node.js + Express + EJS + PostgreSQL (Prisma ORM). Render.com üzərində deploy, Neon üzərində Postgres.

## Lokal quraşdırma

```
npm install
cp .env.example .env   # DATABASE_URL və SESSION_SECRET dəyərlərini doldurun
npx prisma migrate deploy
node prisma/seed.js    # ilkin admin istifadəçisini yaradır: admin / admin123
npm start
```

## Deploy (Render + Neon)

1. **Neon**: [console.neon.tech](https://console.neon.tech) saytında pulsuz layihə yaradın, **"Connection string"** bölməsində **"Direct connection"** (pooled/PgBouncer yox) variantını seçib `postgresql://...` sətrini kopyalayın — bu server daim işlədiyi üçün birbaşa qoşulma daha sadədir.
2. **GitHub**: bu repo-nu GitHub-a yükləyin.
3. **Render**: Render Dashboard → **New +** → **Blueprint** → bu repo-nu seçin. Render `render.yaml` faylını oxuyub servisi avtomatik quracaq.
4. Render sizdən `DATABASE_URL` dəyərini istəyəcək — Neon-dan aldığınız bağlantı sətrini daxil edin.
5. Deploy tamamlandıqdan sonra saytınız `https://<servis-adı>.onrender.com` ünvanında işə düşəcək.
6. İlk dəfə **admin / admin123** ilə daxil olun və şifrəni dərhal `/users` bölməsindən dəyişin (yeni admin yaradıb köhnəsini deaktiv edə bilərsiniz, ya da "Şifrəni sıfırla" düyməsi ilə birbaşa dəyişin).

### Qeyd

Render-in pulsuz planı müəyyən müddət istifadə olunmadıqda "yatır" və növbəti sorğuda 30-60 saniyə oyanma vaxtı ola bilər — mağaza saatlarında bu adətən problem yaratmır, amma daim aktiv qalması lazımdırsa ödənişli plana keçmək lazımdır.
