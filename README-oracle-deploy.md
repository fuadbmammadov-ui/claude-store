# Oracle Cloud Deploy (Faza 1 — Render ilə paralel test)

Bu sənəd `magaza-pos`-un Oracle Cloud "Always Free" Ubuntu VM üzərində Docker ilə işə
salınmasını təsvir edir. **Bu, Render-i əvəz etmir** — hazırkı Render+Neon deployment-i
toxunulmadan, dəyişmədən işləməyə davam edir. Oracle burada bir **dublikat/paralel test
mühiti** kimi qurulur. Hər iki tərəf eyni Neon Postgres bazasına qoşulur, ona görə
Oracle tərəfində **yazma əməliyyatları (satış, kassa açılışı və s.) test edilmir** —
yalnız oxuma (login, dashboard, siyahılar) yoxlanılır.

DNS/domen/Cloudflare keçidi və Render-in dayandırılması bu sənədin hissəsi deyil —
ayrıca, sonrakı bir mərhələdədir.

## 1. VM hazırlığı

1. Oracle Cloud Console → Always Free shape ilə Ubuntu 22.04/24.04 LTS instance yaradın
   (mümkünsə Ampere A1 flex — daha çox RAM/CPU verir).
2. Public IP təyin edin (sonradan, real keçid planlaşanda, reserved/static IP-yə çevirin).
3. Security List / Network Security Group-da yalnız bu portları açın: **22 (SSH), 80, 443**.
   Port 3000-i heç vaxt ictimai açmayın — tətbiq yalnız `127.0.0.1:3000`-ə bağlanacaq.

## 2. SSH ilə qoşulub ilkin quraşdırma

```bash
ssh ubuntu@<VM-public-ip>

# qeyri-root deploy istifadəçisi
sudo adduser deploy
sudo usermod -aG sudo deploy
# öz SSH açarınızı deploy istifadəçisinə köçürün, sonra:
# /etc/ssh/sshd_config-da: PermitRootLogin no, PasswordAuthentication no
sudo systemctl restart ssh

# host firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# swap (kiçik Always Free VM-lər üçün təhlükəsizlik marjı)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Docker quraşdırılması

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
sudo systemctl enable docker
# yenidən login olun ki, docker qrupu aktivləşsin
```

## 4. Nginx quraşdırılması (host üzərində)

```bash
sudo apt update && sudo apt install -y nginx
sudo systemctl enable nginx
```

Repo-dakı `nginx/magaza-pos.conf` faylını köçürün:

```bash
sudo cp /opt/magaza-pos/nginx/magaza-pos.conf /etc/nginx/sites-available/magaza-pos.conf
sudo ln -s /etc/nginx/sites-available/magaza-pos.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Bu fazada sadə HTTP (port 80) istifadə olunur — Cloudflare/HTTPS Faza 2-də əlavə olunacaq.

## 5. Tətbiqin köçürülməsi və `.env` yaradılması

```bash
sudo mkdir -p /opt/magaza-pos && sudo chown deploy:deploy /opt/magaza-pos
git clone https://github.com/fuadbmammadov-ui/claude-store.git /opt/magaza-pos
cd /opt/magaza-pos
cp .env.example .env
chmod 600 .env
nano .env
```

`.env`-i doldururken **Render dashboard-dakı eyni dəyərləri** istifadə edin:

| Dəyişən | Dəyər |
|---|---|
| `DATABASE_URL` | Render-də olan eyni Neon connection string (direct/non-pooled) |
| `SESSION_SECRET` | Render dashboard → Environment-dən köçürün (eyni dəyər — mövcud sessiyalar üçün fərq etmir, çünki Oracle ayrı test mühitidir) |
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Render-dəki eyni dəyərlər |
| `RUN_STARTUP_SCRIPTS` | `true` (Faza 1-də Render ilə eyni davranışı saxlamaq üçün) və ya sonradan `false`-a keçirilə bilər, çünki Docker build prosesi artıq bunu tam idarə edir |

**DİQQƏT:** `DATABASE_URL` **eyni** Neon bazasına işarə edəcək. Bu Faza 1-də qəsdən belədir
(dublikat mühit, sadəcə oxuma testi üçün). Real yazma testi aparmayın.

## 6. Build və işə salma

```bash
cd /opt/magaza-pos
docker compose build
docker compose up -d
docker compose logs -f app
```

Loglarda görməlisiniz: `prisma migrate deploy` uğurla bitir → (əgər `RUN_STARTUP_SCRIPTS=true`)
seed/import-legacy skriptləri işləyir → `Mağaza POS sistemi 3000 portunda işləyir.`

## 7. Yoxlama

```bash
curl -s http://127.0.0.1:3000/health
# gözlənilən: {"status":"ok","db":"ok"}
```

Brauzerdə `http://<VM-public-ip>/` açın, login edin (yalnız oxuma əməliyyatları ilə test edin:
dashboard, məhsullar, hesabatlar). Bu müddətdə `https://magaza-pos.onrender.com` paralel və
problemsiz işləməyə davam etməlidir.

## 8. Sonrakı deploy-lar

```bash
cd /opt/magaza-pos
git pull
docker compose build
docker compose up -d
```

`prisma migrate deploy` hər dəfə avtomatik işləyir (yalnız gözləyən migration-ları tətbiq edir,
məlumat itkisi riski yoxdur).

## 9. Backup

`scripts/backup-db.sh` Neon-dan gündəlik `pg_dump` backup-ı alır (yalnız oxuma). Cron əlavə edin:

```bash
chmod +x /opt/magaza-pos/scripts/backup-db.sh
crontab -e
# əlavə edin:
0 3 * * * /opt/magaza-pos/scripts/backup-db.sh >> /opt/magaza-pos/backups/backup.log 2>&1
```

## 10. Bu fazada NƏ EDİLMİR

- Domen alınmır, Cloudflare/DNS dəyişdirilmir.
- Render deployment-i dayandırılmır və ya silinmir.
- Oracle tərəfində real yazma əməliyyatı (satış, kassa) edilmir.
- Neon-a heç bir struktur dəyişikliyi edilmir.

Bu addımlar (domen, Cloudflare HTTPS, DNS keçidi, Render-in dayandırılması) ayrıca,
istifadəçinin təsdiqi ilə həyata keçiriləcək sonrakı fazadır.
