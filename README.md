# Mağaza POS

Kiçik mağaza üçün satış, mal qəbulu, borc və kassa idarəetmə sistemi.

## Xüsusiyyətlər

- Giriş/şifrə ilə autentifikasiya, iki rol: **Admin** (tam səlahiyyət) və **Satıcı** (mal qəbulu + satış)
- Mal qəbulu: alış qiyməti, satış qiyməti, miqdar, ölçü vahidi (ədəd / kq)
- Mal qəbulunda barkodun avtomatik yaradılması və kiçik ölçülü (50x30mm) etiket çapı
- Satış (POS): barkod skaneri ilə və ya adla axtarışla, nağd / kartla / borca yazma
- Müştəri məlumatları (ad, telefon) borc satışlarında qeydə alınır
- Borc idarəetməsi: müştəri üzrə ümumi borc, qismən/tam ödəniş qeydiyyatı
- Kassa: açılış məbləği, gün ərzində nağd/kart/borc məbləğləri, kassada olmalı nağd hesablanması, bağlanışda faktiki say ilə müqayisə
- Günlük hesabat (yalnız Admin): satışlar, mal qəbulları, gündəlik qazanc (marja)

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
