/* eslint-disable */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

// --- init ---
const prisma = new PrismaClient();
const app = express();
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
app.locals.BASE_URL = BASE_URL;

// --- middleware & view engine ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------------- ROUTES ----------------

// Home (list businesses)
app.get('/', async (req, res) => {
  const businesses = await prisma.business.findMany({ orderBy: { createdAt: 'desc' } });
  res.render('index', { businesses, BASE_URL });
});

// Create business
app.post('/business', async (req, res) => {
  try {
    const {
      name,
      slug: customSlug,
      logoUrl,
      brandColor,
      publicTitle, publicSubtitle, publicFooter,
      ctaLabel, ctaText,
      instagramUrl, tiktokUrl, youtubeUrl,
      showLogo, qrLayout, steps
    } = req.body;

    const slug = (customSlug && customSlug.trim().length)
      ? customSlug.trim().toLowerCase()
      : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

    const biz = await prisma.business.create({
      data: {
        name, slug, logoUrl,
        brandColor: brandColor || null,
        publicTitle, publicSubtitle, publicFooter, ctaLabel, ctaText,
        instagramUrl, tiktokUrl, youtubeUrl,
        showLogo: !!showLogo,
        qrLayout: (qrLayout === 'horizontal' ? 'horizontal' : 'vertical')
      }
    });

    // Initial steps (textarea, one per line)
    if (steps && steps.trim().length) {
      const lines = steps.split('\n').map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        await prisma.step.create({
          data: { businessId: biz.id, order: i + 1, text: lines[i] }
        });
      }
    }

    res.redirect(`/business/${biz.slug}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error creating business: ' + (e?.message || e));
  }
});

// Admin: manage business page
app.get('/business/:slug', async (req, res) => {
  const biz = await prisma.business.findUnique({
    where: { slug: req.params.slug },
    include: { steps: true }
  });
  if (!biz) return res.status(404).send('Not found');
  res.render('business', { biz, BASE_URL });
});

// Update any single platform URL (and log redirect history)
app.post('/business/:slug/update', async (req, res) => {
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).send('Not found');

  const { platform, newUrl } = req.body;
  const platKey = (platform || '').toLowerCase();
  if (!['instagram','tiktok','youtube'].includes(platKey)) return res.status(400).send('Invalid platform');

  const current = biz[platKey + 'Url'];
  const data = {}; data[platKey + 'Url'] = newUrl || null;

  await prisma.$transaction([
    prisma.redirectHistory.create({
      data: { businessId: biz.id, platform: platKey.toUpperCase(), fromUrl: current, toUrl: newUrl || '' }
    }),
    prisma.business.update({ where: { id: biz.id }, data })
  ]);

  res.redirect(`/business/${biz.slug}`);
});

// Save theme / CTA / steps
app.post('/business/:slug/theme', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');

    const {
      brandColor, publicTitle, publicSubtitle, publicFooter,
      ctaLabel, ctaText, showLogo, qrLayout, steps,
      logoUrl, instagramUrl, tiktokUrl, youtubeUrl
    } = req.body;

    await prisma.business.update({
      where: { id: biz.id },
      data: {
        brandColor: brandColor || null,
        publicTitle: publicTitle || null,
        publicSubtitle: publicSubtitle || null,
        publicFooter: publicFooter || null,
        ctaLabel: ctaLabel || null,
        ctaText: ctaText || null,
        showLogo: !!showLogo,
        qrLayout: (qrLayout === 'horizontal' ? 'horizontal' : 'vertical'),
        logoUrl: logoUrl || null,
        instagramUrl: instagramUrl || null,
        tiktokUrl: tiktokUrl || null,
        youtubeUrl: youtubeUrl || null
      }
    });

    // Replace steps with new list
    await prisma.step.deleteMany({ where: { businessId: biz.id } });
    if (steps && steps.trim().length) {
      const lines = steps.split('\n').map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        await prisma.step.create({ data: { businessId: biz.id, order: i + 1, text: lines[i] } });
      }
    }

    res.redirect(`/business/${biz.slug}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Theme save failed: ' + (e?.message || e));
  }
});

// Toggle platform enable/disable (kept for compatibility)
app.post('/business/:slug/toggle', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');

    const { platform, enabled } = req.body;
    if (!['instagram','tiktok','youtube'].includes(platform)) return res.status(400).send('Invalid platform');

    const urlKey = platform + 'Url';
    const isEnabled = enabled === 'on';

    if (!isEnabled) {
      await prisma.business.update({ where: { id: biz.id }, data: { [urlKey]: null } });
      await prisma.redirectHistory.create({
        data: { businessId: biz.id, platform: platform.toUpperCase(), fromUrl: biz[urlKey], toUrl: '' }
      });
    } else {
      const { newUrl } = req.body;
      const toUrl = (newUrl && newUrl.trim()) ? newUrl.trim() : biz[urlKey];
      if (!toUrl) return res.status(400).send('Provide a URL to enable this platform.');
      await prisma.business.update({ where: { id: biz.id }, data: { [urlKey]: toUrl } });
      await prisma.redirectHistory.create({
        data: { businessId: biz.id, platform: platform.toUpperCase(), fromUrl: biz[urlKey], toUrl }
      });
    }

    res.redirect(`/business/${biz.slug}`);
  } catch (e) {
    console.error(e);
    res.status(500).send('Toggle failed: ' + (e?.message || e));
  }
});

// Delete business
app.post('/business/:slug/delete', async (req, res) => {
  try {
    const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
    if (!biz) return res.status(404).send('Not found');

    await prisma.redirectHistory.deleteMany({ where: { businessId: biz.id } });
    await prisma.scanEvent.deleteMany({ where: { businessId: biz.id } });
    await prisma.step.deleteMany({ where: { businessId: biz.id } });
    await prisma.business.delete({ where: { id: biz.id } });

    res.redirect('/');
  } catch (e) {
    console.error(e);
    res.status(500).send('Delete failed: ' + (e?.message || e));
  }
});

// ---------- POSTER VIEWS (single EJS with isPublic flag) ----------

// Admin preview (toolbar, A4/Letter toggle)
app.get('/poster/:slug', async (req, res) => {
  const biz = await prisma.business.findUnique({
    where: { slug: req.params.slug },
    include: { steps: true }
  });
  if (!biz) return res.status(404).send('Not found');
  res.render('poster', { biz, isPublic: false });
});

// Public flyer (no toolbar, defaults to A4)
app.get('/p/:slug', async (req, res) => {
  const biz = await prisma.business.findUnique({
    where: { slug: req.params.slug },
    include: { steps: true }
  });
  if (!biz) return res.status(404).send('Not found');
  res.render('poster', { biz, isPublic: true });
});

// ---------- Redirect + Analytics + QR ----------

// Redirect: QR target (and log scan)
app.get('/r/:slug/:platform', async (req, res) => {
  const plat = (req.params.platform || '').toLowerCase();
  const valid = ['instagram','tiktok','youtube'];
  if (!valid.includes(plat)) return res.status(400).send('Invalid platform');

  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).send('Not found');

  const target = biz[plat + 'Url'];
  if (!target) return res.redirect(`/p/${biz.slug}`);

  const ua = req.headers['user-agent'] || null;
  const ipRaw = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const ip = ipRaw.split(',')[0].trim();
  const ipHash = ip ? crypto.createHash('sha256').update(ip).digest('hex') : null;
  const referer = req.headers['referer'] || null;

  await prisma.scanEvent.create({
    data: { businessId: biz.id, platform: plat.toUpperCase(), userAgent: ua, ipHash, referer }
  });

  res.redirect(target);
});

// Analytics JSON (counts per platform)
app.get('/business/:slug/analytics.json', async (req, res) => {
  const biz = await prisma.business.findUnique({ where: { slug: req.params.slug } });
  if (!biz) return res.status(404).json({ error: 'Not found' });
  const rows = await prisma.scanEvent.groupBy({
    by: ['platform'],
    _count: { _all: true },
    where: { businessId: biz.id }
  });
  res.json({ business: biz.slug, counts: rows.map(r => ({ platform: r.platform, count: r._count._all })) });
});

// Dynamic QR images (stable, cached)
const QR_OPTS = { errorCorrectionLevel: 'M', margin: 2, width: 800 };
app.get('/qr/:slug/:platform.png', async (req, res) => {
  const { slug, platform } = req.params;
  const valid = ['instagram', 'tiktok', 'youtube'];
  if (!valid.includes(platform)) return res.status(400).send('Invalid platform');

  const biz = await prisma.business.findUnique({ where: { slug } });
  if (!biz) return res.status(404).send('Not found');

  const urlToEncode = `${BASE_URL}/r/${biz.slug}/${platform}`;
  try {
    const buf = await QRCode.toBuffer(urlToEncode, QR_OPTS);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).send('QR error');
  }
});

// --- start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${BASE_URL}`);
});
